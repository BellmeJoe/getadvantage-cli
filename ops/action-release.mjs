// getAdvantage — Action distribution tags + GitHub Release contract.
//
// After npm publish succeeds, the release pipeline must:
//   1. Create/update exact source tag `v<package-version>` on the released commit
//   2. Move floating Action major tag `v1` to that same commit
//   3. Ensure a GitHub Release exists for the exact tag
//
// Published source identity (critical):
//   - New version: candidate is current HEAD; after `npm publish`, the registry
//     `gitHead` must match that HEAD before any tag/release mutation.
//   - Already-published version (docs-only pushes): source is npm
//     `gitHead` and/or the peeled exact tag — never blindly current HEAD.
//   - Annotated tags are always compared via `refs/tags/<name>^{}` (commit).
//
// Pure plan helpers are unit-tested. The CLI (`--apply` / `--gate` /
// `--verify-npm-source`) runs in CI and never makes network calls during tests
// unless explicitly invoked with network. Node built-ins only. ESM.

import { readFileSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

/** Action API major floating tag consumed by `uses: …@v1`. */
export const ACTION_MAJOR_TAG = "v1";

/** Default bounded retries waiting for npm registry gitHead propagation. */
export const NPM_GITHEAD_RETRY_DEFAULTS = Object.freeze({
  attempts: 8,
  delayMs: 5_000,
});

/**
 * Normalize a git object name to lowercase hex (7–40 chars), or "".
 * @param {string|null|undefined} sha
 * @returns {string}
 */
export function normalizeSha(sha) {
  const s = String(sha ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(s)) return "";
  return s;
}

/**
 * True when two SHAs refer to the same object (full or unambiguous prefix).
 * @param {string} a
 * @param {string} b
 */
export function shasEqual(a, b) {
  const x = normalizeSha(a);
  const y = normalizeSha(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const n = Math.min(x.length, y.length);
  if (n < 7) return false;
  return x.slice(0, n) === y.slice(0, n);
}

/**
 * Validate and normalize a package version string (semver-ish x.y.z…).
 * @param {string} version
 * @returns {{ok:true,version:string}|{ok:false,reason:string}}
 */
export function parsePackageVersion(version) {
  const v = String(version ?? "").trim();
  if (!v) return { ok: false, reason: "empty-version" };
  if (!/^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/.test(v)) {
    return { ok: false, reason: "invalid-version" };
  }
  return { ok: true, version: v };
}

/** Exact release/source tag for a package version (`v0.9.0`). */
export function exactTagName(version) {
  const p = parsePackageVersion(version);
  if (!p.ok) throw new Error(p.reason);
  return `v${p.version}`;
}

/**
 * Floating Action major tag for a package version.
 * Product contract: Action surface major is `v1` for the current first-party
 * Action API (including 0.9.x and future 1.x until a breaking Action major).
 */
export function actionMajorTagForVersion(_version) {
  return ACTION_MAJOR_TAG;
}

/**
 * Build a GitHub Git-refs API request for a release tag. This is the CI-safe
 * fallback when GitHub rejects a normal tag push because the target commit
 * contains workflow-file changes.
 *
 * @param {{repository:string,tag:string,sha:string,force?:boolean}} o
 * @returns {{ok:true,args:string[]}|{ok:false,reason:string}}
 */
export function githubRefApiRequest(o = {}) {
  const repository = String(o.repository || "").trim();
  const tag = String(o.tag || "").trim();
  const sha = normalizeSha(o.sha);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return { ok: false, reason: "invalid-github-repository" };
  }
  if (!tag || tag.includes("..") || /[\s\\~^:?*\[]/.test(tag)) {
    return { ok: false, reason: "invalid-tag" };
  }
  if (!sha) return { ok: false, reason: "invalid-sha" };

  if (o.force) {
    return {
      ok: true,
      args: [
        "api",
        "--method",
        "PATCH",
        `repos/${repository}/git/refs/tags/${encodeURIComponent(tag)}`,
        "-f",
        `sha=${sha}`,
        "-F",
        "force=true",
      ],
    };
  }
  return {
    ok: true,
    args: [
      "api",
      "--method",
      "POST",
      `repos/${repository}/git/refs`,
      "-f",
      `ref=refs/tags/${tag}`,
      "-f",
      `sha=${sha}`,
    ],
  };
}

/**
 * Peel a tag ref to the underlying commit SHA.
 * Annotated tags: `refs/tags/name` is a tag object; `refs/tags/name^{}` is the commit.
 * Lightweight tags: both resolve to the same commit.
 *
 * @param {string} tagName e.g. `v0.9.0` or `v1`
 * @param {{revParse?: (ref:string)=>string|null}} [deps]
 * @returns {string|null} lowercase commit SHA, or null if missing/unresolvable
 */
export function peelTagToCommit(tagName, deps = {}) {
  const name = String(tagName ?? "").trim();
  if (!name || name.includes("..") || /[\s\\]/.test(name)) return null;
  const ref = `refs/tags/${name}^{}`;
  if (typeof deps.revParse === "function") {
    const out = deps.revParse(ref);
    return normalizeSha(out) || null;
  }
  const r = git(["rev-parse", "--verify", ref], deps);
  if (r.status !== 0) return null;
  return normalizeSha((r.stdout || "").trim()) || null;
}

/**
 * Resolve the commit that is the *published* source identity for a version.
 *
 * - New publish: candidate HEAD is the source.
 * - Already on npm: use npm package `gitHead` and/or the peeled exact tag.
 *   Never trust current HEAD alone (docs-only commits after a release).
 * - If both npm gitHead and exact tag exist and disagree → fail.
 * - If neither can prove the SHA → fail safely (`published-source-unproven`).
 *
 * @param {object} o
 * @param {boolean} o.alreadyPublished local package version already on npm
 * @param {string} [o.candidateHeadSha] current HEAD (used only for new publish)
 * @param {string|null} [o.npmGitHead] `npm view name@version gitHead`
 * @param {string|null} [o.exactTagCommitSha] peeled exact tag commit
 * @returns {{ok:true,sourceSha:string,origin:string}|{ok:false,reason:string,detail?:string}}
 */
export function resolveReleasedSourceSha(o = {}) {
  if (!o.alreadyPublished) {
    const head = normalizeSha(o.candidateHeadSha);
    if (!head) return { ok: false, reason: "invalid-candidate-head" };
    return { ok: true, sourceSha: head, origin: "candidate-head" };
  }

  const npm = normalizeSha(o.npmGitHead);
  const exact = normalizeSha(o.exactTagCommitSha);

  if (npm && exact && !shasEqual(npm, exact)) {
    return {
      ok: false,
      reason: "published-source-conflict",
      detail: `npm gitHead ${npm} ≠ exact tag ${exact}`,
    };
  }
  if (npm) return { ok: true, sourceSha: npm, origin: "npm-gitHead" };
  if (exact) return { ok: true, sourceSha: exact, origin: "exact-tag" };
  return {
    ok: false,
    reason: "published-source-unproven",
    detail: "no npm gitHead and no peelable exact release tag",
  };
}

/**
 * After `npm publish`, require registry gitHead to match the candidate HEAD
 * before any tag/release mutation. Missing or mismatched → fail, leave tags alone.
 *
 * @param {object} o
 * @param {string} o.candidateHeadSha
 * @param {string|null|undefined} o.npmGitHead
 * @returns {{ok:true,sourceSha:string}|{ok:false,reason:string,detail?:string}}
 */
export function verifyPublishedNpmSource(o = {}) {
  const candidate = normalizeSha(o.candidateHeadSha);
  if (!candidate) return { ok: false, reason: "invalid-candidate-head" };
  const npm = normalizeSha(o.npmGitHead);
  if (!npm) {
    return {
      ok: false,
      reason: "npm-gitHead-unobserved",
      detail: "registry did not return gitHead for the just-published version",
    };
  }
  if (!shasEqual(candidate, npm)) {
    return {
      ok: false,
      reason: "npm-gitHead-mismatch",
      detail: `candidate ${candidate} ≠ npm gitHead ${npm}`,
    };
  }
  // Prefer the longer form when both are prefixes of the same object.
  const sourceSha = candidate.length >= npm.length ? candidate : npm;
  return { ok: true, sourceSha };
}

/**
 * Pure gate for the publish workflow: is this a new npm version, and do Action
 * tags/release need repair relative to the *released* source SHA (not docs HEAD)?
 *
 * @param {object} o
 * @param {string} o.localVersion
 * @param {string} o.publishedVersion npm `version` or `"none"`
 * @param {string} o.candidateHeadSha `git rev-parse HEAD`
 * @param {string|null} [o.npmGitHead]
 * @param {string|null} [o.exactTagCommitSha] peeled
 * @param {string|null} [o.majorTagCommitSha] peeled `v1`
 * @param {boolean} [o.releaseExists]
 * @returns {object}
 */
export function planPublishGate(o = {}) {
  const ver = parsePackageVersion(o.localVersion);
  if (!ver.ok) return { ok: false, reason: ver.reason };

  const published = String(o.publishedVersion ?? "none").trim();
  const alreadyPublished = published !== "none" && published === ver.version;
  const newPublish = !alreadyPublished;

  const resolved = resolveReleasedSourceSha({
    alreadyPublished,
    candidateHeadSha: o.candidateHeadSha,
    npmGitHead: o.npmGitHead,
    exactTagCommitSha: o.exactTagCommitSha,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      detail: resolved.detail,
      newPublish,
      alreadyPublished,
      tagsMissing: true,
    };
  }

  const sourceSha = resolved.sourceSha;
  const exactTag = exactTagName(ver.version);
  const majorTag = actionMajorTagForVersion(ver.version);
  const exactOk =
    !!o.exactTagCommitSha && shasEqual(o.exactTagCommitSha, sourceSha);
  const majorOk =
    !!o.majorTagCommitSha && shasEqual(o.majorTagCommitSha, sourceSha);
  const releaseOk = !!o.releaseExists;

  // Exact tag present but pointing at a *different* commit than the proven
  // published source: still "tags_missing" so the apply step runs and fails
  // honestly (source-tag-mismatch) rather than silent retag.
  const tagsMissing = !exactOk || !majorOk || !releaseOk;

  return {
    ok: true,
    version: ver.version,
    exactTag,
    majorTag,
    newPublish,
    alreadyPublished,
    sourceSha,
    sourceOrigin: resolved.origin,
    candidateHeadSha: normalizeSha(o.candidateHeadSha) || null,
    tagsMissing,
    exactOk,
    majorOk,
    releaseOk,
    /** Docs-only push when distribution already matches published source. */
    idempotentNoOp: alreadyPublished && !tagsMissing,
  };
}

/**
 * Plan tag/release operations for an idempotent post-npm publish step.
 *
 * @param {object} o
 * @param {string} o.version package.json version
 * @param {string} o.headSha *released* source commit SHA (not docs-only HEAD)
 * @param {{name:string,sha:string|null}[]} [o.existingTags] tags with *peeled* commit SHAs
 * @param {boolean} [o.releaseExists] whether GitHub Release for exact tag exists
 * @returns {{ok:boolean,reason?:string,exactTag?:string,majorTag?:string,ops?:Array,idempotent?:boolean}}
 */
export function planActionRelease(o = {}) {
  const ver = parsePackageVersion(o.version);
  if (!ver.ok) return { ok: false, reason: ver.reason };
  const headSha = normalizeSha(o.headSha);
  if (!headSha) {
    return { ok: false, reason: "invalid-head-sha" };
  }

  const exactTag = exactTagName(ver.version);
  const majorTag = actionMajorTagForVersion(ver.version);
  const byName = new Map();
  for (const t of o.existingTags || []) {
    if (t && t.name) byName.set(t.name, t.sha ? normalizeSha(t.sha) || null : null);
  }

  const ops = [];
  const exactSha = byName.has(exactTag) ? byName.get(exactTag) : undefined;

  if (exactSha !== undefined && exactSha !== null && !shasEqual(exactSha, headSha)) {
    // Exact release tag already points elsewhere — refuse silent retag.
    return {
      ok: false,
      reason: "source-tag-mismatch",
      exactTag,
      majorTag,
      detail: `${exactTag} → ${exactSha}, released source ${headSha}`,
    };
  }

  if (exactSha === undefined || exactSha === null) {
    ops.push({ op: "create-tag", tag: exactTag, sha: headSha });
  } else if (shasEqual(exactSha, headSha)) {
    ops.push({ op: "keep-tag", tag: exactTag, sha: headSha });
  }

  const majorSha = byName.has(majorTag) ? byName.get(majorTag) : undefined;
  if (majorSha && shasEqual(majorSha, headSha)) {
    ops.push({ op: "keep-tag", tag: majorTag, sha: headSha });
  } else {
    // Floating major always moves to the released commit (create or force-update).
    ops.push({ op: "move-tag", tag: majorTag, sha: headSha, previous: majorSha ?? null });
  }

  if (o.releaseExists) {
    ops.push({ op: "keep-release", tag: exactTag });
  } else {
    ops.push({ op: "create-release", tag: exactTag, sha: headSha });
  }

  const mutating = ops.some((x) => x.op === "create-tag" || x.op === "move-tag" || x.op === "create-release");
  return {
    ok: true,
    exactTag,
    majorTag,
    version: ver.version,
    headSha,
    ops,
    idempotent: !mutating,
  };
}

/**
 * Static contract checks for publish.yml content (no network).
 * @param {string} yml raw workflow YAML
 * @returns {{ok:boolean,failures:string[]}}
 */
export function validatePublishWorkflowContract(yml) {
  const text = String(yml || "");
  const failures = [];
  const need = [
    { re: /permissions:\s*\n(?:[^\n]*\n)*?\s*contents:\s*write/m, msg: "must grant contents: write for tags/release" },
    { re: /npm publish/i, msg: "must npm publish" },
    { re: /action-release\.mjs|Action distribution|Ensure Action tags/i, msg: "must run Action tag/release step" },
    { re: /\bv1\b|ACTION_MAJOR|major tag|floating/i, msg: "must mention floating Action major v1" },
    { re: /exact|v\$\{|v\$LOCAL|package-version|exact tag/i, msg: "must create exact v<version> tag" },
    { re: /source-tag-mismatch|mismatch|fail/i, msg: "must fail honestly on source/tag mismatch" },
    { re: /npm test|npm run evidence/i, msg: "must gate on tests/evidence before publish" },
    // Real runner proof: execute checked-out candidate Action before publish/tag move.
    { re: /uses:\s*\.\/\s*$/m, msg: "must run composite Action via uses: ./ before publish" },
    { re: /comment:\s*false/i, msg: "Action self-test must set comment: false" },
    { re: /report:\s*false/i, msg: "Action self-test must set report: false" },
    // Self-gate must dogfood a clean versioned fixture — never the product root
    // (product tests/ intentionally hold secret-shaped hostile strings).
    {
      re: /working-directory:\s*fixtures\/publish-self-gate/i,
      msg: "Action self-test must use working-directory: fixtures/publish-self-gate",
    },
    {
      re: /Materialize clean publish self-gate fixture|publish-self-gate/i,
      msg: "must materialize clean publish self-gate fixture before uses: ./",
    },
    // Published source identity: npm gitHead + peeled tags, not blind HEAD.
    { re: /gitHead/i, msg: "must resolve published source via npm gitHead" },
    { re: /\^\{\}/, msg: "must peel tags with ^{} for annotated-tag safety" },
    { re: /verify-npm-source|npm-gitHead|gitHead.*match|published source/i, msg: "must verify npm gitHead before tag mutation" },
  ];
  for (const n of need) {
    if (!n.re.test(text)) failures.push(n.msg);
  }
  // uses: ./ step must appear before the npm publish run step (ignore prose comments).
  const usesExact = text.search(/^\s*uses:\s*\.\/\s*$/m);
  const npmPub = text.search(/^\s*npm publish\b/m);
  if (usesExact < 0 || npmPub < 0 || usesExact > npmPub) {
    failures.push("uses: ./ Action gate must appear before npm publish");
  }
  // Fixture materialization must precede the composite self-test.
  const materializeIdx = text.search(/Materialize clean publish self-gate fixture/i);
  if (materializeIdx < 0 || (usesExact >= 0 && materializeIdx > usesExact)) {
    failures.push("clean publish self-gate fixture must be materialized before uses: ./");
  }
  // Tag/release apply must not run before publish for new versions: the
  // verify-npm-source / action-release step must appear after npm publish.
  const applyIdx = text.search(/action-release\.mjs\s+--apply|verify-npm-source/i);
  if (npmPub >= 0 && applyIdx >= 0 && applyIdx < npmPub) {
    failures.push("tag/release mutation must not precede npm publish");
  }
  // Must not require founder click (workflow_dispatch alone is ok as extra, but push/main should ship).
  if (!/push:/.test(text) && !/workflow_dispatch/.test(text)) {
    failures.push("must have an automated trigger");
  }
  // Least privilege: contents write is required; avoid blanket write-all if possible.
  if (/permissions:\s*write-all/i.test(text)) {
    failures.push("must not use write-all; use least contents: write");
  }
  // Annotated-tag apply needs repository-local tagger identity (never --global).
  // Contract order matches the pass-4 structural check: user.name then user.email.
  const taggerIdentityIdx = text.search(/git config user\.name[\s\S]*git config user\.email/);
  const applyOnlyIdx = text.search(/action-release\.mjs\s+--apply/);
  if (taggerIdentityIdx < 0) {
    failures.push("must configure repository-local tagger identity (user.name then user.email)");
  } else if (applyOnlyIdx >= 0 && taggerIdentityIdx > applyOnlyIdx) {
    failures.push("tagger identity must be configured before annotated-tag apply");
  }
  if (/git config --global user\.(?:name|email)/.test(text)) {
    failures.push("must not mutate global git identity");
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Read package version from package.json at repo root.
 */
export function readLocalVersion(root = REPO_ROOT) {
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  return parsePackageVersion(pkg.version);
}

function git(args, opts = {}) {
  const r = spawnSync("git", args, {
    cwd: opts.cwd || REPO_ROOT,
    encoding: "utf8",
    env: opts.env || process.env,
  });
  return r;
}

/**
 * Annotated tags require a committer identity. GitHub-hosted runners often have
 * none configured; set a bot identity only when missing (never overwrite CI-set
 * values). Lightweight tags and other git ops do not need this.
 */
function ensureGitIdentityForAnnotatedTag(cwd = REPO_ROOT) {
  const name = git(["config", "user.name"], { cwd });
  const email = git(["config", "user.email"], { cwd });
  const hasName = name.status === 0 && String(name.stdout || "").trim();
  const hasEmail = email.status === 0 && String(email.stdout || "").trim();
  if (!hasName) {
    git(["config", "user.name", "github-actions[bot]"], { cwd });
  }
  if (!hasEmail) {
    git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], { cwd });
  }
}

function githubRepository(opts = {}) {
  const fromEnv = String(opts.repository || process.env.GITHUB_REPOSITORY || "").trim();
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fromEnv)) return fromEnv;
  const remote = git(["remote", "get-url", "origin"], opts);
  if (remote.status !== 0) return "";
  const match = String(remote.stdout || "")
    .trim()
    .match(/github\.com(?::|\/)([^/]+)\/([^/]+)$/i);
  return match ? `${match[1]}/${match[2].replace(/\.git$/i, "")}` : "";
}

function pushTagWithApiFallback(tag, sha, opts = {}) {
  const pushArgs = ["push", "origin", `refs/tags/${tag}`];
  if (opts.force) pushArgs.push("--force");
  const push = git(pushArgs, opts);
  if (push.status === 0) return { ok: true, transport: "git" };

  const request = githubRefApiRequest({
    repository: githubRepository(opts),
    tag,
    sha,
    force: Boolean(opts.force),
  });
  if (!request.ok) {
    return { ok: false, error: `${push.stderr || push.stdout}\nAPI fallback unavailable: ${request.reason}` };
  }

  console.warn(`action-release: git push for ${tag} rejected; retrying through GitHub refs API`);
  const api = spawnSync("gh", request.args, {
    cwd: opts.cwd || REPO_ROOT,
    encoding: "utf8",
    env: opts.env || process.env,
  });
  if (api.status !== 0) {
    return {
      ok: false,
      error: `${push.stderr || push.stdout}\nGitHub refs API fallback failed: ${api.stderr || api.stdout}`,
    };
  }
  return { ok: true, transport: "github-api" };
}

/**
 * Query npm registry for package@version gitHead (or empty string).
 * Injectable for tests.
 *
 * @param {string} name
 * @param {string} version
 * @param {{npmView?: Function, cwd?: string}} [deps]
 * @returns {string}
 */
export function fetchNpmGitHead(name, version, deps = {}) {
  if (typeof deps.npmView === "function") {
    return String(deps.npmView(name, version) ?? "").trim();
  }
  const r = spawnSync(
    "npm",
    ["view", `${name}@${version}`, "gitHead"],
    {
      cwd: deps.cwd || REPO_ROOT,
      encoding: "utf8",
      env: process.env,
      shell: process.platform === "win32",
    },
  );
  if (r.status !== 0) return "";
  return String(r.stdout || "").trim();
}

/**
 * Bounded retry until registry returns a gitHead matching candidate, or exhausts.
 * @param {object} o
 * @param {string} o.name
 * @param {string} o.version
 * @param {string} o.candidateHeadSha
 * @param {number} [o.attempts]
 * @param {number} [o.delayMs]
 * @param {{npmView?: Function, sleep?: (ms:number)=>void}} [deps]
 */
export function waitForNpmGitHead(o = {}, deps = {}) {
  const attempts = Number(o.attempts) > 0 ? Number(o.attempts) : NPM_GITHEAD_RETRY_DEFAULTS.attempts;
  const delayMs = Number(o.delayMs) >= 0 ? Number(o.delayMs) : NPM_GITHEAD_RETRY_DEFAULTS.delayMs;
  const sleep =
    typeof deps.sleep === "function"
      ? deps.sleep
      : (ms) => {
          // Avoid Atomics in restrictive envs; spawnSync sleep is fine in CI.
          spawnSync(process.execPath, ["-e", `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${ms})`], {
            encoding: "utf8",
          });
        };

  let last = "";
  for (let i = 0; i < attempts; i++) {
    last = fetchNpmGitHead(o.name, o.version, deps);
    const v = verifyPublishedNpmSource({
      candidateHeadSha: o.candidateHeadSha,
      npmGitHead: last,
    });
    if (v.ok) return { ok: true, npmGitHead: last, sourceSha: v.sourceSha, attempts: i + 1 };
    if (i + 1 < attempts) sleep(delayMs);
  }
  const final = verifyPublishedNpmSource({
    candidateHeadSha: o.candidateHeadSha,
    npmGitHead: last,
  });
  return {
    ok: false,
    npmGitHead: last || null,
    reason: final.reason || "npm-gitHead-unobserved",
    detail: final.detail,
    attempts,
  };
}

function writeGithubOutput(pairs) {
  const out = process.env.GITHUB_OUTPUT;
  const lines = [];
  for (const [k, v] of Object.entries(pairs)) {
    lines.push(`${k}=${v}`);
  }
  const blob = lines.join("\n") + "\n";
  if (out) {
    appendFileSync(out, blob, "utf8");
  }
  for (const line of lines) console.log(line);
}

/**
 * CI gate: resolve published source + whether tags need repair. Writes GITHUB_OUTPUT.
 */
export function runPublishGateCli(opts = {}) {
  const root = opts.cwd || REPO_ROOT;
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const name = pkg.name;
  const localVersion = pkg.version;

  const pubR = spawnSync("npm", ["view", name, "version"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
  const publishedVersion =
    pubR.status === 0 ? String(pubR.stdout || "").trim() || "none" : "none";

  const headR = git(["rev-parse", "HEAD"], { cwd: root });
  const candidateHeadSha = (headR.stdout || "").trim();

  const exact = exactTagName(localVersion);
  const exactTagCommitSha = peelTagToCommit(exact, { cwd: root });
  const majorTagCommitSha = peelTagToCommit(ACTION_MAJOR_TAG, { cwd: root });

  let npmGitHead = "";
  if (publishedVersion !== "none" && publishedVersion === localVersion) {
    npmGitHead = fetchNpmGitHead(name, localVersion, { cwd: root });
  }

  let releaseExists = false;
  const gh = spawnSync("gh", ["release", "view", exact, "--json", "tagName"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  });
  releaseExists = gh.status === 0;

  const gate = planPublishGate({
    localVersion,
    publishedVersion,
    candidateHeadSha,
    npmGitHead: npmGitHead || null,
    exactTagCommitSha,
    majorTagCommitSha,
    releaseExists,
  });

  console.log(
    `action-release gate: name=${name} local=${localVersion} published=${publishedVersion} ` +
      `candidate=${candidateHeadSha.slice(0, 12)} npmGitHead=${(npmGitHead || "(none)").slice(0, 12)} ` +
      `exact=${exactTagCommitSha ? exactTagCommitSha.slice(0, 12) : "(none)"} ` +
      `v1=${majorTagCommitSha ? majorTagCommitSha.slice(0, 12) : "(none)"} release=${releaseExists}`,
  );

  if (!gate.ok) {
    console.error(`action-release gate: FAIL ${gate.reason}${gate.detail ? ` (${gate.detail})` : ""}`);
    writeGithubOutput({
      version: localVersion,
      exact_tag: exact,
      sha: candidateHeadSha,
      source_sha: "",
      new: String(publishedVersion !== localVersion && publishedVersion !== "none" ? "true" : publishedVersion === "none" ? "true" : "false"),
      tags_missing: "true",
      gate_ok: "false",
      gate_reason: gate.reason || "unknown",
    });
    return { ok: false, gate, exitCode: 1 };
  }

  writeGithubOutput({
    version: gate.version,
    exact_tag: gate.exactTag,
    sha: candidateHeadSha,
    source_sha: gate.sourceSha,
    new: gate.newPublish ? "true" : "false",
    tags_missing: gate.tagsMissing ? "true" : "false",
    source_origin: gate.sourceOrigin,
    gate_ok: "true",
    gate_reason: gate.idempotentNoOp ? "idempotent-no-op" : gate.newPublish ? "new-publish" : "repair",
  });

  console.log(
    `action-release gate: OK new=${gate.newPublish} tags_missing=${gate.tagsMissing} ` +
      `source=${gate.sourceSha.slice(0, 12)} origin=${gate.sourceOrigin} no_op=${gate.idempotentNoOp}`,
  );
  return { ok: true, gate, exitCode: 0 };
}

/**
 * Apply plan using local git + gh CLI. Used by CI only.
 * headSha must be the *released* source (proven npm gitHead or candidate after verify).
 *
 * @param {object} o
 * @param {string} o.version
 * @param {string} o.headSha released source SHA
 * @param {boolean} [o.dryRun]
 */
export function applyActionRelease(o = {}) {
  const headSha = normalizeSha(o.headSha || git(["rev-parse", "HEAD"]).stdout);
  if (!headSha) {
    console.error("action-release: FAIL invalid-head-sha");
    return { ok: false, plan: null, exitCode: 1 };
  }
  const version = o.version || readLocalVersion().version;

  // Discover existing tags for exact + major — always peel to commit (annotated-safe).
  const existingTags = [];
  for (const name of [exactTagName(version), ACTION_MAJOR_TAG]) {
    const peeled = peelTagToCommit(name, { cwd: o.cwd || REPO_ROOT });
    if (peeled) {
      existingTags.push({ name, sha: peeled });
    }
  }

  // Release existence via gh when available.
  let releaseExists = false;
  const exact = exactTagName(version);
  if (!o.dryRun) {
    const gh = spawnSync("gh", ["release", "view", exact, "--json", "tagName"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: process.env,
    });
    releaseExists = gh.status === 0;
  } else if (o.releaseExists != null) {
    releaseExists = !!o.releaseExists;
  }

  const plan = planActionRelease({
    version,
    headSha,
    existingTags,
    releaseExists,
  });
  if (!plan.ok) {
    console.error(`action-release: FAIL ${plan.reason}${plan.detail ? ` (${plan.detail})` : ""}`);
    return { ok: false, plan, exitCode: 1 };
  }

  console.log(`action-release: plan for ${plan.exactTag} @ ${plan.headSha} (idempotent=${plan.idempotent})`);
  for (const op of plan.ops) {
    console.log(`  - ${op.op} ${op.tag || ""}${op.sha ? ` → ${op.sha.slice(0, 12)}` : ""}`);
  }

  if (o.dryRun) {
    return { ok: true, plan, exitCode: 0, dryRun: true };
  }

  for (const op of plan.ops) {
    if (op.op === "keep-tag" || op.op === "keep-release") continue;
    if (op.op === "create-tag") {
      ensureGitIdentityForAnnotatedTag();
      const r = git(["tag", "-a", op.tag, "-m", `release: getadvantage ${version}`, op.sha]);
      if (r.status !== 0) {
        // Tag may already exist on this SHA from a race — re-check peeled commit.
        const peeled = peelTagToCommit(op.tag);
        if (!peeled || !shasEqual(peeled, op.sha)) {
          console.error(`action-release: create-tag failed for ${op.tag}: ${r.stderr || r.stdout}`);
          return { ok: false, plan, exitCode: 1 };
        }
      }
      const tagObject = normalizeSha(git(["rev-parse", `refs/tags/${op.tag}`]).stdout);
      const pushed = pushTagWithApiFallback(op.tag, tagObject, { cwd: o.cwd || REPO_ROOT });
      if (!pushed.ok) {
        console.error(`action-release: push tag ${op.tag} failed: ${pushed.error}`);
        return { ok: false, plan, exitCode: 1 };
      }
    } else if (op.op === "move-tag") {
      // Floating major: force-update local + remote (standard Action major pattern).
      // Prefer lightweight floating tag (common Action convention); force move is fine.
      git(["tag", "-f", op.tag, op.sha]);
      const pushed = pushTagWithApiFallback(op.tag, op.sha, { cwd: o.cwd || REPO_ROOT, force: true });
      if (!pushed.ok) {
        console.error(`action-release: move-tag push ${op.tag} failed: ${pushed.error}`);
        return { ok: false, plan, exitCode: 1 };
      }
    } else if (op.op === "create-release") {
      const gh = spawnSync(
        "gh",
        [
          "release",
          "create",
          op.tag,
          "--target",
          op.sha,
          "--title",
          `getadvantage ${version}`,
          "--notes",
          `Automated release for getadvantage@${version}.\n\nAction pin: \`uses: BellmeJoe/getadvantage-cli@v1\` (floating major) or \`@${op.tag}\` (exact).`,
        ],
        { cwd: REPO_ROOT, encoding: "utf8", env: process.env },
      );
      if (gh.status !== 0) {
        // Idempotent: release already exists is OK.
        const msg = `${gh.stderr || ""}${gh.stdout || ""}`;
        if (!/already exists/i.test(msg)) {
          console.error(`action-release: create-release failed: ${msg}`);
          return { ok: false, plan, exitCode: 1 };
        }
      }
    }
  }

  console.log(`action-release: OK ${plan.exactTag} + ${plan.majorTag} @ ${plan.headSha.slice(0, 12)}`);
  return { ok: true, plan, exitCode: 0 };
}

/**
 * CLI: after npm publish, verify registry gitHead matches candidate before tags.
 */
export function runVerifyNpmSourceCli(o = {}) {
  const root = o.cwd || REPO_ROOT;
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const version = o.version || pkg.version;
  const name = pkg.name;
  const candidateHeadSha =
    normalizeSha(o.headSha) || normalizeSha(git(["rev-parse", "HEAD"], { cwd: root }).stdout);

  console.log(
    `action-release: verify-npm-source ${name}@${version} candidate=${candidateHeadSha.slice(0, 12)}`,
  );

  const waited = waitForNpmGitHead(
    {
      name,
      version,
      candidateHeadSha,
      attempts: o.attempts,
      delayMs: o.delayMs,
    },
    o.deps || {},
  );

  if (!waited.ok) {
    console.error(
      `action-release: FAIL ${waited.reason}${waited.detail ? ` (${waited.detail})` : ""} ` +
        `after ${waited.attempts} attempt(s) — tags left untouched for safe retry`,
    );
    return { ok: false, waited, exitCode: 1, sourceSha: null };
  }

  console.log(
    `action-release: npm gitHead matches candidate @ ${waited.sourceSha.slice(0, 12)} ` +
      `(attempts=${waited.attempts})`,
  );
  // Emit source_sha for subsequent steps when GITHUB_OUTPUT is set.
  writeGithubOutput({ source_sha: waited.sourceSha, npm_githead_ok: "true" });
  return { ok: true, waited, exitCode: 0, sourceSha: waited.sourceSha };
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const wantApply = args.includes("--apply");
  const wantGate = args.includes("--gate");
  const wantVerify = args.includes("--verify-npm-source");
  const versionArg = args.find((a) => a.startsWith("--version="));
  const shaArg = args.find((a) => a.startsWith("--sha="));
  const attemptsArg = args.find((a) => a.startsWith("--attempts="));
  const delayArg = args.find((a) => a.startsWith("--delay-ms="));

  if (wantGate) {
    const result = runPublishGateCli();
    process.exit(result.exitCode);
  }

  if (wantVerify) {
    const result = runVerifyNpmSourceCli({
      version: versionArg ? versionArg.slice("--version=".length) : undefined,
      headSha: shaArg ? shaArg.slice("--sha=".length) : undefined,
      attempts: attemptsArg ? Number(attemptsArg.slice("--attempts=".length)) : undefined,
      delayMs: delayArg ? Number(delayArg.slice("--delay-ms=".length)) : undefined,
    });
    process.exit(result.exitCode);
  }

  // Default to dry-run unless --apply (safer for local invocation).
  const result = applyActionRelease({
    dryRun: !wantApply,
    version: versionArg ? versionArg.slice("--version=".length) : undefined,
    headSha: shaArg ? shaArg.slice("--sha=".length) : undefined,
  });
  process.exit(result.exitCode);
}
