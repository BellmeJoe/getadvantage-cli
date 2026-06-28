// Ship-Safe — runs the full check suite and renders the per-check + overall
// verdict. Shared by both `ship-safe check` and `ship-safe deploy` so the gate
// is identical in both paths.

import { c, GLYPH, printResult, section } from "./util.mjs";
import {
  checkDirtyTree,
  checkSecrets,
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

  section("Checks");

  // a. Dirty-tree guard
  results.push(safe(() => checkDirtyTree(cwd), "Dirty-tree guard"));
  printResult(results[results.length - 1]);

  // b. Secret scan
  results.push(safe(() => checkSecrets(cwd), "Secret scan"));
  printResult(results[results.length - 1]);

  // c. Typecheck (always) + optional full build
  results.push(safe(() => checkTypecheck(cwd), "Typecheck (tsc --noEmit)"));
  printResult(results[results.length - 1]);
  if (o.runBuild) {
    results.push(safe(() => checkBuild(cwd), "Production build (npm run build)"));
    printResult(results[results.length - 1]);
  }

  // d. Schema-bump check
  results.push(safe(() => checkSchemaBump(cwd, o.baseRef || "main"), "Schema-bump check"));
  printResult(results[results.length - 1]);

  // ---- v1.1 OVERVIEW SCANNERS (read-only maps) ----------------------------
  // Default-on: three fast, read-only repo scans that give the builder a map of
  // what their app actually has. They emit pass/warn only (never a blocking
  // fail) — a surprising map is informational, the v1 safety checks own NO-GO.
  // Disable with `--no-overview`.
  const runOverview = o.overview !== false;
  if (runOverview) {
    section("Overview — what your app has (read-only)");

    results.push(safe(() => overviewApiSurface(cwd), "API surface map"));
    printResult(results[results.length - 1]);

    results.push(safe(() => overviewIntegrations(cwd), "Agents & integrations map"));
    printResult(results[results.length - 1]);

    results.push(safe(() => overviewSchedules(cwd), "Schedules & jobs map"));
    printResult(results[results.length - 1]);
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
        return {
          status: "warn",
          label: "Project brief",
          detail: s.reason,
          extra: ["project brief is stale, run `ship-safe brief` to refresh."],
        };
      }, "Project brief"),
    );
    printResult(results[results.length - 1]);
  }

  // ---- Overall verdict ----------------------------------------------------
  const fails = results.filter((r) => r.status === "fail").length;
  const warns = results.filter((r) => r.status === "warn").length;
  const passes = results.filter((r) => r.status === "pass").length;

  section("Verdict");
  console.log(`  ${GLYPH.pass} ${passes}   ${GLYPH.warn} ${warns}   ${GLYPH.fail} ${fails}`);

  if (fails > 0) {
    console.log(
      "\n" + c.red(c.bold("  NO-GO")) + c.red(` — ${fails} blocking issue(s). Do not ship until these are clear.`),
    );
    return { exitCode: 1, results };
  }
  if (warns > 0) {
    console.log(
      "\n" + c.green(c.bold("  GO")) + c.yellow(` — with ${warns} warning(s) to eyeball first.`),
    );
    return { exitCode: 0, results };
  }
  console.log("\n" + c.green(c.bold("  GO")) + c.green(" — all checks clear. Safe to ship."));
  return { exitCode: 0, results };
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
