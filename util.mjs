// Ship-Safe — shared helpers (ANSI color, git wrappers, formatting).
// Node built-ins only. No npm deps.

import { createHash } from "node:crypto";
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
 *  where a leading space in the XY status field is meaningful.
 *
 *  Stderr is captured (not inherited) so a missing-path probe never streams a
 *  `fatal: path '…' does not exist in '<commit>'` storm into the CLI UI.
 *  Callers that need the failure reason still get it on the thrown error. */
export function gitRaw(args, opts = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    cwd: opts.cwd ?? process.cwd(),
    // git can emit a lot on a large diff; give it room.
    maxBuffer: 64 * 1024 * 1024,
    // Capture stderr so missing-blob probes never print raw git fatals.
    // (Default stdio inherits stderr — that is what caused the dogfood storm.)
    stdio: ["ignore", "pipe", "pipe"],
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

/**
 * Read a path's blob from the git index (staged / tracked content), not the
 * working tree. Used for policy authorization so unstaged edits cannot
 * suppress secrets while the path is still "in the index".
 * @param {string} cwd
 * @param {string} rel repo-relative path (forward slashes preferred)
 * @returns {string|null} file text, or null if missing / not in index
 */
export function readGitIndexText(cwd, rel) {
  const want = String(rel || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  if (!want) return null;
  try {
    // Do not trim — policy JSON must match the staged blob exactly for
    // worktree-diff disclosure; trailing newline is part of the blob.
    return execFileSync("git", ["show", `:${want}`], {
      encoding: "utf8",
      cwd: cwd ?? process.cwd(),
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
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
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Classify the git status of a working directory without letting git's own
 * fatal: noise reach the user. Presentation strings stay in the caller
 * (index.mjs); this helper is reusable detection only.
 *
 * @param {string} [cwd]
 * @returns {{ kind: "worktree", root: string } | { kind: "bare" } | { kind: "non-git" }}
 */
export function classifyGitCwd(cwd = process.cwd()) {
  // Bare first: --show-toplevel fails on bare (no work tree), while
  // --is-bare-repository returns "true". Checking bare before toplevel
  // keeps the two failure modes distinguishable.
  try {
    const bare = execFileSync("git", ["rev-parse", "--is-bare-repository"], {
      encoding: "utf8",
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (bare === "true") return { kind: "bare" };
  } catch {
    // Not a git directory, or git unavailable — fall through.
  }

  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (root) return { kind: "worktree", root };
  } catch {
    // Not a work tree.
  }

  return { kind: "non-git" };
}

/** True when `cwd` is a bare git repository (no working tree). */
export function isBareRepository(cwd = process.cwd()) {
  return classifyGitCwd(cwd).kind === "bare";
}

/** Repo root (absolute). Suppresses git's own stderr noise — the caller
 *  prints ONE clean guidance line instead. Throws for bare and non-git
 *  (use `classifyGitCwd` when those must be distinguished). */
export function repoRoot(cwd = process.cwd()) {
  const cls = classifyGitCwd(cwd);
  if (cls.kind === "worktree") return cls.root;
  const err = new Error(
    cls.kind === "bare" ? "bare repository" : "not a git repository",
  );
  err.code = cls.kind;
  throw err;
}

/**
 * Normalize matched secret text before identity / display-length computation.
 * CRLF and lone CR both collapse to LF so the same secret yields the same
 * `auth` id and `(N chars)` on Windows and Linux working trees.
 * Used by both `fingerprint` and `secretAuthId` so the two cannot drift.
 * @param {string} match
 * @returns {string}
 */
export function normalizeSecretMatchText(match) {
  return String(match ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Mask a matched secret to a recognisable fingerprint — NEVER echo the full
 *  value. Mirrors app/lib/safety.ts `fingerprint()`.
 *  Keeps a well-known public prefix intact (sk_live_, ghp_, sk-ant-, …) so the
 *  fingerprint reads instantly, but only when ≥8 chars stay hidden.
 *
 *  DISPLAY ONLY. Do not use this string as an allowlist authorization identity —
 *  distinct secrets can share the same prefix/tail/length form. Use
 *  `secretAuthId()` for policy matching. */
export function fingerprint(match) {
  const text = normalizeSecretMatchText(match);
  let head = text.slice(0, 6);
  if (text.length > 14) {
    const pre = text.slice(0, 12).match(/^.+[_-]/);
    if (pre && text.length - pre[0].length >= 8) head = pre[0];
  }
  const tail = text.length > 14 ? text.slice(-4) : "";
  return `${head}…${tail} (${text.length} chars)`;
}

/**
 * Collision-resistant authorization identity for a secret match.
 * SHA-256 hex of the line-ending-normalised match bytes (UTF-8). Safe to print
 * and to store in repo policy (`secrets.ignore.hashes` / legacy `fingerprints`
 * field when the entry is a full digest). Never confusable with the display
 * fingerprint. Line endings are normalised so Windows CRLF and Linux LF trees
 * produce the same allowlist id for the same secret.
 * @param {string} match
 * @returns {string} 64-char lowercase hex
 */
export function secretAuthId(match) {
  return createHash("sha256").update(normalizeSecretMatchText(match), "utf8").digest("hex");
}

/** Pluralization suffix: `${n} issue${pl(n)}` → "1 issue" / "2 issues". */
export function pl(n) {
  return n === 1 ? "" : "s";
}

/**
 * Exact env keys that must never reach project-controlled child processes
 * (local TypeScript, npm build scripts, or any untrusted repo binary).
 * GitHub tokens stay in the trusted Action parent only.
 */
export const CREDENTIAL_ENV_KEYS = Object.freeze([
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_URL",
  "ACTIONS_RUNTIME_TOKEN",
  "ACTIONS_RUNTIME_URL",
  "ACTIONS_RESULTS_URL",
  "ACTIONS_CACHE_URL",
  "GETADVANTAGE_API_KEY",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "NPM_AUTH_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SESSION_TOKEN",
  "AWS_SECURITY_TOKEN",
  "AZURE_CLIENT_SECRET",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "DATABASE_URL",
  "MYSQL_URL",
  "POSTGRES_URL",
  "POSTGRESQL_URL",
  "MONGODB_URI",
  "MONGO_URL",
  "REDIS_URL",
  "REDIS_PASSWORD",
  "CONNECTION_STRING",
  "PGPASSWORD",
  "MYSQL_PWD",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_API_KEY",
]);

/**
 * True when an env key name is credential-shaped (token / secret / password /
 * API key / OIDC / DB / cookie / session material). Never matches PATH or
 * normal tool-resolution keys.
 */
export function isCredentialEnvKey(name) {
  const k = String(name || "");
  if (!k) return false;
  // Tool resolution — never scrub.
  if (/^PATH$/i.test(k) || /^PATHEXT$/i.test(k)) return false;
  if (/^(SystemRoot|SYSTEMROOT|COMSPEC|ComSpec|WINDIR|windir)$/i.test(k)) return false;
  if (/^(HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|TMP|TEMP|TMPDIR|PWD|OLDPWD|SHELL|USER|USERNAME|LOGNAME)$/i.test(k)) {
    return false;
  }
  if (/^(LANG|LC_|TERM|COLORTERM|NO_COLOR|FORCE_COLOR|CI|NODE_ENV|NODE_PATH|TZ)/i.test(k)) return false;
  if (k === "INIT_CWD" || k === "npm_node_execpath" || k === "npm_execpath") return false;
  if (/^npm_package_/i.test(k) || /^npm_lifecycle_/i.test(k)) return false;
  if (/^npm_config_/i.test(k)) {
    return /auth|token|password|secret|_otp|email|_key/i.test(k);
  }
  if (CREDENTIAL_ENV_KEYS.includes(k)) return true;
  // GitHub Actions OIDC / runtime surfaces
  if (/^ACTIONS_(ID_TOKEN|RUNTIME|RESULTS|CACHE)/i.test(k)) return true;
  if (/^ACTIONS_/i.test(k) && /TOKEN|SECRET|PASSWORD|OIDC|AUTHORIZATION/i.test(k)) return true;
  // GitHub context: keep non-secret GITHUB_* (SHA, REF, WORKSPACE…); drop tokens.
  if (/^GITHUB_/i.test(k)) {
    return /TOKEN|SECRET|PASSWORD|AUTHORIZATION|JWT|OIDC|APP_TOKEN|PAT|PRIVATE/i.test(k);
  }
  // getAdvantage reporting + API + Action-only SARIF attribution nonce
  // (none of these belong in project tsc/build / npm install children).
  if (/^GETADVANTAGE_(API_KEY|TOKEN|SECRET|REPORT|SARIF_RUN_NONCE)/i.test(k)) return true;
  if (/^INPUT_GETADVANTAGE_/i.test(k)) return true;
  // npm / registry auth
  if (/^NPM_/i.test(k) && /TOKEN|AUTH|PASSWORD|SECRET/i.test(k)) return true;
  // DB / cloud connection strings by prefix
  if (/^(DATABASE|MYSQL|POSTGRES|MONGO|REDIS|DB)_/i.test(k) && /URL|URI|PASSWORD|PASS|AUTH|SECRET/i.test(k)) {
    return true;
  }
  // Generic high-risk names (token/secret/password/private-key/cookie/session/…)
  if (
    /(_|^)(TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_?KEY|API_?KEY|APIKEY|ACCESS_?KEY|AUTH_?TOKEN|CREDENTIALS?|SESSION_?SECRET|COOKIE|JWT|BEARER)S?$/i.test(
      k,
    )
  ) {
    if (/^GITHUB_ACTIONS$/i.test(k)) return false;
    return true;
  }
  return false;
}

/**
 * Copy `env` with all credential-shaped keys removed.
 * Use for every project-controlled subprocess (tsc, npm run build, …).
 * The trusted Action parent retains GITHUB_TOKEN for PR comments only.
 *
 * @param {NodeJS.ProcessEnv|Record<string,string|undefined>} [env]
 * @param {{ keep?: string[] }} [opts] exact keys to retain (e.g. report key in trusted CLI only)
 * @returns {Record<string,string>}
 */
export function scrubCredentialEnv(env = process.env, opts = {}) {
  const keep = new Set((opts.keep || []).map(String));
  const out = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (v == null) continue;
    if (keep.has(k)) {
      out[k] = String(v);
      continue;
    }
    if (isCredentialEnvKey(k)) continue;
    out[k] = String(v);
  }
  return out;
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
//     printed via console.log (user-facing guidance is not an error). Under
//     --json, that note only stays off the machine channel when a command
//     entry has already installed routeHumanOutputToStderr() — map / check /
//     intent / fan-in / architecture at their handler starts. The pre-command
//     git-classify early exits in index.mjs install the same route on their
//     --json bare/non-git branches before printing, then exit with no JSON
//     document (stdout empty; guidance on stderr). Worktree success still
//     leaves routing to those five command sites.

export const MARKER_DIR = ".getadvantage";
export const LEGACY_MARKER_DIR = ".ship-safe";

let legacyMarkerNoteShown = false;
function noteLegacyMarkerDir() {
  if (legacyMarkerNoteShown) return;
  legacyMarkerNoteShown = true;
  console.log(
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
