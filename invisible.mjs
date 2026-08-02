// getAdvantage — invisible mode (B2 / 0.12.x).
//
// One command installs automatic gate enforcement (not instruction-file hope):
//   getadvantage init --claude-code
//   getadvantage init --cursor          (detect-and-refuse until schema verified)
//   getadvantage init --uninstall-invisible
//   getadvantage init --invisible-status
//
// Claude Code schema (verified 2026-07-31 against code.claude.com/docs/en/hooks
// and installed plugin hooks under ~/.claude/plugins/.../hooks/hooks.json):
//   project file: .claude/settings.json
//   shape: { hooks: { EventName: [ { matcher?, hooks: [ { type:"command",
//            command, args?, timeout? } ] } ] } }
//   Local user ~/.claude/settings.json has no hooks block on this machine —
//   project-level write is correct.
//
// Cursor: schema not verified against a real installed hook surface on this
// machine → detect-and-refuse (permitted narrowing, disclosed).
//
// Also installs a marker-owned git pre-commit when safe (no husky fight,
// respects core.hooksPath). Receipt: .getadvantage/INVISIBLE-MODE.md
// with fixed header for GitHub code search. Zero telemetry.
//
// Node built-ins only. ESM.

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  binName,
  c,
  cliVersion,
  gitSafe,
  MARKER_DIR,
  section,
  stripBom,
} from "./util.mjs";
import {
  intentPathEverInAncestry,
  INTENT_REL,
  parseAndValidateContract,
  resolveInitBaseline,
} from "./intent.mjs";
import {
  BYPASS_ENV,
  CLI_POINTER_BASENAME,
  HOOK_BASENAME,
  MANAGED_ID,
  RECEIPT_HEADER,
  RECEIPT_REL,
  writeReceipt,
} from "./invisible-hook.mjs";

const __filename = fileURLToPath(import.meta.url);
const PACKAGE_DIR = path.dirname(__filename);

export { MANAGED_ID, RECEIPT_REL, RECEIPT_HEADER, BYPASS_ENV };

const GIT_HOOK_MARKER = `# ${MANAGED_ID}`;
const SETTINGS_REL = ".claude/settings.json";
const INSTALLED_HOOK_REL = `${MARKER_DIR}/${HOOK_BASENAME}`;
const CLI_POINTER_REL = `${MARKER_DIR}/${CLI_POINTER_BASENAME}`;
const STATE_REL = `${MARKER_DIR}/invisible-state.json`;

// ---------------------------------------------------------------------------
// Editor detection
// ---------------------------------------------------------------------------

/**
 * Detect which AI editors leave project markers in the repo.
 * @returns {{ claude: boolean, cursor: boolean, claudeSignals: string[], cursorSignals: string[] }}
 */
export function detectEditors(cwd) {
  const claudeSignals = [];
  const cursorSignals = [];

  const claudePaths = [
    [".claude", "dir"],
    [".claude/settings.json", "file"],
    [".claude/settings.local.json", "file"],
    ["CLAUDE.md", "file"],
  ];
  for (const [rel, kind] of claudePaths) {
    const abs = path.join(cwd, rel);
    if (existsSync(abs)) {
      try {
        const st = statSync(abs);
        if (kind === "dir" && st.isDirectory()) claudeSignals.push(rel);
        if (kind === "file" && st.isFile()) claudeSignals.push(rel);
      } catch {
        /* ignore */
      }
    }
  }

  const cursorPaths = [
    [".cursor", "dir"],
    [".cursor/rules", "dir"],
    [".cursorrules", "file"],
    [".cursor/mcp.json", "file"],
  ];
  for (const [rel, kind] of cursorPaths) {
    const abs = path.join(cwd, rel);
    if (existsSync(abs)) {
      try {
        const st = statSync(abs);
        if (kind === "dir" && st.isDirectory()) cursorSignals.push(rel);
        if (kind === "file" && st.isFile()) cursorSignals.push(rel);
      } catch {
        /* ignore */
      }
    }
  }

  return {
    claude: claudeSignals.length > 0,
    cursor: cursorSignals.length > 0,
    claudeSignals,
    cursorSignals,
  };
}

/**
 * Wrong-editor ship blocker: refuse when the chosen flag conflicts with
 * exclusive markers for the other editor.
 * @returns {{ ok: true } | { ok: false, message: string, suggest: string }}
 */
export function checkEditorCompatibility(cwd, editor) {
  const d = detectEditors(cwd);
  if (editor === "claude-code") {
    // Cursor-only repo (has cursor markers, zero claude markers) → refuse.
    if (d.cursor && !d.claude) {
      return {
        ok: false,
        message:
          `this repo looks Cursor-only (found ${d.cursorSignals.join(", ")}; no Claude Code markers). ` +
          `Installing Claude Code hooks here would misconfigure the project.`,
        suggest: `${binName()} init --cursor`,
      };
    }
    return { ok: true };
  }
  if (editor === "cursor") {
    if (d.claude && !d.cursor) {
      return {
        ok: false,
        message:
          `this repo looks Claude-Code-only (found ${d.claudeSignals.join(", ")}; no Cursor markers). ` +
          `Installing a Cursor hook surface here would misconfigure the project.`,
        suggest: `${binName()} init --claude-code`,
      };
    }
    return { ok: true };
  }
  return { ok: false, message: `unknown editor ${editor}`, suggest: `${binName()} init --claude-code` };
}

// ---------------------------------------------------------------------------
// settings.json safety
// ---------------------------------------------------------------------------

/**
 * Classify settings text for safe editing.
 * Returns null when JSON.parse succeeds (strict JSON — safe to merge).
 * Returns a short reason when parse fails and the text looks like JSONC /
 * trailing-comma / comments (refuse, never rewrite).
 */
export function looksLikeJsoncOrNonStrict(text) {
  const s = stripBom(String(text || ""));
  // Strict JSON that parses is NEVER treated as JSONC — even if a naive
  // strip-strings heuristic would see commas between string array elements.
  try {
    JSON.parse(s);
    return null;
  } catch {
    /* fall through */
  }
  // Line comments or block comments outside strings — heuristic for messaging.
  let stripped = "";
  let i = 0;
  let inStr = false;
  let esc = false;
  let quote = "";
  while (i < s.length) {
    const ch = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === "\\") {
        esc = true;
      } else if (ch === quote) {
        inStr = false;
      }
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      i++;
      continue;
    }
    stripped += ch;
    i++;
  }
  if (/\/\//.test(stripped) || /\/\*/.test(stripped)) return "comments";
  if (/,\s*[}\]]/.test(stripped)) return "trailing-comma";
  return "invalid-json";
}

/**
 * Detect indent style from an existing JSON body (default 2 spaces).
 */
function detectIndent(text) {
  const m = String(text || "").match(/\n([ \t]+)"/);
  if (m) return m[1];
  return "  ";
}

/**
 * True when a hook handler object is ours (managed marker in command/args).
 */
export function isManagedHookHandler(handler) {
  if (!handler || typeof handler !== "object") return false;
  const cmd = String(handler.command || "");
  const args = Array.isArray(handler.args) ? handler.args.map(String) : [];
  const blob = [cmd, ...args].join(" ");
  return blob.includes(MANAGED_ID) || blob.includes(HOOK_BASENAME) || blob.includes("invisible-hook");
}

/**
 * True when a matcher group contains only managed handlers (safe to replace).
 */
function groupIsOurs(group) {
  if (!group || !Array.isArray(group.hooks) || group.hooks.length === 0) return false;
  return group.hooks.every(isManagedHookHandler);
}

/**
 * Build the managed Claude Code hooks block (exec form for Windows path safety).
 * Schema cited: code.claude.com/docs/en/hooks — type command + args exec form.
 */
export function buildManagedClaudeHooks() {
  // ${CLAUDE_PROJECT_DIR} is substituted by Claude Code into each args element.
  const hookPath = `\${CLAUDE_PROJECT_DIR}/${INSTALLED_HOOK_REL.replace(/\\/g, "/")}`;
  const mk = (mode) => ({
    type: "command",
    command: "node",
    args: [hookPath, mode, "--managed", MANAGED_ID],
    timeout: 60,
  });
  return {
    SessionStart: [
      {
        matcher: "startup|resume|clear|compact",
        hooks: [mk("session-start")],
      },
    ],
    PreToolUse: [
      {
        matcher: "Write|Edit|MultiEdit|Bash",
        hooks: [mk("pre-tool")],
      },
    ],
    PostToolUse: [
      {
        matcher: "Write|Edit|MultiEdit",
        hooks: [mk("post-tool")],
      },
    ],
  };
}

/**
 * Merge managed hooks into parsed settings object. Preserves foreign hooks.
 * @returns {{ ok: true, json: object, changed: boolean } | { ok: false, error: string }}
 */
export function mergeManagedHooksIntoSettings(existingJson) {
  const managed = buildManagedClaudeHooks();
  const root =
    existingJson && typeof existingJson === "object" && !Array.isArray(existingJson)
      ? { ...existingJson }
      : {};

  if (root.hooks != null && (typeof root.hooks !== "object" || Array.isArray(root.hooks))) {
    return {
      ok: false,
      error: `${SETTINGS_REL} has a non-object "hooks" value — refusing to rewrite it.`,
    };
  }

  const prevHooks = root.hooks && typeof root.hooks === "object" ? root.hooks : {};
  const hooks = { ...prevHooks };

  for (const [event, groups] of Object.entries(managed)) {
    const existing = Array.isArray(hooks[event]) ? hooks[event] : [];
    // Drop previous managed groups; keep foreign ones; append current managed.
    const foreign = existing.filter((g) => !groupIsOurs(g));
    hooks[event] = [...foreign, ...groups];
  }

  const changed = JSON.stringify(prevHooks) !== JSON.stringify(hooks);
  root.hooks = hooks;
  return { ok: true, json: root, changed };
}

/**
 * Read + safely plan a settings.json write.
 * @returns {{ action: 'create'|'update'|'noop'|'refuse', ... }}
 */
export function planSettingsWrite(cwd) {
  const abs = path.join(cwd, ".claude", "settings.json");
  if (!existsSync(abs)) {
    const managed = buildManagedClaudeHooks();
    const json = { hooks: managed };
    const body = JSON.stringify(json, null, 2) + "\n";
    return { action: "create", abs, body, json };
  }

  let raw;
  try {
    raw = readFileSync(abs, "utf8");
  } catch (e) {
    return {
      action: "refuse",
      abs,
      error: `cannot read ${SETTINGS_REL}: ${e && e.message ? e.message : e}`,
    };
  }

  const jsonc = looksLikeJsoncOrNonStrict(raw);
  if (jsonc) {
    return {
      action: "refuse",
      abs,
      error:
        `${SETTINGS_REL} looks like JSONC / non-strict JSON (${jsonc}). ` +
        `Refusing to rewrite it (would risk corrupting comments or trailing commas). ` +
        `Convert it to strict JSON, or add the getAdvantage hooks block by hand.`,
      preserved: raw,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(stripBom(raw));
  } catch (e) {
    return {
      action: "refuse",
      abs,
      error:
        `${SETTINGS_REL} is not valid JSON (${e && e.message ? e.message : e}). ` +
        `Refusing to rewrite it. Fix the syntax, then re-run.`,
      preserved: raw,
    };
  }

  const merged = mergeManagedHooksIntoSettings(parsed);
  if (!merged.ok) {
    return { action: "refuse", abs, error: merged.error, preserved: raw };
  }

  if (!merged.changed) {
    return { action: "noop", abs, body: raw, json: merged.json };
  }

  const indent = detectIndent(raw);
  const body = JSON.stringify(merged.json, null, indent) + "\n";
  return { action: "update", abs, body, json: merged.json, previous: raw };
}

/**
 * Remove only our managed hook groups from settings.json.
 * Foreign hooks and non-hooks keys survive. Empty hooks object is removed.
 */
export function planSettingsUninstall(cwd) {
  const abs = path.join(cwd, ".claude", "settings.json");
  if (!existsSync(abs)) {
    return { action: "noop", abs, reason: "no settings file" };
  }
  let raw;
  try {
    raw = readFileSync(abs, "utf8");
  } catch (e) {
    return {
      action: "refuse",
      abs,
      error: `cannot read ${SETTINGS_REL}: ${e && e.message ? e.message : e}`,
    };
  }
  const jsonc = looksLikeJsoncOrNonStrict(raw);
  if (jsonc) {
    return {
      action: "refuse",
      abs,
      error: `${SETTINGS_REL} looks like JSONC (${jsonc}) — refusing to touch it. Remove managed hooks by hand.`,
      preserved: raw,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(stripBom(raw));
  } catch (e) {
    return {
      action: "refuse",
      abs,
      error: `${SETTINGS_REL} is invalid JSON — refusing to touch it. Original left byte-exact.`,
      preserved: raw,
    };
  }
  if (!parsed || typeof parsed !== "object" || !parsed.hooks || typeof parsed.hooks !== "object") {
    return { action: "noop", abs, reason: "no hooks block", preserved: raw };
  }

  const hooks = { ...parsed.hooks };
  let changed = false;
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue;
    const next = hooks[event].filter((g) => !groupIsOurs(g));
    if (next.length !== hooks[event].length) {
      changed = true;
      if (next.length === 0) delete hooks[event];
      else hooks[event] = next;
    }
  }
  if (!changed) return { action: "noop", abs, reason: "no managed hooks", preserved: raw };

  const out = { ...parsed };
  if (Object.keys(hooks).length === 0) delete out.hooks;
  else out.hooks = hooks;

  // If the file only ever held our hooks (and maybe nothing else), remove it.
  if (Object.keys(out).length === 0) {
    return { action: "delete", abs, previous: raw };
  }
  const indent = detectIndent(raw);
  const body = JSON.stringify(out, null, indent) + "\n";
  return { action: "update", abs, body, previous: raw };
}

// ---------------------------------------------------------------------------
// Atomic write helpers (no partials on failure)
// ---------------------------------------------------------------------------

function atomicWriteFile(abs, body) {
  const dir = path.dirname(abs);
  mkdirSync(dir, { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
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
}

function safeUnlink(abs) {
  try {
    if (existsSync(abs)) unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Git hook install
// ---------------------------------------------------------------------------

/**
 * Resolve the git hooks directory, honouring core.hooksPath.
 * @returns {{ ok: true, hooksDir: string, hooksPathConfig: string|null, gitDir: string }
 *          | { ok: false, error: string }}
 */
export function resolveGitHooksDir(cwd) {
  const gitDir = gitSafe(["rev-parse", "--git-dir"], { cwd });
  if (!gitDir) {
    return { ok: false, error: "not a git repository (or git unavailable)" };
  }
  const absGitDir = path.isAbsolute(gitDir) ? gitDir : path.resolve(cwd, gitDir);

  // Nested gitlink / worktree: --git-dir is correct; never write into a parent
  // by following a bare path wrongly.
  const hooksPath = gitSafe(["config", "--get", "core.hooksPath"], { cwd });
  if (hooksPath) {
    const absHooks = path.isAbsolute(hooksPath) ? hooksPath : path.resolve(cwd, hooksPath);
    return {
      ok: true,
      hooksDir: absHooks,
      hooksPathConfig: hooksPath,
      gitDir: absGitDir,
    };
  }
  return {
    ok: true,
    hooksDir: path.join(absGitDir, "hooks"),
    hooksPathConfig: null,
    gitDir: absGitDir,
  };
}

export function detectHusky(cwd) {
  const huskyPre = path.join(cwd, ".husky", "pre-commit");
  return existsSync(huskyPre);
}

/** Body of the managed git pre-commit hook (POSIX sh — Git for Windows uses sh). */
export function buildGitPreCommitBody() {
  // Use relative path from repo root; git runs hooks with cwd = work tree root.
  const rel = INSTALLED_HOOK_REL.replace(/\\/g, "/");
  return [
    "#!/bin/sh",
    GIT_HOOK_MARKER,
    "# Managed by getadvantage invisible mode. Do not edit by hand.",
    "# Uninstall: getadvantage init --uninstall-invisible",
    `if [ -n "$${BYPASS_ENV}" ] && [ "$${BYPASS_ENV}" != "0" ]; then`,
    `  echo "[getadvantage invisible-mode] BYPASS active ($${BYPASS_ENV}). Gate not run for this pre-commit. This is a deliberate escape hatch." >&2`,
    "  exit 0",
    "fi",
    `HOOK="./${rel}"`,
    'if [ ! -f "$HOOK" ]; then',
    '  echo "[getadvantage invisible-mode] installed pre-commit but runner missing: $HOOK" >&2',
    '  echo "  Re-run: getadvantage init --claude-code   or uninstall: getadvantage init --uninstall-invisible" >&2',
    "  exit 1",
    "fi",
    `exec node "$HOOK" pre-commit --managed ${MANAGED_ID}`,
    "",
  ].join("\n");
}

export function isManagedGitHook(body) {
  return String(body || "").includes(GIT_HOOK_MARKER) || String(body || "").includes(MANAGED_ID);
}

/**
 * Plan git pre-commit install.
 */
export function planGitHookInstall(cwd, { force = false } = {}) {
  if (detectHusky(cwd)) {
    const line = `node ./${INSTALLED_HOOK_REL.replace(/\\/g, "/")} pre-commit --managed ${MANAGED_ID}`;
    return {
      action: "refuse-husky",
      error:
        "husky is present (.husky/pre-commit). Refusing to fight the hook manager.",
      nextAction: `Add this line to .husky/pre-commit:\n    ${line}`,
    };
  }

  const resolved = resolveGitHooksDir(cwd);
  if (!resolved.ok) return { action: "refuse", error: resolved.error };

  const abs = path.join(resolved.hooksDir, "pre-commit");
  const body = buildGitPreCommitBody();

  if (existsSync(abs)) {
    let current = "";
    try {
      current = readFileSync(abs, "utf8");
    } catch (e) {
      return {
        action: "refuse",
        error: `cannot read existing pre-commit hook: ${e && e.message ? e.message : e}`,
        abs,
      };
    }
    if (isManagedGitHook(current)) {
      if (current === body || current.replace(/\r\n/g, "\n") === body) {
        return { action: "noop", abs, hooksDir: resolved.hooksDir, hooksPathConfig: resolved.hooksPathConfig };
      }
      // Our hook, outdated → update.
      return {
        action: "update",
        abs,
        body,
        hooksDir: resolved.hooksDir,
        hooksPathConfig: resolved.hooksPathConfig,
      };
    }
    // Foreign hook.
    if (!force) {
      return {
        action: "refuse-foreign",
        abs,
        error:
          `a pre-commit hook already exists at ${abs} and is not managed by getadvantage. ` +
          `Not overwriting it.`,
        nextAction: `Inspect it, then re-run with --force to replace it, or add the getadvantage line yourself.`,
      };
    }
    return {
      action: "force-replace",
      abs,
      body,
      previous: current,
      hooksDir: resolved.hooksDir,
      hooksPathConfig: resolved.hooksPathConfig,
    };
  }

  return {
    action: "create",
    abs,
    body,
    hooksDir: resolved.hooksDir,
    hooksPathConfig: resolved.hooksPathConfig,
  };
}

export function planGitHookUninstall(cwd) {
  const resolved = resolveGitHooksDir(cwd);
  if (!resolved.ok) return { action: "noop", reason: resolved.error };
  const abs = path.join(resolved.hooksDir, "pre-commit");
  if (!existsSync(abs)) return { action: "noop", abs, reason: "no pre-commit" };
  let current = "";
  try {
    current = readFileSync(abs, "utf8");
  } catch {
    return { action: "noop", abs, reason: "unreadable" };
  }
  if (!isManagedGitHook(current)) {
    return { action: "noop", abs, reason: "foreign hook left untouched" };
  }
  return { action: "delete", abs };
}

// ---------------------------------------------------------------------------
// Intent auto-capture
// ---------------------------------------------------------------------------

/**
 * Write a real Intent Contract when none exists in ancestry.
 * Skip with a message when already present (never crash).
 * @returns {{ status: 'wrote'|'skipped'|'failed', message: string, path?: string }}
 */
export function autoCaptureIntent(cwd) {
  const abs = path.join(cwd, ...INTENT_REL.split("/"));

  try {
    if (intentPathEverInAncestry(cwd, "HEAD")) {
      return {
        status: "skipped",
        message:
          `${INTENT_REL} already exists in reachable HEAD ancestry — ` +
          `skipping auto-capture (unsigned local mode allows one freeze per clean lineage).`,
      };
    }
  } catch {
    // ancestry probe failed (no commits etc.) — continue and let baseline fail honestly
  }

  if (existsSync(abs)) {
    return {
      status: "skipped",
      message: `${INTENT_REL} already exists in the worktree — leaving it in place.`,
    };
  }

  const baseRes = resolveInitBaseline(cwd);
  if (!baseRes.ok) {
    return {
      status: "failed",
      message: `intent auto-capture cannot pin baselineCommit: ${baseRes.error}`,
    };
  }

  // Project-tree-wide envelope: match the stated goal ("keep agent changes
  // inside the project tree"). Escapes (.git/**, nested git, gitlink, symlink,
  // absolute/`..` paths) stay fail-closed via structural checks in intent.mjs,
  // not via a JS/TS-shaped allow list that blocks ordinary first commits of
  // main.py / Dockerfile / .github/** / public/* / etc.
  const draft = {
    schemaVersion: 1,
    goal:
      "Invisible-mode auto-capture: keep agent changes inside the project tree until a tighter task contract is frozen on a clean lineage.",
    allow: ["**"],
    deny: [],
    baselineCommit: baseRes.sha,
    acceptanceNotes:
      "Auto-captured by getadvantage init --claude-code / invisible mode. " +
      "Envelope allows every repo-relative path; structural checks still refuse " +
      ".git/**, nested git, gitlinks, symlinks, and path traversal. " +
      "For a tighter envelope, start a branch from a trusted base with no intent history and run intent init.",
  };

  const check = parseAndValidateContract(JSON.stringify(draft));
  if (!check.ok) {
    return { status: "failed", message: `intent auto-capture invalid: ${check.error}` };
  }

  try {
    mkdirSync(path.dirname(abs), { recursive: true });
    const body =
      JSON.stringify(
        {
          schemaVersion: check.contract.schemaVersion,
          goal: check.contract.goal,
          allow: check.contract.allow,
          deny: check.contract.deny,
          baselineCommit: check.contract.baselineCommit,
          acceptanceNotes: check.contract.acceptanceNotes,
        },
        null,
        2,
      ) + "\n";
    atomicWriteFile(abs, body);
  } catch (e) {
    return {
      status: "failed",
      message: `intent auto-capture write failed: ${e && e.message ? e.message : e}`,
    };
  }

  // Freeze as a dedicated commit of ONLY the intent file so the next automatic
  // gate can trust it (uncommitted worktree contracts are fail-closed NO-GO).
  let freezeSha = null;
  try {
    execFileSync("git", ["add", "--", INTENT_REL], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    // --no-verify: this freeze is the bootstrap that makes subsequent gates
    // trustable. Running pre-commit here would deadlock (gate requires the
    // freeze that this commit is creating). Honest one-shot skip.
    execFileSync(
      "git",
      ["commit", "-q", "--no-verify", "-m", "chore: intent contract (invisible-mode auto-capture)"],
      {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
        env: {
          ...process.env,
          // Prefer ambient identity; only fill gaps so commit never fails for name alone.
          GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "getadvantage invisible-mode",
          GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "invisible@getadvantage.local",
          GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "getadvantage invisible-mode",
          GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "invisible@getadvantage.local",
        },
      },
    );
    freezeSha = gitSafe(["rev-parse", "HEAD"], { cwd }) || null;
  } catch (e) {
    // Leave the worktree file; unstage if we only got as far as `git add`.
    try {
      execFileSync("git", ["reset", "-q", "HEAD", "--", INTENT_REL], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      /* ignore */
    }
    const detail = e && e.stderr ? String(e.stderr).trim() : e && e.message ? e.message : String(e);
    return {
      status: "wrote",
      message:
        `wrote ${INTENT_REL} (baseline ${baseRes.sha.slice(0, 12)}) but could not create the freeze commit ` +
        `(${detail}). Run: git add ${INTENT_REL} && git commit --no-verify -m "chore: intent contract"`,
      path: abs,
      freezeFailed: true,
      allow: check.contract.allow,
      deny: check.contract.deny,
      goal: check.contract.goal,
    };
  }

  return {
    status: "wrote",
    message:
      `wrote + froze Intent Contract at ${INTENT_REL} ` +
      `(baseline ${baseRes.sha.slice(0, 12)}` +
      `${freezeSha ? `; freeze ${freezeSha.slice(0, 12)}` : ""})`,
    path: abs,
    freezeSha,
    allow: check.contract.allow,
    deny: check.contract.deny,
    goal: check.contract.goal,
  };
}

// ---------------------------------------------------------------------------
// Install runner + state + receipt
// ---------------------------------------------------------------------------

function installRunnerFiles(cwd) {
  const written = [];
  const hookSrc = path.join(PACKAGE_DIR, HOOK_BASENAME);
  const hookDest = path.join(cwd, ...INSTALLED_HOOK_REL.split("/"));
  mkdirSync(path.dirname(hookDest), { recursive: true });
  // Copy the package runner into the repo so Claude hooks and git hooks share one path.
  copyFileSync(hookSrc, hookDest);
  written.push(INSTALLED_HOOK_REL);

  // Pointer so the installed runner finds this CLI's index.mjs without PATH.
  const indexPath = path.join(PACKAGE_DIR, "index.mjs");
  const pointerAbs = path.join(cwd, ...CLI_POINTER_REL.split("/"));
  atomicWriteFile(pointerAbs, indexPath + "\n");
  written.push(CLI_POINTER_REL);

  return written;
}

function writeState(cwd, state) {
  const abs = path.join(cwd, ...STATE_REL.split("/"));
  atomicWriteFile(abs, JSON.stringify(state, null, 2) + "\n");
  return STATE_REL;
}

function readState(cwd) {
  const abs = path.join(cwd, ...STATE_REL.split("/"));
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(stripBom(readFileSync(abs, "utf8")));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Status (ship blocker 1: hook removal honesty)
// ---------------------------------------------------------------------------

/**
 * Report whether invisible mode is actually gating.
 * If state says installed but hooks are missing → "not gating".
 */
export function invisibleStatus(cwd) {
  const settingsAbs = path.join(cwd, ".claude", "settings.json");
  const runnerAbs = path.join(cwd, ...INSTALLED_HOOK_REL.split("/"));
  const receiptAbs = path.join(cwd, ...RECEIPT_REL.split("/"));
  const state = readState(cwd);

  let settingsHasManaged = false;
  if (existsSync(settingsAbs)) {
    try {
      const raw = readFileSync(settingsAbs, "utf8");
      if (!looksLikeJsoncOrNonStrict(raw)) {
        const j = JSON.parse(stripBom(raw));
        const hooks = j && j.hooks;
        if (hooks && typeof hooks === "object") {
          for (const event of Object.keys(hooks)) {
            if (!Array.isArray(hooks[event])) continue;
            for (const g of hooks[event]) {
              if (groupIsOurs(g)) {
                settingsHasManaged = true;
                break;
              }
            }
          }
        }
      }
    } catch {
      /* treat as missing */
    }
  }

  let gitHasManaged = false;
  const resolved = resolveGitHooksDir(cwd);
  if (resolved.ok) {
    const pre = path.join(resolved.hooksDir, "pre-commit");
    if (existsSync(pre)) {
      try {
        gitHasManaged = isManagedGitHook(readFileSync(pre, "utf8"));
      } catch {
        /* ignore */
      }
    }
  }

  const runnerPresent = existsSync(runnerAbs);
  const receiptPresent = existsSync(receiptAbs);
  const claimedInstalled = !!(state && state.installed);

  // Gating requires at least one live hook path AND the runner.
  const gating = runnerPresent && (settingsHasManaged || gitHasManaged);

  let summary;
  if (gating) {
    summary = "gating";
  } else if (claimedInstalled || receiptPresent || settingsHasManaged || gitHasManaged) {
    // Was installed or residue remains, but not actually enforcing.
    summary = "not gating";
  } else {
    summary = "not installed";
  }

  return {
    summary,
    gating,
    claimedInstalled,
    settingsHasManaged,
    gitHasManaged,
    runnerPresent,
    receiptPresent,
    receiptTampered: receiptPresent
      ? !String(readFileSync(receiptAbs, "utf8")).includes(RECEIPT_HEADER)
      : false,
    state,
  };
}

// ---------------------------------------------------------------------------
// Preflight: repo readiness
// ---------------------------------------------------------------------------

function preflightRepo(cwd) {
  const top = gitSafe(["rev-parse", "--show-toplevel"], { cwd });
  if (!top) {
    return { ok: false, error: "not a git repository — run inside a git repo (git init first)." };
  }
  // Resolve real root (handles worktrees); refuse writing outside.
  const root = path.resolve(top);
  const cwdAbs = path.resolve(cwd);
  // Allow cwd inside root (or equal).
  if (cwdAbs !== root && !cwdAbs.startsWith(root + path.sep)) {
    // Still OK if user passed the worktree path as cwd that IS the toplevel.
  }

  const head = gitSafe(["rev-parse", "--verify", "HEAD"], { cwd: root });
  if (!head) {
    return {
      ok: false,
      error:
        "repository has no commits yet — create an initial commit first, then re-run. " +
        "Next: git add -A && git commit -m \"chore: initial\" && getadvantage init --claude-code",
    };
  }

  // Detached HEAD is fine (CI / worktree).
  // Bare repo: rev-parse --is-bare-repository
  const bare = gitSafe(["rev-parse", "--is-bare-repository"], { cwd: root });
  if (bare === "true") {
    return { ok: false, error: "bare repository — invisible mode needs a work tree." };
  }

  // Gitlink / submodule: if .git is a file, still OK as long as toplevel resolves.
  return { ok: true, root, head };
}

// ---------------------------------------------------------------------------
// Public: install / uninstall / status / CLI entry
// ---------------------------------------------------------------------------

/**
 * Install invisible mode for Claude Code.
 * @returns {number} exit code
 */
export function installClaudeCode(o) {
  const cwdIn = o.cwd;
  const force = !!o.force;

  section("Invisible mode — Claude Code");

  const pf = preflightRepo(cwdIn);
  if (!pf.ok) {
    console.error(c.red(`✗ ${pf.error}`));
    return 1;
  }
  const cwd = pf.root;

  const compat = checkEditorCompatibility(cwd, "claude-code");
  if (!compat.ok) {
    console.error(c.red(`✗ Wrong editor: ${compat.message}`));
    console.error(c.gray(`  Try: ${compat.suggest}`));
    return 1;
  }

  // Idempotent short-circuit when already fully installed and gating.
  const st0 = invisibleStatus(cwd);
  if (st0.gating && st0.settingsHasManaged && st0.runnerPresent && !force) {
    // Still ensure receipt exists.
    try {
      writeReceipt(cwd, { phase: "install-idempotent", verdict: "installed", exitCode: 0 });
    } catch {
      /* ignore */
    }
    console.log(c.green("✓ Invisible mode already installed and gating — nothing changed."));
    console.log(c.gray(`  settings: ${SETTINGS_REL}`));
    console.log(c.gray(`  runner:   ${INSTALLED_HOOK_REL}`));
    console.log(c.gray(`  receipt:  ${RECEIPT_REL}`));
    console.log(c.gray(`  status:   ${binName()} init --invisible-status`));
    console.log(c.gray(`  uninstall:${binName()} init --uninstall-invisible`));
    console.log(c.gray(`  bypass:   ${BYPASS_ENV}=1`));
    return 0;
  }

  // Plan all writes first — fail closed before any mutation when planning fails.
  const settingsPlan = planSettingsWrite(cwd);
  if (settingsPlan.action === "refuse") {
    console.error(c.red(`✗ ${settingsPlan.error}`));
    console.error(c.gray(`  Original ${SETTINGS_REL} left untouched (byte-exact).`));
    return 1;
  }

  const gitPlan = planGitHookInstall(cwd, { force });
  if (gitPlan.action === "refuse" || gitPlan.action === "refuse-foreign") {
    console.error(c.red(`✗ ${gitPlan.error}`));
    if (gitPlan.nextAction) console.error(c.gray(`  ${gitPlan.nextAction}`));
    return 1;
  }
  // husky: continue with Claude settings only; print the line to add.
  const huskySkipGit = gitPlan.action === "refuse-husky";

  const written = [];
  const notes = [];

  try {
    // 1. Runner + CLI pointer (needed by hooks; also by intent freeze path indirectly)
    written.push(...installRunnerFiles(cwd));

    // 2. Intent auto-capture FIRST so the freeze commit exists before git hooks
    //    start enforcing the gate (avoids chicken-and-egg on first install).
    const intent = autoCaptureIntent(cwd);
    if (intent.status === "wrote") {
      written.push(
        INTENT_REL + (intent.freezeSha ? " (auto-captured + freeze commit)" : " (auto-captured)"),
      );
      console.log(c.green(`✓ Intent: ${intent.message}`));
      // Disclose the auto-captured envelope on screen at install time so operators
      // know ordinary project-tree paths are in scope (not a JS/TS-only allow list).
      const allowList = Array.isArray(intent.allow) ? intent.allow : ["**"];
      const denyList = Array.isArray(intent.deny) ? intent.deny : [];
      console.log(c.bold("  Intent envelope (auto-captured)"));
      console.log(c.gray(`  file:  ${INTENT_REL}`));
      console.log(c.gray(`  allow: ${JSON.stringify(allowList)}`));
      console.log(c.gray(`  deny:  ${JSON.stringify(denyList)}`));
      if (intent.goal) console.log(c.gray(`  goal:  ${intent.goal}`));
      console.log(
        c.gray(
          "  scope: every repo-relative path; escapes (.git/**, nested git, gitlink, symlink, absolute/..) stay fail-closed",
        ),
      );
      console.log(c.gray(`  limitation: scope verified; semantic correctness not proven`));
      console.log(
        c.gray(
          `  tighter envelope later: branch from a clean base (no intent history) → ` +
            `${binName()} intent init --goal "…" --allow "src/**" … → ` +
            `git add ${INTENT_REL} && git commit -m "chore: intent contract"`,
        ),
      );
      if (intent.freezeFailed) {
        console.log(
          c.yellow(
            `  Freeze manually: git add ${INTENT_REL} && git commit --no-verify -m "chore: intent contract"`,
          ),
        );
      }
    } else if (intent.status === "skipped") {
      notes.push(intent.message);
      console.log(c.gray(`· Intent: ${intent.message}`));
    } else {
      console.log(c.yellow(`⚠ Intent: ${intent.message}`));
      notes.push(intent.message);
    }

    // 3. settings.json
    if (settingsPlan.action === "create" || settingsPlan.action === "update") {
      atomicWriteFile(settingsPlan.abs, settingsPlan.body);
      written.push(SETTINGS_REL + (settingsPlan.action === "create" ? " (created)" : " (updated)"));
    } else if (settingsPlan.action === "noop") {
      notes.push(`${SETTINGS_REL} already has managed hooks`);
    }

    // 4. git pre-commit (unless husky) — after intent freeze
    if (huskySkipGit) {
      console.log(c.yellow(`⚠ ${gitPlan.error}`));
      console.log(c.gray(`  ${gitPlan.nextAction}`));
      notes.push("git pre-commit skipped (husky)");
    } else if (gitPlan.action === "noop") {
      notes.push("git pre-commit already managed");
    } else if (
      gitPlan.action === "create" ||
      gitPlan.action === "update" ||
      gitPlan.action === "force-replace"
    ) {
      mkdirSync(gitPlan.hooksDir, { recursive: true });
      atomicWriteFile(gitPlan.abs, gitPlan.body);
      try {
        chmodSync(gitPlan.abs, 0o755);
      } catch {
        /* Windows may ignore mode */
      }
      const label =
        gitPlan.action === "force-replace"
          ? "git pre-commit (replaced foreign hook via --force)"
          : gitPlan.action === "update"
            ? "git pre-commit (updated)"
            : "git pre-commit (created)";
      written.push(label);
      if (gitPlan.hooksPathConfig) {
        notes.push(`used core.hooksPath=${gitPlan.hooksPathConfig}`);
      }
    }

    // 5. Receipt + state
    writeReceipt(cwd, { phase: "install", verdict: "installed", exitCode: 0 });
    written.push(RECEIPT_REL);
    writeState(cwd, {
      installed: true,
      editor: "claude-code",
      version: cliVersion(),
      installedAt: new Date().toISOString(),
      managedId: MANAGED_ID,
    });
    written.push(STATE_REL);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const code = e && e.code;
    if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
      console.error(c.red(`✗ permission denied writing invisible-mode files: ${msg}`));
      console.error(c.gray("  No partial install left behind when possible; re-run after fixing permissions."));
    } else {
      console.error(c.red(`✗ install failed: ${msg}`));
    }
    // Best-effort cleanup of runner/pointer if settings never landed — keep simple: report.
    return 1;
  }

  console.log(c.green("✓ Invisible mode installed for Claude Code."));
  for (const w of written) console.log(c.gray(`  wrote ${w}`));
  for (const n of notes) console.log(c.gray(`  · ${n}`));
  console.log("");
  console.log(c.bold("  What runs automatically"));
  console.log(c.gray("  • Claude Code SessionStart / PreToolUse / PostToolUse → gate"));
  if (!huskySkipGit) console.log(c.gray("  • git pre-commit → gate"));
  console.log(c.gray(`  • receipt refreshed at ${RECEIPT_REL} (code-searchable, zero telemetry)`));
  console.log("");
  console.log(c.bold("  Next"));
  console.log(c.gray(`  ${binName()} init --invisible-status   # confirm gating`));
  console.log(c.gray(`  ${BYPASS_ENV}=1                 # deliberate bypass (prints honestly)`));
  console.log(c.gray(`  ${binName()} init --uninstall-invisible`));
  return 0;
}

/**
 * Cursor path: schema unverified → detect-and-refuse.
 */
export function installCursor(o) {
  const cwdIn = o.cwd;
  section("Invisible mode — Cursor");

  const pf = preflightRepo(cwdIn);
  if (!pf.ok) {
    console.error(c.red(`✗ ${pf.error}`));
    return 1;
  }
  const cwd = pf.root;

  const compat = checkEditorCompatibility(cwd, "cursor");
  if (!compat.ok) {
    console.error(c.red(`✗ Wrong editor: ${compat.message}`));
    console.error(c.gray(`  Try: ${compat.suggest}`));
    return 1;
  }

  console.error(
    c.red(
      "✗ Cursor hook schema is not verified on this machine — refusing to invent a config format.",
    ),
  );
  console.error(
    c.gray(
      "  getAdvantage only writes hook configs against a schema read from a real installed surface.",
    ),
  );
  console.error(
    c.gray(
      "  Claude Code is fully supported. Run:",
    ),
  );
  console.error(c.cyan(`    ${binName()} init --claude-code`));
  console.error(
    c.gray(
      "  For Cursor today: use the git pre-commit path after Claude install, or wait for a verified Cursor schema.",
    ),
  );
  // Wrong-editor / detect surface still exercised; exit non-zero.
  return 1;
}

/**
 * Uninstall: remove only what we wrote.
 */
export function uninstallInvisible(o) {
  const cwdIn = o.cwd;
  section("Invisible mode — uninstall");

  let cwd = cwdIn;
  const top = gitSafe(["rev-parse", "--show-toplevel"], { cwd: cwdIn });
  if (top) cwd = path.resolve(top);

  const removed = [];
  const kept = [];

  // settings
  const sp = planSettingsUninstall(cwd);
  if (sp.action === "refuse") {
    console.error(c.red(`✗ ${sp.error}`));
    console.error(c.gray("  settings.json left byte-exact. Remove managed hooks by hand if needed."));
    // Continue with other removals.
    kept.push(SETTINGS_REL + " (untouched — refuse)");
  } else if (sp.action === "delete") {
    safeUnlink(sp.abs);
    removed.push(SETTINGS_REL);
  } else if (sp.action === "update") {
    try {
      atomicWriteFile(sp.abs, sp.body);
      removed.push(SETTINGS_REL + " (managed hooks removed; foreign keys kept)");
    } catch (e) {
      console.error(c.red(`✗ could not update settings: ${e && e.message ? e.message : e}`));
      return 1;
    }
  } else {
    kept.push(SETTINGS_REL + (sp.reason ? ` (${sp.reason})` : ""));
  }

  // git hook
  const gp = planGitHookUninstall(cwd);
  if (gp.action === "delete") {
    safeUnlink(gp.abs);
    removed.push(path.relative(cwd, gp.abs).split(path.sep).join("/") || "pre-commit");
  } else if (gp.reason) {
    kept.push(`git pre-commit (${gp.reason})`);
  }

  // runner + pointer + state + receipt
  for (const rel of [INSTALLED_HOOK_REL, CLI_POINTER_REL, STATE_REL, RECEIPT_REL]) {
    const abs = path.join(cwd, ...rel.split("/"));
    if (existsSync(abs)) {
      safeUnlink(abs);
      removed.push(rel);
    }
  }

  // Intent contract is NOT removed (it may be a freeze the human cares about).
  kept.push(`${INTENT_REL} (left in place — not an install residue)`);

  console.log(c.green("✓ Invisible mode uninstalled."));
  for (const r of removed) console.log(c.gray(`  removed ${r}`));
  for (const k of kept) console.log(c.gray(`  kept ${k}`));
  console.log(c.gray("  Repo works normally; re-install anytime with init --claude-code."));
  return 0;
}

/**
 * Print status. Exit 0 always (informational), unless repo unreadable.
 */
export function printInvisibleStatus(o) {
  const cwdIn = o.cwd;
  section("Invisible mode — status");

  let cwd = cwdIn;
  const top = gitSafe(["rev-parse", "--show-toplevel"], { cwd: cwdIn });
  if (top) cwd = path.resolve(top);

  const st = invisibleStatus(cwd);

  if (st.summary === "gating") {
    console.log(c.green(`✓ status: gating`));
  } else if (st.summary === "not gating") {
    console.log(c.red(`✗ status: not gating`));
    console.log(
      c.gray(
        "  Install claimed or residue present, but the automatic gate is NOT enforcing.",
      ),
    );
    if (st.claimedInstalled && !st.runnerPresent) {
      console.log(c.gray(`  · runner missing: ${INSTALLED_HOOK_REL}`));
    }
    if (st.claimedInstalled && !st.settingsHasManaged && !st.gitHasManaged) {
      console.log(c.gray("  · Claude settings + git pre-commit managed hooks are missing (removed out from under install)."));
    }
    if (st.receiptTampered) {
      console.log(c.gray(`  · receipt at ${RECEIPT_REL} is missing the expected header (hand-edited or corrupt).`));
    }
    console.log(c.gray(`  Re-install: ${binName()} init --claude-code`));
    console.log(c.gray(`  Or uninstall residue: ${binName()} init --uninstall-invisible`));
  } else {
    console.log(c.gray(`· status: not installed`));
    console.log(c.gray(`  Install: ${binName()} init --claude-code`));
  }

  console.log(c.gray(`  settings managed: ${st.settingsHasManaged ? "yes" : "no"}`));
  console.log(c.gray(`  git pre-commit managed: ${st.gitHasManaged ? "yes" : "no"}`));
  console.log(c.gray(`  runner present: ${st.runnerPresent ? "yes" : "no"}`));
  console.log(c.gray(`  receipt present: ${st.receiptPresent ? "yes" : "no"}`));
  console.log(c.gray(`  bypass env: ${BYPASS_ENV}=1`));

  // Ship blocker 1: never claim gating when not.
  return st.gating ? 0 : st.summary === "not installed" ? 0 : 1;
}

/**
 * CLI router for invisible-mode init flags.
 * @returns {number} exit code
 */
export function runInvisible(o) {
  if (o.uninstall) return uninstallInvisible(o);
  if (o.status) return printInvisibleStatus(o);
  if (o.editor === "cursor") return installCursor(o);
  if (o.editor === "claude-code") return installClaudeCode(o);
  console.error(c.red("✗ invisible mode requires --claude-code or --cursor (or --uninstall-invisible / --invisible-status)."));
  return 1;
}
