// Ship-Safe — SESSION LEDGER (`ship-safe ledger`).
//
// The append-only continuity changelog. Every `ship-safe handoff` adds (or, if
// you re-run it in the same session, updates) one compact entry to
// `.ship-safe/ledger.md`: date · branch @ sha · commits since last · next step.
// Over time it becomes the project's session history — the thread that lets any
// model/session see not just WHERE the project is, but HOW it got there.
//
// Node built-ins only. ESM. Writes one repo-resident file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { c, gitSafe, relPath } from "./util.mjs";

const HEAD_MARK = "<!-- ship-safe:ledger -->";

function ledgerPath(cwd) {
  return path.join(cwd, ".ship-safe", "ledger.md");
}

/** Pull the first real "next step" line out of a handoff notes block. Returns
 *  "—" when it's still the placeholder or empty. */
function extractNext(notes) {
  if (!notes) return "—";
  const lines = notes.split("\n");
  let inNext = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^##\s+next steps/i.test(line)) { inNext = true; continue; }
    if (inNext) {
      if (/^##\s/.test(line)) break; // next heading
      if (!line) continue;
      const text = line.replace(/^(\d+\.|[-*])\s*/, "").trim();
      if (!text || text.startsWith("_(")) return "—"; // untouched placeholder
      return text.replace(/\s+/g, " ").slice(0, 140);
    }
  }
  return "—";
}

/**
 * Append (or update the latest same-sha) ledger entry. Called by `handoff`.
 * @returns {string} repo-relative ledger path (for the caller to mention).
 */
export function appendLedger(cwd, { headSha, branch, lastHead, notes, now }) {
  const abs = ledgerPath(cwd);
  const dir = path.dirname(abs);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let body = existsSync(abs) ? readFileSync(abs, "utf8") : "";
  if (!body.includes(HEAD_MARK)) {
    body =
      `${HEAD_MARK}\n# Session ledger\n\n` +
      `_A running log of save-points (\`ship-safe handoff\`), newest at the bottom — ` +
      `the project's session history._\n`;
  }

  // commits since the last handoff (best-effort; 0 if range invalid/first run)
  let commitCount = 0;
  if (lastHead) {
    const cnt = gitSafe(["rev-list", "--count", `${lastHead}..HEAD`], { cwd });
    if (cnt) commitCount = parseInt(cnt, 10) || 0;
  }

  const shortSha = headSha ? headSha.slice(0, 10) : "(none)";
  const date = now.slice(0, 16).replace("T", " "); // YYYY-MM-DD HH:MM (UTC)
  const next = extractNext(notes);
  const entry =
    `- **${date}** · \`${branch}\` @ \`${shortSha}\` · ${commitCount} commit(s) since last · next: ${next}`;

  // If the most recent entry is for THIS head sha, update it in place (re-running
  // handoff in one session shouldn't duplicate the save-point).
  const lines = body.split("\n");
  let lastIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("- **")) { lastIdx = i; break; }
  }
  if (lastIdx >= 0 && lines[lastIdx].includes(`@ \`${shortSha}\``)) {
    lines[lastIdx] = entry;
    body = lines.join("\n");
  } else {
    body = body.replace(/\n*$/, "") + "\n" + entry + "\n";
  }

  writeFileSync(abs, body, "utf8");
  return relPath(abs, cwd);
}

/** `ship-safe ledger` — print the recent session history. */
export function runLedger(o) {
  const cwd = o.cwd;
  const abs = ledgerPath(cwd);
  if (!existsSync(abs)) {
    console.log(`  ${c.yellow("⚠")} No session ledger yet — run ${c.cyan("ship-safe handoff")} to start one.`);
    return 0;
  }
  const body = readFileSync(abs, "utf8");
  const entries = body.split("\n").filter((l) => l.startsWith("- **"));
  console.log(c.bold(`\n  Session ledger — ${entries.length} save-point(s)  ${c.gray(`(${relPath(abs, cwd)})`)}\n`));
  const tail = entries.slice(-15);
  for (const e of tail) {
    console.log("  " + e.replace(/^- /, "").replace(/\*\*/g, "").replace(/`/g, ""));
  }
  if (entries.length > tail.length) {
    console.log(c.gray(`  …and ${entries.length - tail.length} older — see ${relPath(abs, cwd)}`));
  }
  return 0;
}

export { ledgerPath };
