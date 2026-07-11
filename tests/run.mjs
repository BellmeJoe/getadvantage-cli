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
//   8. plain-Node repo              — `check` gives no false NO-GO
//   9. own-key secret scan          — adv_live_ (lowercase base36) blocks
//  9b. tracked .env                 — committed .env BLOCKS by itself; contents scanned too
//  9c. clean repo / false positives — placeholder DB URL, CSS class, gitignored .env all pass;
//                                     sk-ant- labeled "Anthropic secret key", not OpenAI
//  9d. oversized file (>2MB)        — head+tail partial scan finds a trailing secret, discloses it
//  10. fan-out lane branches        — namespaced ga/lane-N; re-run idempotent
//  11. branch never silently reused — pre-existing ga/lane-N → clear error
//  12. marker-dir back-compat       — legacy .ship-safe/ read; new writes → .getadvantage/
//  13. --report connector           — opt-in POST matches the ingest contract
//                                     (hermetic mock server); nothing sent without it
//  14. architecture scanner         — oversized + duplicated files flagged with the
//                                     right signals; a small repo stays quiet; the
//                                     check advisory never changes the verdict

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

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
    assert.ok(typecheck && typecheck.status === "pass" && /Skipped/.test(typecheck.detail));
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
      /oversized file\(s\) >2 MB scanned partially/.test(secret.extra.join("\n")) &&
        secret.extra.join("\n").includes("big-log.txt"),
      "the partial-scan note must disclose it scanned partially AND name the file",
    );
    assert.ok(!JSON.stringify(doc).includes(awsKey), "the full secret must never be echoed");
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
