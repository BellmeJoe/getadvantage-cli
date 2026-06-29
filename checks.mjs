// Ship-Safe — the read-only pre-deploy checks.
//
// Every check returns a `result(status, label, detail, extra)`:
//   pass (✓) · warn (⚠) · fail (✗ → NO-GO).
// Nothing here mutates the repo. The secret patterns + dirty-tree reasoning are
// lifted from getAdvantage's own conventions (CLAUDE.md hard-rule #2 and
// app/lib/safety.ts) so the gate matches what the project already enforces.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { result, fingerprint, git, gitRaw, gitSafe } from "./util.mjs";
import { detectProject } from "./detect.mjs";

// ===========================================================================
// a. DIRTY-TREE GUARD
// ===========================================================================
// `vercel --prod` ships the WORKING TREE, not a commit — so any tracked,
// modified/staged file (possibly another concurrent session's uncommitted
// work) would ship live. BLOCK on tracked changes; WARN on untracked (often
// scratch). This is the single biggest known foot-gun in this repo.
export function checkDirtyTree(cwd) {
  // gitRaw (NOT git) — porcelain's leading status columns are space-significant,
  // so we must not trim the output before parsing.
  const porcelain = gitRaw(["status", "--porcelain"], { cwd });
  if (!porcelain.trim()) {
    return result("pass", "Dirty-tree guard", "Working tree is clean — nothing unintended would ship.");
  }

  const lines = porcelain.split("\n").filter((l) => l.length > 0);
  const tracked = []; // modified / staged / renamed / deleted tracked files
  const untracked = []; // ?? — new files git isn't tracking yet

  for (const line of lines) {
    // Porcelain v1: XY<space>path  (X=staged, Y=worktree). "??" = untracked.
    const xy = line.slice(0, 2);
    const file = line.slice(3);
    if (xy === "??") untracked.push(file);
    else tracked.push(`${xy.trim() || xy} ${file}`);
  }

  if (tracked.length > 0) {
    return result(
      "fail",
      "Dirty-tree guard",
      `${tracked.length} tracked file(s) modified/staged — a 'vercel --prod' would ship this unintended work.`,
      [
        ...tracked.slice(0, 20).map((t) => t),
        ...(tracked.length > 20 ? [`…and ${tracked.length - 20} more`] : []),
        "Commit, stash, or revert before shipping. Deploy from a clean detached worktree of the intended commit.",
      ],
    );
  }

  // Only untracked files → warn, list them (they're usually scratch/logs).
  return result(
    "warn",
    "Dirty-tree guard",
    `${untracked.length} untracked file(s) present (not tracked — likely scratch, but confirm they shouldn't ship).`,
    [
      ...untracked.slice(0, 20),
      ...(untracked.length > 20 ? [`…and ${untracked.length - 20} more`] : []),
    ],
  );
}

// ===========================================================================
// b. SECRET SCAN
// ===========================================================================
// What we scan for: OpenAI sk-, Stripe sk_live_/rk_live_, Stripe webhook whsec_,
// Vercel vcp_, KV/Redis REST creds, AWS AKIA, GitHub PATs (classic +
// fine-grained), Google OAuth, Slack, SendGrid, "Bearer <token>" literals, and
// private-key blocks.
// A match BLOCKS (✗); we print the file + a masked FINGERPRINT, never the
// full secret. Binary/lockfiles/node_modules/.git are skipped.

const SECRET_PATTERNS = [
  // --- common provider key formats ---
  { id: "openai", label: "OpenAI secret key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { id: "stripe-live", label: "Stripe live secret key", re: /\bsk_live_[A-Za-z0-9]{20,}/ },
  { id: "stripe-restricted", label: "Stripe restricted key", re: /\brk_live_[A-Za-z0-9]{20,}/ },
  { id: "aws", label: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-pat", label: "GitHub personal access token", re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { id: "github-fine", label: "GitHub fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { id: "google-oauth", label: "Google OAuth secret", re: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/ },
  { id: "slack", label: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "private-key", label: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: "sendgrid", label: "SendGrid key", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/ },
  // --- deploy / CI secrets ---
  { id: "stripe-webhook", label: "Stripe webhook secret (whsec_)", re: /\bwhsec_[A-Za-z0-9]{20,}/ },
  { id: "vercel-token", label: "Vercel token (vcp_)", re: /\bvcp_[A-Za-z0-9]{20,}/ },
  { id: "kv-rest", label: "KV/Redis REST credential", re: /\bKV_REST_API_(?:URL|TOKEN|READ_ONLY_TOKEN)\s*=\s*\S+/ },
  // "Bearer <token>" literal — a common tell for a leaked credential. We capture
  // the token and only flag it if it LOOKS like a real
  // credential (mixed case + a digit, ≥20 chars) — so legitimate test fixtures
  // and placeholders like `Bearer test_cron_secret...` or `Bearer ${token}`
  // don't trip a false NO-GO. The `validate` predicate runs on the captured group.
  {
    id: "bearer",
    label: "Bearer auth token literal",
    re: /\bBearer\s+([A-Za-z0-9_\-.]{20,})/,
    validate: (tok) => /[a-z]/.test(tok) && /[A-Z]/.test(tok) && /[0-9]/.test(tok),
  },
];

// Files we never scan (binary-ish, generated, vendored, or the env files that
// are gitignored by design and legitimately hold secrets locally).
const SKIP_DIR = new Set([".git", "node_modules", ".next", ".vercel", ".data", "dist", "build", "coverage"]);
const SKIP_BASENAME = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".env",
  ".env.local",
  ".env.development.local",
  ".env.production.local",
]);
const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".pdf",
  ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".webm", ".zip", ".gz",
  ".lock", ".map",
]);

const MAX_FILE_BYTES = 2_000_000; // skip very large files (same cap as safety.ts corpus)

/** Heuristic: does this buffer look binary? (null byte in the first 4KB) */
function looksBinary(buf) {
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Files to scan: tracked + staged + (added) untracked-but-not-ignored, deduped.
 *  We deliberately DON'T scan gitignored files (the local .env lives there and
 *  is supposed to hold secrets). */
function filesToScan(cwd) {
  const set = new Set();
  // Tracked files.
  for (const f of gitSafe(["ls-files"], { cwd }).split("\n")) if (f) set.add(f);
  // Untracked-but-not-ignored (new files a dev created; --others honours .gitignore).
  for (const f of gitSafe(["ls-files", "--others", "--exclude-standard"], { cwd }).split("\n")) if (f) set.add(f);
  return [...set];
}

export function checkSecrets(cwd) {
  const files = filesToScan(cwd);
  const hits = []; // { file, label, fp }

  for (const rel of files) {
    const base = path.basename(rel);
    const ext = path.extname(rel).toLowerCase();
    if (SKIP_BASENAME.has(base)) continue;
    if (SKIP_EXT.has(ext)) continue;
    // Skip anything inside a skipped directory.
    if (rel.split(/[\\/]/).some((seg) => SKIP_DIR.has(seg))) continue;

    const abs = path.join(cwd, rel);
    let buf;
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      buf = readFileSync(abs);
    } catch {
      continue; // unreadable / deleted-but-staged etc.
    }
    if (looksBinary(buf)) continue;
    const text = buf.toString("utf8");

    for (const p of SECRET_PATTERNS) {
      const m = text.match(p.re);
      if (!m) continue;
      // If the pattern has a capture group + validator (e.g. Bearer), apply the
      // validator to the captured token so test fixtures/placeholders don't trip.
      const token = m[1] ?? m[0];
      if (p.validate && !p.validate(token)) continue;
      hits.push({ file: rel, label: p.label, fp: fingerprint(token) });
    }
  }

  if (hits.length === 0) {
    return result(
      "pass",
      "Secret scan",
      `Scanned ${files.length} tracked/staged file(s) — no leaked-secret patterns matched.`,
    );
  }

  // De-dupe identical (file,label) pairs for a tidy report.
  const seen = new Set();
  const lines = [];
  for (const h of hits) {
    const k = `${h.file}::${h.label}`;
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(`${h.file} → ${h.label}: ${h.fp}`);
  }
  return result(
    "fail",
    "Secret scan",
    `${lines.length} possible secret(s) in committed/staged files — remove + rotate before shipping.`,
    lines.slice(0, 30),
  );
}

// ===========================================================================
// c. BUILD + TYPECHECK
// ===========================================================================
// Default: `npx tsc --noEmit` (fast). `--build` also runs `npm run build`.
// BLOCK on either failing; print the tail of the output so the founder sees
// the actual error without scrollback.

function runCapture(cmd, args, cwd) {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
      // On Windows npx/tsc are .cmd shims — shell:true lets them resolve.
      shell: process.platform === "win32",
    });
    return { ok: true, out };
  } catch (e) {
    const out = `${e.stdout || ""}${e.stderr || ""}`.trim();
    return { ok: false, out: out || String(e.message || e) };
  }
}

function tail(text, n = 25) {
  const lines = text.split("\n").filter(Boolean);
  return lines.slice(-n);
}

export function checkTypecheck(cwd, project = null) {
  const p = project || detectProject(cwd);

  // Only run tsc on a repo that is actually typecheckable: a tsconfig.json AND a
  // `typescript` dependency. On a plain-Node repo, blindly running `npx tsc`
  // would download TypeScript and either fail (no config) or flag JS files —
  // a FALSE NO-GO. Degrade to a clearly-labelled skip instead.
  if (!p.typecheckable) {
    const why = !p.hasTsConfig && !p.hasTypeScript
      ? "no tsconfig.json and no typescript dependency"
      : !p.hasTsConfig
        ? "no tsconfig.json"
        : "typescript is not a dependency";
    return result(
      "pass",
      "Typecheck",
      `Skipped — this is a ${p.label} (${why}). Nothing to typecheck.`,
    );
  }

  const r = runCapture("npx", ["--yes", "tsc", "--noEmit"], cwd);
  if (r.ok) {
    return result("pass", "Typecheck (tsc --noEmit)", "TypeScript compiled with no type errors.");
  }
  return result(
    "fail",
    "Typecheck (tsc --noEmit)",
    "tsc reported type errors — fix them before shipping.",
    tail(r.out, 25),
  );
}

// Run the project's OWN `build` script (whatever it is — Next, Vite, tsc -b, a
// plain `node build.js`). We don't assume Next.js. If there is no build script,
// that's not a failure — many libraries/CLIs have nothing to build — so we skip
// honestly rather than invent a NO-GO.
export function checkBuild(cwd, project = null) {
  const p = project || detectProject(cwd);

  if (!p.hasBuildScript) {
    return result(
      "pass",
      "Build",
      `Skipped — no "build" script in package.json${p.hasPackageJson ? "" : " (no package.json)"}. Nothing to build.`,
    );
  }

  const r = runCapture("npm", ["run", "build"], cwd);
  if (r.ok) {
    return result("pass", `Production build (npm run build)`, `\`${p.buildCmd}\` completed successfully.`);
  }
  return result(
    "fail",
    "Production build (npm run build)",
    "The build failed — fix it before shipping.",
    tail(r.out, 30),
  );
}

// ===========================================================================
// d. SCHEMA-BUMP CHECK
// ===========================================================================
// db.ts uses a SCHEMA_VERSION sentinel: additive DDL is SKIPPED on an existing
// prod DB whose stored version is already >= SCHEMA_VERSION. So a DDL change
// that forgets to bump SCHEMA_VERSION builds + passes every proof on a fresh
// PGlite DB, then silently no-ops in prod. We diff db.ts (committed vs the
// merge-base with main, PLUS any uncommitted edits): if DDL-ish lines changed
// but the `const SCHEMA_VERSION = N;` line did NOT, WARN loudly.

const DDL_RE = /\b(CREATE\s+TABLE|ADD\s+COLUMN|ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+(?:TABLE|COLUMN|INDEX))\b/i;
const VERSION_RE = /SCHEMA_VERSION\s*=\s*\d+/;

export function checkSchemaBump(cwd, baseRef = "main", project = null) {
  const p = project || detectProject(cwd);

  // This check is specific to the SCHEMA_VERSION-sentinel pattern (a db file
  // whose additive DDL is gated behind a version constant). A repo that doesn't
  // use that pattern can't have this bug, so asserting it there would be a
  // false signal. Skip honestly when the pattern isn't present.
  if (!p.hasSchemaVersionPattern) {
    return result(
      "pass",
      "Schema-bump check",
      "Skipped — no SCHEMA_VERSION-sentinel db file in this repo (pattern doesn't apply).",
    );
  }
  const DB_PATH = p.schemaDbPath;

  // Combined diff = (merge-base…HEAD committed) + (working-tree uncommitted).
  // Use `git diff base...HEAD` for the committed delta on this lane, then a
  // plain `git diff HEAD` for anything not yet committed. We never EDIT db.ts —
  // this only READS the diff.
  const haveBase = !!gitSafe(["rev-parse", "--verify", "--quiet", baseRef], { cwd });
  let committedDiff = "";
  if (haveBase) {
    // base...HEAD = changes on HEAD since it diverged from base (symmetric range).
    committedDiff = gitSafe(["diff", `${baseRef}...HEAD`, "--", DB_PATH], { cwd });
  }
  const uncommittedDiff = gitSafe(["diff", "HEAD", "--", DB_PATH], { cwd });
  const combined = `${committedDiff}\n${uncommittedDiff}`;

  // Only consider ADDED/REMOVED lines (diff bodies, prefixed +/-), not context.
  const changedLines = combined
    .split("\n")
    .filter((l) => /^[+-]/.test(l) && !/^[+-]{3}\s/.test(l)); // skip +++/--- headers

  if (changedLines.length === 0) {
    if (!haveBase) {
      return result(
        "pass",
        "Schema-bump check",
        `No changes to ${DB_PATH} in the working tree (base ref '${baseRef}' not found, so the committed lane delta was skipped).`,
      );
    }
    return result("pass", "Schema-bump check", `No changes to ${DB_PATH} vs ${baseRef}.`);
  }

  const ddlChanged = changedLines.some((l) => DDL_RE.test(l));
  const versionChanged = changedLines.some((l) => VERSION_RE.test(l));

  if (ddlChanged && !versionChanged) {
    return result(
      "warn",
      "Schema-bump check",
      `${DB_PATH} has DDL-ish changes but SCHEMA_VERSION was NOT bumped.`,
      [
        "Additive DDL (CREATE TABLE / ADD COLUMN / ALTER / CREATE INDEX) is SKIPPED on an existing prod DB",
        "whose stored version already matches — so it builds + passes proofs on fresh PGlite, then silently",
        "no-ops in prod. Bump `const SCHEMA_VERSION` (and coordinate the migration). See the schema-version memory.",
        ...changedLines.filter((l) => DDL_RE.test(l)).slice(0, 6).map((l) => l.trim()),
      ],
    );
  }

  if (ddlChanged && versionChanged) {
    return result("pass", "Schema-bump check", `${DB_PATH} changed DDL and SCHEMA_VERSION was bumped alongside it.`);
  }

  return result("pass", "Schema-bump check", `${DB_PATH} changed but no DDL-shaped statements were touched.`);
}
