// Ship-Safe — shared helpers (ANSI color, git wrappers, formatting).
// Node built-ins only. No npm deps.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// --- ANSI color, degrading gracefully ---------------------------------------
// Honour NO_COLOR (https://no-color.org/) and a non-TTY stdout (piped/redirected),
// so the output stays clean when captured to a file.
const COLOR_ON =
  !process.env.NO_COLOR &&
  process.env.TERM !== "dumb" &&
  (process.stdout.isTTY ?? false);

function wrap(code) {
  return (s) => (COLOR_ON ? `[${code}m${s}[0m` : String(s));
}

export const c = {
  green: wrap("32"),
  yellow: wrap("33"),
  red: wrap("31"),
  cyan: wrap("36"),
  gray: wrap("90"),
  bold: wrap("1"),
  dim: wrap("2"),
};

// Status glyphs. ✓ pass · ⚠ warn · ✗ fail (block).
export const GLYPH = {
  pass: c.green("✓"),
  warn: c.yellow("⚠"),
  fail: c.red("✗"),
};

/** A single check result. status ∈ pass|warn|fail. fail ⇒ NO-GO. */
export function result(status, label, detail, extra = []) {
  return { status, label, detail, extra };
}

/** Print one check line + any indented extra lines. */
export function printResult(r) {
  console.log(`  ${GLYPH[r.status]} ${c.bold(r.label)} — ${r.detail}`);
  for (const line of r.extra) console.log(`      ${c.gray(line)}`);
}

// --- git helpers (synchronous; the CLI is short-lived) ----------------------

/** Run a git command, returning trimmed stdout. Throws on non-zero exit.
 *  NOTE: trims — do NOT use for `status --porcelain`, whose leading status
 *  columns are space-significant (use gitRaw for that). */
export function git(args, opts = {}) {
  return gitRaw(args, opts).trim();
}

/** Like git() but returns stdout UNtrimmed — required for porcelain parsing
 *  where a leading space in the XY status field is meaningful. */
export function gitRaw(args, opts = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    cwd: opts.cwd ?? process.cwd(),
    // git can emit a lot on a large diff; give it room.
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Run git but never throw — returns "" on any failure (best-effort probes). */
export function gitSafe(args, opts = {}) {
  try {
    return git(args, opts);
  } catch {
    return "";
  }
}

/** Repo root (absolute). */
export function repoRoot(cwd = process.cwd()) {
  return git(["rev-parse", "--show-toplevel"], { cwd });
}

/** Mask a matched secret to a recognisable fingerprint — NEVER echo the full
 *  value. Mirrors app/lib/safety.ts `fingerprint()`. */
export function fingerprint(match) {
  const head = match.slice(0, 6);
  const tail = match.length > 14 ? match.slice(-4) : "";
  return `${head}…${tail} (${match.length} chars)`;
}

/** Section header. */
export function section(title) {
  console.log("\n" + c.bold(c.cyan(title)));
}

// --- filesystem walk (read-only) --------------------------------------------

/** Directories we never descend into when walking the tree for source scans. */
const WALK_SKIP_DIR = new Set([
  ".git", "node_modules", ".next", ".vercel", ".data", "dist", "build", "coverage", ".turbo",
]);

/**
 * Recursively collect file paths under `dir`, skipping vendored/generated dirs.
 * Returns ABSOLUTE paths. Never throws on an unreadable entry (best-effort).
 * @param {string} dir            absolute directory to walk
 * @param {(rel: string) => boolean} [keep]  optional filter on the path's basename+ext
 */
export function walkFiles(dir, keep) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (WALK_SKIP_DIR.has(ent.name)) continue;
      out.push(...walkFiles(abs, keep));
    } else if (ent.isFile()) {
      if (!keep || keep(abs)) out.push(abs);
    }
  }
  return out;
}

/** Read a UTF-8 text file, returning "" on any error (best-effort probe). */
export function readText(abs) {
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > 4_000_000) return "";
    return readFileSync(abs, "utf8");
  } catch {
    return "";
  }
}

/** Forward-slash a path and make it relative to the repo root for display. */
export function relPath(abs, cwd) {
  return path.relative(cwd, abs).split(path.sep).join("/");
}

// --- the marker directory (.getadvantage/, with .ship-safe/ back-compat) ----
// The CLI keeps its small machine-readable state (brief.json, handoff.json,
// ledger.md) in ONE repo-resident dir. It was `.ship-safe/` historically;
// renamed to `.getadvantage/` to match the product. Back-compat contract:
//   • WRITES always go to .getadvantage/ (created on demand).
//   • READS prefer .getadvantage/<file>, falling back to .ship-safe/<file>
//     (per file, so a half-migrated repo never silently loses history).
//   • When the legacy dir is still being read, a one-time migration note is
//     printed to stderr (stderr so it can never pollute --json stdout).

export const MARKER_DIR = ".getadvantage";
export const LEGACY_MARKER_DIR = ".ship-safe";

let legacyMarkerNoteShown = false;
function noteLegacyMarkerDir() {
  if (legacyMarkerNoteShown) return;
  legacyMarkerNoteShown = true;
  console.error(
    c.gray(
      `  (Found legacy ${LEGACY_MARKER_DIR}/ state — still readable, but new state now writes to ` +
        `${MARKER_DIR}/. Move or delete ${LEGACY_MARKER_DIR}/ whenever convenient.)`,
    ),
  );
}

/** Absolute path to READ a marker file from: `.getadvantage/<file>` when present,
 *  else the legacy `.ship-safe/<file>` (with a one-time migration note), else the
 *  canonical (absent) new path — callers already handle a missing file. */
export function markerFileForRead(cwd, file) {
  const newAbs = path.join(cwd, MARKER_DIR, file);
  if (existsSync(newAbs)) return newAbs;
  const oldAbs = path.join(cwd, LEGACY_MARKER_DIR, file);
  if (existsSync(oldAbs)) {
    noteLegacyMarkerDir();
    return oldAbs;
  }
  return newAbs;
}

/** Absolute path to WRITE a marker file to — always `.getadvantage/<file>`,
 *  creating the directory if needed. */
export function markerFileForWrite(cwd, file) {
  const dir = path.join(cwd, MARKER_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path.join(dir, file);
}
