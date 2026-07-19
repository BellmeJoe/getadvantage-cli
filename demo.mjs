// getAdvantage CLI — THE ONE-COMMAND DEMO (`getadvantage demo`).
//
// The fastest way to FEEL the safe fan-in conductor: this scaffolds a realistic
// throwaway sample project in a temp dir, opens 3 lanes with pre-made DIVERGENT
// edits, then runs the WHOLE conductor (collision map → merge-train → combined
// gate → verdict) — zero manual setup. The three lanes are designed to exercise
// every branch of the conductor:
//
//   • lane 1 — rewrites README's intro line. CLEAN, lands green. OVERLAPS with
//              lane 3 on README.md (so the collision map has something to flag).
//   • lane 2 — adds a new file (feature.js) with a SYNTAX ERROR. It merges
//              textually clean — but the COMBINED-tree gate (which builds the
//              merged result) goes red, so it is QUARANTINED, never landed.
//              This is the novel "two green branches can be red together" case.
//   • lane 3 — rewrites the SAME README intro line a different way. After lane 1
//              has landed, lane 3 textually CONFLICTS, so the train halts there.
//
// So one run shows: an overlap detected, a clean lane that lands, a lane the
// gate quarantines, and a lane that conflicts — every branch of the conductor.
//
// Self-cleaning: removes the temp repo on exit unless `--keep` is passed (in
// which case it prints the path so you can poke around). Node built-ins only.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { c } from "./util.mjs";
import { runFanIn } from "./fanout.mjs";

/** Run git in a given cwd, throwing on failure (demo setup must be deterministic). */
function g(args, cwd) {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}

function write(repo, rel, content) {
  const abs = path.join(repo, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

/**
 * `getadvantage demo` — scaffold a sample repo + lanes and run the conductor.
 * @param {object} o
 * @param {boolean} [o.keep]  keep the temp repo (and print its path) instead of deleting it
 * @returns {Promise<number>} exit code
 */
export async function runDemo(o = {}) {
  const base = mkdtempSync(path.join(tmpdir(), "ga-demo-"));
  const repo = path.join(base, "sample-app");
  mkdirSync(repo, { recursive: true });

  console.log(c.bold("\n  Demo — the safe fan-in conductor, end to end\n"));
  console.log(c.gray(`  Scaffolding a throwaway sample repo at:`));
  console.log(c.gray(`    ${repo}`));
  console.log("");

  try {
    // ---- 1. A realistic little plain-Node project (NOT Next.js, on purpose:
    //         it also proves the generic, non-stack-biased gate). --------------
    g(["init", "-q", "-b", "main"], repo);
    g(["config", "user.email", "demo@getadvantage.app"], repo);
    g(["config", "user.name", "getAdvantage Demo"], repo);
    g(["config", "commit.gpgsign", "false"], repo);

    write(repo, "package.json", JSON.stringify({
      name: "sample-app",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: {
        // A real build step that actually fails if app.js is broken — so the
        // combined-tree gate has teeth. `node --check` parses the file without
        // running it and exits non-zero on a syntax error.
        build: "node --check app.js",
      },
    }, null, 2) + "\n");

    write(repo, "README.md", [
      "# sample-app",
      "",
      "A tiny sample project so you can see the getAdvantage fan-in conductor work.",
      "",
      "## Usage",
      "",
      "    node app.js",
      "",
    ].join("\n"));

    write(repo, "app.js", [
      "// sample-app entrypoint",
      "export function main() {",
      "  return 'hello from sample-app';",
      "}",
      "",
      "console.log(main());",
      "",
    ].join("\n"));

    g(["add", "-A"], repo);
    g(["commit", "-q", "-m", "chore: initial sample-app"], repo);

    console.log(c.cyan("  Created a sample repo with app.js + README.md (plain Node, no framework)."));
    console.log("");

    // ---- 2. Three divergent lanes via the real fan-out machinery would create
    //         sibling worktrees; for a hermetic demo we build the lane branches
    //         + their worktrees directly (same shape fan-in discovers:
    //         ../sample-app-lane-N on branch ga/lane-N). -------------------------
    console.log(c.cyan("  Opening 3 lanes with pre-made divergent edits:"));

    const readmeIntro = (line) => [
      "# sample-app",
      "",
      line,
      "",
      "## Usage",
      "",
      "    node app.js",
      "",
    ].join("\n");

    // lane 1 — CLEAN land: rewrites the README intro (overlaps lane 3, but lands
    //          first so it goes in green).
    makeLane(repo, base, 1, (laneDir) => {
      write(laneDir, "README.md", readmeIntro("A tiny sample project — with a friendlier intro, courtesy of lane 1."));
    }, "docs: friendlier README intro (lane 1)");
    console.log(`     ${c.green("✓")} lane 1 — rewrites the README intro line ${c.gray("(clean; overlaps lane 3)")}`);

    // lane 2 — QUARANTINE: edits app.js to add a feature but leaves a SYNTAX
    //          ERROR (a missing brace). Lane 1 didn't touch app.js, so this
    //          merges textually clean — but the combined-tree build (which parses
    //          app.js) fails → the lane is quarantined and rolled back.
    makeLane(repo, base, 2, (laneDir) => {
      write(laneDir, "app.js", [
        "// sample-app entrypoint — lane 2 added a feature but left a syntax error",
        "export function main() {",
        "  const extra = 'lane-2 feature';",
        "  return 'hello from sample-app ' + extra",  // missing closing brace below
        "",
        "console.log(main());",
        "",
      ].join("\n"));
    }, "feat: app.js feature (has a syntax error)");
    console.log(`     ${c.yellow("⚠")} lane 2 — edits app.js but leaves a syntax error ${c.gray("(builds red → quarantined)")}`);

    // lane 3 — CONFLICT: rewrites the SAME README intro line a different way. After
    //          lane 1 lands, this textually conflicts → train halts here.
    makeLane(repo, base, 3, (laneDir) => {
      write(laneDir, "README.md", readmeIntro("A tiny sample project, rewritten a totally different way by lane 3."));
    }, "docs: different README intro (lane 3)");
    console.log(`     ${c.red("✗")} lane 3 — rewrites the SAME README intro line ${c.gray("(conflicts with lane 1)")}`);
    console.log("");

    // ---- 3. Run the FULL conductor on the sample repo. ----------------------
    console.log(c.cyan("  Running the conductor (dry-run preview):"));
    console.log(c.gray("  " + "─".repeat(56)));
    await runFanIn({ cwd: repo, apply: false, build: true });

    console.log(c.cyan("  Now landing for real (--apply):"));
    console.log(c.gray("  " + "─".repeat(56)));
    const { exitCode: code } = await runFanIn({ cwd: repo, apply: true, build: true });

    console.log(c.bold("  That's the whole wow:"));
    console.log("     " + c.gray("• the collision map flagged README.md (lanes 1 + 3),"));
    console.log("     " + c.gray("• lane 1 landed clean and green,"));
    console.log("     " + c.gray("• lane 2 built RED on the combined tree and was quarantined (never reached main),"));
    console.log("     " + c.gray("• lane 3 textually conflicted and the train halted — the verdict named exactly who needs you."));
    console.log("");

    return code === 1 ? 0 : code; // a demo "needs you" verdict is the POINT, not a failure
  } finally {
    if (o.keep) {
      console.log(c.gray(`  --keep set: the demo repo is left at`));
      console.log(c.gray(`    ${repo}`));
      console.log(c.gray(`  (and its lane worktrees at ${path.join(base, "sample-app-lane-*")}). Delete the parent`));
      console.log(c.gray(`  folder when done: ${base}`));
    } else {
      try {
        rmSync(base, { recursive: true, force: true });
      } catch {
        console.log(c.gray(`  (Could not auto-remove the demo dir — delete it when convenient: ${base})`));
      }
    }
  }
}

/**
 * Create one demo lane: a worktree at ../sample-app-lane-N on branch ga/lane-N,
 * apply an edit, and commit it — exactly the shape `fan-in` discovers.
 */
function makeLane(repo, base, i, edit, message) {
  const laneDir = path.join(base, `sample-app-lane-${i}`);
  g(["worktree", "add", "-q", "-b", `ga/lane-${i}`, laneDir, "HEAD"], repo);
  edit(laneDir);
  g(["add", "-A"], laneDir);
  g(["commit", "-q", "-m", message], laneDir);
}
