// getAdvantage CLI — evaluator feedback URL builder.
//
// Pure functions only: no I/O, no network, no git. Builds a copy-pasteable
// GitHub "new issue" URL pre-filled with redacted environment + gate metadata.
//
// Hard properties:
//   • Target host/repo are NAMED CONSTANTS — never derived from the user's
//     `origin` (a stranger's bug report must never open on a stranger's repo).
//   • Secrets, absolute paths, usernames, and home dirs never travel in the
//     payload (raw or after decodeURIComponent).
//   • URL length is hard-capped (MAX_URL_CHARS); overlong payloads truncate
//     with visible disclosure and never emit an invalid URL.
//   • This module never posts, opens a browser, or touches the network.
//   • Secret shapes come from the checks.mjs catalogue (one answer). Feedback-
//     only extras may widen coverage; they must never narrow it.

import { SECRET_PATTERNS as CHECK_SECRET_PATTERNS } from "./checks.mjs";

/** Canonical origin for the feedback issue form. Never from git remote. */
export const FEEDBACK_GITHUB_ORIGIN = "https://github.com";

/** owner/repo constants — never from the caller's origin. */
export const FEEDBACK_OWNER = "BellmeJoe";
export const FEEDBACK_REPO = "getadvantage-cli";
export const FEEDBACK_OWNER_REPO = `${FEEDBACK_OWNER}/${FEEDBACK_REPO}`;

/** Full base URL (origin + path) for the pre-filled new-issue form. */
export const FEEDBACK_NEW_ISSUE_BASE =
  `${FEEDBACK_GITHUB_ORIGIN}/${FEEDBACK_OWNER_REPO}/issues/new`;

/**
 * Hard cap on the full URL length (chars). GitHub issue forms + browser
 * address bars are not unbounded; over this we truncate the body with a
 * visible disclosure rather than emit a URL that may fail to open.
 */
export const MAX_URL_CHARS = 7000;

/** Clone a RegExp so redaction never shares lastIndex with the gate scanner. */
function cloneRe(re) {
  return new RegExp(re.source, re.flags);
}

/**
 * Check-catalogue entries the redactor covers. Derived from checks.mjs —
 * removing an entry here is exactly what the drift/parity test mutates.
 * Defence-in-depth: we apply each `.re` without its `validate()` (redact more
 * aggressively than the gate detects).
 */
const CHECK_SECRET_REDACTION = CHECK_SECRET_PATTERNS.map((p) => ({
  id: p.id,
  re: cloneRe(p.re),
}));

/**
 * Ids from `checks.mjs` `SECRET_PATTERNS` that the feedback redactor covers.
 * Must stay a complete enumeration of the check catalogue (superset via
 * feedback-only extras is fine; missing an id is a defect).
 */
export const FEEDBACK_COVERS_CHECK_SECRET_IDS = Object.freeze(
  CHECK_SECRET_REDACTION.map((p) => p.id),
);

/**
 * Feedback-only extras — shapes the gate does not list (or lists more
 * narrowly) but that must still never travel in a feedback payload.
 * Keeping these is the allowed "superset" relative to checks.mjs.
 */
const FEEDBACK_ONLY_SECRET_PATTERNS = [
  /\bsk_test_[A-Za-z0-9]{20,}/g,
  /\bghs_[A-Za-z0-9]{20,}/g,
  /\bgho_[A-Za-z0-9]{20,}/g,
  /\bghu_[A-Za-z0-9]{20,}/g,
  /\bghr_[A-Za-z0-9]{20,}/g,
  /\b(?:mysql|mongodb(?:\+srv)?|redis|rediss):\/\/[^\s'"]+/gi,
];

const SECRET_REDACTION_REGEXES = [
  ...CHECK_SECRET_REDACTION.map((p) => p.re),
  ...FEEDBACK_ONLY_SECRET_PATTERNS,
];

/**
 * Source/flags pairs actually applied by redactSecrets — used by the
 * catalogue-parity test so coverage cannot drift from a hand-written id list.
 */
export function listFeedbackSecretRedactionSources() {
  return SECRET_REDACTION_REGEXES.map((re) => ({
    source: re.source,
    flags: re.flags,
  }));
}

/** Replace credential-shaped substrings with a fixed token. Pure. */
export function redactSecrets(text) {
  let s = String(text ?? "");
  for (const re of SECRET_REDACTION_REGEXES) {
    // Reset lastIndex for global patterns reused across calls.
    re.lastIndex = 0;
    s = s.replace(re, "[REDACTED]");
  }
  return s;
}

/**
 * Strip absolute paths, home-directory prefixes, and OS usernames so a
 * payload never carries machine identity. Pure — extra names come from the
 * caller (e.g. process.env.USERNAME) so this module stays I/O-free.
 *
 * Path shapes allow spaces inside segments (e.g. `C:\Program Files\…`,
 * `/Users/ben/My Documents/x`) so redaction does not stop at the first space.
 *
 * @param {string} text
 * @param {{ homeDir?: string, username?: string }} [opts]
 */
export function redactPathsAndUser(text, opts = {}) {
  let s = String(text ?? "");

  // Explicit home directory (forward- or back-slash).
  if (opts.homeDir && String(opts.homeDir).length > 1) {
    const home = String(opts.homeDir);
    const esc = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(esc, "gi"), "[HOME]");
    // Also the forward-slash form of a Windows home.
    if (home.includes("\\")) {
      const fwd = home.replace(/\\/g, "/");
      const escFwd = fwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      s = s.replace(new RegExp(escFwd, "gi"), "[HOME]");
    }
  }

  // Explicit username (whole token / path segment only).
  if (opts.username && String(opts.username).length >= 2) {
    const u = String(opts.username).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Path segment after Users/ or home/
    s = s.replace(new RegExp(`([/\\\\]Users[/\\\\])${u}\\b`, "gi"), "$1[USER]");
    s = s.replace(new RegExp(`([/\\\\]home[/\\\\])${u}\\b`, "gi"), "$1[USER]");
    // Bare Windows user profile roots already handled via homeDir; also
    // catch leftover `\\Users\\name` / `/Users/name` when homeDir missing.
  }

  // Generic absolute-path shapes (defense in depth — never depend on opts).
  // Spaces are allowed inside path *segments*; the final segment stops at
  // whitespace so trailing prose is not swallowed. Middle segments may contain
  // spaces (`Program Files`, `My Documents`).
  // Windows backslash: C:\Users\name\… and C:\Program Files\Foo\bar.txt
  s = s.replace(/\b[A-Za-z]:\\(?:[^\\\/\r\n"'`<>|]+\\)*[^\\\/\s"'`<>|]+/g, "[PATH]");
  // Windows forward-slash form
  s = s.replace(/\b[A-Za-z]:\/(?:[^\/\r\n"'`<>|]+\/)*[^\/\s"'`<>|]+/g, "[PATH]");
  // Unix home and absolute (spaced segments OK)
  s = s.replace(/\/home\/(?:[^\/\r\n"'`<>|]+\/)*[^\/\s"'`<>|]+/g, "[PATH]");
  s = s.replace(/\/Users\/(?:[^\/\r\n"'`<>|]+\/)*[^\/\s"'`<>|]+/g, "[PATH]");
  // $HOME / %USERPROFILE% literals
  s = s.replace(/\$HOME\b/g, "[HOME]");
  s = s.replace(/%USERPROFILE%/gi, "[HOME]");
  s = s.replace(/%HOMEPATH%/gi, "[HOME]");

  return s;
}

/** Full redaction pipeline for any string that will enter the URL. */
export function redactPayloadText(text, opts = {}) {
  return redactPathsAndUser(redactSecrets(text), opts);
}

/**
 * Build title + body markdown from meta (still unencoded). Pure.
 * @param {object} meta
 * @returns {{ title: string, body: string }}
 */
export function buildFeedbackMarkdown(meta = {}) {
  const redactOpts = {
    homeDir: meta.homeDir,
    username: meta.username,
  };
  const clean = (v) => redactPayloadText(v == null ? "" : String(v), redactOpts);

  const cli = clean(meta.cliVersion || "unknown");
  const node = clean(meta.nodeVersion || "unknown");
  const platform = clean(meta.platform || "unknown");
  const stack = clean(meta.stackLabel || "unknown");
  const verdict = clean(meta.verdict || "n/a");
  const exitCode =
    typeof meta.exitCode === "number" && Number.isFinite(meta.exitCode)
      ? String(meta.exitCode)
      : "n/a";

  const counts = meta.counts && typeof meta.counts === "object" ? meta.counts : {};
  const pass = Number(counts.pass) || 0;
  const fail = Number(counts.fail) || 0;
  const warn = Number(counts.warn) || 0;
  const skip = Number(counts.skip) || 0;

  const title = clean(
    meta.title ||
      `Feedback: getadvantage ${cli} · ${platform} · ${verdict === "n/a" ? "no gate" : verdict}`,
  ).slice(0, 200);

  const checkLines = [];
  const checks = Array.isArray(meta.checks) ? meta.checks : [];
  // Soft per-item bounds keep a normal run compact; the hard URL cap
  // (MAX_URL_CHARS / assembleFeedbackUrl) is the real size guard — do not
  // pre-truncate the whole body so small maxUrlChars overrides still exercise it.
  for (const ch of checks.slice(0, 200)) {
    if (!ch || typeof ch !== "object") continue;
    const label = clean(ch.label || ch.id || "check").slice(0, 200);
    const status = clean(ch.status || "?").slice(0, 40);
    // Label + status only — never detail/extra/findings (paths + secrets).
    checkLines.push(`- ${label}: ${status}`);
  }

  const notes = meta.notes ? clean(meta.notes).slice(0, 100_000) : "";

  const parts = [
    "## Environment (auto-filled, redacted)",
    "",
    `- CLI version: ${cli}`,
    `- Node: ${node}`,
    `- OS platform: ${platform}`,
    `- Detected stack: ${stack}`,
    `- Gate verdict: ${verdict} (exit ${exitCode})`,
    `- Check counts: ${pass} pass · ${warn} warn · ${fail} fail · ${skip} skip`,
    "",
  ];

  if (checkLines.length > 0) {
    parts.push("## Checks", "", ...checkLines, "");
  }

  parts.push(
    "## Notes",
    "",
    notes || "_(describe what went wrong or what you expected)_",
    "",
    "---",
    "_Generated by `getadvantage feedback`. Nothing was sent automatically —",
    "this link only pre-fills a GitHub issue form. No hostname, username,",
    "absolute path, or secret value is included._",
    "",
  );

  return { title, body: parts.join("\n") };
}

/**
 * Assemble a URL from base + title + body, truncating body if needed so the
 * full URL stays under `maxChars`. Always returns a string that `new URL()`
 * accepts with origin+path equal to FEEDBACK_NEW_ISSUE_BASE.
 *
 * @param {string} title
 * @param {string} body
 * @param {number} [maxChars]
 * @returns {{ url: string, truncated: boolean, title: string, body: string }}
 */
export function assembleFeedbackUrl(title, body, maxChars = MAX_URL_CHARS) {
  const base = FEEDBACK_NEW_ISSUE_BASE;
  const cap = typeof maxChars === "number" && maxChars > 0 ? maxChars : MAX_URL_CHARS;

  const tryBuild = (t, b) => {
    const q = new URLSearchParams();
    q.set("title", t);
    q.set("body", b);
    // URLSearchParams encodes spaces as '+' which is fine in query strings;
    // build via URL for a guaranteed-valid absolute URL.
    const u = new URL(base);
    u.search = q.toString();
    return u.toString();
  };

  let t = String(title ?? "").slice(0, 200);
  let b = String(body ?? "");
  let url = tryBuild(t, b);
  let truncated = false;

  if (url.length <= cap) {
    // Validate and return.
    const parsed = new URL(url);
    if (parsed.origin + parsed.pathname !== new URL(base).origin + new URL(base).pathname) {
      // Should be unreachable — constants only — but never emit a wrong target.
      url = base;
      truncated = true;
    }
    return { url, truncated, title: t, body: b };
  }

  truncated = true;
  const disclosure = "\n\n_(Payload truncated to fit the URL length limit.)_\n";

  // Drop body content until under the cap; keep title.
  // Binary-search body length for speed on huge inputs.
  let lo = 0;
  let hi = b.length;
  let best = "";
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = b.slice(0, mid) + disclosure;
    const u = tryBuild(t, candidate);
    if (u.length <= cap) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best) {
    b = best;
    url = tryBuild(t, b);
  } else {
    // Title alone still too long, or pathological cap — emit bare base + short note.
    t = t.slice(0, 40);
    b = "_(Payload truncated to fit the URL length limit.)_";
    url = tryBuild(t, b);
    if (url.length > cap) {
      // Absolute last resort: bare base URL (still valid, still correct target).
      url = base;
      b = "";
    }
  }

  // Final safety: must parse and must point at the constant target.
  try {
    const parsed = new URL(url);
    const want = new URL(base);
    if (parsed.origin !== want.origin || parsed.pathname !== want.pathname) {
      url = base;
      truncated = true;
    }
  } catch {
    url = base;
    truncated = true;
  }

  return { url, truncated, title: t, body: b };
}

/**
 * Build a pre-filled GitHub new-issue URL from redacted metadata.
 *
 * @param {object} [meta]
 * @param {string} [meta.cliVersion]
 * @param {string} [meta.nodeVersion]
 * @param {string} [meta.platform]     os.platform() only — never hostname
 * @param {string} [meta.stackLabel]
 * @param {{ pass?: number, fail?: number, warn?: number, skip?: number }} [meta.counts]
 * @param {Array<{ label?: string, id?: string, status?: string }>} [meta.checks]
 * @param {string} [meta.verdict]
 * @param {number} [meta.exitCode]
 * @param {string} [meta.title]
 * @param {string} [meta.notes]
 * @param {string} [meta.homeDir]      optional; used only for redaction
 * @param {string} [meta.username]     optional; used only for redaction
 * @param {number} [meta.maxUrlChars]  override MAX_URL_CHARS (tests)
 * @returns {{
 *   url: string,
 *   truncated: boolean,
 *   title: string,
 *   body: string,
 *   base: string,
 * }}
 */
export function buildFeedbackUrl(meta = {}) {
  const { title, body } = buildFeedbackMarkdown(meta);
  const maxChars =
    typeof meta.maxUrlChars === "number" && meta.maxUrlChars > 0
      ? meta.maxUrlChars
      : MAX_URL_CHARS;
  const assembled = assembleFeedbackUrl(title, body, maxChars);
  return {
    url: assembled.url,
    truncated: assembled.truncated,
    title: assembled.title,
    body: assembled.body,
    base: FEEDBACK_NEW_ISSUE_BASE,
  };
}
