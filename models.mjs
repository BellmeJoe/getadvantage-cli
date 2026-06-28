// Ship-Safe — MODEL PLAYBOOK (`ship-safe models`).
//
// A plain-language guide to choosing + switching AI models, for people who don't
// want to track benchmarks. HONESTY (hard): model strengths shift constantly and
// depend on YOUR task — this is PRINCIPLE-based guidance, never a "best model"
// claim or a benchmark. The real point: because your brain is portable
// (PROJECT-BRIEF.md + HANDOFF.md live in the repo), switching is cheap, so you can
// match the model to the job and move freely.
//
// Node built-ins only. ESM. Read-only (prints; writes nothing).

import { c } from "./util.mjs";

export function runModels() {
  const L = [
    "",
    c.bold("  Choosing + switching AI models — a plain-language playbook"),
    "",
    "  Your context lives in the repo (PROJECT-BRIEF.md + HANDOFF.md), so switching",
    "  models or tools is cheap. Match the model to the job:",
    "",
    `  ${c.cyan("Routine / boilerplate")}   repetitive edits, simple components, formatting, copy.`,
    "    A cheaper, faster model is usually plenty. Save the strong one for the hard parts.",
    "",
    `  ${c.cyan("Hard reasoning")}          architecture, tricky bugs, security, big refactors.`,
    "    Reach for the strongest model you have — the quality gap shows up right here.",
    "",
    `  ${c.cyan("Slow or down?")}           a provider is lagging or offline — switch and keep moving`,
    "    (ChatGPT, Claude, Gemini, Qwen, …). Run `ship-safe switch` first so the next one",
    "    starts with your brain instead of a blank slate.",
    "",
    c.gray("  Rule of thumb: try a cheaper model first, escalate when it struggles. Don't get"),
    c.gray("  locked to one — verify what works for YOUR task, and switch freely."),
    "",
    c.gray("  (Principles, not benchmarks — model strengths change; your portable brain doesn't.)"),
    "",
  ];
  for (const line of L) console.log(line);
  return 0;
}
