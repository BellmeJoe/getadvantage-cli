#!/usr/bin/env node
// getAdvantage CLI — the pre-deploy gate for AI-built apps: a local GO/NO-GO
// (secrets, dirty tree, build) you run before you ship.
//
// The control layer for AI-built apps: spin up parallel worktree lanes
// (`fan-out`), then reconcile them into ONE verified main with the SAFE FAN-IN
// conductor (`fan-in`) — a collision map, a merge-train, and a combined-tree
// gate so no conflict reaches main un-verified. Plus a local, dependency-free
// pre-deploy auditor that gives a plain-language GO / NO-GO:
//
//   • dirty-tree guard   — `vercel --prod` ships the working tree, so a dirty
//                          tree (or another session's work) would ship live
//   • secret scan        — leaked keys in committed/staged files
//   • build + typecheck  — `tsc --noEmit` (and `--build` for a full build)
//   • schema-bump check  — DDL changed without a SCHEMA_VERSION bump
//
// Plus v1.1 read-only OVERVIEW MAPS (default-on; `--no-overview` to skip) —
// "understand what you built":
//   • API surface map    — every route, its methods, and whether it's auth-gated
//                          (⚠ mutating routes with no auth check)
//   • integrations map    — external/LLM/3rd-party calls + the env keys behind them
//                          (⚠ a secret reachable from the client bundle)
//   • schedules & jobs map — vercel.json crons + cron routes + their gating
//                          (⚠ an ungated, publicly-triggerable cron)
//
// Node built-ins only. ESM. Nothing here mutates your repo (`check`); only the
// explicit `deploy` subcommand performs an action, and it deploys from a clean
// detached worktree of the target commit.
//
// LOCAL BY DEFAULT (the core promise): no command touches the network unless
// you explicitly opt in with `--report` / GETADVANTAGE_REPORT=1, which posts
// the run's VERDICT + metadata (the --json report — never your source code)
// to your getAdvantage account. See report.mjs.
//
// Usage:
//   node cli/ship-safe/index.mjs [check] [--build]
//   node cli/ship-safe/index.mjs deploy [--expect-prefix getadvantage-] [--scope <s>]
//                                       [--commit <ref>] [--token-env VERCEL_TOKEN]
//                                       [--build] [--force]

import { binName, c, classifyGitCwd, cliVersion, printResult, section } from "./util.mjs";
import { repoRoot } from "./util.mjs";
import { detectProject, detectRepoStack } from "./detect.mjs";
import { renderMap } from "./overviews.mjs";
import { runChecks } from "./checks-runner.mjs";
import { deploy } from "./deploy.mjs";
import { runBrief } from "./brief.mjs";
import { runHandoff } from "./handoff.mjs";
import { runLedger } from "./ledger.mjs";
import { runGauge } from "./gauge.mjs";
import { runInit } from "./init.mjs";
import { runSwitch } from "./switch.mjs";
import { runModels } from "./models.mjs";
import { runMcp } from "./mcp.mjs";
import { runFanOut, runFanIn } from "./fanout.mjs";
import { runArchitecture } from "./architecture.mjs";
import { runDemo } from "./demo.mjs";
import {
  envReportOn,
  reportRun,
  reportDryRun,
  lanesForIngest,
  ciDefaultBaseRef,
  runLogin,
  runLogout,
} from "./report.mjs";
import { runGithubAction } from "./action.mjs";
import { buildSarif, writeSarifFile } from "./sarif.mjs";
import { runIntent, printIntentHelp, INTENT_LIMITATION } from "./intent.mjs";
import { buildFeedbackUrl } from "./feedback.mjs";
import { runPolicyGate, printGateHelp } from "./gate.mjs";
import os from "node:os";

function parseArgs(argv) {
  // First non-flag token is the subcommand; default to "check".
  const flags = {};
  const positional = [];
  // Multi-value flags accumulate as arrays (intent --allow / --deny / --require).
  const multiFlags = new Set(["allow", "deny", "require"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      // value-taking flags vs boolean flags
      const valueFlags = new Set([
        "expect-prefix",
        "scope",
        "commit",
        "token-env",
        "base-ref",
        "out",
        "task",
        "into",
        "top",
        "sarif",
        "goal",
        "notes",
        "acceptance-notes",
        "max-files",
      ]);
      if (multiFlags.has(key)) {
        const val = argv[++i];
        if (val === undefined || (typeof val === "string" && val.startsWith("--"))) {
          if (!Array.isArray(flags[key])) flags[key] = [];
          if (val !== undefined && val.startsWith("--")) i--;
        } else {
          if (!Array.isArray(flags[key])) flags[key] = [];
          flags[key].push(val);
        }
      } else if (valueFlags.has(key)) {
        const val = argv[++i];
        // Missing value (end of argv or next flag) — record empty so callers
        // can fail honestly instead of treating --sarif as a boolean.
        if (val === undefined || (typeof val === "string" && val.startsWith("--"))) {
          flags[key] = "";
          if (val !== undefined && val.startsWith("--")) i--; // re-process next flag
        } else {
          flags[key] = val;
        }
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { cmd: positional[0] || "check", arg: positional[1], flags, positional };
}

function header() {
  console.log(c.bold("┌────────────────────────────────────────┐"));
  console.log(c.bold("│  getAdvantage — check before you ship  │"));
  console.log(c.bold("└────────────────────────────────────────┘"));
}

// ---------------------------------------------------------------------------
// --json plumbing — the platform bridge payload.
// ---------------------------------------------------------------------------
// With --json, stdout carries EXACTLY ONE JSON document (stable schema:
// { command, verdict, exitCode, lanes?/checks?, generatedAt }) so CI and the
// platform can parse it. The human rendering is NOT suppressed — it is routed
// wholesale to stderr (same information, other channel), which also keeps
// progress visible in a terminal. console.error already targets stderr.
function routeHumanOutputToStderr() {
  const origWrite = process.stdout.write.bind(process.stdout);
  console.log = (...args) =>
    process.stderr.write(args.map((a) => (typeof a === "string" ? a : String(a))).join(" ") + "\n");
  // Progress lines (e.g. fan-in's "gating the combined tree…") write to stdout
  // directly — reroute those too.
  process.stdout.write = (chunk, ...rest) => process.stderr.write(chunk, ...rest);
  return () => {
    process.stdout.write = origWrite;
  };
}

/** Print the single JSON document to the REAL stdout (restoring it first). */
function emitJson(restoreStdout, doc) {
  restoreStdout();
  process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
}

function printHelp() {
  const bin = binName();
  header();
  console.log(`
${c.bold("Commands")}
  ${c.cyan("ship")}     The full gate, including the production build: is this safe to ship?
           Exits 0 on GO, 1 on NO-GO. Same as ${c.bold("check --build")} — the name you remember.
  ${c.cyan("map")}      A read-only map of what your app has: API surface (what is gated, what
           mutates), agents & integrations, schedules & jobs. Orientation, never a verdict.
  ${c.cyan("check")}    Run all read-only pre-deploy checks (default). Exits 0 on GO, 1 on NO-GO.
  ${c.cyan("brief")}    Generate / refresh the PROJECT BRAIN — a portable, repo-resident project
           brief (default ${c.bold("PROJECT-BRIEF.md")}) that ANY model/session/tool reads on start,
           so you can switch tools without re-explaining the project. ${c.bold("--check")} only warns
           if the brief is missing or stale (never blocks).
  ${c.cyan("handoff")}  Refresh the brief AND write ${c.bold("HANDOFF.md")} — the HOT "where we left off"
           layer (what you were doing · next steps · open threads), so you can drop a long,
           slow session and start a fresh, fast one with no loss. Your notes are preserved
           across refreshes.
  ${c.cyan("gauge")}    Is this session getting heavy? A quick freshness read (repo activity since
           your last handoff) that nudges you to reset before things get slow.
  ${c.cyan("ledger")}   Show the session ledger — the running log of save-points (the project's
           history); each ${c.bold("handoff")} adds an entry.
  ${c.cyan("init")}     Wire the brain into your agent's instructions file (CLAUDE.md / AGENTS.md /
           .cursorrules / .windsurfrules / .clinerules) so the brief + handoff load at session start.
           ${c.bold("Invisible mode:")} ${c.bold("--claude-code")} installs automatic gate hooks
           (Claude Code settings + git pre-commit + Intent auto-capture + proof receipt);
           ${c.bold("--cursor")} detect-and-refuse until schema verified;
           ${c.bold("--uninstall-invisible")} removes only what we wrote;
           ${c.bold("--invisible-status")} reports whether the gate is actually enforcing;
           ${c.bold("--force")} overwrites a foreign pre-commit hook.
  ${c.cyan("switch")}   Switch tools/models without losing context: saves your place, wires every
           AI-tool file, and prints the prompt to start the new session. ${c.dim("(switch <tool>)")}
  ${c.cyan("models")}   A plain-language playbook for choosing + switching AI models (which model
           for which job) — principles, not benchmarks.
  ${c.cyan("mcp")}      Run a dependency-free Model Context Protocol (MCP) server over stdio so an
           AI agent (Claude Code, Cursor) can call getAdvantage's brain + checks MID-session
           — tools: ${c.bold("get_brief")}, ${c.bold("refresh_brief")}, ${c.bold("get_handoff")}, ${c.bold("save_handoff")}, ${c.bold("check")}, ${c.bold("map")}, ${c.bold("architecture")}, ${c.bold("gauge")}.
           No API keys, no network — same engine as the CLI.
  ${c.cyan("fan-out")}  Run several AI sessions/models in PARALLEL, all sharing ONE project brain, via
           git worktrees. ${c.dim("(fan-out <n> [--task \"...\"])")} — opens ${c.bold("N")} lanes (1–8) off HEAD,
           each with the brain wired; open a different tool/model in each, then review + merge.
  ${c.cyan("fan-in")}   ${c.bold("The safe fan-in conductor.")} Reconcile the parallel lanes into ONE verified
           main: a ${c.bold("collision map")} (which files >1 lane touched), a ${c.bold("merge-train")} dry-run
           (textual conflicts up front), and — only with ${c.bold("--apply")} — actually merge the
           clean lanes one at a time, re-running the check gate on the COMBINED tree after
           each so two-green-but-red-together breaks are caught and that lane is quarantined
           (rolled back), never landed. Ends on one verdict screen. No conflict reaches main un-verified.
  ${c.cyan("demo")}     Spin up a throwaway sample repo with 3 pre-made divergent lanes (one clean,
           one that breaks the build, one that textually conflicts) and run the WHOLE fan-in
           conductor on it — the entire wow in ONE command, zero setup.
  ${c.cyan("architecture")}  The ACCRETION scanner — where is the code rotting by being built OVER instead
           of collapsed? Ranks the top collapse candidates by ${c.bold("size × churn × duplication")}
           (oversized files, git-churn hotspots, repeated ≥15-line blocks, approximate
           complexity). Surfaces the signal an AI coding agent is missing; it never
           refactors and never claims your code is clean. ${c.bold("Advisory — always exits 0.")}
  ${c.cyan("login")}    Connect this machine to your getAdvantage account: store an ${c.bold("adv_live_")} API key
           in ~/.getadvantage/config.json (owner-only). Used by ${c.bold("--report")}; env
           GETADVANTAGE_API_KEY always wins over the stored key. ${c.cyan("logout")} removes it.
  ${c.cyan("intent")}   Local Intent Contract — human goal bound to an enforceable change envelope.
           ${c.bold("init")} pins immutable ${c.bold("baselineCommit")} and writes ${c.bold(".getadvantage/intent.json")};
           ${c.bold("commit only that file")} as a dedicated freeze before the agent starts (authorization is the
           freeze blob, not worktree / later HEAD / --base-ref). ${c.bold("check")} diffs every change after baseline
           → GO / NO-GO + contractHash + receiptHash. ${c.dim("scope verified; semantic correctness not proven.")}
           See ${c.bold(`${binName()} intent --help`)}.
  ${c.cyan("github-action")}  Write .github/workflows/getadvantage.yml — one-copy first-party Action
           (${c.bold("uses: BellmeJoe/getadvantage-cli@v1")}) on every push + pull request: GO/NO-GO,
           SARIF → ${c.bold("upload-sarif@v4")}, update-in-place PR summary (job-summary fallback).
           Public code scanning; private needs Code Security + ${c.bold("actions: read")}.
           Idempotent; ${c.bold("--force")} to replace a differing / pre-0.9.0 workflow. ${c.dim("(also: init --github-action)")}
  ${c.cyan("deploy")}   Run check, then deploy from a clean detached worktree and confirm the
           deployment URL prefix. Performs a real ${c.bold("vercel --prod")}.
  ${c.cyan("feedback")} Print a copy-pasteable GitHub issue URL pre-filled with redacted
           environment + gate metadata (CLI/Node/OS platform, stack, check counts).
           ${c.bold("Nothing is sent")} — no browser open, no network. Always exits 0.
  ${c.cyan("gate")}     Policy gate — outbound stdin filter (BLOCK default, ${c.bold("--redact")} to mask).
           Local proof under ${c.bold(".getadvantage/gate-proofs/")}. Not inbound. Not a proxy.

${c.bold("Flags")}
  --version / -v          Print the CLI version and exit.
  --build                 Also run the project's ${c.bold("build")} script (default: typecheck only, where it applies).
  --base-ref <ref>        Merge-base ref for the schema-bump diff (default: main).
  --no-overview           Skip the read-only overview maps (API surface, integrations, schedules).
  --no-brief-check        Skip the (non-blocking) brief-staleness warning in ${c.cyan("check")}.
  --agent-trigger         (${c.cyan("check")}) Agent-trigger profile for invisible-mode hooks only: run the
                          same gate but omit Dirty-tree (staging is expected at commit/edit time) and
                          print a visible disclosure line. Not the default; not read from repo config.
                          Plain ${c.cyan("check")} / ${c.cyan("check --ci")} still enforce Dirty-tree for pre-deploy.
  --json                  (${c.cyan("check")} + ${c.cyan("map")} + ${c.cyan("fan-in")} + ${c.cyan("architecture")} + ${c.cyan("gate")}) Print ONE machine-readable JSON document to stdout
                          — { command, verdict, exitCode, checks?/lanes?, generatedAt } — with the
                          human rendering routed to stderr. For CI and tooling.
  --sarif <path>          (${c.cyan("check")}) Write a dependency-free SARIF 2.1.0 file for GitHub code scanning.
                          Does not replace human output or --json; does not turn NO-GO into success.
                          Invalid path / write failure exits non-zero with a next action. Messages
                          are redacted (fingerprints + auth ids only — never full secrets).
  --ci                    (${c.cyan("check")} + ${c.cyan("fan-in")}) Non-interactive CI mode: never prompts, tolerates a
                          detached HEAD (CI checks out a sha), and defaults the base comparison to
                          origin/main (or GITHUB_BASE_REF). Exit codes stay CI-honest: 0 = GO.
  --report                (${c.cyan("check")} + ${c.cyan("fan-in")}) OPT-IN: after the verdict, post the run REPORT — the
                          --json document (verdict, exit code, checks / lane outcomes) plus repo
                          name, branch + commit id, ${c.bold("never your source code")} — to your getAdvantage
                          account. Also enabled by GETADVANTAGE_REPORT=1. Needs a key (env
                          GETADVANTAGE_API_KEY or ${c.cyan("login")}); endpoint override: GETADVANTAGE_API_URL.
                          Without --report, nothing ever leaves your machine.
  --report-dry-run        (${c.cyan("check")} + ${c.cyan("fan-in")}) Transparency mode: build the exact body --report
                          would POST, print a one-screen summary (project/ref, verdict, checks /
                          findings with file:line · fp · authId · remediation) plus the full JSON,
                          endpoint, byte size, and whether a key resolved (source only — never the
                          key). ${c.bold("Nothing is sent")} — no network call. Exit code stays the gate's
                          own verdict. Wins over --report when both are passed.
  --report-required       Reporting is best-effort by default (a failed post never changes the gate
                          verdict / exit code). This flag makes a failed post exit non-zero. Implies
                          --report.

  ${c.dim("brief only:")}
  --out <path>            Where to write the brief (default: PROJECT-BRIEF.md at repo root).
  --check                 Report staleness only (no write); warns if missing/stale.

  ${c.dim("fan-out only:")}
  --task "<text>"         A one-line task to print into each lane's guidance (optional).

  ${c.dim("fan-in only:")}
  --apply                 Actually merge the clean lanes (default is a safe DRY-RUN preview only).
  --no-build              Skip the full build in the combined-tree gate (typecheck still runs).
  --into <branch>         Integration branch to land lanes into (default: your current branch).

  ${c.dim("architecture only:")}
  --top <n>               How many collapse candidates to rank (default 10, max 50).
  --json                  One machine-readable JSON document on stdout:
                          { command:"architecture", summary, candidates, generatedAt }.

  ${c.dim("gate only:")}
  --redact                Mask secret/PII/denylist matches and write the rest to stdout (exit 0).
                          Default is BLOCK (non-zero exit, nothing of the payload on stdout).

  ${c.dim("deploy only:")}
  --expect-prefix <p>     Required deployment-host prefix (default: derived from your linked .vercel project; guard skipped if none).
  --scope <scope>         Vercel team scope, passed through to vercel.
  --commit <ref>          Commit-ish to deploy (default: HEAD).
  --token-env <NAME>      Env var NAME holding the Vercel token (default: VERCEL_TOKEN).
  --force                 Deploy even if checks return NO-GO (use with care).

${c.bold("Examples")}
  ${bin}                        run the pre-deploy checks (GO / NO-GO)
  ${bin} brief                  generate / refresh the project brain
  ${bin} init                   auto-load the brain at every session start
  ${bin} init --claude-code     invisible mode: automatic gate hooks + receipt
  ${bin} init --uninstall-invisible   remove invisible-mode hooks (only ours)
  ${bin} init --invisible-status      is the automatic gate actually enforcing?
  ${bin} handoff                save your place for the next session
  ${bin} switch cursor          move to a new tool/model without losing context
  ${bin} gauge                  is this session getting heavy?
  ${bin} mcp                    run the MCP server (an agent calls the brain mid-session)
  ${bin} fan-out 3              open 3 parallel lanes sharing one brain
  ${bin} fan-out 3 --task "add a settings page"
  ${bin} fan-in                 collision map + merge-train DRY-RUN (preview, nothing merged)
  ${bin} fan-in --apply         actually land the clean+green lanes into main, gated
  ${bin} demo                   see the whole safe fan-in conductor on a throwaway repo
  ${bin} architecture           where is the code accreting? ranked collapse candidates
  ${bin} architecture --json --top 5   machine-readable, top 5 only
  ${bin} login                  store your adv_live_ key for --report (once per machine)
  ${bin} check --ci --report    CI gate + post the verdict to your account (what the Action runs)
  ${bin} check --sarif out.sarif   also write SARIF 2.1 for GitHub code scanning
  ${bin} github-action          write the GitHub Actions workflow (gate + SARIF upload)
  ${bin} intent init --goal "Add password reset" --allow "src/auth/**" --deny ".github/**"
  ${bin} intent check           prove all changes after baseline stayed inside the freeze contract
  ${bin} deploy --expect-prefix myproject-
  ${bin} gate                   filter stdin (BLOCK on secret / PII / denylist)
  echo hello | ${bin} gate --redact
`);
}

/** Command-specific help: `map --help` / `help map`. */
function printMapHelp() {
  const bin = binName();
  header();
  console.log(`
${c.bold("map")} — a read-only orientation map of what your app has. Never a verdict,
never a write; always exits 0.

${c.bold("Usage")}
  ${bin} map

${c.bold("Lanes")}
  ${c.cyan("Project estate")}          Top-level modules (dirs + file counts + languages),
                          dependency highlights, and ${c.bold("client orientation")} (Vite / React /
                          Supabase evidence at the repo root: detected | not detected |
                          not checkable + paths). Works on ANY stack.
  ${c.cyan("API surface map")}         Route table + methods + whether each looks auth-gated, with a
                          ${c.bold("⚠")} on a mutating route with no obvious gate. Parses ${c.bold("Next.js")} App
                          Router, ${c.bold("Express/Fastify")}, and ${c.bold("Flask/FastAPI")} (best-effort regex);
                          client SPAs get an honest "route mapping does not apply" line —
                          never invented Express routes.
  ${c.cyan("Agents & integrations")}   LLM / 3rd-party services detected from DECLARED
                          dependencies (package.json, requirements.txt, pyproject.toml)
                          plus app/ source, with the env keys behind them. Supabase SDK
                          presence is not an RLS/auth/security verdict.
  ${c.cyan("Schedules & jobs")}        vercel.json crons + app/api/cron/* routes and whether
                          each is gated (CRON_SECRET).

${c.bold("JSON")} (${c.cyan(`${bin} map --json`)})
  Adds machine fields: stack, clientOrientation { clientApp, signals, build,
  nextCheck, notes }, lanes. Evidence paths only — never secret values.

A map is orientation, not a gate — run ${c.cyan(`${bin} ship`)} for the GO / NO-GO.
`);
}

/** Command-specific help: `mcp --help` / `help mcp`. */
function printMcpHelp() {
  const bin = binName();
  header();
  console.log(`
${c.bold("mcp")} — run a dependency-free Model Context Protocol (MCP) server over stdio,
so an AI agent (Claude Code, Cursor, any MCP client) can call getAdvantage's
brain + checks MID-session. No API keys, no network — same engine as the CLI.

${c.bold("Usage")}
  ${bin} mcp

${c.bold("Tools it exposes")}
  ${c.cyan("get_brief")}       read (or generate) PROJECT-BRIEF.md — the project brain
  ${c.cyan("refresh_brief")}   regenerate the brief from the current repo
  ${c.cyan("get_handoff")}     read HANDOFF.md — where work left off
  ${c.cyan("save_handoff")}    refresh the brief + write HANDOFF.md + a ledger entry
  ${c.cyan("check")}           the read-only pre-deploy checks → GO / NO-GO
  ${c.cyan("map")}             read-only app X-ray: routes + auth posture, integrations, crons
  ${c.cyan("architecture")}    accretion scan: collapse candidates + QUIET/NOTABLE/SEVERE band
  ${c.cyan("gauge")}           "is this session getting heavy?" heuristic

${c.bold("Register in Claude Code")} (one command):
  claude mcp add getadvantage -- npx -y getadvantage mcp

${c.bold("Or by config file")} — .mcp.json at the repo root (Claude Code) or
.cursor/mcp.json (Cursor):
  {
    "mcpServers": {
      "getadvantage": {
        "command": "npx",
        "args": ["-y", "getadvantage", "mcp"]
      }
    }
  }
`);
}

/** Command-specific help: `fan-out --help` / `fan-in --help` / `help fan-in`. */
function printFanHelp() {
  const bin = binName();
  header();
  console.log(`
${c.bold("fan-out / fan-in")} — several AI sessions in parallel, ONE verified main.

${c.bold("Usage")}
  ${bin} fan-out <n> [--task "..."]   open n lanes (1–8) as git worktrees off HEAD,
                                      each with the project brain wired
  ${bin} fan-in                       dry-run: collision map (files >1 lane touched)
                                      + each lane test-merged ALONE against main
  ${bin} fan-in --apply               land the lanes in sequence, re-running the
                                      check gate on the COMBINED tree after each
                                      merge — a lane that is green alone but red
                                      combined is quarantined (rolled back), and
                                      a textual conflict halts the train there

${c.bold("The point")}
  Two lanes can each pass alone and still break together. Textual merging can't
  see that; the combined-tree gate can. Nothing reaches main un-verified.

Want the whole thing acted out in ~10 seconds, zero setup? ${c.cyan(`${bin} demo`)}
`);
}

/**
 * Silence console + stdio so a nested `runChecks` does not pollute the feedback
 * first screen. Restores on dispose. Product stderr for feedback is 0 bytes.
 */
function silenceIo() {
  const oLog = console.log;
  const oErr = console.error;
  const oWarn = console.warn;
  const oInfo = console.info;
  const oStdout = process.stdout.write.bind(process.stdout);
  const oStderr = process.stderr.write.bind(process.stderr);
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  console.info = () => {};
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  return () => {
    console.log = oLog;
    console.error = oErr;
    console.warn = oWarn;
    console.info = oInfo;
    process.stdout.write = oStdout;
    process.stderr.write = oStderr;
  };
}

/**
 * `getadvantage feedback` — print a copy-pasteable GitHub issue URL.
 * Always exits 0 (not a gate). Never opens a browser, never posts, zero network.
 * Non-git / no-remote / detached HEAD degrade cleanly (usable link, no fatal:).
 */
async function runFeedbackCommand() {
  let cwd = null;
  try {
    cwd = repoRoot();
  } catch {
    // Non-git: still emit a usable link with environment-only metadata.
    cwd = null;
  }

  let stackLabel = null;
  let checks = [];
  let counts = { pass: 0, fail: 0, warn: 0, skip: 0 };
  let verdict = null;
  let exitCode = null;

  if (cwd) {
    try {
      const project = detectProject(cwd);
      stackLabel = project && project.label ? project.label : null;
    } catch {
      /* best-effort */
    }

    // Collect per-check verdicts with human output suppressed (≤12-line screen).
    const restore = silenceIo();
    try {
      const { exitCode: ec, results } = await runChecks({
        cwd,
        runBuild: false,
        overview: false,
        briefCheck: false,
      });
      exitCode = ec;
      verdict = ec === 0 ? "GO" : "NO-GO";
      checks = (results || []).map((r) => ({
        label: r && r.label ? String(r.label) : "check",
        status: r && r.status ? String(r.status) : "?",
      }));
      for (const r of results || []) {
        if (!r) continue;
        if (r.status === "pass") counts.pass++;
        else if (r.status === "fail") counts.fail++;
        else if (r.status === "warn") counts.warn++;
        else if (r.status === "skip") counts.skip++;
      }
    } catch {
      // Metadata is best-effort — never fail the feedback command.
    } finally {
      restore();
    }
  }

  const built = buildFeedbackUrl({
    cliVersion: cliVersion(),
    nodeVersion: process.version,
    platform: os.platform(),
    stackLabel: stackLabel || undefined,
    counts,
    checks,
    verdict: verdict || undefined,
    exitCode: typeof exitCode === "number" ? exitCode : undefined,
    homeDir: os.homedir(),
    username: process.env.USERNAME || process.env.USER || process.env.LOGNAME || "",
  });

  // First screen: link + what it contains + nothing-sent. ≤12 lines. 0 stderr.
  const bits = [
    `CLI ${cliVersion()}`,
    `Node ${process.version}`,
    `OS ${os.platform()}`,
  ];
  if (stackLabel) bits.push(`stack ${stackLabel}`);
  if (verdict) bits.push(`gate ${verdict}`);
  console.log(built.url);
  console.log("");
  console.log(`Pre-filled with: ${bits.join(", ")}.`);
  console.log("Nothing was sent — copy the link into a browser if you want to open an issue.");
  if (built.truncated) {
    console.log("(Payload truncated to fit the URL length limit.)");
  }
  return 0;
}

async function main() {
  let { cmd, arg, flags, positional } = parseArgs(process.argv.slice(2));

  // --version / -v — print the package version, nothing else. (Before 0.6.2
  // this silently ran the full check.)
  if (flags.version || cmd === "-v" || cmd === "version") {
    console.log(cliVersion());
    process.exit(0);
  }

  // Alias: `ship` = the full gate INCLUDING the production build. The name is
  // the promise — a bare `check` without --build has not proven the build, so
  // the command people remember runs the whole thing.
  const invokedAsShip = cmd === "ship";
  if (cmd === "ship") {
    cmd = "check";
    flags.build = true;
  }

  if (cmd === "help" || flags.help) {
    const topic = cmd === "help" ? arg : cmd;
    if (topic === "map") {
      printMapHelp();
      process.exit(0);
    }
    if (topic === "mcp") {
      printMcpHelp();
      process.exit(0);
    }
    if (topic === "intent") {
      header();
      printIntentHelp();
      process.exit(0);
    }
    if (topic === "fan-out" || topic === "fan-in" || topic === "fanout" || topic === "fanin") {
      printFanHelp();
      process.exit(0);
    }
    if (topic === "gate") {
      printGateHelp();
      process.exit(0);
    }
    // `intent --help` / `intent help` already covered when cmd is intent below.
    printHelp();
    process.exit(0);
  }

  // Gate commands (check / ship) must never silently ignore an unknown flag —
  // a typo'd `--no-overviews` quietly running the default gate would be a
  // false sense of coverage. Error loudly, exit 1.
  if (cmd === "check") {
    const GATE_FLAGS = new Set([
      "build", "base-ref", "no-overview", "no-brief-check", "json", "ci",
      "report", "report-dry-run", "report-required", "sarif", "help", "version",
      // Explicit only — never default, never from repo config. Invisible-mode
      // hooks pass this so agent/commit triggers omit Dirty-tree (with disclosure).
      "agent-trigger",
    ]);
    const unknown = Object.keys(flags).filter((k) => !GATE_FLAGS.has(k));
    if (unknown.length > 0) {
      console.error(c.red(`✗ Unknown flag${unknown.length > 1 ? "s" : ""}: ${unknown.map((f) => `--${f}`).join(", ")}`));
      console.error(c.gray(`  Run \`${binName()} help\` to see the flags ${invokedAsShip ? "`ship`" : "`check`"} accepts.`));
      process.exit(1);
    }
  }

  // The MCP server is special: stdout is the JSON-RPC protocol channel, so we must
  // NOT print the header (or anything else) to stdout, and we resolve the repo
  // per-tool-call (each tool takes an optional `cwd`) — so it can launch from any
  // directory, not only a git repo. Handle it before the repo-root gate below.
  if (cmd === "mcp") {
    const code = await runMcp();
    process.exit(code);
  }

  // login / logout manage the PER-USER key store (~/.getadvantage/config.json)
  // — they are not repo-bound, so they run before the repo-root gate.
  if (cmd === "login") {
    header();
    process.exit(await runLogin());
  }
  if (cmd === "logout") {
    header();
    process.exit(runLogout());
  }

  // `demo` scaffolds its OWN throwaway repo in a temp dir — it needs no project
  // and no cwd git repo. It is the "zero setup" showcase, so it must run before
  // the repo-root gate below (otherwise a curious evaluator in an empty folder
  // hits a dead-end on the most likely first-run path).
  if (cmd === "demo") {
    header();
    process.exit(await runDemo({ keep: !!flags.keep }));
  }

  // `feedback` prints a copy-pasteable GitHub issue URL. Not a gate — always
  // exits 0. Prefer running before the hard repoRoot() failure so non-git
  // degrades cleanly (usable link, zero raw git fatal: noise).
  if (cmd === "feedback") {
    process.exit(await runFeedbackCommand());
  }

  // `gate` is a stdin filter (outbound policy gate). Same class as mcp /
  // feedback / demo — must run in a non-git folder. Dispatch BEFORE
  // classifyGitCwd() / repoRoot().
  if (cmd === "gate") {
    const GATE_CMD_FLAGS = new Set(["json", "redact", "help", "version"]);
    const unknown = Object.keys(flags).filter((k) => !GATE_CMD_FLAGS.has(k));
    if (unknown.length > 0) {
      console.error(c.red(`✗ Unknown flag${unknown.length > 1 ? "s" : ""}: ${unknown.map((f) => `--${f}`).join(", ")}`));
      console.error(c.gray(`  Run \`${binName()} help\` to see the flags \`gate\` accepts.`));
      process.exit(1);
    }
    const restore = flags.json ? routeHumanOutputToStderr() : null;
    const code = await runPolicyGate({
      flags,
      cwd: process.cwd(),
      emitJson: restore
        ? (doc) => {
            emitJson(restore, doc);
          }
        : null,
    });
    process.exit(code);
  }

  // Classify first so bare / non-git / unreadable get factually correct guidance.
  // Human mode: guidance on stdout, stderr 0 B (lane H1/H4/H9). Under --json,
  // route console.log → stderr here — this block runs before the five
  // command-entry routeHumanOutputToStderr() sites, and we exit before any
  // machine document is emitted (same channel shape as unknown-flag under
  // --json: exit 1, stdout empty, detail on stderr). Do not install routing
  // on the worktree success path (those five sites still own it).
  let cwd;
  const gitCwd = classifyGitCwd();
  if (gitCwd.kind === "worktree") {
    cwd = gitCwd.root;
  } else if (gitCwd.kind === "bare") {
    if (flags.json) routeHumanOutputToStderr();
    console.log(
      c.red(
        "✗ This is a bare repository — getAdvantage gates a working tree; run it in a clone.",
      ),
    );
    console.log(c.gray("  → Try it with no setup:  getadvantage demo"));
    process.exit(1);
  } else if (gitCwd.kind === "unreadable") {
    if (flags.json) routeHumanOutputToStderr();
    console.log(
      c.red(
        "✗ This folder's git repository could not be read — likely a permissions problem on .git.",
      ),
    );
    console.log(
      c.gray(
        "  → Fix permissions on the .git directory, then re-run getadvantage check",
      ),
    );
    console.log(c.gray("  → Try it with no setup:  getadvantage demo"));
    process.exit(1);
  } else {
    if (flags.json) routeHumanOutputToStderr();
    console.log(
      c.red(
        "✗ This folder isn't a git repository yet — getAdvantage gates the git history of your project.",
      ),
    );
    console.log(c.gray("  → Try it with no setup:  getadvantage demo"));
    console.log(
      c.gray(
        "  → Or gate this folder:   git init && git add -A   (then re-run getadvantage check)",
      ),
    );
    process.exit(1);
  }

  // --report / GETADVANTAGE_REPORT=1 → post the run (check · fan-in) to the
  // platform. --report-required implies --report and makes a FAILED post exit
  // non-zero; otherwise reporting is best-effort and the gate verdict alone
  // owns the exit code (a network hiccup must not turn a GO into a failed CI
  // step). --report-dry-run is transparency-only: same body, no network; it
  // wins over --report when both are set so nothing is posted by accident.
  const reportDryRunWanted = !!flags["report-dry-run"];
  const reportWanted = !!flags.report || !!flags["report-required"] || envReportOn();
  const reportRequired = !!flags["report-required"];

  // `map` — the read-only overview scanners on their own: project estate (any
  // stack), API surface, agents & integrations, schedules & jobs. Never blocks,
  // never writes; exit 0 always (a map is orientation, not a verdict). Opens
  // with an HONEST scope line. Same stack detection + parsers as `check`.
  // `--json` is honoured (finding: map --json was silently ignored).
  if (cmd === "map") {
    const restore = flags.json ? routeHumanOutputToStderr() : null;
    header();
    const { stack, lanes, clientOrientation } = renderMap(cwd);
    if (restore) {
      emitJson(restore, {
        command: "map",
        stack: stack
          ? {
              kind: stack.kind,
              label: stack.label,
              nextJs: !!stack.nextJs,
              frontend: !!stack.frontend,
            }
          : null,
        // First-class client orientation (Vite/React/Supabase evidence-only).
        // Same structured fields as scanEstate — never includes secret values.
        clientOrientation: clientOrientation || null,
        lanes: lanes.map((r) => ({
          status: r.status,
          label: r.label,
          detail: r.detail,
          extra: r.extra || [],
        })),
        generatedAt: new Date().toISOString(),
      });
    }
    process.exit(0);
  }

  if (cmd === "check") {
    const restore = flags.json ? routeHumanOutputToStderr() : null;
    header();
    // --ci: non-interactive CI mode. `check` never prompts and already tolerates
    // a detached HEAD; the observable difference is the base-ref default —
    // origin/<GITHUB_BASE_REF> / origin/main instead of local `main`, which a CI
    // checkout usually doesn't have.
    const baseRef = flags["base-ref"] || (flags.ci ? ciDefaultBaseRef(cwd) : undefined);
    const { exitCode, results } = await runChecks({
      cwd,
      runBuild: !!flags.build,
      baseRef,
      // Overviews are default-on; `--no-overview` turns them off.
      overview: !flags["no-overview"],
      // Brief-staleness warning is default-on; `--no-brief-check` turns it off.
      briefCheck: !flags["no-brief-check"],
      // Agent-trigger profile: omit Dirty-tree only when the flag is explicit.
      // Default path (no flag) is byte-stable — dirty-tree always runs.
      omitDirtyTree: !!flags["agent-trigger"],
    });
    const intentCheck = results.find((r) => r && r.label === "Intent Contract" && r.intent);
    const doc = {
      command: "check",
      verdict: exitCode === 0 ? "GO" : "NO-GO",
      exitCode,
      checks: results.map((r) => ({
        status: r.status,
        label: r.label,
        detail: r.detail,
        extra: r.extra || [],
        // Optional structured findings (secret scan, tracked .env, …) for
        // tooling. Human lines stay in extra; raw matches are never present.
        ...(Array.isArray(r.findings) && r.findings.length > 0 ? { findings: r.findings } : {}),
        ...(r.intent ? { intent: r.intent } : {}),
      })),
      // Top-level intent receipt when a trusted contract was evaluated — never
      // invent a verified claim when the check was omitted (no contract).
      ...(intentCheck ? { intent: intentCheck.intent, limitation: INTENT_LIMITATION } : {}),
      generatedAt: new Date().toISOString(),
    };
    let finalExit = exitCode;
    if (reportDryRunWanted) {
      // Transparency only — never POSTs, even when combined with --report.
      reportDryRun({ cwd, kind: "check", doc });
    } else if (reportWanted) {
      const rep = await reportRun({ cwd, kind: "check", doc, required: reportRequired });
      if (!rep.ok && reportRequired) finalExit = finalExit || 1;
    }
    // --sarif <path>: write SARIF 2.1 after the gate. Does not suppress human
    // or --json output. Gate NO-GO stays exit 1; write/serialize failure also
    // forces non-zero (never silently drop findings or claim success).
    if ("sarif" in flags) {
      try {
        const sarifDoc = buildSarif({ results, exitCode, cwd });
        const abs = writeSarifFile({ doc: sarifDoc, outPath: flags.sarif });
        console.log(c.gray(`  SARIF written: ${abs}`));
      } catch (e) {
        console.error(c.red(`  ✗ SARIF export failed: ${e.message || e}`));
        finalExit = 1;
      }
    }
    // --json must report the final CLI outcome. If SARIF write (or required
    // report) fails after a clean gate, do not leave verdict:GO / exitCode:0
    // while the process exits 1.
    if (finalExit !== doc.exitCode) {
      doc.exitCode = finalExit;
      doc.verdict = finalExit === 0 ? "GO" : "NO-GO";
    }
    if (restore) emitJson(restore, doc);
    process.exit(finalExit);
  }

  if (cmd === "brief") {
    header();
    const code = runBrief({
      cwd,
      out: flags.out,
      check: !!flags.check,
    });
    process.exit(code);
  }

  if (cmd === "handoff") {
    header();
    const code = runHandoff({
      cwd,
      out: flags.out,
      noBrief: !!flags["no-brief"],
    });
    process.exit(code);
  }

  if (cmd === "switch") {
    header();
    process.exit(runSwitch({ cwd, target: arg }));
  }

  if (cmd === "models") {
    header();
    process.exit(runModels());
  }

  if (cmd === "gauge") {
    header();
    process.exit(runGauge({ cwd }));
  }

  if (cmd === "ledger") {
    header();
    process.exit(runLedger({ cwd }));
  }

  // `github-action` (alias: `init --github-action`) writes the CI workflow that
  // runs `check --ci --report` on push + pull_request. Idempotent; --force to
  // replace a differing existing file.
  if (cmd === "github-action" || (cmd === "init" && flags["github-action"])) {
    header();
    process.exit(runGithubAction({ cwd, force: !!flags.force }));
  }

  if (cmd === "init") {
    header();
    process.exit(
      runInit({
        cwd,
        claudeCode: !!flags["claude-code"],
        cursor: !!flags.cursor,
        uninstallInvisible: !!flags["uninstall-invisible"],
        invisibleStatus: !!flags["invisible-status"],
        force: !!flags.force,
      }),
    );
  }

  // Intent Contract: local change-scope proof (init + check).
  if (cmd === "intent") {
    const sub = arg || "help";
    if (sub === "help" || flags.help) {
      header();
      printIntentHelp();
      process.exit(0);
    }
    const restore = flags.json ? routeHumanOutputToStderr() : null;
    header();
    let jsonDoc = null;
    const code = runIntent({
      cwd,
      sub,
      flags,
      emitJson: restore
        ? (doc) => {
            jsonDoc = doc;
          }
        : null,
    });
    if (restore && jsonDoc) emitJson(restore, jsonDoc);
    else if (restore && !jsonDoc) {
      // init or help under --json — emit a minimal document
      emitJson(restore, {
        command: "intent",
        sub,
        exitCode: code,
        generatedAt: new Date().toISOString(),
      });
    }
    process.exit(code);
  }

  if (cmd === "fan-out" || cmd === "fanout") {
    header();
    process.exit(runFanOut({ cwd, n: arg, task: flags.task }));
  }

  if (cmd === "fan-in" || cmd === "fanin") {
    const restore = flags.json ? routeHumanOutputToStderr() : null;
    header();
    // fan-in accepts --ci too: it is already non-interactive; the flag defaults
    // the base comparison to origin/main / GITHUB_BASE_REF like `check --ci`.
    const { exitCode, report } = await runFanIn({
      cwd,
      apply: !!flags.apply,
      // `--no-build` skips the (slower) full build in the combined-tree gate;
      // default is to build, since a textual merge can break the build even
      // when each lane typechecks alone.
      build: !flags["no-build"],
      baseRef: flags["base-ref"] || (flags.ci ? ciDefaultBaseRef(cwd) : undefined),
      into: flags.into,
    });
    const doc = {
      command: "fan-in",
      verdict: exitCode === 0 ? "GO" : "NO-GO",
      exitCode,
      mode: report.mode,
      into: report.into,
      ...(report.preflight ? { preflight: report.preflight } : {}),
      ...(report.postTrainDirty ? { postTrainDirty: true } : {}),
      lanes: report.lanes,
      generatedAt: new Date().toISOString(),
    };
    let finalExit = exitCode;
    if (reportDryRunWanted) {
      // Transparency only — never POSTs, even when combined with --report.
      reportDryRun({
        cwd,
        kind: "fan-in",
        doc,
        lanes: lanesForIngest(report.lanes),
      });
    } else if (reportWanted) {
      const rep = await reportRun({
        cwd,
        kind: "fan-in",
        doc,
        lanes: lanesForIngest(report.lanes),
        required: reportRequired,
      });
      if (!rep.ok && reportRequired) finalExit = finalExit || 1;
    }
    if (restore) emitJson(restore, doc);
    process.exit(finalExit);
  }

  // `architecture` — the ACCRETION scanner. Read-only + ADVISORY: it surfaces
  // ranked collapse candidates (size × churn × duplication) and always exits 0
  // — where the code is rotting is a signal for a human, not a ship gate.
  if (cmd === "architecture" || cmd === "arch") {
    const restore = flags.json ? routeHumanOutputToStderr() : null;
    header();
    const { exitCode, report } = runArchitecture({ cwd, top: flags.top });
    const doc = {
      command: "architecture",
      exitCode,
      summary: report.summary,
      candidates: report.candidates,
      generatedAt: new Date().toISOString(),
    };
    if (restore) emitJson(restore, doc);
    process.exit(exitCode);
  }

  if (cmd === "deploy") {
    header();
    const code = await deploy({
      cwd,
      commit: flags.commit,
      expectPrefix: flags["expect-prefix"],
      scope: flags.scope,
      tokenEnv: flags["token-env"],
      force: !!flags.force,
      runBuild: !!flags.build,
    });
    process.exit(code);
  }

  // Typo → focused "did you mean", not a 130-line help dump (finding: typo-dumps-full-help).
  const known = [
    "ship", "check", "map", "brief", "handoff", "init", "switch", "models", "gauge",
    "ledger", "mcp", "fan-out", "fan-in", "demo", "architecture", "login", "logout",
    "github-action", "intent", "deploy", "feedback", "gate", "help", "version",
  ];
  void positional; // parseArgs exposes full positional list for future multi-arg cmds
  const suggestion = didYouMean(cmd, known);
  console.error(c.red(`✗ Unknown command: ${cmd}`));
  if (suggestion) {
    console.error(c.gray(`  Did you mean \`${binName()} ${suggestion}\`?`));
  }
  console.error(c.gray(`  Run \`${binName()} help\` for the full command list.`));
  process.exit(1);
}

/** Tiny Levenshtein-ish "did you mean" for command typos. */
function didYouMean(input, candidates) {
  if (!input || typeof input !== "string") return null;
  const s = input.toLowerCase();
  let best = null;
  let bestDist = Infinity;
  for (const cand of candidates) {
    const d = editDistance(s, cand);
    // Accept only close typos (≤2 edits, or prefix match).
    if (d < bestDist && (d <= 2 || cand.startsWith(s) || s.startsWith(cand.slice(0, 3)))) {
      bestDist = d;
      best = cand;
    }
  }
  return bestDist <= 2 || (best && best.startsWith(s)) ? best : null;
}

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

main().catch((e) => {
  console.error(c.red(`✗ getAdvantage crashed: ${e?.stack || e}`));
  process.exit(1);
});
