// Ship-Safe — CONTEXT FUEL GAUGE (`ship-safe gauge`).
//
// "How heavy is this session — should I reset?" A long AI session gets slow as
// its context bloats; the cure is to save your place (`handoff`) and start fresh.
// This gauge nudges you to do that BEFORE it gets painful.
//
// HONESTY (hard): a CLI canNOT see your AI's context window or token count. This
// is a HEURISTIC built from REPO ACTIVITY since your last handoff — time elapsed,
// commits, and lines changed — a proxy for "how long you've been going." It never
// claims to measure your tokens; it's a reminder, not a measurement.
//
// Node built-ins only. ESM. Read-only (writes nothing).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { c, gitSafe } from "./util.mjs";

function readJson(abs) {
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

/** Parse "N files changed, A insertions(+), B deletions(-)" → A+B (lines touched). */
function parseChurn(shortstat) {
  if (!shortstat) return 0;
  let total = 0;
  const ins = shortstat.match(/(\d+) insertion/);
  const del = shortstat.match(/(\d+) deletion/);
  if (ins) total += parseInt(ins[1], 10) || 0;
  if (del) total += parseInt(del[1], 10) || 0;
  return total;
}

function fmtAge(hours) {
  if (hours == null) return "unknown";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min ago`;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function runGauge(o) {
  const cwd = o.cwd;
  const marker = readJson(path.join(cwd, ".ship-safe", "handoff.json"));
  const head = gitSafe(["rev-parse", "HEAD"], { cwd });

  // No save-point yet → can't gauge drift; nudge to set a baseline.
  if (!marker || !marker.head_sha) {
    console.log(`  ${c.yellow("◔")} ${c.bold("No save-point yet.")}`);
    console.log(`      Run ${c.cyan("ship-safe handoff")} to set your baseline — then this gauge can tell you when a session is getting heavy.`);
    return 0;
  }

  const lastHead = marker.head_sha;
  let commits = 0;
  const cnt = gitSafe(["rev-list", "--count", `${lastHead}..HEAD`], { cwd });
  if (cnt) commits = parseInt(cnt, 10) || 0;

  const committedChurn = parseChurn(gitSafe(["diff", "--shortstat", lastHead, "HEAD"], { cwd }));
  const workingChurn = parseChurn(gitSafe(["diff", "--shortstat"], { cwd }));
  const churn = committedChurn + workingChurn;

  let hours = null;
  if (marker.generated_at) {
    const ms = Date.now() - Date.parse(marker.generated_at);
    if (!Number.isNaN(ms)) hours = Math.max(0, ms / 3_600_000);
  }

  // Heuristic "session weight" — commits + lines/60 + hours/2. Deliberately rough.
  const weight = commits + churn / 60 + (hours ?? 0) / 2;
  let band, glyph, color, nudge;
  if (weight < 4) {
    band = "Fresh"; glyph = "●"; color = c.green;
    nudge = "Plenty of runway — keep going.";
  } else if (weight < 12) {
    band = "Getting heavy"; glyph = "◐"; color = c.yellow;
    nudge = "A good moment to `ship-safe handoff` soon, so your next session starts light.";
  } else {
    band = "Time to reset"; glyph = "◑"; color = c.red;
    nudge = "Run `ship-safe handoff`, then start a fresh session — you'll keep everything and get your speed back.";
  }

  console.log(`  ${color(glyph)} ${c.bold("Session weight: " + band)}`);
  console.log(
    c.gray(
      `      since your last save-point (${fmtAge(hours)}): ` +
        `${commits} commit(s), ~${churn} line(s) changed.`,
    ),
  );
  console.log(`      ${nudge}`);
  console.log(c.gray("      (Heuristic from repo activity — not a read of your AI's context.)"));
  return 0;
}
