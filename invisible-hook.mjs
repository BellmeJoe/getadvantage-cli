#!/usr/bin/env node
// getAdvantage invisible-mode hook runner.
//
// Invoked by:
//   • Claude Code project hooks (SessionStart / PreToolUse / PostToolUse)
//   • git pre-commit (when installed by `getadvantage init --claude-code`)
//
// Responsibilities:
//   1. Honour GETADVANTAGE_INVISIBLE_BYPASS=1 with an honest bypass message.
//   2. Run the local GO/NO-GO gate under the **agent-trigger profile**
//      (`check --ci --agent-trigger --no-brief-check`) — full gate minus Dirty-tree
//      (staging/edits are expected here); disclosure line always printed.
//      Plain `check --ci` (no flag) still enforces Dirty-tree for pre-deploy.
//   3. Refresh the in-repo proof receipt (zero telemetry).
//   4. On PreToolUse NO-GO: exit 2 + JSON deny so Claude blocks the tool.
//   5. On git pre-commit NO-GO: exit 1 so the commit is refused.
//
// Marker ownership: args include `--managed getadvantage:invisible-mode`.
// Node built-ins only. ESM. No network.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MANAGED_ID = "getadvantage:invisible-mode";
export const RECEIPT_REL = ".getadvantage/INVISIBLE-MODE.md";
export const RECEIPT_HEADER = "getAdvantage invisible-mode receipt";
export const BYPASS_ENV = "GETADVANTAGE_INVISIBLE_BYPASS";
export const HOOK_BASENAME = "invisible-hook.mjs";
export const CLI_POINTER_BASENAME = "invisible-cli-path.txt";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Best-effort project root: CLAUDE_PROJECT_DIR, parent of .getadvantage, or git toplevel. */
export function resolveProjectRoot() {
  const fromEnv = process.env.CLAUDE_PROJECT_DIR;
  if (fromEnv && existsSync(fromEnv)) return path.resolve(fromEnv);

  // Installed runner lives at <root>/.getadvantage/invisible-hook.mjs
  if (path.basename(__dirname) === ".getadvantage") {
    return path.dirname(__dirname);
  }

  try {
    const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.status === 0 && r.stdout) return r.stdout.trim();
  } catch {
    /* ignore */
  }
  return process.cwd();
}

/** Locate index.mjs for the CLI that should run the gate. */
export function resolveCliIndex(projectRoot) {
  const candidates = [];
  const pointer = path.join(projectRoot, ".getadvantage", CLI_POINTER_BASENAME);
  if (existsSync(pointer)) {
    try {
      const p = readFileSync(pointer, "utf8").trim();
      if (p && existsSync(p)) candidates.push(p);
    } catch {
      /* ignore */
    }
  }
  candidates.push(
    path.join(__dirname, "index.mjs"), // source / package root
    path.join(projectRoot, "node_modules", "getadvantage", "index.mjs"),
    path.join(__dirname, "..", "index.mjs"),
  );
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function printBypass(mode) {
  console.error(
    `[getadvantage invisible-mode] BYPASS active (${BYPASS_ENV}=1). ` +
      `Gate not run for this ${mode}. This is a deliberate escape hatch — ` +
      `not a silent skip. Unset the env var to restore automatic gating.`,
  );
}

/**
 * Write / refresh the countable proof receipt. No secrets, no PII, no network.
 */
export function writeReceipt(projectRoot, meta = {}) {
  const abs = path.join(projectRoot, ".getadvantage", "INVISIBLE-MODE.md");
  mkdirSync(path.dirname(abs), { recursive: true });
  const now = new Date().toISOString();
  const lines = [
    `# ${RECEIPT_HEADER}`,
    "",
    "This file is a **local proof receipt** that getAdvantage invisible mode is",
    "installed (or was recently run) in this repository. It exists so week-two",
    "reuse is countable via GitHub code search with **zero telemetry**.",
    "",
    "- No secrets. No PII. No network. No identifiers you did not put in the repo.",
    "- Safe to commit. Safe to delete. Deleting it does not uninstall the hooks.",
    "",
    "## Identity (stable for code search)",
    "",
    "```",
    RECEIPT_HEADER,
    `managed-id: ${MANAGED_ID}`,
    "```",
    "",
    "## Last gate run",
    "",
    `- phase: ${meta.phase || "unknown"}`,
    `- at: ${now}`,
  ];
  if (meta.verdict != null) lines.push(`- verdict: ${meta.verdict}`);
  if (meta.exitCode != null) lines.push(`- exitCode: ${meta.exitCode}`);
  if (meta.bypassed) lines.push(`- bypassed: true (${BYPASS_ENV}=1)`);
  lines.push(
    "",
    "## Remove invisible mode",
    "",
    "```",
    "npx getadvantage init --uninstall-invisible",
    "```",
    "",
    "## Deliberate bypass",
    "",
    "```",
    `${BYPASS_ENV}=1`,
    "```",
    "",
    "Bypass prints an honest message and does not pretend the gate ran.",
    "",
  );
  const body = lines.join("\n");
  const tmp = `${abs}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, body, "utf8");
    renameSync(tmp, abs);
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
  return abs;
}

/**
 * CLI args for the agent-trigger profile used by every invisible-mode hook trigger.
 * Explicit `--agent-trigger` only — never the silent default of plain `check`.
 */
export const AGENT_TRIGGER_CHECK_ARGS = [
  "check",
  "--ci",
  "--no-brief-check",
  "--agent-trigger",
];

/**
 * Run the gate under the agent-trigger profile.
 * Returns { code, stdout, stderr, verdict }.
 */
export function runGate(projectRoot, { quiet = false } = {}) {
  const cli = resolveCliIndex(projectRoot);
  let r;
  if (cli) {
    r = spawnSync(process.execPath, [cli, ...AGENT_TRIGGER_CHECK_ARGS], {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        NO_COLOR: process.env.NO_COLOR || "1",
        GETADVANTAGE_REPORT: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    r = spawnSync("getadvantage", [...AGENT_TRIGGER_CHECK_ARGS], {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        NO_COLOR: process.env.NO_COLOR || "1",
        GETADVANTAGE_REPORT: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
  }

  const code = r.status == null ? 1 : r.status;
  const stdout = r.stdout || "";
  const stderr = r.stderr || "";
  const verdict = code === 0 ? "GO" : "NO-GO";
  if (!quiet) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
  }
  return { code, stdout, stderr, verdict };
}

function emitPreToolDeny(reason) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
    systemMessage: reason,
  };
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function parseArgv(argv) {
  const args = argv.slice(2);
  let mode = "gate";
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--managed" || a.startsWith("--managed=")) {
      if (a === "--managed") i++;
      continue;
    }
    if (
      !a.startsWith("-") &&
      ["session-start", "pre-tool", "post-tool", "pre-commit", "gate", "status"].includes(a)
    ) {
      mode = a;
    }
  }
  return { mode };
}

function isBypassOn() {
  const v = process.env[BYPASS_ENV];
  return v === "1" || v === "true" || v === "yes";
}

/** Drain stdin so Claude's hook JSON pipe never blocks the gate. */
function drainStdin() {
  if (process.stdin.isTTY) return;
  try {
    const buf = Buffer.alloc(65536);
    for (let i = 0; i < 32; i++) {
      try {
        const n = readSync(0, buf, 0, buf.length, null);
        if (!n) break;
      } catch {
        break;
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * CLI entry when executed as a script.
 * @returns {number} exit code
 */
export function runInvisibleHook(argv = process.argv) {
  const { mode } = parseArgv(argv);
  const projectRoot = resolveProjectRoot();

  if (isBypassOn()) {
    printBypass(mode);
    try {
      writeReceipt(projectRoot, { phase: mode, bypassed: true, verdict: "BYPASS", exitCode: 0 });
    } catch {
      /* ignore */
    }
    return 0;
  }

  drainStdin();

  const gate = runGate(projectRoot, { quiet: false });
  try {
    writeReceipt(projectRoot, {
      phase: mode,
      verdict: gate.verdict,
      exitCode: gate.code,
    });
  } catch (e) {
    console.error(
      `[getadvantage invisible-mode] warning: could not write receipt: ${e && e.message ? e.message : e}`,
    );
  }

  if (gate.code === 0) return 0;

  if (mode === "pre-tool") {
    emitPreToolDeny(
      `getAdvantage invisible-mode: gate returned NO-GO (exit ${gate.code}). ` +
        `Fix the findings above, or set ${BYPASS_ENV}=1 for a deliberate bypass.`,
    );
    return 2;
  }
  if (mode === "pre-commit" || mode === "gate") {
    console.error(
      `[getadvantage invisible-mode] gate NO-GO — commit/action refused. ` +
        `Deliberate bypass: ${BYPASS_ENV}=1`,
    );
    return 1;
  }
  // session-start / post-tool: report but do not hard-block session lifecycle.
  // Composition is the agent-trigger profile (no Dirty-tree). Advisory must not
  // promise a Dirty-tree block that this profile will not deliver.
  if (mode === "session-start" || mode === "post-tool") {
    console.error(
      `[getadvantage invisible-mode] gate NO-GO on ${mode} (exit ${gate.code}). ` +
        `Subsequent PreToolUse / pre-commit use the same agent-trigger profile ` +
        `(secrets, tracked .env, Intent Contract, and other non-dirty-tree checks) ` +
        `and will refuse until those are fixed. Dirty-tree is not gated on agent ` +
        `triggers — run plain check --ci before deploy.`,
    );
    return 0;
  }
  return 1;
}

const isDirect =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirect) {
  process.exit(runInvisibleHook(process.argv));
}
