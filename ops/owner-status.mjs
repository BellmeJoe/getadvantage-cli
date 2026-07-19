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

let npm = "(offline?)";
try {
  npm = execFileSync("npm", ["view", "getadvantage", "version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 15_000,
  }).trim();
} catch {
  /* ignore */
}

const match = npm === local;
console.log("");
console.log("  getAdvantage — owner status");
console.log("  ────────────────────────────────────────");
console.log(`  Live npm:     getadvantage@${npm}`);
console.log(`  This checkout: ${local}${match ? "  ✓ matches live" : "  ⚠ differs from live"}`);
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
