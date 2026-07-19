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
