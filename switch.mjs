// Ship-Safe — SWITCH WITHOUT LOSS (`ship-safe switch`).
//
// The portability move. Your brain lives in the REPO (PROJECT-BRIEF.md +
// HANDOFF.md), not in any one tool or model — so switching from Claude to Cursor
// to Qwen (or just starting a fresh session) should cost nothing. `switch` makes
// that a single command:
//   1. saves your place + refreshes the brain (handoff),
//   2. wires every AI-tool entry file so the new tool auto-loads it (init),
//   3. prints the exact paste-ready prompt to start the new session.
//
// Optionally name the tool/model you're switching TO for a tailored tip:
//   ship-safe switch cursor
//
// Node built-ins only. ESM. (Delegates to handoff + init.)

import { binName, c } from "./util.mjs";
import { runHandoff } from "./handoff.mjs";
import { runInit } from "./init.mjs";

// A friendly per-target line. Unknown targets get the generic guidance.
const TOOL_TIPS = {
  claude: "Claude Code reads CLAUDE.md at startup — it'll pick up your brain automatically.",
  "claude-code": "Claude Code reads CLAUDE.md at startup — it'll pick up your brain automatically.",
  // init upserts the auto-load block into existing AI files, or creates AGENTS.md
  // when none exist. It does NOT create .cursorrules from scratch — only updates
  // it if already present (finding: switch-cursorrules-claim).
  cursor:
    "Cursor: if you already have a .cursorrules file, it now has the brain block. Otherwise AGENTS.md was created (or updated) — open that, or add a .cursorrules and re-run `getadvantage init`.",
  windsurf: "Windsurf reads .windsurfrules at startup — it'll pick up your brain automatically.",
  cline: "Cline reads .clinerules at startup — it'll pick up your brain automatically.",
  copilot: "GitHub Copilot reads .github/copilot-instructions.md — it'll pick up your brain.",
  codex: "Codex (and AGENTS.md-aware tools) read AGENTS.md — it'll pick up your brain.",
  qwen: "Qwen / any model: paste the prompt below to load your brain into the new chat.",
  chatgpt: "ChatGPT / any model: paste the prompt below to load your brain into the new chat.",
  gemini: "Gemini / any model: paste the prompt below to load your brain into the new chat.",
};

// The entry file each tool actually reads at startup — wired (created if
// missing) when you switch TO that tool, so the tip above is always true.
// cursor deliberately absent: we never create .cursorrules from scratch
// (finding: switch-cursorrules-claim); Cursor also reads AGENTS.md.
const TOOL_FILES = {
  claude: "CLAUDE.md",
  "claude-code": "CLAUDE.md",
  windsurf: ".windsurfrules",
  cline: ".clinerules",
  copilot: ".github/copilot-instructions.md",
  codex: "AGENTS.md",
};

export function runSwitch(o) {
  const cwd = o.cwd;
  const target = (o.target || "").toLowerCase();

  console.log(c.bold("\n  Switching without loss — your brain lives in the repo, not the tool.\n"));

  // 1. Save your place + refresh the brain.
  console.log(c.cyan("  1. Saving your place"));
  const ho = runHandoff({ cwd, quiet: true });
  if (ho !== 0) {
    console.log(c.yellow("     (Couldn't refresh the handoff — see the note above; continuing.)"));
  }

  // 2. Wire every AI-tool entry file so whatever you switch to auto-loads it —
  //    including the target tool's own file, even if it doesn't exist yet.
  console.log(c.cyan("\n  2. Wiring your tools"));
  runInit({ cwd, preferFile: TOOL_FILES[target] });

  // 3. The exact prompt to start the new session/tool/model.
  console.log(c.cyan("\n  3. Start the new session"));
  if (target && TOOL_TIPS[target]) {
    console.log(`     ${c.gray(TOOL_TIPS[target])}`);
  }
  console.log("     Open your new tool or model and paste this:");
  console.log(c.bold("\n     Read PROJECT-BRIEF.md and HANDOFF.md, then continue where we left off.\n"));
  console.log(c.gray(`     Same project, new model — no re-explaining. Need help choosing one? \`${binName()} models\`.`));
  return 0;
}
