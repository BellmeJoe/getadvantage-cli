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
import { c, relPath } from "./util.mjs";

const START = "<!-- ship-safe:auto-load -->";
const END = "<!-- /ship-safe:auto-load -->";

const BLOCK = [
  START,
  "## Project brain — read first",
  "Before anything else, read **`PROJECT-BRIEF.md`** (what this project is) and,",
  "if present, **`HANDOFF.md`** (where work left off). Refresh them with",
  "`ship-safe handoff` (or `npx getadvantage handoff`) before switching sessions",
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
  const i = body.indexOf(START);
  const j = body.indexOf(END);
  let action;
  if (i !== -1 && j !== -1 && j > i) {
    body = body.slice(0, i) + BLOCK + body.slice(j + END.length);
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
  const present = TARGETS.filter((t) => existsSync(path.join(cwd, t)));
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
  console.log(c.gray("  (Don't forget to run `ship-safe brief` once so the brain file exists.)"));
  return 0;
}
