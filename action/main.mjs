// getAdvantage first-party Action runner.
//
// Invoked from action.yml (composite). Runs the CLI shipped next to the action
// path, writes SARIF, posts an update-in-place PR summary (or job-summary
// fallback), and exits with a gate-honest code.
//
// Exit contract:
//   0  — clean GO and SARIF write succeeded (when a path was requested)
//   1  — NO-GO, ERROR, or SARIF write failure
// Outputs (GITHUB_OUTPUT): verdict, exit-code, summary-mode, sarif-written,
//   sarif-path, sarif-upload-eligible
// Never writes secrets into outputs, summaries, or logs beyond the gate's own redaction.
//
// Credential boundary: GITHUB_TOKEN / Actions OIDC stay in this trusted parent
// only. The CLI child and every project-controlled subprocess receive a
// credential-scrubbed environment (see scrubCredentialEnv).
//
// Node built-ins only. ESM.

import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSummaryMarkdown, upsertPrComment, writeJobSummary } from "./summary.mjs";
import { cliVersion, scrubCredentialEnv } from "../util.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Allowed output names — closed set prevents attacker-controlled keys. */
const OUTPUT_NAMES = new Set([
  "verdict",
  "exit-code",
  "summary-mode",
  "sarif-written",
  "sarif-path",
  "sarif-upload-eligible",
]);

function isRegularFile(p) {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Snapshot a file for current-run write proof: size, mtime, and SHA-256 content
 * digest. Digest is authoritative when mtime/size are preserved or collide.
 * @returns {{mtimeMs:number,size:number,sha256:string}|null}
 */
export function fileSnapshot(p) {
  try {
    if (!existsSync(p) || !statSync(p).isFile()) return null;
    const st = statSync(p);
    const buf = readFileSync(p);
    const sha256 = createHash("sha256").update(buf).digest("hex");
    return { mtimeMs: st.mtimeMs, size: st.size, sha256 };
  } catch {
    return null;
  }
}

/**
 * Read the getadvantage/runNonce property from a SARIF document, if present.
 * @param {string} abs
 * @returns {string}
 */
export function readSarifRunNonce(abs) {
  try {
    const doc = JSON.parse(readFileSync(abs, "utf8"));
    const n = doc?.runs?.[0]?.properties?.["getadvantage/runNonce"];
    return typeof n === "string" ? n : "";
  } catch {
    return "";
  }
}

/**
 * True when path is a parseable SARIF 2.1 file created or replaced this run.
 * Content digest proves replacement even when size matches and mtime is preserved.
 * When expectedNonce is set (Action parent), the file must bind that exact nonce —
 * a stale file touched/replaced by a repo child without the nonce never counts.
 * @param {string} abs
 * @param {{mtimeMs:number,size:number,sha256?:string}|null} before
 * @param {{expectedNonce?:string}} [opts]
 */
export function isCurrentSarifWrite(abs, before, opts = {}) {
  const after = fileSnapshot(abs);
  if (!after) return false;
  // Must be current parseable SARIF 2.1 — never mark garbage/stale as written.
  let doc;
  try {
    doc = JSON.parse(readFileSync(abs, "utf8"));
    if (!doc || doc.version !== "2.1.0" || !Array.isArray(doc.runs)) return false;
  } catch {
    return false;
  }
  const expectedNonce = typeof opts.expectedNonce === "string" ? opts.expectedNonce : "";
  if (expectedNonce) {
    const got = doc?.runs?.[0]?.properties?.["getadvantage/runNonce"];
    if (got !== expectedNonce) return false;
  }
  if (!before) return true;
  // Content identity is required when a pre-existing file was present — mtime/size
  // alone can collide (same-size rewrite, touch -r / preserved mtime).
  if (before.sha256 && after.sha256) {
    return after.sha256 !== before.sha256;
  }
  // Legacy snapshots without digest: still require observable change.
  return after.mtimeMs !== before.mtimeMs || after.size !== before.size;
}

function truthy(v) {
  if (v == null || v === "") return false;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/** Reject control chars and newlines in GITHUB_OUTPUT names/values. */
function isSafeOutputToken(s) {
  if (typeof s !== "string") return false;
  if (s.length > 4096) return false;
  // No C0 controls, no DEL, no newlines/CR.
  return !/[\u0000-\u001F\u007F]/.test(s);
}

/**
 * Validate INPUT_SARIF_FILE: workspace-relative, no controls/newlines,
 * no absolute path, no `..` escape. Returns { ok, rel } or { ok:false, reason }.
 */
export function validateSarifInputPath(raw, cwd, workspace) {
  const s = String(raw ?? "");
  if (!s || !s.trim()) {
    return { ok: false, reason: "empty" };
  }
  if (/[\u0000-\u001F\u007F]/.test(s)) {
    return { ok: false, reason: "controls" };
  }
  if (s.includes("\n") || s.includes("\r")) {
    return { ok: false, reason: "newline" };
  }
  // Absolute paths (POSIX, Windows drive, UNC) are rejected — must be relative.
  if (path.isAbsolute(s) || /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith("\\\\") || s.startsWith("//")) {
    return { ok: false, reason: "absolute" };
  }
  const norm = s.replace(/\\/g, "/");
  if (norm.split("/").some((seg) => seg === "..")) {
    return { ok: false, reason: "escape" };
  }
  // No empty segments that look like injection padding.
  if (norm.includes("//") || norm.startsWith("/")) {
    return { ok: false, reason: "absolute" };
  }
  const abs = path.resolve(cwd, s);
  const ws = workspace || cwd;
  const relToWs = path.relative(ws, abs);
  if (!relToWs || relToWs.startsWith("..") || path.isAbsolute(relToWs)) {
    return { ok: false, reason: "outside-workspace" };
  }
  return { ok: true, rel: s.replace(/\\/g, "/"), abs, outPath: relToWs.replace(/\\/g, "/") };
}

/**
 * Write a single-line GITHUB_OUTPUT record. Rejects unsafe names/values so a
 * hostile path cannot inject additional output keys via newlines.
 */
export function setOutput(name, value, env = process.env) {
  if (!OUTPUT_NAMES.has(name)) {
    console.error(`getadvantage-action: refused unknown output name ${JSON.stringify(name)}`);
    return;
  }
  let v = String(value ?? "");
  if (!isSafeOutputToken(name) || !isSafeOutputToken(v)) {
    console.error(`getadvantage-action: refused unsafe output value for ${name}`);
    // Fall back to empty/safe enums so a required check never sees injected keys.
    if (name === "verdict") v = "ERROR";
    else if (name === "exit-code") v = "1";
    else if (name === "summary-mode") v = "none";
    else if (name === "sarif-written" || name === "sarif-upload-eligible") v = "false";
    else v = "";
  }
  const out = env.GITHUB_OUTPUT;
  if (out) {
    appendFileSync(out, `${name}=${v}\n`, "utf8");
  }
  // Log only safe, already-constrained values (never raw unvalidated paths).
  console.log(`getadvantage-action: output ${name}=${v}`);
}

function setErrorOutputs(env) {
  setOutput("verdict", "ERROR", env);
  setOutput("exit-code", "1", env);
  setOutput("summary-mode", "none", env);
  setOutput("sarif-written", "false", env);
  setOutput("sarif-path", "", env);
  setOutput("sarif-upload-eligible", "false", env);
}

function parseRepo(env) {
  const full = env.GITHUB_REPOSITORY || "";
  const i = full.indexOf("/");
  if (i <= 0) return null;
  return { owner: full.slice(0, i), repo: full.slice(i + 1) };
}

function prNumber(env) {
  const pathEv = env.GITHUB_EVENT_PATH;
  if (pathEv && existsSync(pathEv)) {
    try {
      const ev = JSON.parse(readFileSync(pathEv, "utf8"));
      const n = ev?.pull_request?.number || ev?.issue?.number;
      if (n) return Number(n);
    } catch {
      /* ignore */
    }
  }
  const ref = env.GITHUB_REF || "";
  const m = /^refs\/pull\/(\d+)\//.exec(ref);
  return m ? Number(m[1]) : null;
}

function runUrl(env) {
  const server = (env.GITHUB_SERVER_URL || "https://github.com").replace(/\/$/, "");
  const repo = env.GITHUB_REPOSITORY || "";
  const runId = env.GITHUB_RUN_ID || "";
  if (!repo || !runId) return "";
  return `${server}/${repo}/actions/runs/${runId}`;
}

function isPullRequestEvent(env) {
  const name = env.GITHUB_EVENT_NAME || "";
  return name === "pull_request" || name === "pull_request_target";
}

/**
 * Detect fork PR (head repo ≠ base repo). Upload may be skipped on forks
 * (documented platform limit); never use pull_request_target to bypass.
 */
export function isForkPullRequest(env) {
  if ((env.GITHUB_EVENT_NAME || "") !== "pull_request") return false;
  const pathEv = env.GITHUB_EVENT_PATH;
  if (!pathEv || !existsSync(pathEv)) return false;
  try {
    const ev = JSON.parse(readFileSync(pathEv, "utf8"));
    const head = ev?.pull_request?.head?.repo?.full_name;
    const base = ev?.pull_request?.base?.repo?.full_name;
    if (head && base && head !== base) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Build CLI child env: scrub all credentials, then optionally re-add only the
 * getAdvantage report key when --report is requested and the per-run SARIF
 * attribution nonce (trusted CLI only). Never re-add GITHUB_TOKEN or Actions
 * OIDC material — those stay in the trusted Action parent. The nonce is scrubbed
 * from all project-controlled children (tsc/build) via isCredentialEnvKey.
 *
 * @param {object} env
 * @param {{wantReport?:boolean, sarifNonce?:string}} [opts]
 */
export function buildCliChildEnv(env, { wantReport, sarifNonce } = {}) {
  const childEnv = scrubCredentialEnv(env);
  if (wantReport && env.GETADVANTAGE_API_KEY) {
    childEnv.GETADVANTAGE_API_KEY = String(env.GETADVANTAGE_API_KEY);
  }
  // Explicit deletes for defense in depth (scrub already removes them).
  delete childEnv.GITHUB_TOKEN;
  delete childEnv.GH_TOKEN;
  delete childEnv.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  delete childEnv.ACTIONS_ID_TOKEN_REQUEST_URL;
  delete childEnv.ACTIONS_RUNTIME_TOKEN;
  delete childEnv.NPM_TOKEN;
  delete childEnv.NODE_AUTH_TOKEN;
  delete childEnv.GETADVANTAGE_SARIF_RUN_NONCE;
  if (!wantReport) {
    delete childEnv.GETADVANTAGE_API_KEY;
    delete childEnv.GETADVANTAGE_REPORT;
  }
  // Re-add attribution nonce only for the trusted CLI (never project tsc/npm).
  if (sarifNonce) {
    childEnv.GETADVANTAGE_SARIF_RUN_NONCE = String(sarifNonce);
  }
  return childEnv;
}

/**
 * Core entry — exported for hostile unit tests.
 * @param {object} [env] defaults to process.env
 * @param {{fetchImpl?: typeof fetch}} [opts] inject local fetch for PR comments (tests)
 * @returns {Promise<number>} exit code
 */
export async function runAction(env = process.env, opts = {}) {
  const actionPath = env.GETADVANTAGE_ACTION_PATH || path.join(__dirname, "..");
  const cliEntry = path.join(actionPath, "index.mjs");
  const wantComment = env.INPUT_COMMENT == null || env.INPUT_COMMENT === "" ? true : truthy(env.INPUT_COMMENT);
  const wantReport = env.INPUT_REPORT == null || env.INPUT_REPORT === "" ? true : truthy(env.INPUT_REPORT);
  const cwd = process.cwd();
  const workspace = env.GETADVANTAGE_WORKSPACE || env.GITHUB_WORKSPACE || cwd;

  // Hard-refuse pull_request_target: never spawn the gate, never touch PR
  // comments, never claim SARIF — untrusted PR code must not run with base
  // secrets. Prefer pull_request (fork-safe job-summary path).
  if (env.GITHUB_EVENT_NAME === "pull_request_target") {
    console.error(
      "getadvantage-action: GITHUB_EVENT_NAME=pull_request_target is refused. Prefer pull_request. Not spawning the gate, not writing SARIF claims, not posting PR comments.",
    );
    setErrorOutputs(env);
    return 1;
  }

  if (!existsSync(cliEntry)) {
    console.error(`getadvantage-action: CLI entry not found at ${cliEntry}`);
    setErrorOutputs(env);
    return 1;
  }

  const pathCheck = validateSarifInputPath(env.INPUT_SARIF_FILE || "getadvantage.sarif", cwd, workspace);
  if (!pathCheck.ok) {
    console.error(
      `getadvantage-action: invalid INPUT_SARIF_FILE (${pathCheck.reason}) — refusing path injection; not GO.`,
    );
    setErrorOutputs(env);
    return 1;
  }
  const sarifRel = pathCheck.rel;
  const sarifAbs = pathCheck.abs;

  // Snapshot pre-existing SARIF so a fatal/stale file is never reported as
  // written this run (and never uploaded).
  const preSarif = fileSnapshot(sarifAbs);

  // Per-run nonce: generated only in this trusted parent, passed only to the
  // trusted CLI, scrubbed from project-controlled children, required on return.
  const sarifNonce = randomBytes(16).toString("hex");

  const args = [cliEntry, "check", "--ci", "--json", "--no-overview", "--no-brief-check", "--sarif", sarifRel];
  if (wantReport) args.push("--report");

  const childEnv = buildCliChildEnv(env, { wantReport, sarifNonce });

  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: childEnv,
    timeout: 15 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
  });

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  let doc = null;
  const stdout = result.stdout || "";
  try {
    doc = JSON.parse(stdout.trim());
  } catch {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        doc = JSON.parse(stdout.slice(start, end + 1));
      } catch {
        doc = null;
      }
    }
  }

  const spawnFailed = result.error || result.status === null;
  let exitCode = typeof result.status === "number" ? result.status : 1;
  let verdict = exitCode === 0 ? "GO" : "NO-GO";

  if (spawnFailed) {
    console.error(`getadvantage-action: failed to spawn gate: ${result.error?.message || "unknown"}`);
    verdict = "ERROR";
    exitCode = 1;
  } else if (doc && (doc.verdict === "GO" || doc.verdict === "NO-GO")) {
    verdict = doc.verdict;
    if (typeof doc.exitCode === "number") exitCode = doc.exitCode;
  } else if (!doc && exitCode === 0) {
    console.error("getadvantage-action: gate produced no parseable --json document; treating as ERROR (not GO).");
    verdict = "ERROR";
    exitCode = 1;
  }

  const sarifOk = isCurrentSarifWrite(sarifAbs, preSarif, { expectedNonce: sarifNonce });
  let sarifOutPath = "";
  if (sarifOk) {
    sarifOutPath = pathCheck.outPath || sarifRel;
    // Double-check path is still a single-line safe token before output.
    if (!isSafeOutputToken(sarifOutPath)) {
      console.error("getadvantage-action: SARIF path unsafe for GITHUB_OUTPUT — omitting.");
      sarifOutPath = "";
    }
  } else if (exitCode === 0) {
    console.error(
      `getadvantage-action: SARIF not written this run at ${sarifRel} (missing/stale or nonce mismatch) — failing (not GO).`,
    );
    verdict = "ERROR";
    exitCode = 1;
  } else if (isRegularFile(sarifAbs) && preSarif && !sarifOk) {
    console.warn(
      "getadvantage-action: pre-existing SARIF unchanged or unattributed this run — treating as not written (no stale upload).",
    );
  }

  // Fork PRs: documented skip — platform often blocks code-scanning upload /
  // secrets. Same-repo runs remain eligible when a current SARIF exists.
  const fork = isForkPullRequest(env);
  const uploadEligible = sarifOk && !fork;

  setOutput("verdict", verdict, env);
  setOutput("exit-code", String(exitCode), env);
  setOutput("sarif-written", sarifOk ? "true" : "false", env);
  setOutput("sarif-path", sarifOk ? sarifOutPath : "", env);
  setOutput("sarif-upload-eligible", uploadEligible ? "true" : "false", env);

  const version = cliVersion();
  const body = buildSummaryMarkdown({
    verdict,
    exitCode,
    checks: doc?.checks || [],
    version,
    runUrl: runUrl(env),
    sarifNote: sarifOk
      ? fork
        ? "SARIF written this run; upload skipped on fork PR (documented platform limit)."
        : "SARIF written this run for code scanning upload (when permissions + entitlement allow)."
      : "SARIF was not written this run — code scanning upload skipped.",
    includeMarker: true,
  });

  // body is already built via sanitizeSummaryText on user-derived fields;
  // do not re-sanitize the full document (that would break the stable marker).
  let summaryMode = "none";

  // Ownership is resolved from the authenticated token (/user), never from
  // GITHUB_ACTOR (commonly a human PR author). Do not pass actorLogin here.
  const tryPr =
    wantComment &&
    isPullRequestEvent(env) &&
    env.GITHUB_TOKEN &&
    parseRepo(env) &&
    prNumber(env);

  if (tryPr) {
    const repoInfo = parseRepo(env);
    const num = prNumber(env);
    // Token stays in this parent only — never passed into CLI/tsc env.
    // fetchImpl is injectable for tests so no scenario contacts api.github.com.
    const up = await upsertPrComment({
      token: env.GITHUB_TOKEN,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      issueNumber: num,
      body,
      fetchImpl: typeof opts.fetchImpl === "function" ? opts.fetchImpl : undefined,
    });
    if (up.ok) {
      summaryMode = "pr-comment";
      console.log(`getadvantage-action: PR comment ${up.action} (#${up.id})`);
    } else {
      console.warn(`getadvantage-action: PR comment unavailable (${up.reason}) — falling back to job summary.`);
    }
  }

  if (summaryMode === "none") {
    const stepSummary = env.GITHUB_STEP_SUMMARY;
    if (stepSummary) {
      try {
        writeJobSummary(stepSummary, body, { appendFileSync });
        summaryMode = "job-summary";
        console.log("getadvantage-action: wrote job summary");
      } catch (e) {
        console.warn(`getadvantage-action: job summary write failed: ${e.message || e}`);
      }
    } else {
      console.log("--- getAdvantage summary ---");
      console.log(body);
    }
  }

  setOutput("summary-mode", summaryMode, env);
  return exitCode === 0 && verdict === "GO" ? 0 : 1;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  runAction(process.env)
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`getadvantage-action: fatal ${e.message || e}`);
      try {
        setErrorOutputs(process.env);
      } catch {
        /* ignore */
      }
      process.exit(1);
    });
}
