// getAdvantage — text-level secret scan primitive.
//
// One corpus (`SECRET_PATTERNS`) shared by ship-time `checkSecrets` and the
// request-time policy gate. `scanText(text)` is the missing primitive: the
// ship-time path used to walk the git index and inline the match loop.
//
// Extra evasion views (newline-fold, unicode-strip, base64-decode) are
// OPT-IN (`opts.evasions = true`) and MUST stay off the default ship-time
// path — turning them on by default would change `check` verdicts.
//
// Node built-ins only. Zero network. Never prints a raw secret.

import { emptyPolicy, secretAllowDecision } from "./policy.mjs";

// ---------------------------------------------------------------------------
// Corpus (20 detectors). Identical to the pre-extraction catalogue.
// ---------------------------------------------------------------------------

// Shared validator: real API keys contain at least one digit; CSS class-name
// chains ("sk-circle-fade-dot-before-anim") and prose practically never do.
const hasDigit = (tok) => /[0-9]/.test(tok);

// Anchors are alnum lookarounds, not `\b`. `_` is a JS word char, so `\b`
// misses ordinary `PREFIX_sk_live_…` names. Delta vs `\b` is exactly `_`.
// Letter/digit adjacency still blocks, so pattern-shaped substrings inside
// base64 (`xAKIA…y`) do not match. PEM patterns have no `\b` and stay as-is.
export const SECRET_PATTERNS = [
  // --- from app/lib/safety.ts ---
  // Anthropic BEFORE OpenAI: `sk-ant-…` also matches the broader sk- shape, so
  // the specific pattern must claim it first (and openai's validator skips it).
  { id: "anthropic", label: "Anthropic secret key", re: /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{20,}/g, validate: hasDigit },
  {
    id: "openai",
    label: "OpenAI secret key",
    re: /(?<![A-Za-z0-9])sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
    // Digit required (kills CSS-class false positives); sk-ant- is Anthropic's.
    validate: (tok) => hasDigit(tok) && !tok.startsWith("sk-ant-"),
  },
  { id: "stripe-live", label: "Stripe live secret key", re: /(?<![A-Za-z0-9])sk_live_[A-Za-z0-9]{20,}/g },
  { id: "stripe-restricted", label: "Stripe restricted key", re: /(?<![A-Za-z0-9])rk_live_[A-Za-z0-9]{20,}/g },
  { id: "aws", label: "AWS access key id", re: /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/g },
  { id: "github-pat", label: "GitHub personal access token", re: /(?<![A-Za-z0-9])ghp_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g },
  { id: "github-fine", label: "GitHub fine-grained token", re: /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{22,}(?![A-Za-z0-9])/g },
  { id: "google-oauth", label: "Google OAuth secret", re: /(?<![A-Za-z0-9])GOCSPX-[A-Za-z0-9_-]{20,}(?![A-Za-z0-9])/g },
  { id: "slack", label: "Slack token", re: /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}(?![A-Za-z0-9])/g },
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
  { id: "sendgrid", label: "SendGrid key", re: /(?<![A-Za-z0-9])SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}(?![A-Za-z0-9])/g },
  // --- from CLAUDE.md hard-rule #2 (the pre-commit scan literals) ---
  { id: "stripe-webhook", label: "Stripe webhook secret (whsec_)", re: /(?<![A-Za-z0-9])whsec_[A-Za-z0-9]{20,}/g },
  { id: "vercel-token", label: "Vercel token (vcp_)", re: /(?<![A-Za-z0-9])vcp_[A-Za-z0-9]{20,}/g },
  { id: "kv-rest", label: "KV/Redis REST credential", re: /(?<![A-Za-z0-9])KV_REST_API_(?:URL|TOKEN|READ_ONLY_TOKEN)\s*=\s*\S+/g },
  // getAdvantage's OWN platform key format: adv_live_ + lowercase base36. A
  // dedicated pattern because the generic Bearer heuristic below requires MIXED
  // case + a digit and would miss an all-lowercase token like this one.
  { id: "getadvantage-key", label: "getAdvantage platform key (adv_live_)", re: /(?<![A-Za-z0-9])adv_live_[a-z0-9]{16,}(?![A-Za-z0-9])/g },
  // --- coverage additions (v0.6.0) ---
  // npm access/automation token (the `.npmrc _authToken=npm_…` leak).
  { id: "npm-token", label: "npm access token", re: /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g },
  // Bare JWT (three base64url segments, no "Bearer" prefix needed). To keep
  // false positives near zero we only flag it if the FIRST segment decodes to
  // a JSON object with an `alg` or `typ` field — i.e. a real JWT header.
  {
    id: "jwt",
    label: "JSON Web Token (JWT)",
    re: /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9])/g,
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
    re: /(?<![A-Za-z0-9])postgres(?:ql)?:\/\/[^\s:/@'"]+:([^@\s'"]{8,})@([^\s'"/]+)/g,
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
    re: /(?<![A-Za-z0-9])Bearer\s+([A-Za-z0-9_\-.]{20,})/g,
    validate: (tok) => /[a-z]/.test(tok) && /[A-Z]/.test(tok) && /[0-9]/.test(tok),
  },
];

const PEM_PATTERN_IDS = new Set(["private-key", "private-key-incomplete"]);

// Gate-only evasion toggles. Mutation-proof tests flip these in a scratch copy.
// Ship-time never sets opts.evasions, so these are unreachable on `check`.
export const GATE_EVASION_NEWLINE_FOLD = true;
export const GATE_EVASION_UNICODE = true;
export const GATE_EVASION_BASE64 = true;
// Composed H1∩H2 view. Independent of the single-transform flags so a
// mutation can disable only the combined path (H9).
export const GATE_EVASION_UNICODE_NEWLINE = true;

function cloneRe(re) {
  return new RegExp(re.source, re.flags);
}

// ---------------------------------------------------------------------------
// H1 — newline / split: fold CR/LF out of a view; keep an index map back.
// PEM stays on the raw view (folding would smash BEGIN/END blocks).
// ---------------------------------------------------------------------------

/**
 * Drop CR/LF from `text`, recording folded-index → original-index.
 * @param {string} text
 * @returns {{ folded: string, indexMap: number[] }}
 */
export function foldNewlines(text) {
  const s = String(text ?? "");
  const chars = [];
  const indexMap = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\n" || ch === "\r") continue;
    indexMap.push(i);
    chars.push(ch);
  }
  indexMap.push(s.length);
  return { folded: chars.join(""), indexMap };
}

// ---------------------------------------------------------------------------
// H2 — unicode smuggle: strip Cf format chars + map common homoglyphs.
// ---------------------------------------------------------------------------

const CF_CODEPOINTS = new Set([
  0x200b, // ZWSP
  0x200c, // ZWNJ
  0x200d, // ZWJ
  0x200e, // LRM
  0x200f, // RLM
  0x202a, // LRE
  0x202b, // RLE
  0x202c, // PDF
  0x202d, // LRO
  0x202e, // RLO
  0x2060, // word joiner
  0x2066, // LRI
  0x2067, // RLI
  0x2068, // FSI
  0x2069, // PDI
  0xfeff, // BOM / ZWNBSP
  0x00ad, // soft hyphen
]);

const HOMOGLYPH = {
  "\u0430": "a", // Cyrillic a
  "\u0435": "e",
  "\u043e": "o",
  "\u0440": "p",
  "\u0441": "c",
  "\u0443": "y",
  "\u0445": "x",
  "\u0456": "i",
  "\u0455": "s",
  "\u0501": "d",
  "\u0261": "g",
  "\u0391": "A", // Greek
  "\u0392": "B",
  "\u0395": "E",
  "\u0396": "Z",
  "\u0397": "H",
  "\u0399": "I",
  "\u039a": "K",
  "\u039c": "M",
  "\u039d": "N",
  "\u039f": "O",
  "\u03a1": "P",
  "\u03a4": "T",
  "\u03a5": "Y",
  "\u03a7": "X",
  "\u03b1": "a",
  "\u03bf": "o",
  "\u03c1": "p",
  "\u03c5": "y",
  "\u03c7": "x",
  "\u03ba": "k",
  "\u03bd": "v",
  "\u03c4": "t",
  "\u03b7": "n",
};

/**
 * Strip Cf format characters and map common Cyrillic/Greek lookalikes to ASCII.
 * @param {string} text
 * @returns {{ stripped: string, indexMap: number[] }}
 */
export function stripCfAndHomoglyphs(text) {
  const s = String(text ?? "");
  const chars = [];
  const indexMap = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (CF_CODEPOINTS.has(code)) continue;
    const ch = s[i];
    chars.push(HOMOGLYPH[ch] || ch);
    indexMap.push(i);
  }
  indexMap.push(s.length);
  return { stripped: chars.join(""), indexMap };
}

// ---------------------------------------------------------------------------
// H3 — base64: find base64-looking blobs, decode, scan decoded text.
// ---------------------------------------------------------------------------

const B64_RE = /(?:[A-Za-z0-9+/]{4}){6,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})/g;
const MAX_B64_BLOBS = 48;
const MAX_B64_DECODE_BYTES = 262_144;

/**
 * @param {string} text
 * @returns {Array<{ index: number, length: number, text: string, decoded: string }>}
 */
export function findBase64Blobs(text) {
  const s = String(text ?? "");
  const out = [];
  const re = cloneRe(B64_RE);
  for (const m of s.matchAll(re)) {
    if (out.length >= MAX_B64_BLOBS) break;
    const blob = m[0];
    let decoded;
    try {
      const buf = Buffer.from(blob, "base64");
      if (buf.length === 0 || buf.length > MAX_B64_DECODE_BYTES) continue;
      // Reject obvious binary (NUL in the first 4KB).
      const n = Math.min(buf.length, 4096);
      let binary = false;
      for (let i = 0; i < n; i++) {
        if (buf[i] === 0) {
          binary = true;
          break;
        }
      }
      if (binary) continue;
      decoded = buf.toString("utf8");
    } catch {
      continue;
    }
    if (!decoded) continue;
    out.push({
      index: m.index ?? 0,
      length: blob.length,
      text: blob,
      decoded,
    });
  }
  return out;
}

function origSpan(indexMap, start, length, fallbackLen) {
  if (!indexMap || indexMap.length === 0) {
    return { originalIndex: start, originalLength: length };
  }
  const origStart = indexMap[start] ?? 0;
  if (length <= 0) {
    return { originalIndex: origStart, originalLength: 0 };
  }
  // Exclusive end is (original index of last kept char) + 1 — not
  // indexMap[start+length], which is the sentinel `source.length` when the
  // match runs to the end of the folded view and would swallow trailing
  // CR/LF that the raw view never included (1 secret → 2 spans).
  const lastFolded = start + length - 1;
  const origLast = indexMap[lastFolded];
  const origEnd =
    typeof origLast === "number"
      ? origLast + 1
      : (indexMap[indexMap.length - 1] ?? origStart + length);
  return {
    originalIndex: origStart,
    originalLength: Math.max(0, origEnd - origStart) || fallbackLen,
  };
}

/**
 * Run SECRET_PATTERNS against a string.
 *
 * Hits always include `raw` (callers MUST NOT print it: not CLI stdout,
 * stderr, proof, or --json). `fp` / `authId` come from secretAllowDecision
 * so `private-key-incomplete` cannot authorize by hash.
 *
 * @param {string} text
 * @param {{
 *   file?: string,
 *   policy?: ReturnType<typeof emptyPolicy>,
 *   evasions?: boolean,
 * }} [opts]
 * @returns {Array<{
 *   raw: string,
 *   patternId: string,
 *   label: string,
 *   index: number,
 *   length: number,
 *   fp: string,
 *   authId: string,
 *   allowed: boolean,
 *   reason: string|null,
 *   view: string,
 *   originalIndex: number,
 *   originalLength: number,
 * }>}
 */
export function scanText(text, opts = {}) {
  const source = text == null ? "" : String(text);
  const file = opts.file || "";
  const policy = opts.policy || emptyPolicy();
  const evasions = !!opts.evasions;
  const hits = [];

  const runOn = (viewText, viewName, indexMap, spanOverride) => {
    if (!viewText) return;
    for (const p of SECRET_PATTERNS) {
      if ((viewName === "newline-fold" || viewName === "unicode-fold") && PEM_PATTERN_IDS.has(p.id)) continue;
      const re = cloneRe(p.re);
      for (const m of viewText.matchAll(re)) {
        const token = m[1] ?? m[0];
        if (p.validate && !p.validate(token, m)) continue;
        const raw = m[0];
        const decision = secretAllowDecision(raw, {
          file,
          patternId: p.id,
          policy,
        });
        const index = typeof m.index === "number" ? m.index : 0;
        const span = spanOverride
          ? spanOverride
          : origSpan(indexMap, index, raw.length, raw.length);
        hits.push({
          raw,
          patternId: p.id,
          label: p.label,
          index,
          length: raw.length,
          fp: decision.fp,
          authId: decision.authId,
          allowed: decision.allowed,
          reason: decision.reason,
          view: viewName,
          originalIndex: span.originalIndex,
          originalLength: span.originalLength,
        });
      }
    }
  };

  runOn(source, "raw", null, null);

  if (evasions) {
    if (GATE_EVASION_NEWLINE_FOLD) {
      const { folded, indexMap } = foldNewlines(source);
      if (folded !== source) runOn(folded, "newline-fold", indexMap, null);
    }
    if (GATE_EVASION_UNICODE) {
      const { stripped, indexMap } = stripCfAndHomoglyphs(source);
      if (stripped !== source) runOn(stripped, "unicode", indexMap, null);
    }
    if (GATE_EVASION_UNICODE_NEWLINE && GATE_EVASION_UNICODE && GATE_EVASION_NEWLINE_FOLD) {
      const uni = stripCfAndHomoglyphs(source);
      // Combined view is H1∩H2 only: both transforms must actually change the
      // text. Otherwise unicode-fold duplicates newline-fold on any CR/LF
      // payload (hit-count inflation: 1 secret → 3 views).
      if (uni.stripped !== source) {
        const folded = foldNewlines(uni.stripped);
        if (folded.folded !== uni.stripped) {
          const composed = [];
          for (const inner of folded.indexMap) {
            composed.push(uni.indexMap[inner] ?? uni.indexMap[uni.indexMap.length - 1] ?? inner);
          }
          runOn(folded.folded, "unicode-fold", composed, null);
        }
      }
    }
    if (GATE_EVASION_BASE64) {
      for (const blob of findBase64Blobs(source)) {
        runOn(blob.decoded, "base64", null, {
          originalIndex: blob.index,
          originalLength: blob.length,
        });
      }
    }
  }

  return hits;
}
