// getAdvantage — request-time policy gate (`getadvantage gate`).
//
// Deterministic OUTBOUND stdin filter. Pipe a prompt:
//   … | getadvantage gate              BLOCK (default)
//   … | getadvantage gate --redact     mask matches, exit 0
//   … | getadvantage gate --json       machine doc on stdout
//
// Shares SECRET_PATTERNS with ship-time via scanText(). PII + denylist are
// gate-layer extras (they must not land in SECRET_PATTERNS — that would
// change `check` verdicts). Extra evasion views are opt-in on scanText.
//
// v1 is outbound only: not inbound, not a proxy, not a daemon, not live
// as a request interceptor. Local proof only. Zero network. Zero model calls.
// Node built-ins only.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";
import { fingerprint, secretAuthId, stripBom, MARKER_DIR, LEGACY_MARKER_DIR, c, binName } from "./util.mjs";
import { scanText } from "./scan.mjs";

export const GATE_MAX_STDIN_BYTES = 1_048_576;
// Hang guards, not correctness bounds. Ordinary producer latency (a program
// that computes then emits, curl TTFB, a streaming writer) is seconds, not
// sub-second. 30s of silence is a stuck pipe; 2 min total still bounds a
// producer that dribbles bytes just inside the idle window. 1 MiB at ~9 KB/s
// still fits. H7 (stdin that never closes) must terminate on these.
export const GATE_STDIN_TIMEOUT_MS = 120_000;
export const GATE_STDIN_IDLE_MS = 30_000;
export const GATE_PROOF_DIR = "gate-proofs";

const AUTH_PREFIX_LEN = 8;

// ---------------------------------------------------------------------------
// PII (gate only — not SECRET_PATTERNS)
// ---------------------------------------------------------------------------

function isValidIban(raw) {
  const compact = String(raw || "").replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(compact)) return false;
  if (compact.length < 15 || compact.length > 34) return false;
  const rearr = compact.slice(4) + compact.slice(0, 4);
  let expanded = "";
  for (const ch of rearr) {
    if (ch >= "A" && ch <= "Z") expanded += String(ch.charCodeAt(0) - 55);
    else expanded += ch;
  }
  let rest = 0;
  for (const ch of expanded) rest = (rest * 10 + (ch.charCodeAt(0) - 48)) % 97;
  return rest === 1;
}

export const PII_PATTERNS = [
  {
    id: "email",
    label: "Email address",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    id: "phone",
    label: "Phone number",
    // Separator-required so "hello world" and ISO dates never fire.
    re: /\b(?:\+1[-.\s]?)?(?:\(?\d{3}\)?[-.\s])\d{3}[-.\s]\d{4}\b/g,
  },
  {
    id: "iban",
    label: "IBAN",
    re: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
    validate: (tok) => isValidIban(tok),
  },
  {
    id: "us-ssn",
    label: "US Social Security Number",
    re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
  },
];

function cloneRe(re) {
  return new RegExp(re.source, re.flags);
}

/**
 * Scan gate-only PII patterns. Hits include `raw` — callers must not print it.
 * @param {string} text
 */
export function scanPii(text) {
  const source = text == null ? "" : String(text);
  const hits = [];
  for (const p of PII_PATTERNS) {
    const re = cloneRe(p.re);
    for (const m of source.matchAll(re)) {
      const raw = m[0];
      if (p.validate && !p.validate(raw, m)) continue;
      const index = typeof m.index === "number" ? m.index : 0;
      hits.push({
        kind: "pii",
        raw,
        patternId: p.id,
        label: p.label,
        index,
        length: raw.length,
        originalIndex: index,
        originalLength: raw.length,
        fp: fingerprint(raw),
        authId: secretAuthId(raw),
        allowed: false,
        reason: null,
        view: "raw",
      });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Denylist — worktree config, NOT loadPolicy() (no git, no index trust)
// ---------------------------------------------------------------------------

/**
 * Read `.getadvantage/config.json` (or legacy `.ship-safe/`) from the
 * worktree/cwd directly. Missing file / malformed JSON / non-git → empty
 * list, never `fatal:` / `ENOENT` noise.
 * @param {string} cwd
 * @returns {string[]}
 */
export function loadGateDenylist(cwd) {
  const terms = [];
  const root = cwd || process.cwd();
  const candidates = [
    path.join(root, MARKER_DIR, "config.json"),
    path.join(root, LEGACY_MARKER_DIR, "config.json"),
  ];
  for (const abs of candidates) {
    let text;
    try {
      if (!existsSync(abs)) continue;
      text = readFileSync(abs, "utf8");
    } catch {
      continue; // unreadable — empty denylist, no noise
    }
    try {
      const json = JSON.parse(stripBom(text));
      const list = json && json.gate && Array.isArray(json.gate.denylist) ? json.gate.denylist : null;
      if (list) {
        for (const t of list) {
          if (typeof t === "string" && t.length >= 2) terms.push(t);
        }
      }
      break; // current marker wins even if denylist is empty
    } catch {
      break; // malformed — ignore silently
    }
  }
  return terms;
}

/**
 * @param {string} text
 * @param {string[]} terms
 */
export function matchDenylist(text, terms) {
  const source = text == null ? "" : String(text);
  const hits = [];
  if (!Array.isArray(terms) || terms.length === 0) return hits;
  for (const term of terms) {
    if (typeof term !== "string" || term.length < 2) continue;
    let from = 0;
    while (from <= source.length) {
      const index = source.indexOf(term, from);
      if (index < 0) break;
      hits.push({
        kind: "denylist",
        raw: term,
        patternId: "denylist",
        label: "Denylist term",
        index,
        length: term.length,
        originalIndex: index,
        originalLength: term.length,
        fp: fingerprint(term),
        authId: secretAuthId(term),
        allowed: false,
        reason: null,
        view: "raw",
        term,
      });
      from = index + Math.max(1, term.length);
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

export function redactionMask(hit) {
  const id = hit.patternId || "secret";
  const prefix = String(hit.authId || "00000000").slice(0, AUTH_PREFIX_LEN);
  return `[REDACTED:${id}:${prefix}]`;
}

function blockingHits(hits) {
  return (hits || []).filter((h) => !h.allowed);
}

/**
 * One occurrence is one hit. Evasion views of the same authId + original
 * span are the same secret, not three findings. Preserve view names as
 * `views[]` detail. Do not key on authId alone — H6 needs two copies of
 * the same secret at two spans to stay two hits / two masks.
 */
function collapseHitsByAuthSpan(hits) {
  const order = [];
  const map = new Map();
  for (const h of hits || []) {
    const start = typeof h.originalIndex === "number" ? h.originalIndex : h.index;
    const len = typeof h.originalLength === "number" ? h.originalLength : h.length;
    const key = `${h.kind || "secret"}\0${h.authId || ""}\0${start}\0${len}`;
    const view = h.view || "raw";
    const prev = map.get(key);
    if (!prev) {
      const copy = { ...h, views: [view] };
      map.set(key, copy);
      order.push(copy);
      continue;
    }
    if (!prev.views.includes(view)) prev.views.push(view);
    if (view === "raw" && prev.view !== "raw") {
      prev.view = "raw";
      prev.raw = h.raw;
      prev.index = h.index;
      prev.length = h.length;
    }
  }
  return order;
}

function applyRedactions(text, hits) {
  const source = String(text ?? "");
  const spans = [];
  for (const h of blockingHits(hits)) {
    const start = typeof h.originalIndex === "number" ? h.originalIndex : h.index;
    const len = typeof h.originalLength === "number" ? h.originalLength : h.length;
    if (typeof start !== "number" || start < 0 || start >= source.length) continue;
    const end = Math.min(source.length, start + Math.max(0, len));
    if (end <= start) continue;
    spans.push({ start, end, mask: redactionMask(h) });
  }
  spans.sort((a, b) => b.start - a.start || b.end - a.end);
  const used = [];
  let out = source;
  for (const s of spans) {
    if (used.some((u) => s.start < u.end && s.end > u.start)) continue;
    out = out.slice(0, s.start) + s.mask + out.slice(s.end);
    used.push(s);
  }
  return out;
}

function redactionMapHash(hits) {
  const blocking = blockingHits(hits);
  if (blocking.length === 0) return null;
  const map = {};
  for (const h of blocking) {
    const mask = redactionMask(h);
    if (!map[mask]) map[mask] = h.authId || "";
  }
  const keys = Object.keys(map).sort();
  const canonical = JSON.stringify(Object.fromEntries(keys.map((k) => [k, map[k]])));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function sanitizeHit(h) {
  const views = Array.isArray(h.views) && h.views.length > 0
    ? h.views
    : [h.view || "raw"];
  return {
    kind: h.kind || "secret",
    patternId: h.patternId,
    label: h.label,
    fp: h.fp,
    authId: h.authId,
    view: views.includes("raw") ? "raw" : (h.view || views[0]),
    views,
  };
}

// ---------------------------------------------------------------------------
// Evaluate
// ---------------------------------------------------------------------------

/**
 * Scan a payload (secrets + PII + denylist). Never prints.
 *
 * @param {string} text
 * @param {{ cwd?: string, redact?: boolean, denylist?: string[] }} [opts]
 */
export function evaluatePayload(text, opts = {}) {
  const source = text == null ? "" : String(text);
  const cwd = opts.cwd || process.cwd();
  const terms = Array.isArray(opts.denylist) ? opts.denylist : loadGateDenylist(cwd);

  const secretHits = scanText(source, {
    file: "<stdin>",
    evasions: true,
  }).map((h) => ({ ...h, kind: h.kind || "secret" }));
  const piiHits = scanPii(source);
  const denyHits = matchDenylist(source, terms);
  const hits = collapseHitsByAuthSpan([...secretHits, ...piiHits, ...denyHits]);
  const blocking = blockingHits(hits);

  let action = "PASS";
  let redacted = null;
  let mapHash = null;
  if (blocking.length > 0) {
    if (opts.redact) {
      action = "REDACT";
      redacted = applyRedactions(source, hits);
      mapHash = redactionMapHash(hits);
    } else {
      action = "BLOCK";
      mapHash = redactionMapHash(hits);
    }
  }

  return {
    action,
    hits,
    blocking,
    redacted,
    redactionMapHash: mapHash,
    text: source,
  };
}

// ---------------------------------------------------------------------------
// Proof record (local, zero telemetry, never the raw secret)
// ---------------------------------------------------------------------------

function payloadSha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function proofFilename() {
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  const nonce = randomBytes(6).toString("hex");
  return `${iso}-${nonce}.json`;
}

function stripRawFields(node) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    for (const n of node) stripRawFields(n);
    return node;
  }
  if ("raw" in node) delete node.raw;
  for (const v of Object.values(node)) stripRawFields(v);
  return node;
}

export function writeGateProof(cwd, record) {
  const dir = path.join(cwd || process.cwd(), MARKER_DIR, GATE_PROOF_DIR);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return null;
  }
  const abs = path.join(dir, proofFilename());
  const tmp = `${abs}.tmp-${process.pid}`;
  try {
    const body = JSON.stringify(stripRawFields(record), null, 2) + "\n";
    writeFileSync(tmp, body, "utf8");
    renameSync(tmp, abs);
    return abs;
  } catch {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return null;
  }
}

/** Closed enum for proof / `--json` `reason`. Success path is JSON `null`. */
const GATE_REASON_CLOSED = new Set(["max-bytes", "idle", "total", "error"]);

export function closedTruncationReason(reason, truncated) {
  if (!truncated) return null;
  if (GATE_REASON_CLOSED.has(reason)) return reason;
  return "error";
}

function buildProofRecord({ action, hits, bytes, sha256, redactionMapHash: mapHash, truncated = false, reason = null }) {
  return {
    version: 1,
    command: "gate",
    generatedAt: new Date().toISOString(),
    bytes,
    sha256,
    action,
    truncated: !!truncated,
    reason: closedTruncationReason(reason, truncated),
    hits: blockingHits(hits).map(sanitizeHit),
    redactionMapHash: mapHash,
  };
}

function buildJsonDoc({ action, hits, bytes, sha256, redactionMapHash: mapHash, exitCode, truncated = false, reason = null }) {
  return {
    command: "gate",
    verdict: action,
    exitCode,
    action,
    bytes,
    sha256,
    truncated: !!truncated,
    reason: closedTruncationReason(reason, truncated),
    hits: blockingHits(hits).map(sanitizeHit),
    redactionMapHash: mapHash,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Stdin bound (1 MiB + idle/total hang guards). Must not hang. A partial
// read is never a successful scan — callers must fail closed on truncated.
// ---------------------------------------------------------------------------

/**
 * Bounded stdin read. Resolves `{ buf, truncated, reason }`.
 * `truncated` is true when the byte cap overflowed, the idle timer fired
 * with the stream still open, the total timer fired with the stream still
 * open, or the stream errored. False on a clean `end` — including a clean
 * `end` that lands exactly on `maxBytes`.
 * `reason` is `max-bytes` | `idle` | `total` | `error` | null.
 */
export function readStdinBounded({
  maxBytes = GATE_MAX_STDIN_BYTES,
  totalMs = GATE_STDIN_TIMEOUT_MS,
  idleMs = GATE_STDIN_IDLE_MS,
  stream = process.stdin,
} = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    let idleTimer = null;
    const finish = (why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      try {
        stream.removeListener("data", onData);
      } catch {
        /* ignore */
      }
      try {
        stream.removeListener("end", onEnd);
      } catch {
        /* ignore */
      }
      try {
        stream.removeListener("error", onError);
      } catch {
        /* ignore */
      }
      try {
        if (typeof stream.pause === "function") stream.pause();
      } catch {
        /* ignore */
      }
      try {
        if (typeof stream.destroy === "function") stream.destroy();
      } catch {
        /* ignore */
      }
      try {
        if (typeof stream.unref === "function") stream.unref();
      } catch {
        /* ignore */
      }
      const truncated = why !== "end";
      resolve({
        buf: Buffer.concat(chunks, total),
        truncated,
        reason: truncated ? why : null,
      });
    };
    const bumpIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (idleMs > 0) idleTimer = setTimeout(() => finish("idle"), idleMs);
    };
    const timer = setTimeout(() => finish("total"), totalMs);
    const onData = (chunk) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const room = maxBytes - total;
      if (room <= 0) {
        finish("max-bytes");
        return;
      }
      if (buf.length > room) {
        chunks.push(buf.subarray(0, room));
        total += room;
        finish("max-bytes");
        return;
      }
      chunks.push(buf);
      total += buf.length;
      // Exact fill is not truncation until more data arrives, a timer
      // fires with the stream still open, or a clean `end` lands.
      bumpIdle();
    };
    const onEnd = () => finish("end");
    const onError = () => finish("error");
    if (stream.readableEnded) {
      finish("end");
      return;
    }
    bumpIdle();
    stream.on("data", onData);
    stream.on("end", onEnd);
    stream.on("error", onError);
    try {
      if (typeof stream.resume === "function") stream.resume();
    } catch {
      /* ignore */
    }
  });
}

// ---------------------------------------------------------------------------
// Human output (stderr). Never the raw secret. Never the redaction map.
// ---------------------------------------------------------------------------

export function printGateUsage() {
  const bin = binName();
  console.error(`${c.bold("gate")} — request-time policy gate (outbound stdin filter).`);
  console.error(`  Pipe a prompt:   … | ${bin} gate`);
  console.error(`                   … | ${bin} gate --redact`);
  console.error(`                   … | ${bin} gate --json`);
  console.error("  BLOCK (default): non-zero exit, payload withheld from stdout.");
  console.error("  --redact:        mask matches, write the rest, exit 0.");
  console.error(
    `  Stdin bounds: max ${GATE_MAX_STDIN_BYTES} bytes (1 MiB); idle ${GATE_STDIN_IDLE_MS} ms; total ${GATE_STDIN_TIMEOUT_MS} ms.`,
  );
  console.error("  Hitting a bound: non-zero exit, nothing of the payload on stdout, named reason");
  console.error("  on stderr, proof action INCOMPLETE (never PASS). Close stdin when the prompt is complete.");
  console.error("  Base64 evasion decodes one level; a twice-encoded secret is not detected.");
  console.error("  PASS writes the raw stdin bytes; --redact re-encodes UTF-8, so non-UTF-8 input");
  console.error("  may contain U+FFFD replacement characters.");
  console.error("  Local proof under .getadvantage/gate-proofs/. Not inbound. Not a proxy.");
  console.error("  Not in published getadvantage@0.14.1. Not live as a request interceptor.");
}

function printBlockHuman(evalResult) {
  const first = evalResult.blocking[0];
  const n = evalResult.blocking.length;
  const detector = first
    ? `${first.label} (${first.patternId})`
    : "policy detector";
  console.error(c.red(`✗ Policy gate BLOCK — ${detector}`));
  if (n > 1) {
    console.error(c.gray(`  ${n} hit${n === 1 ? "" : "s"} total (first named).`));
  }
  console.error(c.gray(`  Detector: ${detector}`));
  if (first && first.kind === "denylist") {
    console.error(
      c.gray(
        "  Remedy: remove the denylisted project term from the prompt, or drop it from .getadvantage/config.json gate.denylist if this is a false positive.",
      ),
    );
  } else if (first && first.kind === "pii") {
    console.error(
      c.gray(
        "  Remedy: remove personal data from the prompt before sending it to a model, or re-run with --redact to mask matches.",
      ),
    );
  } else {
    console.error(
      c.gray(
        "  Remedy: remove the secret from the prompt before sending it to a model, or re-run with --redact to mask matches. Rotate the credential if it may have left the machine.",
      ),
    );
  }
  console.error(c.gray("  The payload was not written to stdout."));
}

function printIncompleteHuman(reason) {
  const bound =
    reason === "max-bytes"
      ? `stdin exceeded ${GATE_MAX_STDIN_BYTES} bytes (1 MiB)`
      : reason === "idle"
        ? `stdin idle for ${GATE_STDIN_IDLE_MS} ms with the stream still open`
        : reason === "total"
          ? `stdin read exceeded ${GATE_STDIN_TIMEOUT_MS} ms with the stream still open`
          : reason === "error"
            ? "stdin closed with an error before a clean end"
            : "stdin read was incomplete";
  console.error(c.red(`✗ Policy gate INCOMPLETE — ${bound}`));
  console.error(c.gray("  Unread bytes were not scanned. The gate did not PASS this payload."));
  if (reason === "max-bytes") {
    console.error(
      c.gray(
        `  Remedy: shorten the prompt to at most ${GATE_MAX_STDIN_BYTES} bytes (1 MiB) and re-pipe.`,
      ),
    );
  } else if (reason === "idle") {
    console.error(
      c.gray(
        `  Remedy: keep stdin flowing, or close it when the prompt is complete. A pause longer than ${GATE_STDIN_IDLE_MS} ms is treated as a hang.`,
      ),
    );
  } else if (reason === "total") {
    console.error(
      c.gray(
        `  Remedy: finish writing and close stdin within ${GATE_STDIN_TIMEOUT_MS} ms.`,
      ),
    );
  } else {
    console.error(c.gray("  Remedy: re-pipe the prompt so stdin ends cleanly."));
  }
  console.error(c.gray("  The payload was not written to stdout."));
}

export function printGateHelp() {
  const bin = binName();
  console.log(`${c.bold("gate")} — request-time policy gate (outbound stdin filter).`);
  console.log("");
  console.log("Usage");
  console.log(`  … | ${bin} gate             BLOCK (default): withhold the payload, exit 1`);
  console.log(`  … | ${bin} gate --redact    mask matches, write the rest, exit 0`);
  console.log(`  … | ${bin} gate --json      machine document on stdout (human text on stderr)`);
  console.log("");
  console.log("What it scans (this process, this payload):");
  console.log("  leaked-secret patterns (same corpus as check), PII (email/phone/IBAN/SSN),");
  console.log("  and an optional project denylist in .getadvantage/config.json:");
  console.log('    { "version": 1, "gate": { "denylist": ["PROJECT-CODENAME"] } }');
  console.log("");
  console.log("Stdin bounds (hitting one fails closed — non-zero exit, nothing of the");
  console.log("payload on stdout, named reason on stderr, proof action INCOMPLETE never PASS):");
  console.log(`  max ${GATE_MAX_STDIN_BYTES} bytes (1 MiB); idle ${GATE_STDIN_IDLE_MS} ms; total ${GATE_STDIN_TIMEOUT_MS} ms.`);
  console.log("  Close stdin when the prompt is complete. A pause longer than the idle bound,");
  console.log("  a read longer than the total bound, or a payload over the byte cap is treated");
  console.log("  as incomplete, not as a successful scan.");
  console.log("");
  console.log("Limits (this process, this payload — not a completeness claim):");
  console.log("  Base64 evasion decodes one level; a twice-encoded secret is not detected.");
  console.log("  PASS writes the raw stdin bytes (byte-identical). --redact re-encodes a string");
  console.log("  as UTF-8, so non-UTF-8 input may contain U+FFFD replacement characters.");
  console.log("");
  console.log("Not inbound. Not a proxy or daemon. Local proof only");
  console.log("(`.getadvantage/gate-proofs/`). Never writes the raw secret.");
  console.log("Not in published getadvantage@0.14.1. Not live as a request interceptor.");
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

/**
 * @param {{ flags?: Record<string, unknown>, cwd?: string, emitJson?: ((doc: object) => void)|null }} opts
 * @returns {Promise<number>}
 */
export async function runPolicyGate(opts = {}) {
  const flags = opts.flags || {};
  const cwd = opts.cwd || process.cwd();
  const emitJson = typeof opts.emitJson === "function" ? opts.emitJson : null;

  if (flags.help) {
    printGateHelp();
    return 0;
  }

  if (process.stdin.isTTY) {
    printGateUsage();
    return 1;
  }

  const { buf, truncated, reason } = await readStdinBounded();
  const bytes = buf.length;
  const sha256 = payloadSha256(buf);

  if (truncated) {
    const exitCode = 1;
    const proof = buildProofRecord({
      action: "INCOMPLETE",
      hits: [],
      bytes,
      sha256,
      redactionMapHash: null,
      truncated: true,
      reason,
    });
    writeGateProof(cwd, proof);
    printIncompleteHuman(reason);
    if (emitJson) {
      emitJson(
        buildJsonDoc({
          action: "INCOMPLETE",
          hits: [],
          bytes,
          sha256,
          redactionMapHash: null,
          exitCode,
          truncated: true,
          reason,
        }),
      );
    }
    return exitCode;
  }

  const text = buf.toString("utf8");
  const evaluated = evaluatePayload(text, { cwd, redact: !!flags.redact });
  const exitCode = evaluated.action === "BLOCK" ? 1 : 0;

  const proof = buildProofRecord({
    action: evaluated.action,
    hits: evaluated.hits,
    bytes,
    sha256,
    redactionMapHash: evaluated.redactionMapHash,
    truncated: false,
    reason: null,
  });
  writeGateProof(cwd, proof);

  if (emitJson) {
    if (evaluated.action === "BLOCK") printBlockHuman(evaluated);
    emitJson(
      buildJsonDoc({
        action: evaluated.action,
        hits: evaluated.hits,
        bytes,
        sha256,
        redactionMapHash: evaluated.redactionMapHash,
        exitCode,
        truncated: false,
        reason: null,
      }),
    );
    return exitCode;
  }

  if (evaluated.action === "BLOCK") {
    printBlockHuman(evaluated);
    return 1;
  }

  if (evaluated.action === "REDACT") {
    writeStdoutBytes(evaluated.redacted ?? "");
    return 0;
  }

  // PASS: byte-identical payload, no header, nothing else on stdout.
  // writeSync: process.stdout.write + process.exit drops the tail of a 1 MiB
  // payload on Linux (pipe never drains). Measured 146176 B of 1048576 B
  // on ubuntu-latest run 32739421548.
  writeStdoutBytes(buf);
  return 0;
}

/** Blocking stdout write so PASS/REDACT survive process.exit. */
function writeStdoutBytes(data) {
  if (data == null) return;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  let offset = 0;
  while (offset < buf.length) {
    const n = writeSync(1, buf.subarray(offset));
    if (!n) break;
    offset += n;
  }
}
