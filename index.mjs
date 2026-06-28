#!/usr/bin/env node
// Ship-Safe — "is this safe to ship?"
//
// A local, dependency-free pre-deploy auditor for AI-built apps. Run it in your
// repo BEFORE you deploy and it gives a plain-language GO / NO-GO:
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
// Usage:
//   node cli/ship-safe/index.mjs [check] [--build]
//   node cli/ship-safe/index.mjs deploy [--expect-prefix getadvantage-] [--scope <s>]
//                                       [--commit <ref>] [--token-env VERCEL_TOKEN]
//                                       [--build] [--force]

import { c } from "./util.mjs";
import { repoRoot } from "./util.mjs";
import { runChecks } from "./checks-runner.mjs";
import { deploy } from "./deploy.mjs";
import { runBrief } from "./brief.mjs";
import { runHandoff } from "./handoff.mjs";
import { runLedger } from "./ledger.mjs";
import { runGauge } from "./gauge.mjs";
import { runInit } from "./init.mjs";
import { runSwitch } from "./switch.mjs";
import { runModels } from "./models.mjs";

function parseArgs(argv) {
  // First non-flag token is the subcommand; default to "check".
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      // value-taking flags vs boolean flags
      const valueFlags = new Set(["expect-prefix", "scope", "commit", "token-env", "base-ref", "out"]);
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
  console.log(c.bold("┌──────────────────────────────────────────┐"));
  console.log(c.bold("│  Ship-Safe — is this safe to ship?        │"));
  console.log(c.bold("└──────────────────────────────────────────┘"));
}

function printHelp() {
  header();
  console.log(`
${c.bold("Commands")}
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
  ${c.cyan("deploy")}   Run check, then deploy from a clean detached worktree and confirm the
           deployment URL prefix. Performs a real ${c.bold("vercel --prod")}.

${c.bold("Flags")}
  --build                 Also run a full ${c.bold("npm run build")} (default: tsc --noEmit only).
  --base-ref <ref>        Merge-base ref for the schema-bump diff (default: main).
  --no-overview           Skip the read-only overview maps (API surface, integrations, schedules).
  --no-brief-check        Skip the (non-blocking) brief-staleness warning in ${c.cyan("check")}.

  ${c.dim("brief only:")}
  --out <path>            Where to write the brief (default: PROJECT-BRIEF.md at repo root).
  --check                 Report staleness only (no write); warns if missing/stale.

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
  ship-safe deploy --expect-prefix myproject-
`);
}

async function main() {
  const { cmd, arg, flags } = parseArgs(process.argv.slice(2));

  if (cmd === "help" || flags.help) {
    printHelp();
    process.exit(0);
  }

  let cwd;
  try {
    cwd = repoRoot();
  } catch {
    console.error(c.red("✗ Not inside a git repository. Ship-Safe must run in your project's repo."));
    process.exit(1);
  }

  if (cmd === "check") {
    header();
    const { exitCode } = await runChecks({
      cwd,
      runBuild: !!flags.build,
      baseRef: flags["base-ref"],
      // Overviews are default-on; `--no-overview` turns them off.
      overview: !flags["no-overview"],
      // Brief-staleness warning is default-on; `--no-brief-check` turns it off.
      briefCheck: !flags["no-brief-check"],
    });
    process.exit(exitCode);
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

  if (cmd === "init") {
    header();
    process.exit(runInit({ cwd }));
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
  console.error(c.red(`✗ Ship-Safe crashed: ${e?.stack || e}`));
  process.exit(1);
});
