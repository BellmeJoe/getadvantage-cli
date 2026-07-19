#!/usr/bin/env node
// Thin wrapper — Loop 1 objective gate is ops/evidence-suite.mjs (canonical).
// Kept so old docs that say `node ops/loop1/run.mjs` still work.
// Prefer:  npm run evidence
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const suite = path.join(root, "ops", "evidence-suite.mjs");
const r = spawnSync(process.execPath, [suite, ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
process.exit(r.status ?? 1);
