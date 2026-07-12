#!/usr/bin/env node
// getAdvantage CLI — land the fleet safely: parallel AI agents, one verified main.
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

import { c, printResult, section } from "./util.mjs";
import { repoRoot } from "./util.mjs";
import { overviewApiSurface, overviewIntegrations, overviewSchedules } from "./overviews.mjs";
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
import { envReportOn, reportRun, lanesForIngest, ciDefaultBaseRef, runLogin, runLogout } from "./report.mjs";
import { runGithubAction } from "./action.mjs";

function parseArgs(argv) {
  // First non-flag token is the subcommand; default to "check".
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      // value-taking flags vs boolean flags
      const valueFlags = new Set(["expect-prefix", "scope", "commit", "token-env", "base-ref", "out", "task", "into", "top"]);
      if (valueFlags.has(key)) {
        flags[key] = argv[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { cmd: positional[0] || "check", arg: positional[1], flags };
}

function header() {
  console.log(c.bold("┌────────────────────────────────────────┐"));
  console.log(c.bold("│  getAdvantage — land the fleet safely  │"));
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
  ${c.cyan("switch")}   Switch tools/models without losing context: saves your place, wires every
           AI-tool file, and prints the prompt to start the new session. ${c.dim("(switch <tool>)")}
  ${c.cyan("models")}   A plain-language playbook for choosing + switching AI models (which model
           for which job) — principles, not benchmarks.
  ${c.cyan("mcp")}      Run a dependency-free Model Context Protocol (MCP) server over stdio so an
           AI agent (Claude Code, Cursor) can call getAdvantage's brain + checks MID-session
           — tools: ${c.bold("get_brief")}, ${c.bold("refresh_brief")}, ${c.bold("get_handoff")}, ${c.bold("save_handoff")}, ${c.bold("check")}, ${c.bold("gauge")}.
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
  ${c.cyan("demo")}     Spin up a throwaway sample repo with 3 pre-made divergent lanes (one clean, two
           that collide, one that breaks the build) and run the WHOLE fan-in conductor on it —
           so you can see the entire wow in ONE command, zero setup.
  ${c.cyan("architecture")}  The ACCRETION scanner — where is the code rotting by being built OVER instead
           of collapsed? Ranks the top collapse candidates by ${c.bold("size × churn × duplication")}
           (oversized files, git-churn hotspots, repeated ≥15-line blocks, approximate
           complexity). Surfaces the signal an AI coding agent is missing; it never
           refactors and never claims your code is clean. ${c.bold("Advisory — always exits 0.")}
  ${c.cyan("login")}    Connect this machine to your getAdvantage account: store an ${c.bold("adv_live_")} API key
           in ~/.getadvantage/config.json (owner-only). Used by ${c.bold("--report")}; env
           GETADVANTAGE_API_KEY always wins over the stored key. ${c.cyan("logout")} removes it.
  ${c.cyan("github-action")}  Write .github/workflows/getadvantage.yml — run ${c.bold("check --ci --report")} on every
           push + pull request (reporting needs the GETADVANTAGE_API_KEY repo secret).
           Idempotent; ${c.bold("--force")} to replace a differing existing file. ${c.dim("(also: init --github-action)")}
  ${c.cyan("deploy")}   Run check, then deploy from a clean detached worktree and confirm the
           deployment URL prefix. Performs a real ${c.bold("vercel --prod")}.

${c.bold("Flags")}
  --build                 Also run the project's ${c.bold("build")} script (default: typecheck only, where it applies).
  --base-ref <ref>        Merge-base ref for the schema-bump diff (default: main).
  --no-overview           Skip the read-only overview maps (API surface, integrations, schedules).
  --no-brief-check        Skip the (non-blocking) brief-staleness warning in ${c.cyan("check")}.
  --json                  (${c.cyan("check")} + ${c.cyan("fan-in")}) Print ONE machine-readable JSON document to stdout
                          — { command, verdict, exitCode, checks?/lanes?, generatedAt } — with the
                          human rendering routed to stderr. For CI and tooling.
  --ci                    (${c.cyan("check")} + ${c.cyan("fan-in")}) Non-interactive CI mode: never prompts, tolerates a
                          detached HEAD (CI checks out a sha), and defaults the base comparison to
                          origin/main (or GITHUB_BASE_REF). Exit codes stay CI-honest: 0 = GO.
  --report                (${c.cyan("check")} + ${c.cyan("fan-in")}) OPT-IN: after the verdict, post the run REPORT — the
                          --json document (verdict, exit code, checks / lane outcomes) plus repo
                          name, branch + commit id, ${c.bold("never your source code")} — to your getAdvantage
                          account. Also enabled by GETADVANTAGE_REPORT=1. Needs a key (env
                          GETADVANTAGE_API_KEY or ${c.cyan("login")}); endpoint override: GETADVANTAGE_API_URL.
                          Without --report, nothing ever leaves your machine.
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

  ${c.dim("deploy only:")}
  --expect-prefix <p>     Required deployment-host prefix (default: derived from your linked .vercel project; guard skipped if none).
  --scope <scope>         Vercel team scope, passed through to vercel.
  --commit <ref>          Commit-ish to deploy (default: HEAD).
  --token-env <NAME>      Env var NAME holding the Vercel token (default: VERCEL_TOKEN).
  --force                 Deploy even if checks return NO-GO (use with care).

${c.bold("Examples")}
  ship-safe                        run the pre-deploy checks (GO / NO-GO)
  ship-safe brief                  generate / refresh the project brain
  ship-safe init                   auto-load the brain at every session start
  ship-safe handoff                save your place for the next session
  ship-safe switch cursor          move to a new tool/model without losing context
  ship-safe gauge                  is this session getting heavy?
  getadvantage mcp                 run the MCP server (an agent calls the brain mid-session)
  getadvantage fan-out 3           open 3 parallel lanes sharing one brain
  getadvantage fan-out 3 --task "add a settings page"
  getadvantage fan-in              collision map + merge-train DRY-RUN (preview, nothing merged)
  getadvantage fan-in --apply      actually land the clean+green lanes into main, gated
  getadvantage demo                see the whole safe fan-in conductor on a throwaway repo
  getadvantage architecture        where is the code accreting? ranked collapse candidates
  getadvantage architecture --json --top 5   machine-readable, top 5 only
  getadvantage login               store your adv_live_ key for --report (once per machine)
  getadvantage check --ci --report CI gate + post the verdict to your account (what the Action runs)
  getadvantage github-action       write the GitHub Actions workflow for the line above
  getadvantage deploy --expect-prefix myproject-
`);
}

async function main() {
  let { cmd, arg, flags } = parseArgs(process.argv.slice(2));

  // Alias: `ship` = the full gate INCLUDING the production build. The name is
  // the promise — a bare `check` without --build has not proven the build, so
  // the command people remember runs the whole thing.
  if (cmd === "ship") {
    cmd = "check";
    flags.build = true;
  }

  if (cmd === "help" || flags.help) {
    printHelp();
    process.exit(0);
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

  let cwd;
  try {
    cwd = repoRoot();
  } catch {
    console.error(c.red("✗ Not inside a git repository. getAdvantage must run in your project's repo."));
    process.exit(1);
  }

  // --report / GETADVANTAGE_REPORT=1 → post the run (check · fan-in) to the
  // platform. --report-required implies --report and makes a FAILED post exit
  // non-zero; otherwise reporting is best-effort and the gate verdict alone
  // owns the exit code (a network hiccup must not turn a GO into a failed CI
  // step).
  const reportWanted = !!flags.report || !!flags["report-required"] || envReportOn();
  const reportRequired = !!flags["report-required"];

  // `map` — the read-only overview scanners on their own: API surface,
  // agents & integrations, schedules & jobs. Never blocks, never writes;
  // exit 0 always (a map is orientation, not a verdict).
  if (cmd === "map") {
    header();
    section("Map — what your app has (read-only)");
    for (const [fn, label] of [
      [overviewApiSurface, "API surface map"],
      [overviewIntegrations, "Agents & integrations map"],
      [overviewSchedules, "Schedules & jobs map"],
    ]) {
      try {
        printResult(fn(cwd));
      } catch (e) {
        printResult({ status: "warn", label, detail: `Scanner errored: ${e.message || e}`, extra: [] });
      }
    }
    console.log(
      `\n${c.dim("A map is orientation, not a verdict — run")} ${c.cyan("npx getadvantage ship")} ${c.dim("for the gate.")}`,
    );
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
    });
    const doc = {
      command: "check",
      verdict: exitCode === 0 ? "GO" : "NO-GO",
      exitCode,
      checks: results.map((r) => ({
        status: r.status,
        label: r.label,
        detail: r.detail,
        extra: r.extra || [],
      })),
      generatedAt: new Date().toISOString(),
    };
    let finalExit = exitCode;
    if (reportWanted) {
      const rep = await reportRun({ cwd, kind: "check", doc, required: reportRequired });
      if (!rep.ok && reportRequired) finalExit = finalExit || 1;
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
    process.exit(runInit({ cwd }));
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
    if (reportWanted) {
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

  if (cmd === "demo") {
    header();
    process.exit(await runDemo({ keep: !!flags.keep }));
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

  console.error(c.red(`✗ Unknown command: ${cmd}`));
  printHelp();
  process.exit(1);
}

main().catch((e) => {
  console.error(c.red(`✗ getAdvantage crashed: ${e?.stack || e}`));
  process.exit(1);
});
