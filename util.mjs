// Ship-Safe — shared helpers (ANSI color, git wrappers, formatting).
// Node built-ins only. No npm deps.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// Status glyphs. ✓ pass · ⚠ warn · ✗ fail (block) · – skip (not applicable).
export const GLYPH = {
  pass: c.green("✓"),
  warn: c.yellow("⚠"),
  fail: c.red("✗"),
  skip: c.gray("–"),
};

/** A single check result. status ∈ pass|warn|fail|skip. fail ⇒ NO-GO.
 *  skip = the check does not apply on this repo — neutral, never counted as ✓. */
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

/** Run git but never throw — returns "" on any failure (best-effort probes).
 *  Stderr is swallowed so a 0-commit repo's `fatal: your current branch … does
 *  not have any commits yet` never leaks into the CLI UI (finding:
 *  zerocommit-git-fatal-leak). */
export function gitSafe(args, opts = {}) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      cwd: opts.cwd ?? process.cwd(),
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

/** List repo files with `git <args> -z` and return an array of paths.
 *  The `-z` (NUL-terminated) output is CRITICAL: without it, `git ls-files`
 *  octal-escapes and quotes any non-ASCII path (core.quotepath is on by
 *  default), e.g. `"geheime Datei \303\274ber prod.txt"` — which then fails to
 *  open, so the file is silently dropped from the scan (a false GO on any repo
 *  with an umlaut in a filename). `-z` emits raw UTF-8 bytes, unquoted.
 *  Best-effort: returns [] on any failure. */
export function gitFilesZ(args, opts = {}) {
  try {
    const out = execFileSync("git", [...args, "-z"], {
      encoding: "utf8",
      cwd: opts.cwd ?? process.cwd(),
      maxBuffer: 64 * 1024 * 1024,
    });
    return out.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

/** Repo root (absolute). Suppresses git's own stderr noise — the caller
 *  prints ONE clean "not a git repository" line instead. */
export function repoRoot(cwd = process.cwd()) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/** Mask a matched secret to a recognisable fingerprint — NEVER echo the full
 *  value. Mirrors app/lib/safety.ts `fingerprint()`.
 *  Keeps a well-known public prefix intact (sk_live_, ghp_, sk-ant-, …) so the
 *  fingerprint reads instantly, but only when ≥8 chars stay hidden. */
export function fingerprint(match) {
  let head = match.slice(0, 6);
  if (match.length > 14) {
    const pre = match.slice(0, 12).match(/^.+[_-]/);
    if (pre && match.length - pre[0].length >= 8) head = pre[0];
  }
  const tail = match.length > 14 ? match.slice(-4) : "";
  return `${head}…${tail} (${match.length} chars)`;
}

/** Pluralization suffix: `${n} issue${pl(n)}` → "1 issue" / "2 issues". */
export function pl(n) {
  return n === 1 ? "" : "s";
}

/** Section header. */
export function section(title) {
  console.log("\n" + c.bold(c.cyan(title)));
}

// --- JSON file reading (BOM-tolerant) ----------------------------------------

/** Strip a leading UTF-8 BOM. PowerShell writes UTF-8 files WITH a BOM by
 *  default, and JSON.parse rejects it — so every JSON/config file read must
 *  strip it first or a Windows-authored package.json silently "doesn't parse"
 *  (which once turned a Node project into a "generic repo" and skipped the
 *  build gate — a false GO). */
export function stripBom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Read + parse a JSON file, BOM-tolerant. Distinguishes "no file" from
 * "file exists but could not be parsed" so callers can be honest about which
 * it is (never claim "(no package.json)" when the file is merely broken).
 * @returns {{ exists: boolean, ok: boolean, json: any, error: Error|null }}
 */
export function readJsonFile(abs) {
  let raw;
  try {
    raw = readFileSync(abs, "utf8");
  } catch {
    return { exists: existsSync(abs), ok: false, json: null, error: null };
  }
  try {
    return { exists: true, ok: true, json: JSON.parse(stripBom(raw)), error: null };
  } catch (e) {
    return { exists: true, ok: false, json: null, error: e };
  }
}

// --- self-identity (which bin was invoked; own version) ----------------------

const UTIL_DIR = path.dirname(fileURLToPath(import.meta.url));

/** The binary name the user actually invoked (`getadvantage` or the legacy
 *  `ship-safe` alias), for use in every printed hint/example — an npx
 *  getadvantage user does NOT have `ship-safe` on PATH, so hints must never
 *  hardcode it. Falls back to "getadvantage" (e.g. direct `node index.mjs`). */
export function binName() {
  const base = path.basename(process.argv[1] || "").replace(/\.(mjs|cjs|js|cmd|ps1)$/i, "");
  return base === "ship-safe" ? "ship-safe" : "getadvantage";
}

/** This CLI's own version, read from the package.json shipped next to it. */
export function cliVersion() {
  const r = readJsonFile(path.join(UTIL_DIR, "package.json"));
  return r.ok && typeof r.json.version === "string" ? r.json.version : "0.0.0";
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
