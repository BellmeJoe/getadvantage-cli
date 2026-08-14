// getAdvantage CLI — THE CONNECTOR (`--report` · `--report-dry-run` · `login` · `logout`).
//
// Opt-in bridge from the local gate to your getAdvantage account: after `check`
// or `fan-in` computes its verdict, `--report` (or GETADVANTAGE_REPORT=1) POSTs
// the RUN REPORT to `POST {api}/api/v1/runs` with your `adv_live_…` key.
// `--report-dry-run` builds the same body and prints it (plus a human summary)
// with no network call — transparency for what would leave the machine.
//
// HONESTY (hard rule — this is the brand's core promise, re-scoped precisely):
//   • LOCAL BY DEFAULT. No command ever touches the network unless you
//     explicitly pass `--report` / set GETADVANTAGE_REPORT=1.
//   • What is sent = the run's VERDICT + METADATA — exactly the `--json`
//     document (verdict, exit code, check results / lane outcomes) plus the
//     repo name, branch and commit id. NEVER your source code, your diffs,
//     or your files.
//   • Reporting is BEST-EFFORT: a network hiccup must not turn a GO into a
//     failed CI step. The gate's verdict stays the exit code unless you
//     explicitly pass `--report-required`.
//   • Dry-run never posts, even when combined with `--report`.
//
// Key resolution (never printed back, never logged):
//   env GETADVANTAGE_API_KEY  >  ~/.getadvantage/config.json ({ apiKey, apiUrl? })
// Endpoint resolution:
//   env GETADVANTAGE_API_URL  >  config.apiUrl  >  https://getadvantage.app
// (The env override is load-bearing: it's how the hermetic test suite points
// the CLI at a local mock server.)
//
// Node built-ins only. ESM. Requires Node >= 18 (global fetch).

import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import path from "node:path";
import { c, gitSafe, readJsonFile } from "./util.mjs";

export const DEFAULT_API_BASE = "https://getadvantage.app";

// ---------------------------------------------------------------------------
// user config (~/.getadvantage/config.json) — the PER-USER login store.
// ---------------------------------------------------------------------------
// Deliberately NOT the repo's .getadvantage/ project dir (that one is committed
// code-context — brief/handoff/ledger). Credentials live in the USER's home,
// mode 0600, and are never written into a repo. GETADVANTAGE_CONFIG_DIR
// overrides the location (used by the hermetic tests; also handy for CI
// sandboxes) — it must never default anywhere inside a repo.

export function userConfigDir() {
  return process.env.GETADVANTAGE_CONFIG_DIR || path.join(homedir(), ".getadvantage");
}

export function userConfigPath() {
  return path.join(userConfigDir(), "config.json");
}

export function readUserConfig() {
  // BOM-tolerant (PowerShell default) — see util.readJsonFile.
  return readJsonFile(userConfigPath()).json || {};
}

function writeUserConfig(cfg) {
  const dir = userConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const p = userConfigPath();
  // mode 0600 — owner-only. (On Windows the POSIX bits are advisory; the file
  // still lands under the user's own profile dir.)
  writeFileSync(p, JSON.stringify(cfg, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(p, 0o600);
  } catch {
    /* best-effort on platforms without POSIX modes */
  }
  return p;
}

/** The API base URL: env > stored config > production default. */
export function resolveApiBase() {
  const base = process.env.GETADVANTAGE_API_URL || readUserConfig().apiUrl || DEFAULT_API_BASE;
  return String(base).replace(/\/+$/, "");
}

/** The API key: env > stored config. Returns "" when logged out. */
export function resolveApiKey() {
  return process.env.GETADVANTAGE_API_KEY || readUserConfig().apiKey || "";
}

/**
 * Where the API key resolved from — for transparency messaging only.
 * Never returns or prints the key itself.
 * @returns {"env"|"config"|"none"}
 */
export function resolveKeySource() {
  if (process.env.GETADVANTAGE_API_KEY) return "env";
  if (readUserConfig().apiKey) return "config";
  return "none";
}

/** Is reporting switched on by environment (GETADVANTAGE_REPORT=1)? */
export function envReportOn() {
  const v = String(process.env.GETADVANTAGE_REPORT || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

// ---------------------------------------------------------------------------
// repo + ref derivation — GitHub Actions env first, then git, then the dir.
// ---------------------------------------------------------------------------

/** `owner/name` from a git remote URL (git@ / https / ssh forms), else "". */
export function repoFromRemoteUrl(url) {
  if (!url) return "";
  let u = String(url).trim().replace(/\.git$/i, "");
  const scp = u.match(/^[\w.+-]+@[\w.-]+:(.+)$/); // git@github.com:owner/name
  if (scp) {
    u = scp[1];
  } else {
    try {
      u = new URL(u).pathname; // https://github.com/owner/name · ssh://git@host/owner/name
    } catch {
      /* not a URL — fall through with the raw string */
    }
  }
  const parts = u.split("/").filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join("/");
  return "";
}

/** `project.repo` for the ingest contract: GITHUB_REPOSITORY > origin remote > dir basename. */
export function deriveRepo(cwd) {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const fromRemote = repoFromRemoteUrl(gitSafe(["remote", "get-url", "origin"], { cwd }));
  if (fromRemote) return fromRemote;
  return path.basename(cwd);
}

/** `ref` for the ingest contract: { branch?, sha?, ciUrl? }. Tolerates a
 *  detached HEAD (CI checks out a sha) — branch is simply omitted then. */
export function deriveRef(cwd) {
  const ref = {};
  const branch = process.env.GITHUB_REF_NAME || gitSafe(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  if (branch && branch !== "HEAD") ref.branch = branch;
  const sha = process.env.GITHUB_SHA || gitSafe(["rev-parse", "HEAD"], { cwd });
  if (sha) ref.sha = sha;
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID) {
    ref.ciUrl = `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
  }
  return ref;
}

/**
 * The base ref for CI base comparisons (`--ci` default): the PR base branch
 * when GitHub Actions provides one, else origin/main, else main — the first
 * that actually resolves in this checkout. Every consumer of the base ref
 * already degrades gracefully when it doesn't resolve.
 */
export function ciDefaultBaseRef(cwd) {
  const candidates = [];
  const prBase = process.env.GITHUB_BASE_REF;
  if (prBase) candidates.push(`origin/${prBase}`, prBase);
  candidates.push("origin/main", "main");
  for (const cand of candidates) {
    if (gitSafe(["rev-parse", "--verify", "--quiet", cand], { cwd })) return cand;
  }
  return "origin/main"; // unresolvable — downstream checks skip honestly
}

// ---------------------------------------------------------------------------
// lane mapping — fan-in outcomes → the ingest contract's status set.
// ---------------------------------------------------------------------------

const INGEST_LANE_STATUS = new Set(["landed", "quarantined", "conflict", "skipped", "clean"]);

/** Map the fan-in --json lane entries onto the ingest `lanes` shape.
 *  `tool` is omitted — the CLI doesn't know which model ran a lane and we
 *  never fabricate it. */
export function lanesForIngest(reportLanes) {
  return (reportLanes || []).map((l) => ({
    lane: String(l.branch || `lane-${l.lane}`).slice(0, 120),
    status: INGEST_LANE_STATUS.has(l.outcome) ? l.outcome : "skipped",
    ...(l.detail ? { detail: String(l.detail).slice(0, 500) } : {}),
  }));
}

// ---------------------------------------------------------------------------
// the POST — build the contract body and send it.
// ---------------------------------------------------------------------------

// The ingest endpoint caps `payload` at 256KB. Stay safely under it: if the
// full --json doc would blow the cap, send an honest stub instead of a 413.
const MAX_BODY_BYTES = 240 * 1024;

/** Build the exact `POST /api/v1/runs` body from a run's --json document. */
export function buildRunBody({ cwd, kind, doc, lanes }) {
  const body = {
    project: {
      repo: String(deriveRepo(cwd)).slice(0, 200),
      name: path.basename(cwd).slice(0, 120),
    },
    kind,
    verdict: String(doc.verdict || "").slice(0, 80),
    exitCode: Number.isInteger(doc.exitCode) ? doc.exitCode : doc.exitCode ? 1 : 0,
    payload: doc,
  };
  const ref = deriveRef(cwd);
  if (Object.keys(ref).length > 0) body.ref = ref;
  if (lanes && lanes.length > 0) body.lanes = lanes;

  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_BODY_BYTES) {
    body.payload = {
      command: doc.command,
      verdict: doc.verdict,
      exitCode: doc.exitCode,
      generatedAt: doc.generatedAt,
      truncated: true,
      note: "full report exceeded the ingest size cap; verdict + outcome retained, detail dropped",
    };
  }
  return body;
}

/**
 * Transparency mode (`--report-dry-run`): build the exact body `--report` would
 * POST via `buildRunBody()`, print a one-screen human summary + the full JSON
 * body, resolved endpoint, byte size, and whether a key resolved (source only
 * — never the key). Makes no network call.
 *
 * Machine-parseable body block (for tests / tooling):
 *   --- report body (N bytes) ---
 *   <exact JSON.stringify of the POST body>
 *   --- end report body ---
 *
 * @param {object} o
 * @param {string} o.cwd
 * @param {"check"|"fan-in"|"deploy"} o.kind
 * @param {object} o.doc
 * @param {Array}  [o.lanes]
 * @returns {{ ok: true, body: object, bytes: number, endpoint: string, keySource: "env"|"config"|"none" }}
 */
export function reportDryRun(o) {
  const base = resolveApiBase();
  const keySource = resolveKeySource();
  const body = buildRunBody({ cwd: o.cwd, kind: o.kind, doc: o.doc, lanes: o.lanes });
  // Compact JSON — identical serialization to the live POST path.
  const raw = JSON.stringify(body);
  const bytes = Buffer.byteLength(raw, "utf8");
  const endpoint = `${base}/api/v1/runs`;

  console.log(c.gray("  → report dry-run — show what would leave this machine (nothing is sent)"));
  console.log("");
  console.log(c.bold("  What would leave"));

  const proj = body.project || {};
  const projLabel =
    proj.repo && proj.name && proj.name !== proj.repo
      ? `${proj.repo} (${proj.name})`
      : proj.repo || proj.name || "—";
  console.log(`  Project: ${projLabel}`);
  if (body.ref && Object.keys(body.ref).length > 0) {
    const bits = [];
    if (body.ref.branch) bits.push(body.ref.branch);
    if (body.ref.sha) bits.push(String(body.ref.sha).slice(0, 12));
    if (body.ref.ciUrl) bits.push(body.ref.ciUrl);
    console.log(`  Ref: ${bits.join(" · ") || "—"}`);
  } else {
    console.log("  Ref: —");
  }
  console.log(`  Kind: ${body.kind}`);
  console.log(`  Verdict: ${body.verdict} · exitCode ${body.exitCode}`);

  const payload = body.payload || {};
  if (payload.truncated) {
    console.log(c.yellow("  Payload: truncated stub (full report exceeded the ingest size cap)"));
    if (payload.note) console.log(`    ${payload.note}`);
  } else if (Array.isArray(payload.checks)) {
    console.log("  Check results that would leave:");
    for (const ch of payload.checks) {
      const n = Array.isArray(ch.findings) ? ch.findings.length : 0;
      const findBit = n > 0 ? ` · ${n} finding${n === 1 ? "" : "s"}` : "";
      const detail = ch.detail ? ` — ${String(ch.detail).slice(0, 140)}` : "";
      console.log(`    · ${ch.label}: ${ch.status}${findBit}${detail}`);
    }
    const allFindings = [];
    for (const ch of payload.checks) {
      if (Array.isArray(ch.findings)) {
        for (const f of ch.findings) allFindings.push(f);
      }
    }
    if (allFindings.length > 0) {
      // Header rows only — do not re-print remediation bodies. Plain `check`
      // already printed paste-ready secrets.ignore above; re-printing here
      // duplicated ~40% of the dry-run block and slice(0, 8) truncated JSON
      // mid-object (unclosed braces). Field families stay named; bodies stay
      // complete-or-absent (absent).
      console.log("  Findings that would leave (file:line · fp · authId · remediation):");
      let anyRemediation = false;
      for (const f of allFindings.slice(0, 40)) {
        const loc = f.file
          ? `${f.file}${typeof f.startLine === "number" ? `:${f.startLine}` : ""}`
          : "—";
        const label = f.label || f.ruleId || "finding";
        const fpBit = f.fp ? `: ${f.fp}` : "";
        const authBit = f.authId ? ` · auth ${f.authId}` : "";
        const hasRem = Array.isArray(f.remediation) && f.remediation.length > 0;
        if (hasRem) anyRemediation = true;
        const remBit = hasRem ? " · remediation" : "";
        console.log(`    · ${loc} → ${label}${fpBit}${authBit}${remBit}`);
      }
      if (allFindings.length > 40) {
        console.log(`    … +${allFindings.length - 40} more findings`);
      }
      if (anyRemediation) {
        console.log(
          "    remediation: already printed above (paste-ready secrets.ignore) — not re-printed here",
        );
      }
    }
  }

  if (Array.isArray(body.lanes) && body.lanes.length > 0) {
    console.log("  Lane outcomes that would leave:");
    for (const l of body.lanes) {
      const detail = l.detail ? ` — ${String(l.detail).slice(0, 120)}` : "";
      console.log(`    · ${l.lane}: ${l.status}${detail}`);
    }
  } else if (Array.isArray(payload.lanes) && payload.lanes.length > 0) {
    console.log("  Lane outcomes that would leave:");
    for (const l of payload.lanes) {
      const name = l.lane ?? l.branch ?? "?";
      const status = l.status || l.outcome || "?";
      const detail = l.detail ? ` — ${String(l.detail).slice(0, 120)}` : "";
      console.log(`    · ${name}: ${status}${detail}`);
    }
  }

  console.log("");
  // Precise disclosure: report *body* never carries source/diffs/files/key value/env.
  // Transport differs: live --report sends the key as Authorization header only;
  // dry-run sends nothing at all. (Older "Never sent: … API key …" over-claimed —
  // the key *is* sent on live --report, just never in the body / never displayed.)
  console.log(
    c.gray("  Never sent in report body: source code · diffs · files · API key value · environment"),
  );
  console.log(
    c.gray(
      "  Transport: live --report sends the key as Authorization header only; dry-run sends nothing",
    ),
  );
  console.log("");
  console.log(`  Endpoint: ${endpoint}`);
  console.log(`  Body size: ${bytes} bytes`);
  if (keySource === "env") {
    console.log("  API key: resolved from env (value never shown)");
  } else if (keySource === "config") {
    console.log("  API key: resolved from config (value never shown)");
  } else {
    console.log("  API key: not resolved (a live --report would send nothing)");
  }
  console.log("");
  // Markers deliberately plain ASCII so tests extract the body without ambiguity.
  console.log(`--- report body (${bytes} bytes) ---`);
  console.log(raw);
  console.log("--- end report body ---");

  return { ok: true, body, bytes, endpoint, keySource };
}

/** POST the run. Never throws — returns { status, json } or { status: 0, error }. */
async function postRun({ base, key, body }) {
  const url = `${base}/api/v1/runs`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON error body — status alone still tells the story */
    }
    return { status: res.status, json };
  } catch (e) {
    const why =
      e && e.name === "AbortError"
        ? "timed out after 15s"
        : String((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e);
    return { status: 0, error: why };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Report one finished run to the platform (the `--report` path).
 *
 * Called AFTER the gate computed its verdict; must never change that verdict.
 * Prints its own honest, human status lines (console.log/console.error — in
 * --json mode both are already routed to stderr, so the JSON stdout stays pure).
 *
 * @param {object} o
 * @param {string} o.cwd     repo root
 * @param {"check"|"fan-in"|"deploy"} o.kind
 * @param {object} o.doc     the run's --json document (verdict, exitCode, …)
 * @param {Array}  [o.lanes] fan-in lane entries (the --json `lanes` array)
 * @param {boolean} [o.required]  --report-required (affects messaging only;
 *                                the caller owns the exit code)
 * @returns {Promise<{ok: boolean, url?: string}>}
 */
export async function reportRun(o) {
  const key = resolveApiKey();
  const base = resolveApiBase();

  if (!key) {
    console.error(c.yellow("  ⚠ --report: no getAdvantage API key found — nothing was sent."));
    console.error(c.gray("     Set GETADVANTAGE_API_KEY, or store a key once with `getadvantage login`."));
    if (o.required) {
      console.error(c.red("  ✗ --report-required: cannot post the run without a key — exiting non-zero."));
    } else {
      console.error(c.gray("     (Reporting is best-effort — the exit code still reflects the local verdict.)"));
    }
    return { ok: false };
  }

  console.log(c.gray(`  → reporting this run to ${base} (verdict + metadata — never your source code)`));

  const body = buildRunBody({ cwd: o.cwd, kind: o.kind, doc: o.doc, lanes: o.lanes });
  const res = await postRun({ base, key, body });

  if (res.status === 200 && res.json && (res.json.url || res.json.id)) {
    const shown = res.json.url || `${base} (run ${res.json.id})`;
    console.log(`  ${c.green("→ verdict posted:")} ${c.bold(shown)}`);
    return { ok: true, url: res.json.url || "" };
  }

  // Specific, human failure messages per contract status. NEVER echo the key.
  const apiErr = res.json && res.json.error ? ` (${res.json.error})` : "";
  if (res.status === 401) {
    console.error(c.red(`  ✗ report rejected — 401${apiErr}: the API key was not accepted.`));
    console.error(c.gray("     Re-run `getadvantage login` with a current adv_live_ key (or fix GETADVANTAGE_API_KEY)."));
  } else if (res.status === 413) {
    console.error(c.red(`  ✗ report rejected — 413${apiErr}: the run report exceeded the ingest size limit.`));
    console.error(c.gray("     This shouldn't happen (the CLI pre-truncates); please report it as a bug."));
  } else if (res.status === 429) {
    console.error(c.red(`  ✗ report rejected — 429${apiErr}: rate-limited. Try again in a bit.`));
  } else if (res.status === 400) {
    console.error(c.red(`  ✗ report rejected — 400${apiErr}: the endpoint didn't accept the payload.`));
    console.error(c.gray("     A newer CLI may fix this: `npx getadvantage@latest`."));
  } else if (res.status === 0) {
    console.error(c.red(`  ✗ could not reach ${base} — ${res.error}.`));
  } else {
    console.error(c.red(`  ✗ report failed — HTTP ${res.status}${apiErr}.`));
  }

  if (o.required) {
    console.error(c.red("  ✗ --report-required: the run was not posted — exiting non-zero."));
  } else {
    console.error(c.gray("     The verdict was NOT posted. Local verdict stands — the exit code is unchanged."));
    console.error(c.gray("     (Pass --report-required to fail CI when posting fails.)"));
  }
  return { ok: false };
}

// ---------------------------------------------------------------------------
// `getadvantage login` / `logout` — the per-user key store.
// ---------------------------------------------------------------------------

const KEY_SHAPE = /^adv_live_[a-z0-9]{10,}$/;

/** Prompt for one line on stdin, echo suppressed on a TTY (best-effort). The
 *  prompt itself goes to stderr so piped stdout stays clean. */
function promptForKey(question) {
  return new Promise((resolve, reject) => {
    process.stderr.write(question);
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: process.stdin.isTTY === true,
    });
    if (process.stdin.isTTY) {
      // Mute the echo so the key never appears on screen. Private-ish readline
      // surface; if a future Node drops it, typing degrades to visible — the
      // key still is never printed BACK by us.
      rl._writeToOutput = () => {};
    }
    // Ctrl+C / close without an answer is an abort — must not look like success
    // (finding: login-abort-exit0).
    const onClose = () => {
      reject(Object.assign(new Error("login aborted"), { code: "LOGIN_ABORTED" }));
    };
    rl.once("close", onClose);
    rl.question("", (answer) => {
      rl.removeListener("close", onClose);
      rl.close();
      if (process.stdin.isTTY) process.stderr.write("\n");
      resolve(String(answer || "").trim());
    });
  });
}

/**
 * `getadvantage login` — store an adv_live_ key in ~/.getadvantage/config.json
 * (mode 0600). Reads GETADVANTAGE_API_KEY when set (no prompt needed), else
 * prompts. Never prints the key back.
 */
export async function runLogin() {
  console.log(c.bold("\n  Login — connect this machine to your getAdvantage account\n"));

  let key = String(process.env.GETADVANTAGE_API_KEY || "").trim();
  if (key) {
    console.log(c.gray("  Using the key from GETADVANTAGE_API_KEY (value never shown)."));
  } else {
    try {
      key = await promptForKey("  Paste your getAdvantage API key (adv_live_…): ");
    } catch (e) {
      if (e && e.code === "LOGIN_ABORTED") {
        console.error(c.red("  ✗ Login aborted — nothing was stored."));
        return 1;
      }
      throw e;
    }
  }

  if (!key) {
    console.error(c.red("  ✗ No key entered — nothing was stored."));
    return 1;
  }
  if (!KEY_SHAPE.test(key)) {
    console.error(c.red("  ✗ That doesn't look like a getAdvantage API key (expected `adv_live_` + lowercase letters/digits)."));
    console.error(c.gray("     Nothing was stored. Copy the key from your getadvantage.app account and retry."));
    return 1;
  }

  const cfg = readUserConfig();
  cfg.apiKey = key;
  // Persist an explicitly-configured non-default endpoint (self-hosted/staging)
  // so later runs don't silently post to the wrong place.
  if (process.env.GETADVANTAGE_API_URL) cfg.apiUrl = process.env.GETADVANTAGE_API_URL;
  const p = writeUserConfig(cfg);

  console.log(c.green(`  ✓ Logged in — key stored in ${p} (owner-only file).`));
  console.log(c.gray("    The key is only ever sent as the Authorization header to your API base"));
  console.log(c.gray(`    (${resolveApiBase()}) and is never printed, logged, or written into a repo.`));
  console.log(c.gray("    Try it: `getadvantage check --report` — env GETADVANTAGE_API_KEY still wins when set."));
  return 0;
}

/** `getadvantage logout` — remove the stored key (config file deleted when empty). */
export function runLogout() {
  const p = userConfigPath();
  const cfg = readUserConfig();
  if (!cfg.apiKey) {
    console.log(c.gray(`  Nothing to do — no API key stored${existsSync(p) ? ` in ${p}` : ""}.`));
    return 0;
  }
  delete cfg.apiKey;
  if (Object.keys(cfg).length === 0) {
    try {
      rmSync(p, { force: true });
    } catch {
      /* best-effort */
    }
    console.log(c.green(`  ✓ Logged out — removed the stored key (${p} deleted).`));
  } else {
    writeUserConfig(cfg);
    console.log(c.green(`  ✓ Logged out — removed the stored key from ${p}.`));
  }
  console.log(c.gray("    (GETADVANTAGE_API_KEY in your environment, if set, is untouched.)"));
  return 0;
}
