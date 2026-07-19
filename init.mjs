// Ship-Safe — AUTO-LOAD HOOK (`ship-safe init`).
//
// Kills the discipline tax. AI coding tools read a conventional instructions file
// at the START of every session — `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex
// and a growing set of tools), `.cursorrules` (Cursor), GitHub Copilot's
// instructions file. `init` ensures each present file has a small MANAGED block
// telling the agent to read PROJECT-BRIEF.md + HANDOFF.md first — so the brain
// loads itself and you never have to remember to point at it.
//
// Idempotent: it upserts its own marked block (never duplicates), so re-running
// after the brief changes is safe. If NO entry file exists, it creates AGENTS.md
// (the emerging cross-tool standard). Node built-ins only. ESM.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { binName, c, relPath } from "./util.mjs";

const START = "<!-- getadvantage:auto-load -->";
const END = "<!-- /getadvantage:auto-load -->";
const START_LEGACY = "<!-- ship-safe:auto-load -->";
const END_LEGACY = "<!-- /ship-safe:auto-load -->";

const BLOCK = [
  START,
  "## Project brain — read first",
  "Before anything else, read **`PROJECT-BRIEF.md`** (what this project is) and,",
  "if present, **`HANDOFF.md`** (where work left off). Refresh them with",
  "`npx getadvantage handoff` before switching sessions",
  "or models — your context lives in the repo, not the tool.",
  END,
].join("\n");

// Files an AI coding tool auto-reads at session start. We touch existing ones;
// if none exist we create AGENTS.md (the cross-tool convention).
const TARGETS = [
  "CLAUDE.md",
  "AGENTS.md",
  ".cursorrules",
  ".windsurfrules",
  ".clinerules",
  ".github/copilot-instructions.md",
];

function upsertBlock(abs) {
  let body = existsSync(abs) ? readFileSync(abs, "utf8") : "";
  // Prefer current markers; fall back to legacy ship-safe so re-init migrates
  // the block in place instead of duplicating it.
  let i = body.indexOf(START);
  let j = body.indexOf(END);
  let endLen = END.length;
  if (i === -1 || j === -1 || j <= i) {
    i = body.indexOf(START_LEGACY);
    j = body.indexOf(END_LEGACY);
    endLen = END_LEGACY.length;
  }
  let action;
  if (i !== -1 && j !== -1 && j > i) {
    body = body.slice(0, i) + BLOCK + body.slice(j + endLen);
    action = "updated";
  } else {
    body = (body ? body.replace(/\n*$/, "") + "\n\n" : "") + BLOCK + "\n";
    action = body && existsSync(abs) ? "appended to" : "created";
  }
  const dir = path.dirname(abs);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(abs, body, "utf8");
  return action;
}

export function runInit(o) {
  const cwd = o.cwd;
  // o.preferFile: the entry file the tool being switched TO actually reads
  // (e.g. CLAUDE.md for `switch claude`). Wired even when absent, so the
  // per-tool tip ("X reads Y at startup") is always true.
  const prefer = o.preferFile && TARGETS.includes(o.preferFile) ? o.preferFile : null;
  const present = TARGETS.filter((t) => existsSync(path.join(cwd, t)));
  if (prefer && !present.includes(prefer)) present.unshift(prefer);
  const done = [];

  if (present.length === 0) {
    const abs = path.join(cwd, "AGENTS.md");
    writeFileSync(abs, `# Agent instructions\n\n${BLOCK}\n`, "utf8");
    done.push(`AGENTS.md (created)`);
  } else {
    for (const t of present) {
      const action = upsertBlock(path.join(cwd, t));
      done.push(`${t} (${action})`);
    }
  }

  console.log(c.green(`✓ Wired the project brain in: ${done.join(", ")}`));
  console.log(c.gray("  Your AI reads these at session start — so PROJECT-BRIEF.md + HANDOFF.md load automatically."));
  console.log(c.gray("  Re-run anytime; it updates its own marked block and never duplicates."));
  if (!existsSync(path.join(cwd, "PROJECT-BRIEF.md"))) {
    console.log(c.gray(`  (Don't forget to run \`${binName()} brief\` once so the brain file exists.)`));
  }
  return 0;
}
