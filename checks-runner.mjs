// Ship-Safe — runs the full check suite and renders the per-check + overall
// verdict. Shared by both `ship-safe check` and `ship-safe deploy` so the gate
// is identical in both paths.

import { binName, c, GLYPH, printResult, section, pl } from "./util.mjs";
import {
  checkDirtyTree,
  checkSecrets,
  checkTrackedEnv,
  checkManifest,
  checkTypecheck,
  checkBuild,
  checkSchemaBump,
} from "./checks.mjs";
import {
  overviewApiSurface,
  overviewIntegrations,
  overviewSchedules,
} from "./overviews.mjs";
import { briefStaleness } from "./brief.mjs";
import { detectProject, detectRepoStack } from "./detect.mjs";
import { architectureAdvisory } from "./architecture.mjs";
import { checkIntent } from "./intent.mjs";

/**
 * Run every check and print a clean summary.
 * @param {object} o
 * @param {string} o.cwd        repo root
 * @param {boolean} o.runBuild   also run a full `npm run build` (slower)
 * @param {string} [o.baseRef]   merge-base ref for the schema diff (default main)
 * @param {boolean} [o.overview] run the v1.1 read-only overview scanners
 *                               (API surface · integrations · schedules).
 *                               Defaults to ON — they're fast, read-only maps.
 * @param {boolean} [o.briefCheck] emit a NON-BLOCKING staleness warning if the
 *                               PROJECT BRAIN (PROJECT-BRIEF.md) is missing or
 *                               out of date. Defaults to ON. Never a fail.
 * @returns {Promise<{ exitCode: number, results: any[] }>}  exitCode 0=GO, 1=NO-GO
 */
export async function runChecks(o) {
  const cwd = o.cwd;
  const results = [];

  // Detect the project's shape ONCE so every stack-specific check (tsc,
  // schema-bump, build) can decide whether it applies on THIS repo — keeping the
  // gate trustworthy on a stranger's plain-Node repo, not just a Next.js app.
  const project = detectProject(cwd);

  section("Checks");
  console.log(`  ${c.gray("detected:")} ${c.bold(project.label)}`);

  // a. Dirty-tree guard
  results.push(safe(() => checkDirtyTree(cwd), "Dirty-tree guard"));
  printResult(results[results.length - 1]);

  // b. Secret scan
  results.push(safe(() => checkSecrets(cwd), "Secret scan"));
  printResult(results[results.length - 1]);

  // b2. Tracked .env file — a committed .env is a leak by itself (BLOCKS).
  results.push(safe(() => checkTrackedEnv(cwd), "Tracked .env file"));
  printResult(results[results.length - 1]);

  // b3. Package manifest integrity — an unparseable package.json BLOCKS
  // ("not checkable ≠ GO"); no package.json → neutral skip.
  results.push(safe(() => checkManifest(cwd, project), "Package manifest"));
  printResult(results[results.length - 1]);

  // c. Typecheck (only where it applies) + optional full build
  results.push(safe(() => checkTypecheck(cwd, project), "Typecheck"));
  printResult(results[results.length - 1]);
  if (o.runBuild) {
    results.push(safe(() => checkBuild(cwd, project), "Build"));
    printResult(results[results.length - 1]);
  }

  // d. Schema-bump check (only on the SCHEMA_VERSION-sentinel pattern)
  results.push(safe(() => checkSchemaBump(cwd, o.baseRef || "main", project), "Schema-bump check"));
  printResult(results[results.length - 1]);

  // e. Intent Contract — only when a trusted freeze is present.
  // Projects without a contract keep existing checks only; never emit a false
  // "intent verified" pass. When present, scope violations → NO-GO.
  // Trust always comes from baselineCommit + dedicated freeze history — never
  // from schema-bump/PR --base-ref or any runtime trust selector.
  {
    let intentResult = null;
    try {
      intentResult = checkIntent(cwd, {});
    } catch (e) {
      intentResult = {
        status: "fail",
        label: "Intent Contract",
        detail: `Check errored: ${e.message || e}`,
        extra: [],
      };
    }
    if (intentResult) {
      results.push(intentResult);
      printResult(intentResult);
    }
  }

  // ---- v1.1 OVERVIEW SCANNERS (read-only maps) ----------------------------
  // Default-on: three fast, read-only repo scans that give the builder a map of
  // what their app actually has. They emit pass/warn only (never a blocking
  // fail) — a surprising map is informational, the v1 safety checks own NO-GO.
  // Disable with `--no-overview`.
  const runOverview = o.overview !== false;
  if (runOverview) {
    section("Overview — what your app has (read-only)");

    // Same stack detection map uses — so map and check never disagree on routes
    // (finding: map-vs-check-routes).
    let stack = null;
    try {
      stack = detectRepoStack(cwd);
    } catch {
      /* best-effort */
    }

    results.push(safe(() => overviewApiSurface(cwd, stack), "API surface map"));
    printResult(results[results.length - 1]);

    results.push(safe(() => overviewIntegrations(cwd), "Agents & integrations map"));
    printResult(results[results.length - 1]);

    results.push(safe(() => overviewSchedules(cwd), "Schedules & jobs map"));
    printResult(results[results.length - 1]);

    // Quiet accretion advisory (size+churn only — the cheap half of the
    // `architecture` scan). Deliberately NOT a result: it never appears in the
    // --json checks array and never changes the verdict or exit code.
    const advisory = architectureAdvisory(cwd);
    if (advisory) console.log(`  ${c.gray("(" + advisory + ")")}`);
  }

  // ---- PROJECT BRAIN staleness (non-blocking) -----------------------------
  // Warn (never fail) if the repo-resident project brief is missing or stale,
  // so the portable context any model/tool reads on start doesn't silently rot.
  if (o.briefCheck !== false) {
    results.push(
      safe(() => {
        const s = briefStaleness(cwd);
        if (s.status === "ok") {
          return { status: "pass", label: "Project brief", detail: s.reason, extra: [] };
        }
        // Honest wording: missing ≠ stale (finding: missing-brief-called-stale).
        const action =
          s.status === "missing"
            ? `no project brief yet — run \`${binName()} brief\` to create one.`
            : `project brief is stale — run \`${binName()} brief\` to refresh.`;
        return {
          status: "warn",
          label: "Project brief",
          detail: s.reason,
          extra: [action],
        };
      }, "Project brief"),
    );
    printResult(results[results.length - 1]);
  }

  // ---- Overall verdict ----------------------------------------------------
  // Skipped (not-applicable) checks are NEUTRAL: they render with a "–" and get
  // their own count — a skipped build is not a green tick.
  const fails = results.filter((r) => r.status === "fail").length;
  const warns = results.filter((r) => r.status === "warn").length;
  const passes = results.filter((r) => r.status === "pass").length;
  const skips = results.filter((r) => r.status === "skip").length;

  section("Verdict");
  console.log(
    `  ${GLYPH.pass} ${passes}   ${GLYPH.warn} ${warns}   ${GLYPH.fail} ${fails}   ${GLYPH.skip} ${skips} skipped`,
  );

  const skipNote = skips > 0 ? c.gray(` (${skips} check${pl(skips)} skipped — not applicable on this stack.)`) : "";
  if (fails > 0) {
    console.log(
      "\n" + c.red(c.bold("  NO-GO")) + c.red(` — ${fails} blocking issue${pl(fails)}. Do not ship until these are clear.`),
    );
    return { exitCode: 1, results };
  }
  if (warns > 0) {
    console.log(
      "\n" + c.green(c.bold("  GO")) + c.yellow(` — with ${warns} warning${pl(warns)} to eyeball first.`) + skipNote,
    );
    return { exitCode: 0, results };
  }
  console.log("\n" + c.green(c.bold("  GO")) + c.green(" — all applicable checks clear. Safe to ship.") + skipNote);
  return { exitCode: 0, results };
}

/**
 * Run the BLOCKING gate on a tree, SILENTLY, and return a structured verdict.
 * Used by the fan-in merge-train to judge the COMBINED tree after each merge —
 * the novel "two green branches can be red together" check. We deliberately run
 * the real correctness checks (secret scan + typecheck + build + schema-bump),
 * NOT the dirty-tree guard (the merge train commits each step, so a clean
 * committed tree is expected) and NOT the informational overview maps.
 *
 * `--build`-equivalent is FORCED on here: a textual merge can leave code that
 * typechecks per-file but fails to build together, so the combined gate must
 * actually build to be honest about semantic breaks.
 *
 * @param {object} o
 * @param {string} o.cwd       tree to gate (a worktree or the integration checkout)
 * @param {string} [o.baseRef] schema-bump base ref
 * @param {boolean} [o.build]  run the full build (default true — catches semantic breaks)
 * @returns {{ ok: boolean, fails: any[], results: any[] }}
 */
export function gateTree(o) {
  const cwd = o.cwd;
  const project = detectProject(cwd);
  const results = [];

  results.push(safe(() => checkSecrets(cwd), "Secret scan"));
  results.push(safe(() => checkTrackedEnv(cwd), "Tracked .env file"));
  results.push(safe(() => checkManifest(cwd, project), "Package manifest"));
  results.push(safe(() => checkTypecheck(cwd, project), "Typecheck"));
  if (o.build !== false) {
    results.push(safe(() => checkBuild(cwd, project), "Build"));
  }
  results.push(safe(() => checkSchemaBump(cwd, o.baseRef || "main", project), "Schema-bump check"));

  const fails = results.filter((r) => r.status === "fail");
  return { ok: fails.length === 0, fails, results };
}

/** Never let one check throwing crash the whole gate — surface it as a fail. */
function safe(fn, label) {
  try {
    return fn();
  } catch (e) {
    return {
      status: "fail",
      label,
      detail: `Check errored: ${e.message || e}`,
      extra: [],
    };
  }
}
