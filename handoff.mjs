// Ship-Safe — SESSION HANDOFF (`ship-safe handoff`).
//
// The HOT half of the Project Brain. Where `ship-safe brief` captures the COLD,
// slow-moving truth of the project (architecture, conventions), `handoff`
// captures the HOT, volatile "where we left off RIGHT NOW" — so you can drop a
// long, slow session and start a FRESH, fast one that picks up exactly where you
// were, WITHOUT re-explaining anything.
//
// One command:
//   1. refreshes PROJECT-BRIEF.md (the COLD brain) so both halves stay in sync,
//   2. writes / updates HANDOFF.md (the HOT layer): a small auto "what changed
//      since last time" (from git) PLUS a short narrative you (or your agent)
//      fill in — what you were doing, the next steps, open threads, gotchas,
//   3. prints the one-line "start here" prompt for the next session.
//
// Your narrative is PRESERVED across refreshes (only the auto section + the
// frontmatter timestamp are regenerated). And we NEVER clobber a HANDOFF.md we
// didn't create: if one exists without our marker, we refuse and suggest --out.
//
// Node built-ins only. ESM. Writes two repo-resident files (the handoff + its
// .getadvantage/handoff.json marker — legacy .ship-safe/ still read, see
// util.mjs); refreshing the brief writes its files too.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { binName, c, gitSafe, readJsonFile, relPath, markerFileForRead, markerFileForWrite } from "./util.mjs";
import { runBrief, briefStaleness } from "./brief.mjs";
import { appendLedger } from "./ledger.mjs";

const DEFAULT_HANDOFF = "HANDOFF.md";
const MARKER_FILE = "handoff.json";
// Recognisable first-lines marker so we can tell OUR handoff from a hand-written
// HANDOFF.md (and so a tool can recognise the file).
const BANNER = "<!-- ship-safe:project-handoff -->";
const NOTES_START = "<!-- ship-safe:handoff:notes -->";
const NOTES_END = "<!-- /ship-safe:handoff:notes -->";
const AUTO_START = "<!-- ship-safe:handoff:auto -->";
const AUTO_END = "<!-- /ship-safe:handoff:auto -->";

// The narrative template written on the first handoff (and whenever the notes
// section is empty). This is the part a human/agent fills in — the value.
const DEFAULT_NOTES = [
  "## Where we are",
  "_(What were you working on? One or two sentences — replace this line.)_",
  "",
  "## Next steps",
  "1. _(The very next thing to do — replace this line.)_",
  "",
  "## Open threads / decisions pending",
  "- _(Anything unresolved or waiting on a decision — replace, or delete if none.)_",
  "",
  "## Gotchas found this session",
  "- _(Anything surprising worth remembering — replace, or delete if none.)_",
].join("\n");

function readJson(abs) {
  // BOM-tolerant (PowerShell default) — see util.readJsonFile.
  return readJsonFile(abs).json;
}

function readTextSafe(abs) {
  try {
    return readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

/** Content strictly between two markers (exclusive), trimmed of edge blank
 *  lines. Returns null if either marker is absent. */
function between(text, start, end) {
  const i = text.indexOf(start);
  if (i === -1) return null;
  const j = text.indexOf(end, i + start.length);
  if (j === -1) return null;
  return text.slice(i + start.length, j).replace(/^\n+/, "").replace(/\n+$/, "");
}

/**
 * The auto "what changed since the last handoff" block — git-derived, regenerated
 * each run. Uses `rev-list --count` to distinguish "no new commits" from "the old
 * head is gone" (e.g. after a rebase), so the message is always honest.
 */
function autoBlock(cwd, lastHead) {
  const L = [];
  const branch = gitSafe(["rev-parse", "--abbrev-ref", "HEAD"], { cwd }) || "(unknown)";
  const head = gitSafe(["rev-parse", "HEAD"], { cwd });
  L.push(`- **Branch:** \`${branch}\`${head ? ` @ \`${head.slice(0, 10)}\`` : ""}`);
  L.push("");

  let commitLines = [];
  let label = "recent commits";
  let rangeOk = false;
  if (lastHead) {
    const countStr = gitSafe(["rev-list", "--count", `${lastHead}..HEAD`], { cwd });
    if (countStr !== "") {
      rangeOk = true;
      const n = parseInt(countStr, 10) || 0;
      if (n > 0) {
        commitLines = gitSafe(["log", `${lastHead}..HEAD`, "--format=%h %s"], { cwd })
          .split("\n")
          .filter(Boolean);
        label = "Commits since the last handoff";
      } else {
        label = "No new commits since the last handoff";
      }
    }
  }
  if (!rangeOk) {
    commitLines = gitSafe(["log", "-8", "--format=%h %s"], { cwd }).split("\n").filter(Boolean);
    label = lastHead
      ? "Recent commits (couldn't diff from the last handoff — history moved)"
      : "Recent commits";
  }

  L.push(`**${label}:**`);
  if (label.startsWith("No new commits")) {
    // nothing to list
  } else if (commitLines.length === 0) {
    L.push("- _(none)_");
  } else {
    for (const ln of commitLines.slice(0, 20)) L.push(`- ${ln.replace(/\|/g, "\\|")}`);
    if (commitLines.length > 20) L.push(`- …and ${commitLines.length - 20} more`);
  }

  // Files changed since the last handoff (only when the range is valid).
  if (lastHead && rangeOk) {
    const changed = gitSafe(["diff", "--name-only", lastHead, "HEAD"], { cwd })
      .split("\n")
      .filter(Boolean);
    if (changed.length) {
      L.push("");
      L.push(`**Files changed since the last handoff (${changed.length}):**`);
      for (const f of changed.slice(0, 30)) L.push(`- \`${f}\``);
      if (changed.length > 30) L.push(`- …and ${changed.length - 30} more`);
    }
  }

  // Working-tree state right now.
  const porcelain = gitSafe(["status", "--porcelain"], { cwd })
    .split("\n")
    .filter((l) => l.length > 0);
  let tracked = 0;
  let untracked = 0;
  for (const l of porcelain) {
    if (l.startsWith("??")) untracked++;
    else tracked++;
  }
  L.push("");
  L.push(
    `**Working tree right now:** ${tracked} uncommitted change(s), ${untracked} untracked file(s)` +
      `${tracked === 0 && untracked === 0 ? " — clean." : "."}`,
  );

  return { text: L.join("\n"), head, branch };
}

/**
 * `ship-safe handoff` — refresh the brief and write the HOT handoff layer.
 * @param {object} o
 * @param {string} o.cwd        repo root
 * @param {string} [o.out]      handoff path (default HANDOFF.md)
 * @param {boolean} [o.noBrief] skip the brief refresh (just warn if stale)
 * @returns {number} exit code (0 on success; 1 if it would clobber a foreign file)
 */
export function runHandoff(o) {
  const cwd = o.cwd;
  const out = o.out || DEFAULT_HANDOFF;
  const handoffAbs = path.resolve(cwd, out);

  // ---- Guard: never overwrite a HANDOFF.md we didn't create. ---------------
  const prev = existsSync(handoffAbs) ? readTextSafe(handoffAbs) : "";
  if (prev && !prev.includes(BANNER)) {
    console.error(
      c.red(`✗ ${relPath(handoffAbs, cwd)} already exists and wasn't created by this CLI — refusing to overwrite it.`),
    );
    console.error(c.gray(`  Write to a different file instead:  ${binName()} handoff --out SESSION-HANDOFF.md`));
    return 1;
  }

  // ---- 1. Refresh the COLD brain (unless --no-brief) so both halves sync. ---
  if (!o.noBrief) {
    runBrief({ cwd }); // writes PROJECT-BRIEF.md + marker; prints its own line
  } else {
    const s = briefStaleness(cwd);
    if (s.status !== "ok") {
      console.log(`  ${c.yellow("⚠")} ${c.bold("Project brief")} — ${s.reason} (run \`${binName()} brief\`)`);
    }
  }

  // ---- 2. Preserve the existing narrative; regenerate the rest. ------------
  const prevNotes = prev ? between(prev, NOTES_START, NOTES_END) : null;
  const firstTime = !prevNotes;
  const notes = prevNotes && prevNotes.trim() ? prevNotes : DEFAULT_NOTES;

  const marker = readJson(markerFileForRead(cwd, MARKER_FILE));
  const lastHead = marker && typeof marker.head_sha === "string" ? marker.head_sha : null;

  const auto = autoBlock(cwd, lastHead);
  const now = new Date().toISOString();
  const repoName = path.basename(cwd);

  const L = [];
  L.push("---");
  L.push("ship_safe_handoff: 1");
  L.push(`generated_at: ${now}`);
  L.push(`head_sha: ${auto.head || "(none)"}`);
  L.push(`branch: ${auto.branch}`);
  L.push("generator: getadvantage handoff");
  L.push("---");
  L.push("");
  L.push(BANNER);
  L.push("");
  L.push(`# Handoff — ${repoName}`);
  L.push("");
  L.push("> **Start here, with `PROJECT-BRIEF.md`.** The brief is the COLD layer —");
  L.push("> what this project *is* (architecture, conventions). This handoff is the");
  L.push("> HOT layer — where work *left off right now*. Read both, then continue.");
  L.push("> This is what lets you drop a long, slow session and start a fresh, fast");
  L.push("> one with no loss. Refresh both anytime with `npx getadvantage handoff`.");
  L.push("");
  L.push(NOTES_START);
  L.push(notes);
  L.push(NOTES_END);
  L.push("");
  L.push(AUTO_START);
  L.push("## What changed since the last handoff");
  L.push("*(Auto-generated from git — regenerated each run.)*");
  L.push("");
  L.push(auto.text);
  L.push(AUTO_END);
  L.push("");
  L.push("---");
  L.push(
    `_Generated by \`npx getadvantage handoff\` at ${now}. Your notes above are preserved across refreshes; the “what changed” section is regenerated each run. Commit this file so the next session — any model, any tool — starts here._`,
  );
  L.push("");

  writeFileSync(handoffAbs, L.join("\n"), "utf8");

  // ---- 3. Marker, so the NEXT handoff can diff "since last". ---------------
  const m = {
    schema: 1,
    out: relPath(handoffAbs, cwd),
    head_sha: auto.head || null,
    branch: auto.branch,
    generated_at: now,
  };
  writeFileSync(markerFileForWrite(cwd, MARKER_FILE), JSON.stringify(m, null, 2) + "\n", "utf8");

  // ---- 3b. Append a compact entry to the session ledger (the continuity log).
  const ledgerRel = appendLedger(cwd, { headSha: auto.head, branch: auto.branch, lastHead, notes, now });

  // ---- 4. Tell the human what to do next. ----------------------------------
  console.log(c.green(`✓ Handoff written → ${relPath(handoffAbs, cwd)}`));
  console.log(c.gray(`  Logged to the session ledger → ${ledgerRel}  (\`${binName()} ledger\` for the history).`));
  if (firstTime) {
    console.log(
      c.yellow("  ▸ First handoff — fill in the short narrative (Where we are / Next steps) so the next session knows the plan."),
    );
  }
  if (!o.quiet) {
    console.log(c.gray("  Next session, paste this to pick up instantly:"));
    console.log(c.cyan(`      Read PROJECT-BRIEF.md and ${relPath(handoffAbs, cwd)}, then continue where we left off.`));
    console.log(c.gray("  Commit both files — your brain lives in the repo, not your tool."));
  }
  return 0;
}

export { DEFAULT_HANDOFF };
