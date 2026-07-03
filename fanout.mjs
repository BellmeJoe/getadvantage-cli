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
import { execFileSync } from "node:child_process";
import path from "node:path";
import { c, git, gitSafe, gitRaw, relPath } from "./util.mjs";
import { runHandoff } from "./handoff.mjs";
import { runInit } from "./init.mjs";
import { DEFAULT_OUT } from "./brief.mjs";
import { DEFAULT_HANDOFF } from "./handoff.mjs";
import { gateTree } from "./checks-runner.mjs";

const MIN_LANES = 1;
const MAX_LANES = 8;

/** A lane's branch name. Stable + predictable, and NAMESPACED (`ga/…`) so it can
 *  never squat on or shadow a user's own branch names like `lane-1`. */
function laneBranch(repoName, i) {
  return `ga/lane-${i}`;
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

  // Was the tree clean BEFORE we touched it? If so, we'll tidily commit the
  // brain refresh we're about to write — otherwise fan-out's OWN output dirties
  // main and the very next `fan-in --apply` would refuse on a tree the user
  // never touched. (If the tree was already dirty, we leave it strictly alone.)
  const treeWasCleanBeforeFanout = treeIsClean(cwd);

  // ---- 1. Refresh the brain so every lane starts current. -----------------
  console.log(c.cyan("  1. Refreshing the project brain (so every lane reads the same thing)"));
  runHandoff({ cwd, quiet: true }); // writes PROJECT-BRIEF.md + HANDOFF.md (+ marker)
  // Commit just the brain refresh (only when we started clean) so the headline
  // flow — fan-out → work in lanes → fan-in --apply — doesn't trip the
  // clean-tree guard on fan-out's own writes. Best-effort + honest: we stage
  // ONLY the known brain artifacts, and only commit if that's all that changed.
  if (treeWasCleanBeforeFanout) {
    const committed = commitBrainRefresh(cwd);
    if (committed) console.log(c.gray("     Committed the brain refresh so the tree stays clean for fan-in --apply."));
  }
  console.log("");

  // ---- 2. Create each lane (idempotent). ----------------------------------
  // Re-read HEAD: a brain-refresh commit above may have advanced it, and the
  // lanes branch off the CURRENT HEAD (so they already carry the same brain).
  const headNow = gitSafe(["rev-parse", "HEAD"], { cwd }) || head;
  console.log(c.cyan(`  2. Creating ${n} worktree(s) off \`${headNow.slice(0, 10)}\``));
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

    // NEVER silently reuse a pre-existing lane branch: a leftover branch from an
    // earlier fan-out carries stale work, and quietly attaching a new lane to it
    // would present old commits as this lane's output. Error clearly instead.
    if (branchExists(cwd, branch)) {
      hadError = true;
      console.error(c.red(`     ✗ lane ${i}: branch \`${branch}\` already exists — refusing to silently reuse it.`));
      console.error(c.gray(`        If it's a leftover from an old fan-out, inspect/merge it first, then delete it:`));
      console.error(c.gray(`          git branch -D ${branch}`));
      console.error(c.gray(`        and re-run fan-out.`));
      continue;
    }

    // Create a FRESH branch off HEAD for this lane's worktree.
    try {
      git(["worktree", "add", "-b", branch, dir, "HEAD"], { cwd });
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
 * Discover the fan-out lane worktrees of a repo (../<repo>-lane-<n>).
 * @returns {Array<{i:number, dir:string, branch:string|null}>} sorted by lane index
 */
export function discoverLanes(cwd) {
  const repoName = path.basename(cwd);
  const all = gitSafe(["worktree", "list", "--porcelain"], { cwd });
  const lanes = [];
  let curPath = null;
  let curBranch = null;
  const tryPush = () => {
    if (!curPath) return;
    const base = path.basename(curPath);
    const m = base.match(new RegExp(`^${escapeRe(repoName)}-lane-(\\d+)$`));
    if (m) lanes.push({ i: parseInt(m[1], 10), dir: curPath, branch: curBranch });
  };
  for (const line of all.split("\n")) {
    if (line.startsWith("worktree ")) {
      tryPush();
      curPath = path.resolve(line.slice("worktree ".length).trim());
      curBranch = null;
    } else if (line.startsWith("branch ")) {
      curBranch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    } else if (line === "") {
      tryPush();
      curPath = null;
      curBranch = null;
    }
  }
  tryPush(); // trailing record with no blank line after it
  lanes.sort((a, b) => a.i - b.i);
  return lanes;
}

/**
 * `getadvantage fan-in` — THE SAFE FAN-IN CONDUCTOR.
 *
 * Reconciles the parallel lanes into ONE verified main. In four moves:
 *   1. COLLISION MAP   — per-file edit overlap across lanes (pure git diff vs the
 *                        merge-base). Clean lanes vs colliding lanes, instantly.
 *   2. MERGE-TRAIN     — per lane, a `git merge --no-commit --no-ff` DRY-RUN
 *                        against an integration branch to surface TEXTUAL
 *                        conflicts up front, before touching main.
 *   3. COMBINED GATE   — only with --apply: actually merge the clean lanes one at
 *                        a time, re-running the check gate on the COMBINED tree
 *                        after EACH merge. A lane that goes red gets QUARANTINED
 *                        (its merge rolled back) instead of poisoning main —
 *                        two green branches can be red together.
 *   4. VERDICT         — one screen: per-lane status + a plain-language summary.
 *
 * Honesty: we DETECT overlap and GATE the combined result; we never claim
 * "conflict-free". No conflict reaches main un-verified. Without --apply this is
 * a read-only preview that mutates nothing.
 *
 * @param {object} o
 * @param {string}  o.cwd      repo root
 * @param {boolean} [o.apply]  actually merge the clean lanes (default: dry-run preview)
 * @param {boolean} [o.build]  run the full build in the combined gate (default true)
 * @param {string}  [o.baseRef] schema-bump base ref for the gate
 * @param {string}  [o.into]   integration branch to land into (default: current branch)
 * @returns {Promise<{exitCode: number, report: object}>} exitCode (0 unless a
 *          usage/precondition error or an unresolved lane) + a structured report
 *          of the run — the machine-readable payload behind `--json`.
 */
export async function runFanIn(o) {
  const cwd = o.cwd;
  const repoName = path.basename(cwd);
  const intoBranch = o.into || gitSafe(["rev-parse", "--abbrev-ref", "HEAD"], { cwd }) || "main";
  const mode = o.apply ? "apply" : "dry-run";

  const lanes = discoverLanes(cwd);

  // Structured report of this run — one stable shape for every exit path.
  const makeReport = (train) => ({
    mode,
    into: intoBranch,
    ...(train && train.preflight ? { preflight: train.preflight } : {}),
    ...(train && train.postTrainDirty ? { postTrainDirty: true } : {}),
    lanes: lanes.map(laneReport),
  });

  console.log(c.bold("\n  Safe fan-in — reconcile the lanes into one verified main\n"));

  if (lanes.length === 0) {
    console.log(`  ${c.yellow("⚠")} No fan-out lanes found (no \`../${repoName}-lane-*\` worktrees).`);
    console.log(c.gray(`     Start some with \`getadvantage fan-out <n>\` — or try \`getadvantage demo\` to see it end-to-end.`));
    return { exitCode: 0, report: makeReport(null) };
  }

  // Only lanes that actually have a branch + at least one commit ahead of the
  // integration branch are landable. Annotate each.
  for (const lane of lanes) {
    lane.ahead = 0;
    if (lane.branch) {
      const cnt = gitSafe(["rev-list", "--count", `${intoBranch}..${lane.branch}`], { cwd });
      lane.ahead = parseInt(cnt || "0", 10) || 0;
    }
    // Best-effort: the tool/model a lane used, if a marker recorded it.
    lane.tool = laneTool(lane.dir);
  }

  // ---- 1. COLLISION MAP ----------------------------------------------------
  // For each landable lane, the files it changed since it diverged from the
  // integration branch (merge-base). Pure git, instant, no LLM.
  const landable = lanes.filter((l) => l.branch && l.ahead > 0);
  const skipped = lanes.filter((l) => !l.branch || l.ahead === 0);

  console.log(c.cyan("  1. Collision map") + c.gray("  (which files more than one lane touched)"));
  console.log("");

  const fileToLanes = new Map(); // file -> Set(lane index)
  for (const lane of landable) {
    // The lane's CODE changes — excluding getAdvantage's own generated brain
    // artifacts (PROJECT-BRIEF.md / HANDOFF.md / the wired AGENTS.md etc.). Those
    // are identical tool output copied into every lane by fan-out, so counting
    // them as "collisions" is noise that buries the real overlaps. They still
    // merge fine (identical content), so we just don't HIGHLIGHT them.
    lane.allFiles = laneChangedFiles(cwd, intoBranch, lane.branch);
    lane.files = lane.allFiles.filter((f) => !isBrainArtifact(f));
    for (const f of lane.files) {
      if (!fileToLanes.has(f)) fileToLanes.set(f, new Set());
      fileToLanes.get(f).add(lane.i);
    }
  }
  // Overlap = any (non-brain) file touched by >1 lane.
  const overlaps = [...fileToLanes.entries()].filter(([, set]) => set.size > 1);
  const collidingLaneIds = new Set();
  for (const [, set] of overlaps) for (const i of set) collidingLaneIds.add(i);

  for (const lane of landable) {
    lane.colliding = collidingLaneIds.has(lane.i);
  }

  if (landable.length === 0) {
    console.log(c.gray("     No landable lanes (none are ahead of the integration branch)."));
  } else {
    for (const lane of landable) {
      const tag = lane.colliding
        ? c.yellow("collides")
        : c.green("clean");
      const toolStr = lane.tool ? c.gray(` · ${lane.tool}`) : "";
      console.log(
        `     ${lane.colliding ? c.yellow("◆") : c.green("○")} ${c.bold("lane " + lane.i)} \`${lane.branch}\`${toolStr} — ${lane.files.length} file(s) · ${tag}`,
      );
    }
    console.log("");
    if (overlaps.length === 0) {
      console.log(c.gray("     No file is touched by more than one lane — the lanes are disjoint."));
    } else {
      console.log(`     ${c.yellow("Overlapping file(s)")} — edited by more than one lane:`);
      for (const [file, set] of overlaps.slice(0, 30)) {
        const ids = [...set].sort((a, b) => a - b).map((i) => `lane ${i}`).join(", ");
        console.log(`       ${c.yellow("•")} ${file}  ${c.gray("(" + ids + ")")}`);
      }
      if (overlaps.length > 30) console.log(c.gray(`       …and ${overlaps.length - 30} more overlapping file(s)`));
      console.log("");
      console.log(c.gray("     Overlap is not the same as a conflict — two lanes can edit different parts of"));
      console.log(c.gray("     a file and still merge cleanly. The merge-train below proves which actually conflict."));
    }
  }
  console.log("");

  if (skipped.length) {
    for (const lane of skipped) {
      const why = !lane.branch ? "detached (no branch)" : "no commits ahead";
      lane.outcome = "skipped";
      lane.detail = why;
      console.log(c.gray(`     · lane ${lane.i} skipped — ${why}.`));
    }
    console.log("");
  }

  if (landable.length === 0) {
    console.log(c.gray("  Nothing to land. Do some work in a lane, commit it, then re-run fan-in."));
    return { exitCode: 0, report: makeReport(null) };
  }

  // ---- 2. MERGE-TRAIN -----------------------------------------------------
  // Dry-run (default): per lane, a no-commit merge probe to find TEXTUAL
  // conflicts before touching anything — done in a disposable temp worktree so
  // the user's checkouts are never disturbed. Apply (--apply): merge for real,
  // gating the combined tree after each.
  if (o.apply) {
    console.log(c.cyan("  2. Merge-train") + c.gray("  (merging for real; gate re-runs on the combined tree after each)"));
  } else {
    console.log(c.cyan("  2. Merge-train dry-run") + c.gray("  (textual conflicts, before touching main)"));
  }
  console.log("");

  const train = await runMergeTrain({
    cwd,
    intoBranch,
    lanes: landable,
    apply: !!o.apply,
    build: o.build !== false,
    baseRef: o.baseRef,
  });

  // ---- 4. VERDICT ----------------------------------------------------------
  printVerdict({ lanes: landable, intoBranch, apply: !!o.apply, train });

  // ---- EXIT CODE — must never lie to automation. --------------------------
  // This tool's whole pitch is being the SAFE gate in front of `vercel --prod`.
  // A wrapper doing `fan-in --apply && deploy` reads exit 0 as "go". So:
  //   • Any --apply that was PREFLIGHT-BLOCKED and landed nothing (dirty tree,
  //     or a probe-worktree failure that degraded the run) → non-zero. A refusal
  //     is NOT a success — automation must NOT proceed.
  //   • Any unresolved lane (textual conflict OR a quarantined combined-tree
  //     break) → non-zero, so the human reconciles before anything ships.
  // A clean dry-run preview, or an --apply where every landable lane landed
  // green, is the only path to exit 0.
  if (o.apply && train && train.preflight) {
    // A preflight stopped the apply before anything could land. Even if there
    // were zero lanes, signalling success here would let `&& deploy` proceed.
    return { exitCode: 1, report: makeReport(train) };
  }
  if (o.apply && train && train.postTrainDirty) {
    // Unexpected tracked changes remained after the train (see the STOP report).
    // The landed lanes are safe, but the tree is not clean — automation must not
    // proceed to a deploy that would ship un-reviewed working-tree state.
    return { exitCode: 1, report: makeReport(train) };
  }
  const unresolved = landable.filter((l) => l.outcome === "conflict" || l.outcome === "quarantined").length;
  return { exitCode: unresolved > 0 ? 1 : 0, report: makeReport(train) };
}

/** One lane's entry in the structured report — a stable, machine-readable shape. */
function laneReport(l) {
  return {
    lane: l.i,
    branch: l.branch || null,
    dir: l.dir,
    ahead: l.ahead ?? 0,
    colliding: !!l.colliding,
    files: l.files ?? [],
    outcome: l.outcome || "skipped",
    detail: l.detail || "",
    ...(l.conflictFiles && l.conflictFiles.length ? { conflictFiles: l.conflictFiles } : {}),
    ...(l.gateFails && l.gateFails.length
      ? { gateFails: l.gateFails.map((f) => ({ label: f.label, detail: f.detail })) }
      : {}),
    ...(l.installError ? { installError: l.installError } : {}),
  };
}

// getAdvantage's OWN generated artifacts — the portable brain + the agent-
// instruction files `fan-out` writes/wires into every lane. They're identical
// tool output across lanes, so they're not a meaningful "collision" between the
// builder's lanes. The internal `.ship-safe/` marker dir is included (path kept
// for back-compat; it is NOT a user-facing brand name).
const BRAIN_BASENAMES = new Set([
  DEFAULT_OUT,        // PROJECT-BRIEF.md
  DEFAULT_HANDOFF,    // HANDOFF.md
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
]);
function isBrainArtifact(file) {
  const norm = String(file).split("\\").join("/");
  if (norm.startsWith(".ship-safe/")) return true;
  return BRAIN_BASENAMES.has(path.basename(norm));
}

/** Files a lane changed since it diverged from the integration branch (merge-base).
 *  Uses the symmetric `into...branch` range so only the lane's own edits count. */
function laneChangedFiles(cwd, intoBranch, laneBranch) {
  const out = gitSafe(["diff", "--name-only", `${intoBranch}...${laneBranch}`], { cwd });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

/** Best-effort: read which tool/model a lane used, if init recorded one. We don't
 *  fabricate this — return "" when unknown. */
function laneTool(laneDir) {
  // A future lane marker could record the tool; today it's not persisted, so we
  // stay honest and report nothing rather than guess.
  return "";
}

/** Run a git command returning {ok, out} instead of throwing — needed for merge
 *  attempts, where a non-zero exit (a conflict) is an expected outcome, not an
 *  error. Combines stdout+stderr so conflict messages are captured. */
function gitTry(args, opts = {}) {
  // Capture BOTH streams (stdio pipe) so git's own chatter ("Automatic merge
  // went well…", "Preparing worktree…") never leaks past our own reporting.
  try {
    const out = execFileSync("git", args, {
      encoding: "utf8",
      cwd: opts.cwd ?? process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, out };
  } catch (e) {
    const out = `${e.stdout || ""}${e.stderr || ""}`.trim();
    return { ok: false, out };
  }
}

// ---------------------------------------------------------------------------
// merged-dependency install (the Bug-B fix)
// ---------------------------------------------------------------------------
// The combined-tree gate BUILDS the merged result — but node_modules still
// reflects the pre-merge state. A lane that adds a dependency would therefore
// build red and be falsely quarantined even though it's fine once installed.
// So: if a merge changed package.json or a lockfile, run the project's install
// before gating — and if the INSTALL fails, report that as the reason (a
// dependency problem), never as a generic build failure.

const DEPENDENCY_FILES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
]);

/** Dependency-manifest files this merge changed (repo-relative paths). */
function mergeChangedDependencyFiles(cwd, preMerge) {
  const out = gitSafe(["diff", "--name-only", `${preMerge}..HEAD`], { cwd });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => DEPENDENCY_FILES.has(path.basename(f.split("\\").join("/"))));
}

/** Run a non-git command, capturing both streams, never throwing. On Windows
 *  npm is a .cmd shim, so shell:true lets it resolve (same as checks.mjs). */
function runCmd(cmd, args, cwd) {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
      shell: process.platform === "win32",
    });
    return { ok: true, out };
  } catch (e) {
    const out = `${e.stdout || ""}${e.stderr || ""}`.trim();
    return { ok: false, out: out || String(e.message || e) };
  }
}

/** Install the merged tree's dependencies: `npm ci` when a lockfile is present
 *  (reads, never writes), else `npm install`. Dependency-free (child_process). */
function installMergedDependencies(cwd) {
  const hasLock =
    existsSync(path.join(cwd, "package-lock.json")) ||
    existsSync(path.join(cwd, "npm-shrinkwrap.json"));
  const sub = hasLock ? "ci" : "install";
  const r = runCmd("npm", [sub, "--no-audit", "--no-fund"], cwd);
  return { ok: r.ok, cmd: `npm ${sub}`, out: r.out };
}

/** The files that are currently in a conflicted (unmerged) state. */
function conflictedFiles(cwd) {
  const out = gitSafe(["diff", "--name-only", "--diff-filter=U"], { cwd });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

/** Is the working tree clean (nothing tracked modified/staged)? */
function treeIsClean(cwd) {
  return gitRaw(["status", "--porcelain"], { cwd }).trim() === "";
}

/** The TRACKED dirt in the working tree — modified/staged/deleted tracked files
 *  (porcelain lines that are not `??` untracked). Returned as `XY path` strings.
 *  Untracked files are deliberately excluded: they can't be "restored" by a
 *  reset, and they may be another session's scratch we must never touch. */
function trackedDirt(cwd) {
  return gitRaw(["status", "--porcelain"], { cwd })
    .split("\n")
    .filter((l) => l.length > 0 && !l.startsWith("??"))
    .map((l) => l.trimEnd());
}

/** Is a merge currently in progress (MERGE_HEAD present)? */
function mergeInProgress(cwd) {
  const gitDir = gitSafe(["rev-parse", "--git-dir"], { cwd });
  if (!gitDir) return false;
  return existsSync(path.resolve(cwd, gitDir, "MERGE_HEAD"));
}

/**
 * THE MERGE-TRAIN EXECUTOR + COMBINED-TREE GATE.
 *
 * Dry-run (default): probe each lane independently against the integration
 * branch with `git merge --no-commit --no-ff` to detect TEXTUAL conflicts, then
 * abort each probe — nothing is kept, nothing is committed.
 *
 * Apply (--apply): in the user's CURRENT checkout (which is on the integration
 * branch and has node_modules — so the gate can really typecheck/build), merge
 * the clean lanes one at a time:
 *   • textual conflict  → abort the merge cleanly, mark `conflict`, and HALT the
 *                         train (the remaining lanes are left for the human).
 *   • merge OK          → run the check gate on the COMBINED tree. Red → roll the
 *                         merge back (`git reset --hard` to the pre-merge commit)
 *                         and mark `quarantined`. Green → keep it (`landed`).
 *
 * Never leaves a broken half-merge: every failure path aborts/rolls back.
 *
 * @returns {{ mode:"dry-run"|"apply", preflight?:string }} (per-lane outcome is
 *          written onto each lane object: lane.outcome + lane.detail)
 */
async function runMergeTrain(o) {
  const { cwd, intoBranch, lanes } = o;

  if (!o.apply) {
    // ---- DRY-RUN: probe each lane independently, mutate nothing -------------
    // We probe in a disposable temp worktree checked out at the integration tip
    // so the user's real checkout is never touched.
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const probeDir = mkdtempSync(path.join(tmpdir(), "ga-fanin-probe-"));
    let added = false;
    try {
      const add = gitTry(["worktree", "add", "--detach", probeDir, intoBranch], { cwd });
      if (!add.ok) {
        // Couldn't make a probe worktree — degrade to a name-only report.
        for (const lane of lanes) {
          lane.outcome = "unknown";
          lane.detail = "could not create a probe worktree to dry-run the merge";
        }
        return { mode: "dry-run", preflight: "probe-worktree-failed" };
      }
      added = true;
      for (const lane of lanes) {
        const m = gitTry(["merge", "--no-commit", "--no-ff", lane.branch], { cwd: probeDir });
        if (m.ok) {
          lane.outcome = "clean";
          lane.detail = "merges cleanly (no textual conflict)";
        } else {
          const files = conflictedFiles(probeDir);
          lane.outcome = "conflict";
          lane.detail = files.length
            ? `textual conflict in: ${files.join(", ")}`
            : "merge failed (textual conflict)";
          lane.conflictFiles = files;
        }
        // Reset the probe tree back to the integration tip for the next lane so
        // each lane is judged independently (not cumulatively) in the preview.
        gitTry(["merge", "--abort"], { cwd: probeDir });
        gitTry(["reset", "--hard", intoBranch], { cwd: probeDir });
        gitTry(["clean", "-fd"], { cwd: probeDir });
      }
    } finally {
      // Tear down the probe worktree (best-effort; never leak it).
      if (added) gitTry(["worktree", "remove", "--force", probeDir], { cwd });
      try { rmSync(probeDir, { recursive: true, force: true }); } catch {}
      gitTry(["worktree", "prune"], { cwd });
    }

    for (const lane of lanes) {
      if (lane.outcome === "clean") {
        console.log(`     ${c.green("✓")} ${c.bold("lane " + lane.i)} \`${lane.branch}\` — ${lane.detail}`);
      } else if (lane.outcome === "conflict") {
        console.log(`     ${c.red("✗")} ${c.bold("lane " + lane.i)} \`${lane.branch}\` — ${c.red(lane.detail)}`);
      } else {
        console.log(`     ${c.yellow("?")} ${c.bold("lane " + lane.i)} \`${lane.branch}\` — ${lane.detail}`);
      }
    }
    console.log("");
    console.log(c.gray("     Dry-run only — nothing was merged. The combined-tree check (does the merged"));
    console.log(c.gray("     result still build?) runs during the real merge:"));
    console.log(`       ${c.bold("getadvantage fan-in --apply")}`);
    console.log("");
    return { mode: "dry-run" };
  }

  // ---- APPLY: merge for real, in the user's current checkout ---------------
  // Precondition: the integration checkout must be clean, or a `vercel --prod`
  // (or any later step) could ship a half-merged tree. Refuse otherwise.
  if (!treeIsClean(cwd)) {
    console.log(`     ${c.red("✗ Refusing to --apply: the working tree is not clean.")}`);
    console.log(c.gray("       Commit or stash your changes first — the merge-train lands lanes onto"));
    console.log(c.gray(`       \`${intoBranch}\` and must start from a clean state.`));
    for (const lane of lanes) {
      lane.outcome = "skipped";
      lane.detail = "not attempted (working tree was dirty)";
    }
    return { mode: "apply", preflight: "dirty-tree" };
  }

  const startCommit = gitSafe(["rev-parse", "HEAD"], { cwd });
  console.log(c.gray(`     Landing onto \`${intoBranch}\` (at ${startCommit.slice(0, 10)}). Gate re-runs after every merge.`));
  console.log("");

  // The last VERIFIED-GOOD commit. Starts at the pre-train tip and only ever
  // advances when a lane lands green. Any rollback below may go back to this —
  // NEVER behind it — so a landed lane can never be silently discarded.
  let lastGood = startCommit;
  let halted = false;
  for (const lane of lanes) {
    if (halted) {
      lane.outcome = "skipped";
      lane.detail = "not attempted (train halted on an earlier conflict)";
      continue;
    }

    const preMerge = gitSafe(["rev-parse", "HEAD"], { cwd });
    const m = gitTry(["merge", "--no-ff", "--no-edit", lane.branch], { cwd });

    if (!m.ok) {
      // Textual conflict — abort cleanly and HALT the train.
      const files = conflictedFiles(cwd);
      gitTry(["merge", "--abort"], { cwd });
      lane.outcome = "conflict";
      lane.detail = files.length ? `textual conflict in: ${files.join(", ")}` : "textual conflict";
      lane.conflictFiles = files;
      console.log(`     ${c.red("✗")} ${c.bold("lane " + lane.i)} \`${lane.branch}\` — ${c.red("conflict")}; aborted, tree restored.`);
      if (files.length) console.log(c.gray(`        conflicting: ${files.join(", ")}`));
      halted = true;
      continue;
    }

    // Merge succeeded textually. If it changed package.json / a lockfile, the
    // gate's build would run against STALE node_modules — install first so a
    // lane that adds a dependency isn't falsely quarantined (and an install
    // failure is reported as exactly that, not a generic build fail).
    const depFiles = existsSync(path.join(cwd, "package.json"))
      ? mergeChangedDependencyFiles(cwd, preMerge)
      : [];
    if (depFiles.length > 0) {
      console.log(
        `     ${c.gray("…")} ${c.bold("lane " + lane.i)} \`${lane.branch}\` merged — installing merged dependencies ${c.gray("(" + depFiles.join(", ") + ")")}`,
      );
      const inst = installMergedDependencies(cwd);
      if (!inst.ok) {
        // Roll back ONLY this in-flight merge (to the pre-merge commit — never
        // behind landed lanes) and report the INSTALL as the reason.
        gitTry(["reset", "--hard", preMerge], { cwd });
        lane.outcome = "quarantined";
        lane.detail = `dependency install failed after merge (\`${inst.cmd}\`) — merge rolled back`;
        lane.installError = inst.out.split("\n").filter(Boolean).slice(-8).join("\n");
        console.log(
          `     ${c.yellow("⚠")} ${c.bold("lane " + lane.i)} \`${lane.branch}\` — ${c.yellow("quarantined")}: \`${inst.cmd}\` failed on the merged dependencies; rolled back.`,
        );
        for (const ln of inst.out.split("\n").filter(Boolean).slice(-5)) {
          console.log(c.gray(`        ${ln}`));
        }
        console.log(c.gray("        (node_modules may have been partially modified by the failed install.)"));
        continue;
      }
      console.log(c.gray(`        dependencies installed (\`${inst.cmd}\`).`));
    }

    // Now the NOVEL part: gate the COMBINED tree.
    process.stdout.write(`     ${c.gray("…")} ${c.bold("lane " + lane.i)} \`${lane.branch}\` merged — gating the combined tree`);
    const gate = gateTree({ cwd, baseRef: o.baseRef, build: o.build });
    if (gate.ok) {
      lane.outcome = "landed";
      lane.detail = "merged + combined-tree gate green";
      lastGood = gitSafe(["rev-parse", "HEAD"], { cwd }) || lastGood;
      console.log(`\r     ${c.green("✓")} ${c.bold("lane " + lane.i)} \`${lane.branch}\` — ${c.green("landed")} (combined tree builds + checks pass).            `);
    } else {
      // Two green branches can be red together — quarantine: roll this merge back.
      gitTry(["reset", "--hard", preMerge], { cwd });
      lane.outcome = "quarantined";
      const why = gate.fails.map((f) => f.label).join(", ");
      lane.detail = `combined-tree gate went red (${why}) — merge rolled back`;
      lane.gateFails = gate.fails;
      console.log(`\r     ${c.yellow("⚠")} ${c.bold("lane " + lane.i)} \`${lane.branch}\` — ${c.yellow("quarantined")}: combined tree failed (${why}); rolled back.            `);
    }
  }
  console.log("");
  // ---- POST-TRAIN SAFETY NET ------------------------------------------------
  // Never leave a half-merge behind — and NEVER discard landed lanes. (The old
  // net here hard-reset to startCommit on ANY dirt, which silently reverted
  // lanes the verdict had just reported "landed". That must never happen again:
  // cleanup only ever rolls back the IN-FLIGHT merge, to `lastGood` at worst —
  // the last verified-landed commit — and anything else STOPS with an honest
  // report instead of guessing with the user's repo.)
  let postTrainDirty = false;
  if (trackedDirt(cwd).length > 0) {
    if (mergeInProgress(cwd)) {
      // An in-flight merge the loop somehow didn't finish — aborting is safe:
      // it can only discard the un-committed merge attempt, never a commit.
      gitTry(["merge", "--abort"], { cwd });
      if (trackedDirt(cwd).length > 0) {
        // Abort left residue — roll back to the last verified-good commit.
        // lastGood only ever advances on a green landing, so this can never
        // travel behind a landed lane.
        gitTry(["reset", "--hard", lastGood], { cwd });
      }
      if (trackedDirt(cwd).length === 0) {
        console.log(c.yellow(`     ⚠ Cleaned up an in-flight merge the train left behind — rolled back to the last`));
        console.log(c.yellow(`       verified commit (${lastGood.slice(0, 10)}). Landed lanes are intact.`));
      }
    }
    const leftover = trackedDirt(cwd);
    if (leftover.length > 0) {
      // Unexpected dirt with NO merge in progress (e.g. a build step that writes
      // a tracked file, or a concurrent session's edits). We do NOT reset — that
      // could destroy work that isn't ours to discard. Stop and say exactly
      // where things stand.
      postTrainDirty = true;
      const headNow = gitSafe(["rev-parse", "HEAD"], { cwd });
      const landedCount = lanes.filter((l) => l.outcome === "landed").length;
      console.log(`     ${c.red("✗ STOPPED — unexpected working-tree changes after the merge-train.")}`);
      console.log(c.gray(`       Where you are: \`${intoBranch}\` @ ${headNow ? headNow.slice(0, 10) : "?"}.`));
      if (landedCount > 0) {
        console.log(c.gray(`       Your ${landedCount} landed lane(s) are SAFE — real merge commits on \`${intoBranch}\`; nothing was rolled back.`));
      }
      console.log(c.gray("       These tracked files changed outside the train's own merges:"));
      for (const f of leftover.slice(0, 10)) console.log(c.gray(`         ${f}`));
      if (leftover.length > 10) console.log(c.gray(`         …and ${leftover.length - 10} more`));
      console.log(c.gray("       Nothing was auto-reset — this could be a build side-effect or another session's work,"));
      console.log(c.gray("       and it is not ours to discard. Inspect with `git status`, then commit, stash, or"));
      console.log(c.gray("       revert those changes yourself before shipping."));
    }
  }
  return { mode: "apply", startCommit, lastGood, postTrainDirty };
}

/** THE VERDICT — one screen. Per-lane rows + a plain-language summary. */
function printVerdict({ lanes, intoBranch, apply, train }) {
  console.log(c.cyan("  3. Verdict"));
  console.log("");

  const icon = (o) => {
    switch (o) {
      case "landed": return c.green("✓");
      case "clean": return c.green("○");
      case "quarantined": return c.yellow("⚠");
      case "conflict": return c.red("✗");
      case "skipped": return c.gray("·");
      default: return c.gray("?");
    }
  };
  const word = (o) => {
    switch (o) {
      case "landed": return c.green("landed");
      case "clean": return c.green("ready (clean)");
      case "quarantined": return c.yellow("quarantined");
      case "conflict": return c.red("needs you (conflict)");
      case "skipped": return c.gray("skipped");
      default: return c.gray("unknown");
    }
  };

  for (const lane of lanes) {
    const toolStr = lane.tool ? c.gray(` · ${lane.tool}`) : "";
    console.log(`     ${icon(lane.outcome)} ${c.bold("lane " + lane.i)} \`${lane.branch}\`${toolStr} — ${word(lane.outcome)}`);
    if (lane.detail) console.log(c.gray(`         ${lane.detail}`));
  }
  console.log("");

  const total = lanes.length;
  const landed = lanes.filter((l) => l.outcome === "landed").length;
  const clean = lanes.filter((l) => l.outcome === "clean").length;
  const quarantined = lanes.filter((l) => l.outcome === "quarantined");
  const conflicts = lanes.filter((l) => l.outcome === "conflict");
  const needsYou = [...quarantined, ...conflicts].map((l) => l.i).sort((a, b) => a - b);

  // The headline — calm and exact. "I ran a crew and nothing broke."
  if (apply) {
    if (train && train.preflight === "dirty-tree") {
      console.log("  " + c.yellow(c.bold("Nothing landed — your working tree wasn't clean.")));
      console.log(c.gray("  Safe by design: the train only starts from a clean tree, so a half-merge can never ship."));
      console.log(c.gray("  Commit or stash your changes, then re-run `getadvantage fan-in --apply`."));
      console.log("");
      return;
    }
    if (train && train.preflight) {
      // Any other preflight that blocked the apply (e.g. couldn't prepare the
      // merge). Nothing landed; say so plainly and exit non-zero (handled above).
      console.log("  " + c.yellow(c.bold("Nothing landed — the merge couldn't start.")));
      console.log(c.gray("  Your tree is untouched. Re-run once the issue above is cleared."));
      console.log("");
      return;
    }
    if (landed === total) {
      // The wow. A whole crew of lanes, reconciled, every combined state verified.
      const crew = total === 1 ? "the lane" : `all ${total} lanes`;
      console.log("  " + c.green(c.bold(`✓ ${cap(crew)} landed clean and green into \`${intoBranch}\`.`)));
      console.log(c.green("    You ran a crew in parallel and nothing broke."));
      console.log(c.gray("    Every merge was gated on the COMBINED tree — no conflict, and no semantic"));
      console.log(c.gray("    break that builds alone but breaks together, ever reached main un-verified."));
    } else if (landed === 0) {
      console.log("  " + c.yellow(c.bold(`✗ 0 of ${total} landed`)) + c.yellow(` — ${needPhrase(needsYou)}.`));
      console.log(c.gray("    Main is untouched — nothing unsafe slipped through. Reconcile below, then re-run."));
    } else {
      console.log(
        "  " + c.green(c.bold(`✓ ${landed} of ${total} landed clean and green`)) +
        c.yellow(` — ${needPhrase(needsYou)}.`),
      );
      console.log(c.gray(`    The green ${landed === 1 ? "lane is" : "lanes are"} on \`${intoBranch}\` and verified; the rest are exactly where you left them.`));
    }
    if (train && train.postTrainDirty) {
      console.log("");
      console.log(
        "  " + c.red(c.bold("Working tree not clean")) +
        c.gray("  — unexpected tracked changes remained after the train (see the STOP report"),
      );
      console.log(c.gray("  above). Landed lanes are safe; resolve those changes before shipping. Exit is non-zero."));
    }
    if (quarantined.length) {
      console.log("");
      console.log("  " + c.yellow(c.bold("Quarantined")) + c.gray("  — merged cleanly, but broke the combined tree. Rolled back, NOT on main:"));
      for (const l of quarantined) console.log(`     ${c.yellow("⚠")} lane ${l.i} \`${l.branch}\` ${c.gray("— " + l.detail)}`);
      console.log(c.gray("     Each passes alone but red together — the kind of break a textual merge can't see."));
      console.log(c.gray("     Reconcile by hand, or re-run the lane against the now-updated main."));
    }
    if (conflicts.length) {
      console.log("");
      console.log("  " + c.red(c.bold("Textual conflict")) + c.gray("  — the train halted here so nothing downstream auto-merged:"));
      for (const l of conflicts) {
        console.log(`     ${c.red("✗")} lane ${l.i} \`${l.branch}\` ${c.gray("— " + l.detail)}`);
        console.log(`        ${c.gray("resolve:")} ${c.bold("git merge --no-ff " + l.branch)}   ${c.gray("# fix the markers, commit, then re-run fan-in --apply")}`);
      }
    }
  } else {
    // Dry-run summary.
    const ready = clean;
    const blocked = conflicts.length;
    if (blocked === 0) {
      console.log("  " + c.green(c.bold(`${ready} of ${total} lane(s) merge cleanly`)) + c.gray(" (textually)."));
      console.log(c.gray("  Run with --apply to land them — each is gated on the COMBINED tree as it merges,"));
      console.log(c.gray("  so a 'both-green-but-red-together' break is caught and quarantined, never landed."));
    } else {
      const conflIds = conflicts.map((l) => l.i);
      const conflVerb = conflIds.length === 1 ? "has a textual conflict" : "have textual conflicts";
      console.log(
        "  " + c.green(c.bold(`${ready} clean`)) + c.gray(" · ") + c.red(c.bold(`${blocked} conflicting`)) +
        c.gray(` of ${total} lane(s).`),
      );
      console.log(c.gray(`  ${cap(describeBlockers(conflIds))} ${conflVerb} to resolve first.`));
      console.log(c.gray("  --apply will land the clean ones (gated on the combined tree) and halt at the first conflict."));
    }
    console.log("");
    console.log(c.gray("  Honest by design: we DETECT overlap + GATE the combined result. No conflict reaches"));
    console.log(c.gray("  main un-verified — but we don't magically make incompatible work compatible."));
  }
  console.log("");
}

/** "lane 2" / "lanes 2 and 3" / "lanes 2, 3 and 4". */
function describeBlockers(ids) {
  const xs = [...ids].sort((a, b) => a - b);
  if (xs.length === 0) return "no lanes";
  if (xs.length === 1) return `lane ${xs[0]}`;
  if (xs.length === 2) return `lanes ${xs[0]} and ${xs[1]}`;
  return `lanes ${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** Grammatically-correct "lane 4 needs you" / "lanes 2 and 3 need you". */
function needPhrase(ids) {
  const xs = [...ids].sort((a, b) => a - b);
  const verb = xs.length === 1 ? "needs" : "need";
  return `${describeBlockers(xs)} ${verb} you`;
}

/** Capitalise the first letter (for sentence-leading lane phrases). */
function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
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

/**
 * Commit ONLY the brain artifacts fan-out just refreshed, so the tree returns to
 * clean for a subsequent `fan-in --apply`. Called only when the tree was clean
 * BEFORE fan-out ran, so the only possible changes are getAdvantage's own
 * generated files. We stage by explicit pathspec (never `git add -A`), then bail
 * without committing if anything OUTSIDE the brain set is dirty (belt-and-braces:
 * we won't sweep a user's stray edit into a commit). Best-effort: returns true
 * iff a commit was actually made.
 */
function commitBrainRefresh(cwd) {
  // Nothing changed? (e.g. brain was already current) — nothing to commit.
  if (treeIsClean(cwd)) return false;

  // Confirm every dirty path is a brain artifact before we touch the index.
  const porcelain = gitRaw(["status", "--porcelain"], { cwd });
  const dirtyPaths = porcelain
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => l.slice(3).trim())
    // Handle rename "old -> new" by taking the destination path.
    .map((p) => (p.includes(" -> ") ? p.split(" -> ")[1] : p))
    // Strip surrounding quotes git adds for paths with special chars.
    .map((p) => p.replace(/^"(.*)"$/, "$1"));
  if (dirtyPaths.length === 0) return false;
  if (!dirtyPaths.every((p) => isBrainArtifact(p))) {
    // Something non-brain is dirty too — don't auto-commit; leave it for the user.
    return false;
  }

  // Stage exactly the brain pathspecs (NOT -A) and commit.
  const stage = gitTry(["add", "--", ...dirtyPaths], { cwd });
  if (!stage.ok) return false;
  const commit = gitTry(
    ["commit", "--no-verify", "-q", "-m", "chore(getadvantage): refresh project brain for fan-out lanes"],
    { cwd },
  );
  if (!commit.ok) {
    // Roll the staging back so we don't leave a half-staged index behind.
    gitTry(["reset", "-q", "HEAD", "--", ...dirtyPaths], { cwd });
    return false;
  }
  return true;
}

/** Escape a string for use inside a RegExp. */
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
