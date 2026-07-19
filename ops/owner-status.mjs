#!/usr/bin/env node
// Owner status — 30-second transparency for the human, not the agent.
// npm run owner
//
// Prints: live npm version vs local, then runs the evidence suite scoreboard.
// Exit code = evidence suite exit code.

import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

let npm = null;
try {
  npm = execFileSync("npm", ["view", "getadvantage", "version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
    // npm is npm.cmd on Windows and .cmd files need a shell to spawn;
    // args are static literals, so no injection surface.
    shell: process.platform === "win32",
  }).trim();
} catch {
  /* registry unreachable or npm missing — reported as "couldn't check" below */
}

const verdict =
  npm === null ? "  · live check skipped" : npm === local ? "  ✓ matches live" : "  ⚠ differs from live";
console.log("");
console.log("  getAdvantage — owner status");
console.log("  ────────────────────────────────────────");
console.log(`  Live npm:     ${npm === null ? "(couldn't reach npm — no verdict on live version)" : `getadvantage@${npm}`}`);
console.log(`  This checkout: ${local}${verdict}`);
console.log("");
console.log("  What it does (one line):");
console.log("  GO/NO-GO before deploy — block secrets, .env, dirty tree.");
console.log("");
console.log("  Running evidence suite (the only objective truth)…");
console.log("");

const r = spawnSync(process.execPath, [path.join(ROOT, "ops", "evidence-suite.mjs")], {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});
process.exit(r.status ?? 1);
