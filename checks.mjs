// Ship-Safe — the read-only pre-deploy checks.
//
// Every check returns a `result(status, label, detail, extra)`:
//   pass (✓) · warn (⚠) · fail (✗ → NO-GO).
// Nothing here mutates the repo. The secret patterns + dirty-tree reasoning are
// lifted from getAdvantage's own conventions (CLAUDE.md hard-rule #2 and
// app/lib/safety.ts) so the gate matches what the project already enforces.

import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { result, fingerprint, git, gitRaw, gitSafe, gitFilesZ, pl } from "./util.mjs";
import { detectProject } from "./detect.mjs";
import { loadPolicy, secretAllowDecision } from "./policy.mjs";

// ===========================================================================
// a. DIRTY-TREE GUARD
// ===========================================================================
// `vercel --prod` ships the WORKING TREE, not a commit — so any tracked,
// modified/staged file (possibly another concurrent session's uncommitted
// work) would ship live. BLOCK on tracked changes; WARN on untracked (often
// scratch). This is the single biggest known foot-gun in this repo.
/**
 * Paths the CLI itself writes and then tells the user to commit. Flagging them
 * as "likely scratch" right after `brief`/`handoff`/`init` is dishonest
 * (finding: self-artifacts-trip-dirty-guard). Matched as exact files or under
 * the marker dirs.
 */
function isOwnArtifact(rel) {
  const p = String(rel || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    p === "PROJECT-BRIEF.md" ||
    p === "HANDOFF.md" ||
    p === "AGENTS.md" ||
    p === ".cursorrules" ||
    p === ".windsurfrules" ||
    p === ".clinerules" ||
    p === "CLAUDE.md" ||
    p === ".github/copilot-instructions.md" ||
    p === ".github/workflows/getadvantage.yml"
  ) {
    return true;
  }
  if (p.startsWith(".getadvantage/") || p.startsWith(".ship-safe/")) return true;
  return false;
}

/**
 * The subset of own artifacts the CLI REWRITES on every run (brief/handoff and
 * the marker dirs). A tracked, in-place modification of these is expected churn,
 * so it stays informational. The OTHER own artifacts (CLAUDE.md, AGENTS.md, the
 * editor rules files, the CI workflow) are seeded ONCE and then hand-maintained —
 * a tracked edit or deletion there is real human/agent work (or tampering), not
 * CLI churn, so it must go through the normal tracked-change gate instead of being
 * reported as "clean of ship-risk" (finding: dirty-own-artifact-tracked-mod-pass).
 *
 * Policy config (`config.json` under the marker dirs) is never rewritten by the
 * CLI — it authorizes secret ignores. Tracked/staged edits there are ship-risk,
 * not regenerated churn (0.8.3 Fable audit P1).
 */
function isRegeneratedArtifact(rel) {
  const p = String(rel || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (p === "PROJECT-BRIEF.md" || p === "HANDOFF.md") return true;
  if (p === ".getadvantage/config.json" || p === ".ship-safe/config.json") return false;
  if (p.startsWith(".getadvantage/") || p.startsWith(".ship-safe/")) return true;
  return false;
}

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
  const own = []; // getAdvantage brain/marker artifacts (informational)

  for (const line of lines) {
    // Porcelain v1: XY<space>path  (X=staged, Y=worktree). "??" = untracked.
    // Renames: "R  old -> new" — take the right-hand path for classification.
    const xy = line.slice(0, 2);
    let file = line.slice(3);
    if (file.includes(" -> ")) file = file.split(" -> ").pop();
    if (isOwnArtifact(file)) {
      const untrackedNew = xy === "??";
      const deleted = xy.includes("D");
      // Informational ONLY when it is a just-generated untracked file, or an
      // expected in-place rewrite of a file the CLI regenerates every run. A
      // tracked edit to a seed file (CLAUDE.md/AGENTS.md/rules/workflow), or ANY
      // deletion, is real work → fall through to the normal tracked gate so we
      // never claim "clean of ship-risk" over changes the CLI did not make.
      if (untrackedNew || (isRegeneratedArtifact(file) && !deleted)) {
        own.push(file);
        continue;
      }
    }
    if (xy === "??") untracked.push(file);
    else tracked.push(`${xy.trim() || xy} ${file}`);
  }

  if (tracked.length > 0) {
    return result(
      "fail",
      "Dirty-tree guard",
      `${tracked.length} tracked file${pl(tracked.length)} modified/staged — a 'vercel --prod' would ship this unintended work.`,
      [
        ...tracked.slice(0, 20).map((t) => t),
        ...(tracked.length > 20 ? [`…and ${tracked.length - 20} more`] : []),
        "Commit, stash, or revert before shipping. Deploy from a clean detached worktree of the intended commit.",
        ...(own.length
          ? [`(Also ${own.length} getAdvantage brain/marker file${pl(own.length)} dirty — commit those when ready; they don't block alone.)`]
          : []),
      ],
    );
  }

  // Only own artifacts dirty → pass with a note (the tool told you to create them).
  if (untracked.length === 0 && own.length > 0) {
    return result(
      "pass",
      "Dirty-tree guard",
      `Working tree clean of ship-risk; ${own.length} getAdvantage brain/marker file${pl(own.length)} uncommitted (expected after brief/handoff — commit when ready).`,
      own.slice(0, 20),
    );
  }

  // Only untracked files → warn, list them (may be intentional new work).
  const extras = [
    ...untracked.slice(0, 20),
    ...(untracked.length > 20 ? [`…and ${untracked.length - 20} more`] : []),
  ];
  if (own.length) {
    extras.push(
      `(Plus ${own.length} getAdvantage brain/marker file${pl(own.length)} — not listed as risk; commit when ready.)`,
    );
  }
  return result(
    "warn",
    "Dirty-tree guard",
    `${untracked.length} untracked file${pl(untracked.length)} present (not yet tracked — confirm they are meant to ship, or add them to .gitignore).`,
    extras,
  );
}

// ===========================================================================
// b. SECRET SCAN
// ===========================================================================
// What we scan for: OpenAI, Anthropic, Stripe (live/restricted/webhook), AWS,
// GitHub (classic + fine-grained), Google OAuth, Slack, SendGrid, npm access
// tokens, bare JWTs (header-validated), database URLs with embedded passwords,
// getAdvantage's own platform keys (adv_live_), Vercel tokens, KV/Redis REST
// credentials, "Bearer <token>" literals, and private-key blocks.
// A match BLOCKS (✗); we print the file + a masked FINGERPRINT, never the
// full secret. Binary/lockfiles/node_modules/.git are skipped.

// All patterns carry the /g flag: we matchAll and report the hit COUNT per
// file, not just the first occurrence.
// Shared validator: real API keys contain at least one digit; CSS class-name
// chains ("sk-circle-fade-dot-before-anim") and prose practically never do.
const hasDigit = (tok) => /[0-9]/.test(tok);

const SECRET_PATTERNS = [
  // --- from app/lib/safety.ts ---
  // Anthropic BEFORE OpenAI: `sk-ant-…` also matches the broader sk- shape, so
  // the specific pattern must claim it first (and openai's validator skips it).
  { id: "anthropic", label: "Anthropic secret key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, validate: hasDigit },
  {
    id: "openai",
    label: "OpenAI secret key",
    re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
    // Digit required (kills CSS-class false positives); sk-ant- is Anthropic's.
    validate: (tok) => hasDigit(tok) && !tok.startsWith("sk-ant-"),
  },
  { id: "stripe-live", label: "Stripe live secret key", re: /\bsk_live_[A-Za-z0-9]{20,}/g },
  { id: "stripe-restricted", label: "Stripe restricted key", re: /\brk_live_[A-Za-z0-9]{20,}/g },
  { id: "aws", label: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "github-pat", label: "GitHub personal access token", re: /\bghp_[A-Za-z0-9]{36}\b/g },
  { id: "github-fine", label: "GitHub fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { id: "google-oauth", label: "Google OAuth secret", re: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/g },
  { id: "slack", label: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  // Full PEM block (BEGIN…END), not the header alone. Header-only matches make
  // every key of the same type share one secretAuthId — a hash copied from one
  // fixture must never authorize a different private key (0.8.3 re-review P1).
  {
    id: "private-key",
    label: "Private key block",
    re: /-----BEGIN ((?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
  },
  // Incomplete / truncated PEM: BEGIN present without a matching END for that
  // key type. Full-block regex misses material when the footer is stripped —
  // removing the footer must not turn NO-GO into GO (0.8.3 final re-review P1).
  // Match string is the constant header → non-unique; value/hash allowlisting
  // is refused in secretAllowDecision for this patternId.
  {
    id: "private-key-incomplete",
    label: "Incomplete private key block",
    re: /-----BEGIN ((?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY)-----/g,
    validate: (_tok, m) => {
      const keyType = m?.[1];
      if (!keyType || m.index == null) return false;
      // Escape type for RegExp (spaces/letters only in practice, but stay strict).
      const esc = String(keyType).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const fromHere = m.input.slice(m.index);
      const complete = new RegExp(
        `^-----BEGIN ${esc}-----[\\s\\S]*?-----END ${esc}-----`,
      );
      // Fire only when this BEGIN is not the start of a complete PEM block.
      return !complete.test(fromHere);
    },
  },
  { id: "sendgrid", label: "SendGrid key", re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g },
  // --- from CLAUDE.md hard-rule #2 (the pre-commit scan literals) ---
  { id: "stripe-webhook", label: "Stripe webhook secret (whsec_)", re: /\bwhsec_[A-Za-z0-9]{20,}/g },
  { id: "vercel-token", label: "Vercel token (vcp_)", re: /\bvcp_[A-Za-z0-9]{20,}/g },
  { id: "kv-rest", label: "KV/Redis REST credential", re: /\bKV_REST_API_(?:URL|TOKEN|READ_ONLY_TOKEN)\s*=\s*\S+/g },
  // getAdvantage's OWN platform key format: adv_live_ + lowercase base36. A
  // dedicated pattern because the generic Bearer heuristic below requires MIXED
  // case + a digit and would miss an all-lowercase token like this one.
  { id: "getadvantage-key", label: "getAdvantage platform key (adv_live_)", re: /\badv_live_[a-z0-9]{16,}\b/g },
  // --- coverage additions (v0.6.0) ---
  // npm access/automation token (the `.npmrc _authToken=npm_…` leak).
  { id: "npm-token", label: "npm access token", re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  // Bare JWT (three base64url segments, no "Bearer" prefix needed). To keep
  // false positives near zero we only flag it if the FIRST segment decodes to
  // a JSON object with an `alg` or `typ` field — i.e. a real JWT header.
  {
    id: "jwt",
    label: "JSON Web Token (JWT)",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    validate: (tok) => {
      try {
        const header = JSON.parse(Buffer.from(tok.split(".")[0], "base64url").toString("utf8"));
        return typeof header === "object" && header !== null && ("alg" in header || "typ" in header);
      } catch {
        return false;
      }
    },
  },
  // Database URL with an embedded password (postgres://user:PASS@host).
  // The validator runs on the captured password + host and skips (a) obvious
  // placeholder / interpolated passwords ("mypassword", "changeme3", …) and
  // (b) ANY URL whose host is a local dev target (localhost, 127.0.0.1,
  // 0.0.0.0, ::1, host.docker.internal) — a dev URL is not a production leak.
  // So docs + examples never trip a NO-GO, while a real credential still does.
  {
    id: "db-url-password",
    label: "Database URL with embedded password",
    re: /\bpostgres(?:ql)?:\/\/[^\s:/@'"]+:([^@\s'"]{8,})@([^\s'"/]+)/g,
    validate: (pw, m) => {
      if (/[<>{}$%]/.test(pw)) return false;
      if (/^(?:pass(?:word)?|passwd|secret|example|changeme|test|postgres|admin|root|1234(?:5678?9?)?|x{4,}|\*{4,})$/i.test(pw)) return false;
      // Placeholder passwords: my/your/… + pass(word)/passwd/pwd/secret/changeme (+digits).
      if (/^(?:my|your|db|dummy|sample|local|test|example|demo)?(?:pass(?:word)?|passwd|pwd|secret|changeme)\d*$/i.test(pw)) return false;
      // Local/dev hosts are never a production leak.
      const host = String(m?.[2] ?? "").replace(/:\d+$/, "").toLowerCase();
      if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"].includes(host)) return false;
      return true;
    },
  },
  // "Bearer <token>" literal. The CLAUDE.md pre-commit scan lists "Bearer " as a
  // tell. We capture the token and only flag it if it LOOKS like a real
  // credential (mixed case + a digit, ≥20 chars) — so legitimate test fixtures
  // and placeholders like `Bearer test_cron_secret...` or `Bearer ${token}`
  // don't trip a false NO-GO. The `validate` predicate runs on the captured group.
  {
    id: "bearer",
    label: "Bearer auth token literal",
    re: /\bBearer\s+([A-Za-z0-9_\-.]{20,})/g,
    validate: (tok) => /[a-z]/.test(tok) && /[A-Z]/.test(tok) && /[0-9]/.test(tok),
  },
];

// Files we never scan (binary-ish, generated, vendored).
//
// ⚠ Deliberately NOT skipped: .env* files AND build-output dirs (dist/build/
// coverage). filesToScan() runs through git ls-files, which honours .gitignore —
// so a normally-generated dir only ever reaches the scan when the user COMMITTED
// it. A dir/basename skip here could therefore only suppress the DANGEROUS case:
// a bundled/copied key inside committed build output (the classic vibe-coder
// `git add .` of a dist folder). Skipping .env was a real hole in ≤0.5.0 (fixed
// 0.6.0); skipping build dirs was the same silent-GO hole
// (finding: F1-buildpath-secret-skip). Truly-huge trees that are normally
// gitignored stay skipped for perf — if they're committed, that's a separate smell.
const SKIP_DIR = new Set([".git", "node_modules", ".next", ".vercel", ".data"]);
// Lockfiles USED to be skipped for perf, but a committed npm/yarn _authToken (or a
// key pasted into one) then slipped through silently — so nothing is skipped by
// basename anymore; they're scanned like any other text file.
const SKIP_BASENAME = new Set([]);
// Truly BINARY assets only (images, fonts, video, archives, PDFs). Text formats
// that can carry a copied key are deliberately NOT skipped so the README's "every
// tracked text file" claim is honest: .map sourcemaps embed original sourcesContent
// (a classic place a bundled key hides), .svg is XML, lockfiles are JSON/YAML.
const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf",
  ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".webm", ".zip", ".gz",
]);

const MAX_FILE_BYTES = 2_000_000; // full-scan cap (same cap as safety.ts corpus)
const PARTIAL_CHUNK_BYTES = 262_144; // oversized files: scan first + last 256 KB

/** Heuristic: does this buffer look binary? (null byte in the first 4KB) */
function looksBinary(buf) {
  const n = Math.min(buf.length, 4096);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** UTF-16 encoding implied by a leading BOM, or null. FF FE = LE (the Windows
 *  PowerShell 5.1 default for `>` / Out-File), FE FF = BE. */
function bomEncoding(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return "utf16le";
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return "utf16be";
  return null;
}

/** Decode UTF-16 bytes to a JS string. `hasBom` strips the leading 2-byte BOM;
 *  BE is byte-swapped to LE (Node has no utf16be decoder). */
function decodeUtf16(buf, be, hasBom) {
  const body = hasBom ? buf.subarray(2) : buf;
  if (!be) return body.toString("utf16le");
  const swapped = Buffer.allocUnsafe(body.length - (body.length % 2));
  for (let i = 0; i + 1 < body.length; i += 2) {
    swapped[i] = body[i + 1];
    swapped[i + 1] = body[i];
  }
  return swapped.toString("utf16le");
}

/** Decode a whole-file buffer to scannable text, honoring a UTF-16/UTF-8 BOM.
 *  Returns null for genuine binary (caller skips). Without the UTF-16 branch, a
 *  UTF-16-LE file has a NUL byte after every ASCII char, trips looksBinary, and
 *  is skipped silently — so a committed secret in a PowerShell-authored notes
 *  file passes the gate (a false GO). BOM detection is the reliable signal
 *  because both PowerShell and most Windows editors write the BOM. */
function decodeText(buf) {
  const enc = bomEncoding(buf);
  if (enc) return decodeUtf16(buf, enc === "utf16be", /* hasBom */ true);
  if (looksBinary(buf)) return null;
  return buf.toString("utf8");
}

/** Read the first and last PARTIAL_CHUNK_BYTES of an oversized file without
 *  loading the whole thing. Returns { head, tail } buffers (tail may be null
 *  if reading it fails). Read-only. */
function readHeadTail(abs, size) {
  const fd = openSync(abs, "r");
  try {
    const head = Buffer.alloc(PARTIAL_CHUNK_BYTES);
    const hn = readSync(fd, head, 0, PARTIAL_CHUNK_BYTES, 0);
    const tail = Buffer.alloc(PARTIAL_CHUNK_BYTES);
    const tn = readSync(fd, tail, 0, PARTIAL_CHUNK_BYTES, Math.max(0, size - PARTIAL_CHUNK_BYTES));
    return { head: head.subarray(0, hn), tail: tail.subarray(0, tn) };
  } finally {
    closeSync(fd);
  }
}

/** Files to scan: tracked + staged + (added) untracked-but-not-ignored, deduped.
 *  We deliberately DON'T scan gitignored files (the local .env lives there and
 *  is supposed to hold secrets). */
function filesToScan(cwd) {
  const set = new Set();
  // gitFilesZ (NUL-terminated) — NOT the newline-split gitSafe: git quotes +
  // octal-escapes non-ASCII paths by default, which then fail to open and drop
  // out of the scan silently (a false GO on any repo with an umlaut filename).
  // Tracked files.
  for (const f of gitFilesZ(["ls-files"], { cwd })) set.add(f);
  // Untracked-but-not-ignored (new files a dev created; --others honours .gitignore).
  for (const f of gitFilesZ(["ls-files", "--others", "--exclude-standard"], { cwd })) set.add(f);
  return [...set];
}

export function checkSecrets(cwd) {
  const files = filesToScan(cwd);
  // (file,label) → { fp, count } so repeated hits are COUNTED, not dropped.
  const hits = new Map();
  // Allowlisted hits (built-in EXAMPLE keys + `.getadvantage/config.json` rules).
  // Always disclosed — never a silent false GO (finding: gate-placeholder-false-positive).
  const allowed = new Map(); // (file,label,reason) → { fp, count, reason }
  let scanned = 0;
  let partial = 0; // oversized files scanned head+tail only
  const partialFiles = []; // relative paths of those files (named in the note)
  const policy = loadPolicy(cwd);

  for (const rel of files) {
    const base = path.basename(rel);
    const ext = path.extname(rel).toLowerCase();
    if (SKIP_BASENAME.has(base)) continue;
    if (SKIP_EXT.has(ext)) continue;
    // Skip anything inside a skipped directory.
    if (rel.split(/[\\/]/).some((seg) => SKIP_DIR.has(seg))) continue;

    const abs = path.join(cwd, rel);
    let text;
    let isPartial = false;
    try {
      const st = statSync(abs);
      if (!st.isFile()) continue;
      if (st.size > MAX_FILE_BYTES) {
        // Oversized: NEVER skip silently. Scan the first + last 256 KB and
        // say so in the summary — a secret appended to a giant file is a
        // classic miss.
        const { head, tail } = readHeadTail(abs, st.size);
        const enc = bomEncoding(head);
        if (enc) {
          // UTF-16: decode both chunks (head carries the BOM, tail doesn't).
          const be = enc === "utf16be";
          text = `${decodeUtf16(head, be, true)}\n${decodeUtf16(tail, be, false)}`;
        } else {
          if (looksBinary(head)) continue;
          text = `${head.toString("utf8")}\n${tail.toString("utf8")}`;
        }
        isPartial = true;
      } else {
        const decoded = decodeText(readFileSync(abs));
        if (decoded === null) continue;
        text = decoded;
      }
    } catch {
      continue; // unreadable / deleted-but-staged etc.
    }
    scanned++;
    if (isPartial) {
      partial++;
      partialFiles.push(rel);
    }

    for (const p of SECRET_PATTERNS) {
      for (const m of text.matchAll(p.re)) {
        // If the pattern has a capture group + validator (e.g. Bearer, JWT,
        // DB URL), apply the validator to the captured token so test
        // fixtures/placeholders don't trip. The full match array is passed
        // too, for validators that need more context (e.g. the DB-URL host).
        const token = m[1] ?? m[0];
        if (p.validate && !p.validate(token, m)) continue;
        const raw = m[0];
        const decision = secretAllowDecision(raw, {
          file: rel,
          patternId: p.id,
          policy,
        });
        if (decision.allowed) {
          const ak = `${rel}::${p.label}::${decision.reason}`;
          const prevA = allowed.get(ak);
          if (prevA) prevA.count++;
          else {
            allowed.set(ak, {
              file: rel,
              label: p.label,
              fp: decision.fp,
              authId: decision.authId,
              count: 1,
              reason: decision.reason,
            });
          }
          continue;
        }
        const k = `${rel}::${p.label}`;
        const prev = hits.get(k);
        if (prev) prev.count++;
        else {
          // Region from match index when defensible (1-based line/column).
          // Partial head+tail scans can mis-number middle lines — still emit
          // file + fingerprint; only attach region for full-file scans.
          let startLine;
          let startColumn;
          let endColumn;
          if (!isPartial && typeof m.index === "number" && m.index >= 0) {
            const rc = offsetToLineCol(text, m.index);
            startLine = rc.line;
            startColumn = rc.col;
            const end = offsetToLineCol(text, m.index + raw.length);
            if (end.line === rc.line) endColumn = end.col;
          }
          hits.set(k, {
            file: rel,
            label: p.label,
            patternId: p.id,
            fp: decision.fp,
            authId: decision.authId,
            count: 1,
            startLine,
            startColumn,
            endColumn,
          });
        }
      }
    }
  }

  const partialNames =
    partialFiles.slice(0, 5).join(", ") + (partial > 5 ? `, …and ${partial - 5} more` : "");
  const partialNote =
    partial > 0
      ? [`${partial} oversized file${pl(partial)} >2 MB scanned partially (first + last 256 KB each; scanned partially: ${partialNames}) — move giant blobs out of git for a full scan.`]
      : [];

  // Display fingerprint is human-readable only; sha256 auth id is the
  // copy-paste allowlist identity (never the full secret).
  const hitLine = (h) =>
    `${h.file} → ${h.label}: ${h.fp}${h.count > 1 ? ` (+${h.count - 1} more)` : ""}${h.authId ? ` · auth ${h.authId}` : ""}`;

  const allowedList = [...allowed.values()];
  const allowedNote =
    allowedList.length > 0
      ? [
          `${allowedList.length} allowlisted hit${pl(allowedList.length)} (disclosed, not blocking):`,
          ...allowedList.slice(0, 20).map(
            (h) =>
              `  ${hitLine(h)} [${h.reason}]`,
          ),
          ...(allowedList.length > 20 ? [`  …and ${allowedList.length - 20} more allowlisted`] : []),
        ]
      : [];
  const policyNote = (policy.warnings || []).map((w) => `policy: ${w}`);

  if (hits.size === 0) {
    const allowSummary =
      allowedList.length > 0
        ? ` (${allowedList.length} allowlisted hit${pl(allowedList.length)} disclosed)`
        : "";
    return result(
      "pass",
      "Secret scan",
      `Scanned ${scanned} tracked/staged file${pl(scanned)} — no leaked-secret patterns matched.${allowSummary}`,
      [...allowedNote, ...policyNote, ...partialNote],
    );
  }

  const hitList = [...hits.values()];
  const lines = hitList.map(
    (h) =>
      `${h.file} → ${h.label}: ${h.fp}${h.count > 1 ? ` (+${h.count - 1} more in this file)` : ""}${h.authId ? ` · auth ${h.authId}` : ""}`,
  );
  // Structured findings for SARIF (and optional --json consumers). Never carry
  // the raw match — only fingerprint, auth id, path, patternId, region.
  const findings = hitList.map((h) => ({
    ruleId: `secret/${h.patternId || "unknown"}`,
    patternId: h.patternId,
    label: h.label,
    file: h.file,
    fp: h.fp,
    authId: h.authId,
    count: h.count,
    ...(typeof h.startLine === "number" ? { startLine: h.startLine } : {}),
    ...(typeof h.startColumn === "number" ? { startColumn: h.startColumn } : {}),
    ...(typeof h.endColumn === "number" ? { endColumn: h.endColumn } : {}),
    message: `${h.label}: ${h.fp}${h.authId ? ` · auth ${h.authId}` : ""}`,
  }));
  const r = result(
    "fail",
    "Secret scan",
    `${lines.length} possible secret${pl(lines.length)} in committed/staged files — remove + rotate before shipping.`,
    [...lines.slice(0, 30), ...allowedNote, ...policyNote, ...partialNote],
  );
  r.findings = findings;
  return r;
}

/** 1-based line + column for a byte/char offset into a decoded UTF-16-or-UTF-8 string. */
function offsetToLineCol(text, offset) {
  let line = 1;
  let col = 1;
  const n = Math.min(offset, text.length);
  for (let i = 0; i < n; i++) {
    if (text[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

// ===========================================================================
// b2. TRACKED .ENV FILE
// ===========================================================================
// A committed .env is a leak BY ITSELF, whatever it contains — git history
// keeps every value it ever held, and every clone gets a copy. This is the
// single most common vibe-coder leak (Lovable/Bolt/v0 templates read from
// .env, the first `git add .` commits it). BLOCK on any tracked .env*;
// WARN if a local .env exists but is not gitignored (one `git add .` away).
// Template files (.env.example / .sample / .template / .dist) are fine —
// their CONTENTS are still covered by the secret scan above.

const ENV_TEMPLATE_SUFFIX = /\.(?:example|sample|template|dist)$/i;

function isRealEnvFile(basename) {
  if (ENV_TEMPLATE_SUFFIX.test(basename)) return false;
  return basename === ".env" || basename.startsWith(".env.");
}

export function checkTrackedEnv(cwd) {
  const tracked = gitFilesZ(["ls-files"], { cwd })
    .filter((f) => isRealEnvFile(path.basename(f)));

  if (tracked.length > 0) {
    const r = result(
      "fail",
      "Tracked .env file",
      `${tracked.length} .env file${pl(tracked.length)} tracked by git — a committed .env is a leak by itself, whatever it contains.`,
      [
        ...tracked.slice(0, 10),
        "Remove it from git (git rm --cached <file>), add it to .gitignore, and ROTATE every key that file ever held — git history keeps old values.",
      ],
    );
    r.findings = tracked.map((file) => ({
      ruleId: "check/tracked-env-file",
      label: "Tracked .env file",
      file,
      message: "Committed .env is a leak by itself — remove from git, gitignore, rotate keys.",
    }));
    return r;
  }

  const untrackedEnv = gitFilesZ(["ls-files", "--others", "--exclude-standard"], { cwd })
    .filter((f) => isRealEnvFile(path.basename(f)));

  if (untrackedEnv.length > 0) {
    const r = result(
      "warn",
      "Tracked .env file",
      `${untrackedEnv.length} local .env file${pl(untrackedEnv.length)} are NOT gitignored — one 'git add .' away from committing your keys.`,
      [...untrackedEnv.slice(0, 10), "Add them to .gitignore so they can never be committed."],
    );
    r.findings = untrackedEnv.map((file) => ({
      ruleId: "check/tracked-env-file",
      label: "Unignored .env file",
      file,
      message: "Local .env is not gitignored — one git add away from committing keys.",
    }));
    return r;
  }

  return result(
    "pass",
    "Tracked .env file",
    "No .env files tracked by git (gitignored local .env files are fine and are never read).",
  );
}

// ===========================================================================
// b3. PACKAGE MANIFEST INTEGRITY
// ===========================================================================
// "Not checkable is not GO." A package.json that EXISTS but does not parse means
// npm can't install, the build can't run, and the deploy will fail — so the gate
// must NO-GO, not merely warn (that was a false GO: `ship` returned GO on a
// corrupt manifest because the build gate could only warn "could not run"). The
// BOM case was patched in 0.6.2; this makes the principle general. A repo with
// NO package.json is a legitimate non-Node project → neutral skip.
export function checkManifest(cwd, project = null) {
  const p = project || detectProject(cwd);
  if (p.packageJsonBroken) {
    return result(
      "fail",
      "Package manifest",
      "package.json exists but is not valid JSON — npm install, the build, and the deploy will all fail until it parses.",
      [
        "Fix the syntax (a trailing comma, a missing quote, smart quotes, or a mid-file BOM are the usual causes), then re-run.",
      ],
    );
  }
  if (!p.packageJsonExists) {
    return result(
      "skip",
      "Package manifest",
      "Skipped — no package.json (not a Node project). Nothing to validate.",
    );
  }
  return result("pass", "Package manifest", "package.json is present and valid JSON.");
}

// ===========================================================================
// c. BUILD + TYPECHECK
// ===========================================================================
// Default: `npx tsc --noEmit` (fast). `--build` also runs `npm run build`.
// BLOCK on either failing; print the tail of the output so the founder sees
// the actual error without scrollback.

/** Default wall-clock budget for typecheck / build (finding: gate-build-no-timeout). */
const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function runCapture(cmd, args, cwd, opts = {}) {
  try {
    const out = execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
      // On Windows npm is a .cmd shim — shell:true lets it resolve. When we call
      // an absolute path through `node` (the tsc case) we pass shell:false so the
      // path is never re-parsed by cmd.exe.
      shell: opts.shell ?? process.platform === "win32",
      timeout: opts.timeout ?? DEFAULT_CHECK_TIMEOUT_MS,
      killSignal: "SIGTERM",
    });
    return { ok: true, out };
  } catch (e) {
    // Node sets e.killed / signal on timeout; surface a clear message.
    if (e.killed || e.signal === "SIGTERM" || /ETIMEDOUT|timed out/i.test(String(e.message || ""))) {
      const mins = Math.round((opts.timeout ?? DEFAULT_CHECK_TIMEOUT_MS) / 60000);
      return {
        ok: false,
        out: `Command timed out after ${mins} minute${pl(mins)}: ${cmd} ${args.join(" ")}`,
        timedOut: true,
      };
    }
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
    // A broken manifest can't confirm the TypeScript setup. The Package manifest
    // check owns the NO-GO for that (a broken manifest is a hard block), so here
    // we skip and point at it rather than emitting a second, weaker signal.
    if (p.packageJsonBroken && p.hasTsConfig) {
      return result(
        "skip",
        "Typecheck",
        "Skipped — package.json could not be parsed, so the TypeScript setup can't be confirmed (the Package manifest check blocks on this). Fix the JSON, then re-run.",
      );
    }
    const why = !p.hasTsConfig && !p.hasTypeScript
      ? "no tsconfig.json and no typescript dependency"
      : !p.hasTsConfig
        ? "no tsconfig.json"
        : "typescript is not a dependency";
    return result(
      "skip",
      "Typecheck",
      `Skipped — this is a ${p.label} (${why}). Nothing to typecheck.`,
    );
  }

  // Resolve the LOCALLY INSTALLED TypeScript compiler and run it via `node`.
  // NEVER `npx --yes tsc`: when typescript is declared but not installed (a
  // fresh clone, or CI with no install step), npx would download and execute a
  // SQUATTED third-party package literally named `tsc` and we'd mislabel its
  // output as type errors. A trust gate must not fetch-and-run unvetted code.
  const tscJs = path.join(cwd, "node_modules", "typescript", "bin", "tsc");
  if (!existsSync(tscJs)) {
    return result(
      "warn",
      "Typecheck",
      "TypeScript is declared but not installed (no node_modules/typescript). Run `npm install`, then re-run — the gate never downloads a compiler.",
    );
  }
  const r = runCapture(process.execPath, [tscJs, "--noEmit"], cwd, { shell: false });
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
    // A broken/BOM'd package.json must NEVER read as "(no package.json)" and
    // silently pass the gate (that was a false GO). The Package manifest check
    // owns the NO-GO for an unparseable manifest; defer to it here so ship
    // reports ONE clear blocking reason, not a weaker "could not run" warning
    // that still lets the verdict be GO.
    if (p.packageJsonBroken) {
      return result(
        "skip",
        "Build",
        "Skipped — package.json could not be parsed, so the build script can't be determined (the Package manifest check blocks on this). Fix the JSON, then re-run.",
      );
    }
    return result(
      "skip",
      "Build",
      `Skipped — ${p.packageJsonExists ? 'no "build" script in package.json' : "no package.json"}. Nothing to build.`,
    );
  }

  const r = runCapture("npm", ["run", "build"], cwd);
  if (r.ok) {
    return result("pass", `Production build (npm run build)`, `\`${p.buildCmd}\` completed successfully.`);
  }
  return result(
    "fail",
    "Production build (npm run build)",
    r.timedOut
      ? "The build timed out (10 min budget) — fix a hang or run the build yourself before shipping."
      : "The build failed — fix it before shipping.",
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
      "skip",
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
