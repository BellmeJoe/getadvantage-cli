// getAdvantage CLI — FAN-OUT / FAN-IN (`getadvantage fan-out` · `fan-in`).
//
// Run several AI sessions / models IN PARALLEL on the same project, each in its
// own git worktree, all sharing ONE project brain. Because your context lives in
// the repo (PROJECT-BRIEF.md + HANDOFF.md), every lane reads the same brain and
// won't collide — you open a different model/tool in each, work in parallel, then
// review and merge the ones you like.
//
// `fan-out <n> [--task "..."]`:
//   1. refreshes the brain (writes PROJECT-BRIEF.md + HANDOFF.md so every lane
//      starts current),
//   2. creates N git worktrees `../<repo>-lane-1 … -lane-N`, each a FRESH branch
//      off HEAD, each with the brain wired (runs `init` inside),
//   3. prints what to do: open a different model/tool per lane, work, then review.
//
// SAFE + idempotent: an existing worktree dir or branch for a lane is detected
// and SKIPPED (never clobbered) — re-running just fills the gaps. N is capped to
// 1–8.
//
// `fan-in`: lists the current lanes and prints exactly how to review, merge the
// ones you want, and clean up (`git worktree remove`). Merging stays a GUIDED
// "review and merge" — we never auto-merge for you.
//
// Honesty (hard): this is git-native orchestration. It needs no API keys, calls
// no network, and nothing leaves your machine. We own the brain + the
// orchestration ground — NOT a model router; you bring the models.
//
// Node built-ins only. ESM.

import { existsSync, copyFileSync } from "node:fs";
import path from "node:path";
import { c, git, gitSafe, relPath } from "./util.mjs";
import { runHandoff } from "./handoff.mjs";
import { runInit } from "./init.mjs";
import { DEFAULT_OUT } from "./brief.mjs";
import { DEFAULT_HANDOFF } from "./handoff.mjs";

const MIN_LANES = 1;
const MAX_LANES = 8;

/** A lane's branch name. Stable + predictable so fan-in can find them. */
function laneBranch(repoName, i) {
  return `lane-${i}`;
}

/** A lane's worktree directory (sibling of the repo). Absolute path. */
function laneDir(cwd, repoName, i) {
  return path.resolve(cwd, "..", `${repoName}-lane-${i}`);
}

/** Does a local branch exist? */
function branchExists(cwd, name) {
  return !!gitSafe(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], { cwd });
}

/** The set of paths git currently knows as worktrees (absolute, normalized). */
function listWorktreePaths(cwd) {
  const out = gitSafe(["worktree", "list", "--porcelain"], { cwd });
  const paths = [];
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      paths.push(path.resolve(line.slice("worktree ".length).trim()));
    }
  }
  return paths;
}

/**
 * `getadvantage fan-out <n>` — create N parallel lanes sharing one brain.
 * @param {object} o
 * @param {string} o.cwd     repo root
 * @param {string} [o.n]     requested lane count (positional arg, as a string)
 * @param {string} [o.task]  optional one-line task to print into each lane's guidance
 * @returns {number} exit code (0 on success, 1 on a usage/precondition error)
 */
export function runFanOut(o) {
  const cwd = o.cwd;
  const repoName = path.basename(cwd);

  // ---- 0. Parse + clamp N. ------------------------------------------------
  const raw = parseInt(String(o.n ?? ""), 10);
  if (!o.n || Number.isNaN(raw)) {
    console.error(c.red("✗ fan-out needs a lane count — e.g. `getadvantage fan-out 3`."));
    console.error(c.gray(`  Opens N parallel worktrees (${MIN_LANES}–${MAX_LANES}), each sharing one project brain.`));
    return 1;
  }
  const n = Math.max(MIN_LANES, Math.min(MAX_LANES, raw));
  if (n !== raw) {
    console.log(c.yellow(`  ⚠ Clamped lane count to ${n} (allowed range ${MIN_LANES}–${MAX_LANES}).`));
  }

  // ---- 0b. Require a HEAD commit to branch from. --------------------------
  const head = gitSafe(["rev-parse", "HEAD"], { cwd });
  if (!head) {
    console.error(c.red("✗ No commits yet — make at least one commit before fanning out (lanes branch off HEAD)."));
    return 1;
  }

  console.log(c.bold(`\n  Fan-out — ${n} parallel lane(s) sharing one project brain\n`));

  // ---- 1. Refresh the brain so every lane starts current. -----------------
  console.log(c.cyan("  1. Refreshing the project brain (so every lane reads the same thing)"));
  runHandoff({ cwd, quiet: true }); // writes PROJECT-BRIEF.md + HANDOFF.md (+ marker)
  console.log("");

  // ---- 2. Create each lane (idempotent). ----------------------------------
  console.log(c.cyan(`  2. Creating ${n} worktree(s) off \`${head.slice(0, 10)}\``));
  const knownWorktrees = new Set(listWorktreePaths(cwd));
  const created = [];
  const skipped = [];
  let hadError = false;

  for (let i = 1; i <= n; i++) {
    const branch = laneBranch(repoName, i);
    const dir = laneDir(cwd, repoName, i);
    const dirRel = relPath(dir, cwd);

    // Already a worktree at this path? Skip — never clobber.
    if (knownWorktrees.has(path.resolve(dir)) || existsSync(dir)) {
      skipped.push({ i, branch, dir, dirRel, why: "worktree dir already exists" });
      console.log(`     ${c.yellow("•")} lane ${i}: ${dirRel} already exists — skipped.`);
      continue;
    }

    // Reuse an existing lane branch if present (don't try to recreate it); else
    // create a fresh branch off HEAD. `git worktree add -b` makes the branch; if
    // the branch already exists we attach the worktree to it instead.
    try {
      if (branchExists(cwd, branch)) {
        git(["worktree", "add", dir, branch], { cwd });
      } else {
        git(["worktree", "add", "-b", branch, dir, "HEAD"], { cwd });
      }
    } catch (e) {
      hadError = true;
      console.error(c.red(`     ✗ lane ${i}: could not create worktree — ${String(e.message || e).split("\n")[0]}`));
      continue;
    }

    // The lane is a FRESH checkout of HEAD, so the brain files we just generated
    // in step 1 (which are still uncommitted in the main tree) wouldn't be present
    // there. Copy them in so each lane physically HAS the brain to read — not just
    // an instruction pointing at a missing file.
    copyBrainInto(cwd, dir);

    // Wire the brain into the lane's agent-instruction files so the model that
    // opens there auto-loads PROJECT-BRIEF.md + HANDOFF.md. (init prints its own
    // line; keep it terse — it's quick + clear.)
    try {
      runInit({ cwd: dir });
    } catch (e) {
      console.error(c.yellow(`     ⚠ lane ${i}: brain files copied but couldn't auto-wire init — ${String(e.message || e).split("\n")[0]}`));
    }

    created.push({ i, branch, dir, dirRel });
    console.log(`     ${c.green("✓")} lane ${i}: ${c.bold(dirRel)}  (branch \`${branch}\`)`);
  }
  console.log("");

  // ---- 3. Tell the human exactly what to do. ------------------------------
  console.log(c.cyan("  3. Work in parallel"));
  if (created.length === 0 && skipped.length > 0) {
    console.log(c.gray("     All requested lanes already exist — nothing new created."));
  }
  console.log("     Open a DIFFERENT model/tool in each lane — they all read the same brain,");
  console.log("     so they won't collide. For example (ChatGPT, Claude, Gemini, Cursor, Qwen):");
  console.log("");
  const lanesForGuidance = created.length ? created : skipped;
  for (const lane of lanesForGuidance) {
    console.log(`       lane ${lane.i}:  ${c.bold("cd " + lane.dirRel)}   then open your tool/model there`);
  }
  console.log("");
  if (o.task) {
    console.log(`     Task for every lane: ${c.bold(o.task)}`);
    console.log(c.gray("     (Each lane reads PROJECT-BRIEF.md + HANDOFF.md first, then tackles the task its own way.)"));
  } else {
    console.log(c.gray("     Tip: give each lane the SAME task (try `--task \"...\"`) and compare approaches,"));
    console.log(c.gray("     or split the work across lanes. They share the brain, not the working tree."));
  }
  console.log("");

  // ---- 4. Point at fan-in for the merge/cleanup. --------------------------
  console.log(c.cyan("  4. When you're done"));
  console.log(`     Review + merge the lane(s) you like, then clean up. See:`);
  console.log(c.bold("       getadvantage fan-in"));
  console.log(c.gray("     (Merging stays a guided 'review and merge' — nothing is merged automatically.)"));
  console.log("");
  console.log(
    c.gray("  Git-native: no API keys, no network, nothing leaves your machine. You bring the models; we hold the brain + the ground."),
  );

  return hadError ? 1 : 0;
}

/**
 * `getadvantage fan-in` — list the current lanes and print how to review, merge,
 * and clean up. Guided only; never auto-merges. Read-only.
 * @param {object} o
 * @param {string} o.cwd  repo root
 * @returns {number} exit code (always 0)
 */
export function runFanIn(o) {
  const cwd = o.cwd;
  const repoName = path.basename(cwd);
  const currentBranch = gitSafe(["rev-parse", "--abbrev-ref", "HEAD"], { cwd }) || "main";

  // Find lane worktrees: any worktree whose path matches ../<repo>-lane-<n>.
  const all = gitSafe(["worktree", "list", "--porcelain"], { cwd });
  const lanes = [];
  let curPath = null;
  let curBranch = null;
  for (const line of all.split("\n")) {
    if (line.startsWith("worktree ")) {
      curPath = path.resolve(line.slice("worktree ".length).trim());
      curBranch = null;
    } else if (line.startsWith("branch ")) {
      curBranch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    } else if (line === "" && curPath) {
      const base = path.basename(curPath);
      const m = base.match(new RegExp(`^${escapeRe(repoName)}-lane-(\\d+)$`));
      if (m) lanes.push({ i: parseInt(m[1], 10), dir: curPath, branch: curBranch });
      curPath = null;
      curBranch = null;
    }
  }
  // Catch a trailing record with no blank line after it.
  if (curPath) {
    const base = path.basename(curPath);
    const m = base.match(new RegExp(`^${escapeRe(repoName)}-lane-(\\d+)$`));
    if (m) lanes.push({ i: parseInt(m[1], 10), dir: curPath, branch: curBranch });
  }
  lanes.sort((a, b) => a.i - b.i);

  console.log(c.bold("\n  Fan-in — review, merge the ones you like, then clean up\n"));

  if (lanes.length === 0) {
    console.log(`  ${c.yellow("⚠")} No fan-out lanes found (no \`../${repoName}-lane-*\` worktrees).`);
    console.log(c.gray(`     Start some with \`getadvantage fan-out <n>\`.`));
    return 0;
  }

  console.log(`  ${lanes.length} lane(s) found:\n`);
  for (const lane of lanes) {
    const dirRel = relPath(lane.dir, cwd);
    const branch = lane.branch || "(detached)";
    // Commits this lane has that the current branch doesn't (best-effort).
    let ahead = "";
    if (lane.branch) {
      const cnt = gitSafe(["rev-list", "--count", `${currentBranch}..${lane.branch}`], { cwd });
      if (cnt) ahead = `${cnt} commit(s) ahead of \`${currentBranch}\``;
    }
    console.log(`    ${c.bold("lane " + lane.i)} · branch \`${branch}\` · ${dirRel}${ahead ? `  (${c.cyan(ahead)})` : ""}`);
  }
  console.log("");

  console.log(c.cyan("  1. Review a lane's work"));
  for (const lane of lanes) {
    if (!lane.branch) continue;
    console.log(`     git -C . diff ${currentBranch}..${lane.branch}        ${c.gray(`# what lane ${lane.i} changed`)}`);
  }
  console.log("");

  console.log(c.cyan("  2. Merge the lane(s) you want (you choose — nothing is automatic)"));
  console.log(c.gray(`     From your main checkout (on \`${currentBranch}\`):`));
  for (const lane of lanes) {
    if (!lane.branch) continue;
    console.log(`     git merge --no-ff ${lane.branch}        ${c.gray(`# bring lane ${lane.i} in`)}`);
  }
  console.log("");

  console.log(c.cyan("  3. Clean up the lanes (after merging, or to discard)"));
  for (const lane of lanes) {
    const dirRel = relPath(lane.dir, cwd);
    console.log(`     git worktree remove ${dirRel}${lane.branch ? `  &&  git branch -d ${lane.branch}` : ""}`);
  }
  console.log(c.gray("     (Use `git branch -D <branch>` to discard an unmerged lane you don't want.)"));
  console.log("");
  console.log(c.gray("  Guided on purpose: you read the diffs and decide — fan-in never merges for you."));

  return 0;
}

/**
 * Copy the freshly-generated brain artifacts (PROJECT-BRIEF.md + HANDOFF.md) from
 * the main repo into a lane worktree, so the lane physically HAS the brain. We
 * only copy what exists; best-effort (a copy failure never aborts the fan-out).
 */
function copyBrainInto(srcRepo, laneDir) {
  for (const name of [DEFAULT_OUT, DEFAULT_HANDOFF]) {
    const from = path.join(srcRepo, name);
    const to = path.join(laneDir, name);
    if (!existsSync(from)) continue;
    try {
      copyFileSync(from, to);
    } catch {
      /* best-effort — init still points the agent at the brain */
    }
  }
}

/** Escape a string for use inside a RegExp. */
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
