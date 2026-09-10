// getAdvantage — approval decision engine (`getadvantage approve`).
//
// Stage A: deterministic policy decision per agent action (allow / block /
// escalate), an append-only proof record, a file escalation queue, and a
// named-human resolve path. MCP `approve_action` is stage B and must wrap
// the same `decide()`. Webhook / Slack / Teams adapters are out of scope
// and are not stubbed.
//
// Precedence (locked by tests; do not "improve" without updating them):
//   1. A rule matches when every field it names glob-matches the descriptor
//      (absent field = any). Globs are the existing policy.mjs subset
//      (`pathMatchesGlob`); Windows `\` is normalised to `/` first.
//   2. Among matches, the winner is the most specific (count of named match
//      fields). Tie: earlier in `approvals.rules`.
//   3. UNKNOWN dataClass lock: a descriptor with no dataClass never matches
//      an `allow` rule that does not itself name `dataClass`. Unknown is
//      never `allow` through a wildcard-allow rule. Block / escalate rules
//      may still match.
//   4. No match → `approvals.default`, and a missing default is `escalate`.
//   5. An allow rule without a stable `id` is not an allow: the policy is
//      refused as invalid (H8). `decide()` also refuses to return `allow`
//      without a rule id except for a trusted committed blanket default.
//   6. Authorizing content is the git INDEX blob (`readGitIndexText`), never
//      an unstaged worktree edit. Untracked / gitignored policy is warned
//      and never allows. A policy file that does not authorize cannot
//      authorize.
//
// L3/L4: extra top-level keys (e.g. `tools`, `models`) are ignored. Extra
// rule keys are ignored. Match fields counted for specificity today:
// action, resource, dataClass, actor, plus reserved `tool` and `model`.
//
// Zero dependencies. Node built-ins only. ESM.

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { pathMatchesGlob, isPolicyPathInIndex } from "./policy.mjs";
import {
  binName,
  c,
  classifyGitCwd,
  cliVersion,
  MARKER_DIR,
  readGitIndexText,
  readJsonFile,
  secretAuthId,
  stripBom,
} from "./util.mjs";

export const POLICY_REL = `${MARKER_DIR}/policy.json`;
export const APPROVALS_SUBDIR = "approvals";
export const MATCH_KEYS = Object.freeze([
  "action",
  "resource",
  "dataClass",
  "actor",
  "tool",
  "model",
]);
export const EXIT = Object.freeze({ allow: 0, block: 1, escalate: 2 });
/** Proof fields stored in the clear so an owner can read what happened. */
export const PROOF_PLAIN_FIELDS = Object.freeze(["action", "actor", "model", "dataClass"]);
/** First packet contract. Integer `version: 1` is this checkout's line body, not a released schema. */
export const PROOF_PACKET_SCHEMA = "getadvantage.proof.packet.v1";
export const PROOF_GENESIS_DIGEST = "0".repeat(64);
export const PROOF_EXPORT_MAX_LINES = 10000;
/** One byte ceiling for a JSONL line on both write and read. Hash the complete line. */
export const PROOF_RECORD_MAX_BYTES = 256 * 1024;
/** Cumulative export budget so 10k lines at the per-line cap cannot allocate a single string. */
export const PROOF_EXPORT_MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const PROOF_LOCK_WAIT_MS = 10_000;
const PROOF_LOCK_STALE_MS = 30_000;
const PROOF_CRED_WALK_MAX_DEPTH = 16;
const PROOF_RECORD_VERSIONS = new Set([1, 2]);
const OUTCOMES = new Set(["allow", "block", "escalate"]);
const ID_MAX = 80;
// Conservative shapes only — refuse these in cleartext proof fields rather
// than persist them. Do not import scan.mjs; this door must not widen the
// secret catalogue. Anchors are alnum lookarounds, not `\b`: `_` is a JS
// word char, so `\b` misses ordinary `PREFIX_sk_live_…` names (the 0.14.2
// scanner defect). Letter/digit adjacency (`xAKIA…`) is a disclosed miss,
// same as the scanner. sk-proj and adv_live are shapes the scanner already
// recognizes; they are not a new catalogue.
const CREDENTIAL_FIELD_RE = [
  /(?<![A-Za-z0-9])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/,
  /(?<![A-Za-z0-9])sk_live_[0-9A-Za-z]{16,}/,
  /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9\-_]{16,}/,
  /(?<![A-Za-z0-9])sk-proj-[A-Za-z0-9\-_]{16,}/,
  /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}/,
  /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}(?![A-Za-z0-9])/,
  /(?<![A-Za-z0-9])adv_live_[a-z0-9]{16,}(?![A-Za-z0-9])/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

function own(obj, key) {
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) return undefined;
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return undefined;
  return obj[key];
}

function asString(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function nonempty(v) {
  const s = asString(v).trim();
  return s.length > 0 ? s : "";
}

function fieldLooksLikeCredential(value) {
  const s = asString(value);
  if (!s) return false;
  for (const re of CREDENTIAL_FIELD_RE) {
    re.lastIndex = 0;
    if (re.test(s)) return true;
  }
  return false;
}

/** Field names in diagnostics must never carry an unvalidated value. */
function diagnosticFieldName(key) {
  const s = typeof key === "string" ? key : "";
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(s) || fieldLooksLikeCredential(s)) return "record";
  return s;
}

/**
 * Machine-readable error bodies must not reintroduce a value the human path
 * already refused. Walks the document and replaces credential-shaped strings
 * with null. Used by CLI `--json` error documents and MCP JSON result blocks.
 */
export function omitCredentialShaped(value) {
  if (typeof value === "string") return fieldLooksLikeCredential(value) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return fieldLooksLikeCredential(String(value)) ? null : value;
  }
  if (Array.isArray(value)) return value.map(omitCredentialShaped);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = omitCredentialShaped(value[key]);
    return out;
  }
  return value;
}

function emitErrorJson(emitJson, doc) {
  if (typeof emitJson !== "function") return;
  emitJson(omitCredentialShaped(doc));
}

/**
 * Name of the first persisted caller-controlled field that looks like a
 * secret, or null. resource and summary are digested and are not checked
 * here. `extra.by` is checked when present (resolution records).
 */
export function credentialProofField(descriptor, extra) {
  const desc = descriptor && typeof descriptor === "object" ? descriptor : {};
  for (const key of PROOF_PLAIN_FIELDS) {
    const v = nonempty(desc[key]);
    if (v && fieldLooksLikeCredential(v)) return key;
  }
  const by = nonempty(extra?.by);
  if (by && fieldLooksLikeCredential(by)) return "by";
  return null;
}

/** Forward-slash path form for glob matching (H10). */
export function normalizeMatchValue(v) {
  return asString(v).replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Stable filename fragment. Path components, drive letters, and `..` collapse
 * to a single safe token so nothing is written outside `.getadvantage/`.
 */
export function sanitizeRecordId(raw) {
  let s = asString(raw).replace(/\\/g, "/");
  const parts = s.split("/").filter((p) => p && p !== "." && p !== "..");
  s = parts.length ? parts[parts.length - 1] : "";
  s = s.replace(/^[a-zA-Z]:/, "");
  s = s.replace(/[^A-Za-z0-9._-]/g, "_");
  s = s.replace(/^\.+/, "");
  if (!s) s = "undecidable";
  return s.slice(0, ID_MAX);
}

function isAnyGlob(v) {
  const s = nonempty(v);
  return s === "*" || s === "**" || s === "**/**" || s === "**/";
}

function specificity(rule) {
  let n = 0;
  for (const key of MATCH_KEYS) {
    const v = own(rule, key);
    if (nonempty(v) && !isAnyGlob(v)) n += 1;
  }
  return n;
}

function ruleDecision(rule) {
  const d = nonempty(own(rule, "decision"));
  return OUTCOMES.has(d) ? d : "";
}

function ruleMatches(desc, rule) {
  const decision = ruleDecision(rule);
  if (!decision) return false;

  // Criterion 3 / unknown-never-allow: a descriptor with no dataClass does
  // not match an allow rule that omitted dataClass. A rule that names
  // dataClass still has to glob-match, so unknown cannot sneak through it.
  const descClass = nonempty(desc.dataClass);
  const ruleClass = own(rule, "dataClass");
  if (decision === "allow" && !descClass) {
    if (ruleClass === undefined || ruleClass === null || String(ruleClass).trim() === "") {
      return false;
    }
  }

  for (const key of MATCH_KEYS) {
    const pat = own(rule, key);
    if (pat === undefined || pat === null || String(pat).trim() === "") continue;
    const val = key === "dataClass" ? descClass : nonempty(desc[key]);
    if (!pathMatchesGlob(normalizeMatchValue(val), normalizeMatchValue(pat))) return false;
  }
  return true;
}

function emptyApprovalsPolicy() {
  return {
    version: 1,
    default: "escalate",
    escalateTo: null,
    rules: [],
    trusted: false,
    blanketAllow: false,
  };
}

/**
 * Pure. Same descriptor + same policy → identical { outcome, ruleId, reason,
 * escalateTo, disclosedAllow }. No filesystem, no clock, no randomness.
 *
 * `policy` is the normalised object `loadApprovalsPolicy` returns in `.policy`
 * (or a test fixture of the same shape). Untrusted policies must arrive with
 * empty rules and default `escalate`; `decide()` also refuses `allow` when
 * `trusted === false`.
 *
 * @param {{ action?: string, resource?: string, dataClass?: string, actor?: string, model?: string, summary?: string, tool?: string }} descriptor
 * @param {ReturnType<typeof emptyApprovalsPolicy>|null|undefined} policy
 */
export function decide(descriptor, policy) {
  const desc = {
    action: nonempty(descriptor?.action),
    resource: nonempty(descriptor?.resource),
    dataClass: nonempty(descriptor?.dataClass),
    actor: nonempty(descriptor?.actor),
    model: nonempty(descriptor?.model),
    tool: nonempty(descriptor?.tool),
    summary: asString(descriptor?.summary),
  };
  const pol = policy && typeof policy === "object" ? policy : emptyApprovalsPolicy();
  const rules = Array.isArray(pol.rules) ? pol.rules : [];
  const escalateTo = nonempty(pol.escalateTo) || null;
  const trusted = pol.trusted === true;

  const matches = [];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) continue;
    if (!ruleMatches(desc, rule)) continue;
    matches.push({ rule, index: i, spec: specificity(rule) });
  }
  matches.sort((a, b) => b.spec - a.spec || a.index - b.index);

  if (matches.length > 0) {
    const win = matches[0].rule;
    const decision = ruleDecision(win);
    const id = nonempty(own(win, "id")) || null;
    const reason = nonempty(own(win, "reason")) || (id ? `policy rule ${id}` : "matching policy rule");
    if (decision === "allow" && !id) {
      return {
        outcome: "escalate",
        ruleId: null,
        reason: "an allow rule is missing a stable id — an unattributable allow is refused",
        escalateTo,
        disclosedAllow: false,
      };
    }
    if (decision === "allow" && !trusted) {
      return {
        outcome: "escalate",
        ruleId: null,
        reason: "policy is not tracked or staged — cannot allow",
        escalateTo,
        disclosedAllow: false,
      };
    }
    return {
      outcome: decision,
      ruleId: id,
      reason,
      escalateTo,
      disclosedAllow: decision === "allow",
    };
  }

  let outcome = nonempty(pol.default) || "escalate";
  if (!OUTCOMES.has(outcome)) outcome = "escalate";
  if (outcome === "allow" && !trusted) {
    return {
      outcome: "escalate",
      ruleId: null,
      reason: "policy is not tracked or staged — cannot allow",
      escalateTo,
      disclosedAllow: false,
    };
  }
  if (outcome === "allow") {
    return {
      outcome: "allow",
      ruleId: null,
      reason: "committed default allows every unmatched action (blanket allow)",
      escalateTo,
      disclosedAllow: true,
    };
  }
  if (outcome === "block") {
    return {
      outcome: "block",
      ruleId: null,
      reason: "no matching rule; committed default is block",
      escalateTo,
      disclosedAllow: false,
    };
  }
  return {
    outcome: "escalate",
    ruleId: null,
    reason: "no matching rule; default is escalate",
    escalateTo,
    disclosedAllow: false,
  };
}

function parseJsonText(text, label) {
  try {
    const json = JSON.parse(stripBom(String(text ?? "")));
    return { ok: true, json, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, json: null, error: `${label} is not valid JSON (${msg})` };
  }
}

function validateAllowRules(rules, rel) {
  if (!Array.isArray(rules)) return null;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) continue;
    if (ruleDecision(rule) === "allow" && !nonempty(own(rule, "id"))) {
      return `${rel}: an allow rule is missing a stable id — an unattributable allow is refused`;
    }
  }
  return null;
}

/**
 * Load `.getadvantage/policy.json` under the same trust doctrine as
 * `loadPolicy()` in policy.mjs: only the git index blob authorizes.
 * Does not change policy.mjs. Extra top-level keys are ignored.
 *
 * @param {string} cwd
 * @returns {{ ok: boolean, policy: ReturnType<typeof emptyApprovalsPolicy>, source: string|null, warnings: string[], error: string|null }}
 */
export function loadApprovalsPolicy(cwd) {
  const rel = POLICY_REL;
  const abs = path.join(cwd, rel);
  const warnings = [];
  const empty = emptyApprovalsPolicy();
  const inIndex = isPolicyPathInIndex(cwd, rel);
  const onDisk = existsSync(abs);

  if (!inIndex && !onDisk) {
    warnings.push("No .getadvantage/policy.json is committed, so nothing is allowed automatically.");
    return { ok: true, policy: empty, source: null, warnings, error: null };
  }

  // H2: a malformed file that we can see is a config error, never an allow.
  // Untracked valid JSON falls through to the untrusted empty policy (H3).
  if (!inIndex) {
    if (onDisk) {
      let raw = "";
      try {
        raw = readFileSync(abs, "utf8");
      } catch {
        warnings.push(`${rel} is not tracked or staged in git — approval rules not applied (commit or stage the policy so authorization is reviewable).`);
        return { ok: true, policy: empty, source: rel, warnings, error: null };
      }
      const parsed = parseJsonText(raw, rel);
      if (!parsed.ok) {
        return { ok: false, policy: empty, source: rel, warnings, error: parsed.error };
      }
    }
    warnings.push(
      `${rel} is not tracked or staged in git — approval rules not applied (commit or stage the policy so authorization is reviewable).`,
    );
    return { ok: true, policy: empty, source: rel, warnings, error: null };
  }

  const indexText = readGitIndexText(cwd, rel);
  if (indexText == null) {
    return {
      ok: false,
      policy: empty,
      source: rel,
      warnings,
      error:
        "The committed .getadvantage/policy.json could not be read. Check that git can show that file, then try again.",
    };
  }

  if (onDisk) {
    try {
      const worktreeText = readFileSync(abs, "utf8");
      if (worktreeText !== indexText) {
        warnings.push(
          `${rel} working tree differs from the git index — only the staged/tracked content authorizes approvals (unstaged edits are not applied).`,
        );
      }
    } catch {
      // unreadable worktree is fine; index content still governs
    }
  }

  const parsed = parseJsonText(indexText, `${rel} (git index)`);
  if (!parsed.ok) {
    return { ok: false, policy: empty, source: rel, warnings, error: parsed.error };
  }
  const json = parsed.json;
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return {
      ok: false,
      policy: empty,
      source: rel,
      warnings,
      error: `${rel} (git index) root must be a JSON object`,
    };
  }

  const rawVersion = own(json, "version");
  const version =
    typeof rawVersion === "number" && Number.isFinite(rawVersion) ? rawVersion : 1;
  if (version !== 1) {
    warnings.push(
      `${rel} has unsupported version ${version} (supported: 1) — approval rules not applied.`,
    );
    return { ok: true, policy: empty, source: rel, warnings, error: null };
  }

  const approvals = own(json, "approvals");
  if (approvals == null) {
    return {
      ok: true,
      policy: { ...empty, trusted: true, version },
      source: rel,
      warnings,
      error: null,
    };
  }
  if (typeof approvals !== "object" || Array.isArray(approvals)) {
    return {
      ok: false,
      policy: empty,
      source: rel,
      warnings,
      error: `${rel}: "approvals" must be a JSON object`,
    };
  }

  const rules = Array.isArray(own(approvals, "rules")) ? own(approvals, "rules") : [];
  const invalid = validateAllowRules(rules, rel);
  if (invalid) {
    return { ok: false, policy: empty, source: rel, warnings, error: invalid };
  }

  let defaultDecision = nonempty(own(approvals, "default")) || "escalate";
  if (!OUTCOMES.has(defaultDecision)) defaultDecision = "escalate";

  const normalisedRules = [];
  for (const rule of rules) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) continue;
    if (!ruleDecision(rule)) continue;
    normalisedRules.push(rule);
  }

  const policy = {
    version,
    default: defaultDecision,
    escalateTo: nonempty(own(approvals, "escalateTo")) || null,
    rules: normalisedRules,
    trusted: true,
    blanketAllow: defaultDecision === "allow",
  };
  return { ok: true, policy, source: rel, warnings, error: null };
}

function containedIn(child, parent) {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  if (c === p) return true;
  const prefix = p.endsWith(path.sep) ? p : p + path.sep;
  if (c.startsWith(prefix)) return true;
  if (process.platform === "win32") {
    const cl = c.toLowerCase();
    const pl = p.toLowerCase();
    const pfx = pl.endsWith(path.sep) ? pl : pl + path.sep;
    return cl === pl || cl.startsWith(pfx);
  }
  return false;
}

function isSymlinkOrReparse(abs) {
  try {
    return lstatSync(abs).isSymbolicLink();
  } catch (e) {
    if (e && e.code === "ENOENT") return false;
    throw e;
  }
}

function realExisting(abs) {
  try {
    return realpathSync(abs);
  } catch {
    return path.resolve(abs);
  }
}

function escapedApprovalsError() {
  return new Error("approval record path escaped .getadvantage/approvals/");
}

function sharedInodeError() {
  const err = new Error(
    "The approval record shares storage with another name, so this action was not allowed.",
  );
  err.code = "PROOF_SHARED_INODE";
  return err;
}

function assertUnsharedInode(st) {
  if (!st) return;
  if (typeof st.nlink === "number" && st.nlink > 1) throw sharedInodeError();
}

function checkpointError(message) {
  const err = new Error(message);
  err.code = "PROOF_CHECKPOINT";
  return err;
}

function partialWriteError(message) {
  const err = new Error(message);
  err.code = "PROOF_PARTIAL_WRITE";
  return err;
}

function lstatOrNull(abs) {
  try {
    return lstatSync(abs);
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Refuse reparse points, directories, and paths that leave approvals.
 * Hardlinks (nlink > 1) are unlinked by name only after this check: the
 * other name is not our write target, so we never open a shared inode.
 */
function assertSafeWriteTarget(cwd, abs, { mustNotExist = false } = {}) {
  assertApprovalsContainment(cwd, abs);
  const st = lstatOrNull(abs);
  if (!st) return null;
  if (st.isSymbolicLink()) throw escapedApprovalsError();
  if (st.isDirectory()) {
    const err = new Error("output path is a directory");
    err.code = "PROOF_OUTPUT_IS_DIR";
    throw err;
  }
  if (mustNotExist) {
    const err = new Error("output path already exists");
    err.code = "EEXIST";
    throw err;
  }
  return st;
}

function removeLeftoverWriteTarget(cwd, abs) {
  const st = assertSafeWriteTarget(cwd, abs);
  if (!st) return;
  unlinkSync(abs);
}

/** Create `abs` exclusively (`wx`) and write `data`. Never follows a reparse. */
function exclusiveWriteFile(cwd, abs, data) {
  removeLeftoverWriteTarget(cwd, abs);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  let fd;
  try {
    fd = openSync(abs, "wx");
  } catch (e) {
    if (e && e.code === "EEXIST") {
      const st = lstatOrNull(abs);
      if (st && st.isSymbolicLink()) throw escapedApprovalsError();
    }
    throw e;
  }
  try {
    writeSync(fd, buf, 0, buf.length, 0);
  } finally {
    closeSync(fd);
  }
}

function isTipStructurallyValid(tip) {
  if (!tip || typeof tip !== "object" || Array.isArray(tip) || tip.corrupt) return false;
  if (!Number.isInteger(tip.lineCount) || tip.lineCount < 1) return false;
  if (!isWellFormedPrevDigest(tip.tipDigest)) return false;
  return true;
}

/**
 * Containment is a filesystem fact, not a string prefix. Refuse symlinks and
 * directory junctions on the approvals root, the output path, and its parent.
 */
function assertApprovalsContainment(cwd, abs) {
  const marker = path.resolve(cwd, MARKER_DIR);
  const root = path.resolve(marker, APPROVALS_SUBDIR);
  const resolved = path.resolve(abs);
  if (!containedIn(resolved, root)) throw escapedApprovalsError();
  if (existsSync(marker) && isSymlinkOrReparse(marker)) {
    if (!containedIn(realExisting(marker), path.resolve(cwd))) throw escapedApprovalsError();
  }
  if (existsSync(root) && isSymlinkOrReparse(root)) throw escapedApprovalsError();
  const parent = path.dirname(resolved);
  if (existsSync(parent) && isSymlinkOrReparse(parent)) throw escapedApprovalsError();
  if (existsSync(abs) && isSymlinkOrReparse(abs)) throw escapedApprovalsError();
  if (existsSync(abs)) {
    const realAbs = realExisting(abs);
    const realRoot = existsSync(root) ? realExisting(root) : root;
    if (!containedIn(realAbs, root) && !containedIn(realAbs, realRoot)) throw escapedApprovalsError();
  } else if (existsSync(parent)) {
    const realParent = realExisting(parent);
    if (!containedIn(realParent, root) && realParent !== root) throw escapedApprovalsError();
  }
}

function approvalsAbs(cwd, file, opts = {}) {
  const rel = path.join(APPROVALS_SUBDIR, file);
  const abs = path.resolve(cwd, MARKER_DIR, rel);
  const root = path.resolve(cwd, MARKER_DIR, APPROVALS_SUBDIR);
  if (!containedIn(abs, root)) throw escapedApprovalsError();
  if (opts.create !== false) {
    const marker = path.resolve(cwd, MARKER_DIR);
    if (!existsSync(marker)) mkdirSync(marker, { recursive: true });
    if (existsSync(root) && isSymlinkOrReparse(root)) throw escapedApprovalsError();
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
  }
  assertApprovalsContainment(cwd, abs);
  return abs;
}

export function proofPathForId(cwd, id, opts = {}) {
  return approvalsAbs(cwd, `${sanitizeRecordId(id)}.jsonl`, opts);
}

/**
 * Build the proof object. Never includes summary text, resource text, or any
 * raw payload — only digests. A display fingerprint of the summary is not
 * stored: a mask of a secret still contains secret bytes (H6).
 */
export function buildProofRecord({ kind, id, decision, descriptor, now, extra }) {
  const desc = descriptor || {};
  const bad = credentialProofField(desc, extra);
  if (bad) {
    const err = new Error(
      `The ${diagnosticFieldName(bad)} value looks like a secret, so it was not stored and this action was not allowed. Pass a name, not a key.`,
    );
    err.code = "PROOF_CREDENTIAL_FIELD";
    err.field = diagnosticFieldName(bad);
    throw err;
  }
  const summary = asString(desc.summary);
  const resource = asString(desc.resource);
  const rec = {
    version: 1,
    kind: kind || "decision",
    id: sanitizeRecordId(id),
    outcome: decision?.outcome || null,
    ruleId: decision?.ruleId ?? null,
    reason: decision?.reason || null,
    escalateTo: decision?.escalateTo ?? null,
    approver:
      kind === "resolution"
        ? nonempty(extra?.by) || null
        : decision?.ruleId || (decision?.outcome === "allow" ? "default" : decision?.ruleId),
    model: nonempty(desc.model) || null,
    dataClass: nonempty(desc.dataClass) || "unknown",
    actor: nonempty(desc.actor) || null,
    action: nonempty(desc.action) || null,
    resourceDigest: resource ? secretAuthId(resource) : null,
    summaryDigest: summary ? secretAuthId(summary) : null,
    createdAt: now,
  };
  if (extra && typeof extra === "object") {
    if (extra.by) rec.by = nonempty(extra.by);
    if (extra.resolves) rec.resolves = sanitizeRecordId(extra.resolves);
    if (extra.resolution) rec.resolution = extra.resolution;
    if (typeof extra.resourceDigest === "string") rec.resourceDigest = extra.resourceDigest;
    if (typeof extra.summaryDigest === "string") rec.summaryDigest = extra.summaryDigest;
  }
  const storedBad = credentialRecordField(rec);
  if (storedBad) {
    const err = new Error(
      `The ${diagnosticFieldName(storedBad)} value looks like a secret, so it was not stored and this action was not allowed. Pass a name, not a key.`,
    );
    err.code = "PROOF_CREDENTIAL_FIELD";
    err.field = diagnosticFieldName(storedBad);
    throw err;
  }
  return rec;
}

export function jsonlLineDigest(raw) {
  if (Buffer.isBuffer(raw)) return createHash("sha256").update(raw).digest("hex");
  return createHash("sha256").update(String(raw ?? ""), "utf8").digest("hex");
}

function decodeUtf8Line(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tipPathFor(abs) {
  return `${abs}.tip`;
}

function readTipFile(abs) {
  const p = tipPathFor(abs);
  if (!existsSync(p)) return null;
  if (isSymlinkOrReparse(p)) throw escapedApprovalsError();
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    if (!j || typeof j !== "object" || Array.isArray(j)) return { corrupt: true };
    return j;
  } catch {
    return { corrupt: true };
  }
}

function writeTipFile(cwd, abs, tip) {
  const p = tipPathFor(abs);
  const tmp = `${p}.tmp`;
  assertSafeWriteTarget(cwd, p);
  exclusiveWriteFile(cwd, tmp, JSON.stringify(tip) + "\n");
  try {
    const destSt = lstatOrNull(p);
    if (destSt) {
      if (destSt.isSymbolicLink() || destSt.isDirectory()) throw escapedApprovalsError();
      unlinkSync(p);
    }
    renameSync(tmp, p);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

function countJsonlLines(abs) {
  if (!existsSync(abs)) return 0;
  const fd = openSync(abs, "r");
  try {
    const st = fstatSync(fd);
    if (st.size === 0) return 0;
    let pos = 0;
    let n = 0;
    const CHUNK = 64 * 1024;
    let last = 0;
    while (pos < st.size) {
      const k = Math.min(CHUNK, st.size - pos);
      const buf = Buffer.alloc(k);
      readSync(fd, buf, 0, k, pos);
      pos += k;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x0a) n += 1;
      }
      last = buf[buf.length - 1];
    }
    if (last !== 0x0a) n += 1;
    return n;
  } finally {
    closeSync(fd);
  }
}

function withProofLock(abs, fn) {
  const lockPath = `${abs}.lock`;
  const start = Date.now();
  let fd;
  let staleUnremoved = false;
  for (;;) {
    if (Date.now() - start > PROOF_LOCK_WAIT_MS) {
      const err = staleUnremoved
        ? new Error("a stale approval lock could not be removed; delete the .lock path and retry")
        : new Error("another approve is writing this record; retry in a moment");
      err.code = staleUnremoved ? "PROOF_LOCK_STALE" : "PROOF_LOCK_TIMEOUT";
      throw err;
    }
    try {
      fd = openSync(lockPath, "wx");
      break;
    } catch (e) {
      const code = e && e.code;
      if (code !== "EEXIST" && code !== "EISDIR" && code !== "EPERM") throw e;
      let stale = false;
      try {
        const st = lstatSync(lockPath);
        if (Date.now() - st.mtimeMs > PROOF_LOCK_STALE_MS) stale = true;
        if (st.isDirectory()) stale = true;
      } catch {
        stale = true;
      }
      if (stale) {
        let removed = false;
        try {
          unlinkSync(lockPath);
          removed = true;
        } catch {
          /* directory or raced */
        }
        if (!removed) {
          try {
            rmdirSync(lockPath);
            removed = true;
          } catch {
            /* still there */
          }
        }
        staleUnremoved = !removed;
        sleepMs(20);
        continue;
      }
      staleUnremoved = false;
      sleepMs(20);
    }
  }
  try {
    return fn();
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

function lastJsonlLine(abs) {
  if (!existsSync(abs)) return null;
  const fd = openSync(abs, "r");
  try {
    const st = fstatSync(fd);
    if (st.size === 0) return null;
    const window = Math.min(st.size, PROOF_RECORD_MAX_BYTES + 2);
    const buf = Buffer.alloc(window);
    readSync(fd, buf, 0, window, st.size - window);
    let end = buf.length;
    if (end > 0 && buf[end - 1] === 0x0a) end -= 1;
    if (end > 0 && buf[end - 1] === 0x0d) end -= 1;
    let start = 0;
    let found = false;
    for (let i = end - 1; i >= 0; i--) {
      if (buf[i] === 0x0a) {
        start = i + 1;
        found = true;
        break;
      }
    }
    if (!found && st.size > window) return { tooLarge: true, bytes: null };
    const line = buf.subarray(start, end);
    if (line.length === 0) return null;
    if (line.length > PROOF_RECORD_MAX_BYTES) return { tooLarge: true, bytes: null };
    return { tooLarge: false, bytes: Buffer.from(line) };
  } finally {
    closeSync(fd);
  }
}

function ledgerStat(abs) {
  try {
    return lstatSync(abs);
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
}

function rollbackLedgerToSize(abs, prevSize, created) {
  try {
    const st = lstatOrNull(abs);
    if (st && typeof st.nlink === "number" && st.nlink > 1) return false;
    if (created || prevSize <= 0) {
      unlinkSync(abs);
      return true;
    }
    const fd = openSync(abs, "r+");
    try {
      const fst = fstatSync(fd);
      if (typeof fst.nlink === "number" && fst.nlink > 1) return false;
      ftruncateSync(fd, prevSize);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Write one ledger line. New files are exclusive-create (`wx`). Existing
 * files are opened, fstat'd, and refused when nlink > 1 so a same-volume
 * hardlink cannot smuggle the append onto an outside name.
 */
function appendLedgerLine(cwd, abs, buf, fileExists) {
  if (!fileExists) {
    exclusiveWriteFile(cwd, abs, buf);
    return;
  }
  const fd = openSync(abs, "r+");
  try {
    const fst = fstatSync(fd);
    if (typeof fst.nlink === "number" && fst.nlink > 1) throw sharedInodeError();
    let offset = 0;
    const start = fst.size;
    while (offset < buf.length) {
      const n = writeSync(fd, buf, offset, buf.length - offset, start + offset);
      if (!n) {
        const err = new Error("The approval record could not be fully written.");
        err.code = "PROOF_SHORT_WRITE";
        throw err;
      }
      offset += n;
    }
  } finally {
    closeSync(fd);
  }
}

function lastLineHasPrevDigest(prevLine) {
  if (!prevLine || prevLine.tooLarge || !prevLine.bytes) return false;
  const text = decodeUtf8Line(prevLine.bytes);
  if (!text) return false;
  try {
    const rec = JSON.parse(text);
    return isWellFormedPrevDigest(own(rec, "prevDigest"));
  } catch {
    return false;
  }
}

export function appendProofRecord(cwd, record) {
  const id = sanitizeRecordId(record?.id);
  if (fieldLooksLikeCredential(id) || fieldLooksLikeCredential(asString(record?.id))) {
    const err = new Error(
      "The id value looks like a secret, so it was not stored and this action was not allowed. Pass a name, not a key.",
    );
    err.code = "PROOF_CREDENTIAL_FIELD";
    err.field = "id";
    throw err;
  }
  const abs = proofPathForId(cwd, id);
  return withProofLock(abs, () => {
    assertApprovalsContainment(cwd, abs);
    if (existsSync(abs) && isSymlinkOrReparse(abs)) throw escapedApprovalsError();
    const tipAbs = tipPathFor(abs);
    if (existsSync(tipAbs) && isSymlinkOrReparse(tipAbs)) throw escapedApprovalsError();

    const st = ledgerStat(abs);
    if (st && st.isDirectory()) {
      const err = new Error("output path is a directory");
      err.code = "PROOF_OUTPUT_IS_DIR";
      throw err;
    }
    assertUnsharedInode(st);
    const fileExists = !!(st && st.isFile());
    const tip = readTipFile(abs);
    const tipPresent = existsSync(tipAbs);

    if (!fileExists && tipPresent) {
      throw checkpointError(
        "The approval record is missing but a write checkpoint is present, so this action was not allowed.",
      );
    }
    if (fileExists && st.size === 0) {
      throw checkpointError(
        "The approval record is empty, so this action was not allowed. Run getadvantage approve to write a new record.",
      );
    }

    const prevLine = lastJsonlLine(abs);
    if (prevLine && prevLine.tooLarge) {
      const err = new Error("The previous approval line is too large to chain.");
      err.code = "PROOF_RECORD_TOO_LARGE";
      throw err;
    }

    const actualCount = fileExists ? countJsonlLines(abs) : 0;
    const actualTail = prevLine && prevLine.bytes ? jsonlLineDigest(prevLine.bytes) : null;
    const chained = lastLineHasPrevDigest(prevLine);

    if (fileExists) {
      if (tip && !isTipStructurallyValid(tip)) {
        throw checkpointError(
          "The approval record does not match its write checkpoint, so this action was not allowed.",
        );
      }
      if (chained) {
        if (!isTipStructurallyValid(tip) || tip.tipDigest !== actualTail || tip.lineCount !== actualCount) {
          throw checkpointError(
            "The approval record does not match its write checkpoint, so this action was not allowed.",
          );
        }
      } else if (isTipStructurallyValid(tip)) {
        if (tip.tipDigest !== actualTail || tip.lineCount !== actualCount) {
          throw checkpointError(
            "The approval record does not match its write checkpoint, so this action was not allowed.",
          );
        }
      }
    }

    const rec = {
      ...record,
      prevDigest: prevLine ? jsonlLineDigest(prevLine.bytes) : PROOF_GENESIS_DIGEST,
    };
    const bad = credentialRecordField(rec);
    if (bad) {
      const err = new Error(
        `The ${diagnosticFieldName(bad)} value looks like a secret, so it was not stored and this action was not allowed. Pass a name, not a key.`,
      );
      err.code = "PROOF_CREDENTIAL_FIELD";
      err.field = diagnosticFieldName(bad);
      throw err;
    }
    const payload = JSON.stringify(rec);
    const buf = Buffer.from(`${payload}\n`, "utf8");
    if (buf.length - 1 > PROOF_RECORD_MAX_BYTES) {
      const err = new Error("The approval record is too large to store.");
      err.code = "PROOF_RECORD_TOO_LARGE";
      throw err;
    }

    const lineCount = actualCount + 1;
    const prevSize = fileExists ? st.size : 0;
    const created = !fileExists;
    appendLedgerLine(cwd, abs, buf, fileExists);
    try {
      writeTipFile(cwd, abs, {
        v: 1,
        lineCount,
        tipDigest: jsonlLineDigest(buf.subarray(0, buf.length - 1)),
      });
    } catch (e) {
      const rolled = rollbackLedgerToSize(abs, prevSize, created);
      if (!rolled) {
        throw partialWriteError(
          "The decision was written but the write checkpoint could not be updated. Treat this record as incomplete.",
        );
      }
      throw e;
    }
    return abs;
  });
}

export function readProofLines(cwd, id) {
  const abs = proofPathForId(cwd, id);
  if (!existsSync(abs)) return { abs, raw: null, lines: [] };
  const raw = readFileSync(abs, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  return { abs, raw, lines };
}

function* iterateJsonlLines(abs, fileHash) {
  const CHUNK = 64 * 1024;
  const fd = openSync(abs, "r");
  try {
    const st = fstatSync(fd);
    let carry = Buffer.alloc(0);
    let pos = 0;
    let lineNo = 0;
    while (pos < st.size) {
      const n = Math.min(CHUNK, st.size - pos);
      const buf = Buffer.alloc(n);
      readSync(fd, buf, 0, n, pos);
      pos += n;
      if (fileHash) fileHash.update(buf);
      carry = carry.length ? Buffer.concat([carry, buf]) : buf;
      let start = 0;
      for (let i = 0; i < carry.length; i++) {
        if (carry[i] === 0x0a) {
          lineNo += 1;
          let raw = carry.subarray(start, i);
          if (raw.length && raw[raw.length - 1] === 0x0d) raw = raw.subarray(0, raw.length - 1);
          yield {
            lineNo,
            rawBytes: Buffer.from(raw),
            truncated: false,
            tooLarge: raw.length > PROOF_RECORD_MAX_BYTES,
          };
          start = i + 1;
        }
      }
      carry = start === 0 ? carry : carry.subarray(start);
      if (carry.length > PROOF_RECORD_MAX_BYTES) {
        lineNo += 1;
        yield { lineNo, rawBytes: carry, truncated: true, tooLarge: true };
        return;
      }
    }
    if (carry.length > 0) {
      lineNo += 1;
      let raw = carry;
      if (raw.length && raw[raw.length - 1] === 0x0d) raw = raw.subarray(0, raw.length - 1);
      yield {
        lineNo,
        rawBytes: Buffer.from(raw),
        truncated: true,
        tooLarge: raw.length > PROOF_RECORD_MAX_BYTES,
      };
    }
  } finally {
    closeSync(fd);
  }
}

function idLooksLikePath(raw) {
  const s = asString(raw);
  if (!s) return false;
  if (s.includes("..") || s.includes("/") || s.includes("\\")) return true;
  if (/^[a-zA-Z]:/.test(s)) return true;
  try {
    if (path.isAbsolute(s)) return true;
  } catch {
    return true;
  }
  return false;
}

function deriveApproverKind(rec) {
  if (nonempty(rec?.kind) === "resolution" || nonempty(rec?.by)) return "person";
  if (nonempty(rec?.ruleId)) return "policy";
  if (nonempty(rec?.approver) === "default") return "default";
  return null;
}

function credentialInTree(value, field, depth) {
  if (value == null) return null;
  if (depth > PROOF_CRED_WALK_MAX_DEPTH) return field;
  if (typeof value === "string") {
    return fieldLooksLikeCredential(value) ? field : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return fieldLooksLikeCredential(String(value)) ? field : null;
  }
  if (typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = credentialInTree(item, field, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const key of Object.keys(value)) {
    const hit = credentialInTree(value[key], field, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * Name of the first field on a stored record that looks like a secret, or
 * null. Walks own enumerable keys and nested arrays/objects (the complete
 * record). Reports the top-level key so diagnostics never echo a value.
 */
export function credentialRecordField(rec) {
  if (rec == null || typeof rec !== "object") return null;
  if (Array.isArray(rec)) return credentialInTree(rec, "record", 0);
  const desc = {
    action: rec.action,
    actor: rec.actor,
    model: rec.model,
    dataClass: rec.dataClass,
  };
  const named = credentialProofField(desc, { by: rec.by });
  if (named) return named;
  for (const key of Object.keys(rec)) {
    const hit = credentialInTree(rec[key], key, 0);
    if (hit) return hit;
  }
  return null;
}

function projectedScalar(v) {
  if (v == null) return null;
  if (typeof v === "string") return v;
  return null;
}

function projectProofRecord(rec, seq, lineDigestHex, chainBound) {
  const dataClass = nonempty(typeof rec.dataClass === "string" ? rec.dataClass : "") || "unknown";
  return {
    seq,
    sourceVersion: typeof rec.version === "number" && Number.isFinite(rec.version) ? rec.version : 1,
    chainBound,
    lineDigest: lineDigestHex,
    prevDigest: typeof rec.prevDigest === "string" ? rec.prevDigest : null,
    kind: projectedScalar(rec.kind),
    id: projectedScalar(rec.id),
    outcome: projectedScalar(rec.outcome),
    ruleId: rec.ruleId ?? null,
    reason: projectedScalar(rec.reason),
    escalateTo: projectedScalar(rec.escalateTo),
    approver: projectedScalar(rec.approver),
    approverKind: deriveApproverKind(rec),
    model: projectedScalar(rec.model),
    actor: projectedScalar(rec.actor),
    action: projectedScalar(rec.action),
    dataTouched: {
      dataClass,
      resourceDigest: projectedScalar(rec.resourceDigest),
    },
    summaryDigest: projectedScalar(rec.summaryDigest),
    createdAt: projectedScalar(rec.createdAt),
    by: projectedScalar(rec.by),
    resolves: projectedScalar(rec.resolves),
    resolution: projectedScalar(rec.resolution),
  };
}

function latestFromProjected(projected) {
  const last = projected[projected.length - 1] || null;
  let ctx = last;
  for (let i = projected.length - 1; i >= 0; i--) {
    if (projected[i].kind === "decision") {
      ctx = projected[i];
      break;
    }
  }
  const lastClass = nonempty(last?.dataTouched?.dataClass);
  const ctxClass = nonempty(ctx?.dataTouched?.dataClass);
  return {
    outcome: last?.outcome ?? null,
    dataClass: lastClass && lastClass !== "unknown" ? lastClass : ctxClass || "unknown",
    model: nonempty(last?.model) || nonempty(ctx?.model) || null,
    createdAt: last?.createdAt ?? null,
    approver: last?.approver ?? null,
  };
}

function readDecisionContext(abs) {
  const ctx = {
    model: null,
    dataClass: null,
    actor: null,
    action: null,
    resourceDigest: null,
    summaryDigest: null,
  };
  try {
    for (const line of iterateJsonlLines(abs)) {
      if (line.tooLarge || line.truncated) continue;
      const text = decodeUtf8Line(line.rawBytes);
      if (!text) continue;
      let rec;
      try {
        rec = JSON.parse(text);
      } catch {
        continue;
      }
      if (!rec || typeof rec !== "object" || Array.isArray(rec)) continue;
      if (nonempty(rec.kind) !== "decision" && ctx.action) continue;
      if (typeof rec.model === "string") ctx.model = rec.model;
      if (typeof rec.dataClass === "string") ctx.dataClass = rec.dataClass;
      if (typeof rec.actor === "string") ctx.actor = rec.actor;
      if (typeof rec.action === "string") ctx.action = rec.action;
      if (typeof rec.resourceDigest === "string") ctx.resourceDigest = rec.resourceDigest;
      if (typeof rec.summaryDigest === "string") ctx.summaryDigest = rec.summaryDigest;
    }
  } catch {
    /* ignore — resolve still records its own outcome */
  }
  return ctx;
}

function publishReplace(cwd, tmp, dest) {
  assertSafeWriteTarget(cwd, dest);
  assertSafeWriteTarget(cwd, tmp);
  const bak = `${dest}.bak`;
  if (existsSync(dest)) {
    const bakSt = lstatOrNull(bak);
    if (bakSt) {
      if (bakSt.isSymbolicLink()) throw escapedApprovalsError();
      if (bakSt.isDirectory()) {
        const err = new Error("output path is a directory");
        err.code = "PROOF_OUTPUT_IS_DIR";
        throw err;
      }
      unlinkSync(bak);
    }
    renameSync(dest, bak);
    try {
      renameSync(tmp, dest);
    } catch (e) {
      try {
        renameSync(bak, dest);
      } catch {
        /* ignore */
      }
      throw e;
    }
    return bak;
  }
  renameSync(tmp, dest);
  return null;
}

function restoreFromBak(dest) {
  const bak = `${dest}.bak`;
  const bakSt = lstatOrNull(bak);
  if (bakSt && !bakSt.isDirectory() && !bakSt.isSymbolicLink()) {
    try {
      const destSt = lstatOrNull(dest);
      if (destSt && !destSt.isDirectory() && !destSt.isSymbolicLink()) unlinkSync(dest);
    } catch {
      /* ignore */
    }
    try {
      renameSync(bak, dest);
      return true;
    } catch {
      return false;
    }
  }
  try {
    const destSt = lstatOrNull(dest);
    if (destSt && !destSt.isDirectory() && !destSt.isSymbolicLink()) unlinkSync(dest);
    return !bakSt;
  } catch {
    return false;
  }
}

function writeProofOutputs(cwd, id, packet, html) {
  const jsonAbs = approvalsAbs(cwd, `${id}.packet.json`, { create: true });
  const htmlAbs = approvalsAbs(cwd, `${id}.html`, { create: true });
  const jsonTmp = `${jsonAbs}.tmp`;
  const htmlTmp = `${htmlAbs}.tmp`;
  const jsonRel = `${MARKER_DIR}/${APPROVALS_SUBDIR}/${id}.packet.json`;
  const htmlRel = `${MARKER_DIR}/${APPROVALS_SUBDIR}/${id}.html`;
  let jsonPublished = false;
  let htmlPublished = false;
  let jsonBak = null;
  let htmlBak = null;
  try {
    exclusiveWriteFile(cwd, jsonTmp, JSON.stringify(packet, null, 2) + "\n");
    exclusiveWriteFile(cwd, htmlTmp, html);
    jsonBak = publishReplace(cwd, jsonTmp, jsonAbs);
    jsonPublished = true;
    htmlBak = publishReplace(cwd, htmlTmp, htmlAbs);
    htmlPublished = true;
    for (const bak of [jsonBak, htmlBak]) {
      if (bak) {
        try {
          unlinkSync(bak);
        } catch {
          /* ignore */
        }
      }
    }
    return { jsonAbs, htmlAbs, jsonRel, htmlRel, published: "both" };
  } catch (e) {
    try {
      const st = lstatOrNull(jsonTmp);
      if (st && !st.isDirectory() && !st.isSymbolicLink()) unlinkSync(jsonTmp);
    } catch {
      /* ignore */
    }
    try {
      const st = lstatOrNull(htmlTmp);
      if (st && !st.isDirectory() && !st.isSymbolicLink()) unlinkSync(htmlTmp);
    } catch {
      /* ignore */
    }
    let jsonRestored = true;
    let htmlRestored = true;
    if (jsonPublished) jsonRestored = restoreFromBak(jsonAbs);
    if (htmlPublished) htmlRestored = restoreFromBak(htmlAbs);
    let published = "none";
    if (jsonPublished && htmlPublished) {
      published = jsonRestored && htmlRestored ? "none" : "partial";
    } else if (jsonPublished) {
      published = jsonRestored ? "none" : "partial";
    }
    const err = e instanceof Error ? e : new Error(String(e));
    err.published = published;
    throw err;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function chainStatusOf(boundCount, unboundCount, lineCount) {
  if (lineCount <= 0) return "unverified";
  if (boundCount === lineCount) return "verified";
  if (boundCount > 0) return "partial";
  return "unverified";
}

function chainStatusLabel(chain) {
  const s = chain?.status;
  if (s === "verified") return "intact";
  if (s === "partial") return "partial";
  return "unverified";
}

function isWellFormedPrevDigest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function nestedOwnField(rec) {
  if (rec == null || typeof rec !== "object") return "record";
  if (Array.isArray(rec)) return "record";
  for (const key of Object.keys(rec)) {
    const v = rec[key];
    if (v != null && typeof v === "object") return key;
  }
  return null;
}

function renderProofHtml(packet) {
  const rows = (packet.records || []).slice(0, 20);
  const more =
    (packet.records || []).length > rows.length
      ? `<p>Showing ${rows.length} of ${packet.chain.lineCount} lines. The JSON packet has every line.</p>`
      : "";
  const tr = rows
    .map((ev) => {
      const who = ev.approverKind === "person" ? ev.approver || ev.by || "" : ev.approver || ev.approverKind || "";
      return `<tr><td>${escapeHtml(ev.createdAt || "")}</td><td>${escapeHtml(ev.outcome || "")}</td><td>${escapeHtml(who)}</td><td>${escapeHtml(ev.model || "")}</td><td>${escapeHtml(ev.dataTouched?.dataClass || "unknown")}</td><td>${escapeHtml(ev.dataTouched?.resourceDigest || "digest only")}</td></tr>`;
    })
    .join("");
  const limits = (packet.limitations || []).map((l) => `<li>${escapeHtml(l)}</li>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>getAdvantage proof record</title>
<style>
body{font-family:system-ui,sans-serif;margin:24px;color:#111;background:#fff}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:14px;word-break:break-all}
.note{margin-top:16px;color:#333}
</style>
</head>
<body>
<h1>getAdvantage proof record</h1>
<p>This page was written on this machine by getadvantage proof export. It is not hosted. There is no public URL.</p>
<p>Id: ${escapeHtml(packet.id)} · Lines: ${escapeHtml(String(packet.chain?.lineCount ?? 0))} · Chain: ${escapeHtml(chainStatusLabel(packet.chain))} · Unsigned lines: ${escapeHtml(String(packet.chain?.unboundCount ?? 0))}</p>
<table>
<thead><tr><th>When</th><th>Outcome</th><th>Who</th><th>Model</th><th>Data class</th><th>Resource digest</th></tr></thead>
<tbody>${tr}</tbody>
</table>
${more}
<ul>${limits}</ul>
<p class="note">Local files: ${escapeHtml(packet.source?.path || "")} · ${escapeHtml(packet.humanPage?.path || "")}. Open the page file in a browser on this machine. It is not published.</p>
</body>
</html>
`;
}

/**
 * Read `.getadvantage/approvals/<id>.jsonl` without loading the file as one
 * string. v1 lines (no prevDigest) export. A stored prevDigest that does not
 * match the previous line fails closed and names the line.
 *
 * @returns {{ ok: true, packet: object, html: string, jsonRel: string, htmlRel: string, jsonAbs: string, htmlAbs: string } | { ok: false, error: string, next: string, line?: number, field?: string }}
 */
export function exportProofRecord(cwd, rawId, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const raw = asString(rawId);
  if (!nonempty(raw)) {
    return {
      ok: false,
      error: "Need an id (the record id printed by getadvantage approve).",
      next: `Run \`${binName()} help proof\` to see what this command accepts.`,
    };
  }
  if (idLooksLikePath(raw)) {
    return {
      ok: false,
      error: "That id is not a local record name (it tries to leave .getadvantage/approvals/).",
      next: "pass the record id printed by getadvantage approve, not a file path",
    };
  }
  const id = sanitizeRecordId(raw);
  if (fieldLooksLikeCredential(raw) || fieldLooksLikeCredential(id)) {
    return {
      ok: false,
      error: "The id value looks like a secret, so it was not exported.",
      next: "pass a name, not a key. If this record is already stored, do not copy it; say only the field name",
      field: "id",
      published: "none",
    };
  }
  let abs;
  try {
    abs = proofPathForId(cwd, id, { create: false });
  } catch {
    return {
      ok: false,
      error: "That id is not a local record name (it tries to leave .getadvantage/approvals/).",
      next: "pass the record id printed by getadvantage approve, not a file path",
    };
  }
  if (!existsSync(abs)) {
    return {
      ok: false,
      error: `No approval record named ${id} was found under .getadvantage/approvals/.`,
      next: "run getadvantage approve for the action, then re-run proof export with that record id",
    };
  }

  try {
    return withProofLock(abs, () =>
      finishProofExport(cwd, id, abs, now),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e && (e.code === "PROOF_LOCK_TIMEOUT" || e.code === "PROOF_LOCK_STALE")) {
      return {
        ok: false,
        error: msg,
        next: "retry in a moment",
        published: "none",
      };
    }
    const escaped = /escaped \.getadvantage\/approvals/.test(msg);
    return {
      ok: false,
      error: escaped
        ? "That id is not a local record name (it tries to leave .getadvantage/approvals/)."
        : `Could not read the approval record (${msg}).`,
      next: escaped
        ? "pass the record id printed by getadvantage approve, not a file path"
        : "check that the file is readable, then re-run proof export",
      published: "none",
    };
  }
}

function finishProofExport(cwd, id, abs, now) {
  const projected = [];
  let prev = PROOF_GENESIS_DIGEST;
  let boundCount = 0;
  let unboundCount = 0;
  let lineCount = 0;
  let chainStarted = false;
  let lastLineDigest = null;
  let totalBytes = 0;
  const fileHash = createHash("sha256");
  try {
    if (isSymlinkOrReparse(abs)) {
      return {
        ok: false,
        error: "That id is not a local record name (it tries to leave .getadvantage/approvals/).",
        next: "pass the record id printed by getadvantage approve, not a file path",
        published: "none",
      };
    }
    for (const { lineNo, rawBytes, truncated, tooLarge } of iterateJsonlLines(abs, fileHash)) {
      if (lineCount >= PROOF_EXPORT_MAX_LINES) {
        return {
          ok: false,
          error: `The approval record ${id} has more than ${PROOF_EXPORT_MAX_LINES} lines, so it was not exported.`,
          next: "split the work into a new approve run; this export stays bounded",
          line: lineNo,
          published: "none",
        };
      }
      if (tooLarge) {
        return {
          ok: false,
          error: `The approval record ${id} has a line over ${PROOF_RECORD_MAX_BYTES} bytes at line ${lineNo}, so it was not exported.`,
          next: "split the work into a new approve run; this export stays bounded",
          line: lineNo,
          published: "none",
        };
      }
      totalBytes += rawBytes ? rawBytes.length : 0;
      if (totalBytes > PROOF_EXPORT_MAX_TOTAL_BYTES) {
        return {
          ok: false,
          error: `The approval record ${id} is larger than ${PROOF_EXPORT_MAX_TOTAL_BYTES} bytes, so it was not exported.`,
          next: "split the work into a new approve run; this export stays bounded",
          line: lineNo,
          published: "none",
        };
      }
      if (!rawBytes || truncated) {
        return {
          ok: false,
          error: `The approval record ${id} is truncated at line ${lineNo}, so it was not exported.`,
          next: `do not edit .getadvantage/approvals/${id}.jsonl; re-run getadvantage approve to write a new record`,
          line: lineNo,
          published: "none",
        };
      }
      const lineRaw = decodeUtf8Line(rawBytes);
      if (lineRaw == null) {
        return {
          ok: false,
          error: `The approval record ${id} is truncated at line ${lineNo}, so it was not exported.`,
          next: `do not edit .getadvantage/approvals/${id}.jsonl; re-run getadvantage approve to write a new record`,
          line: lineNo,
          published: "none",
        };
      }
      let rec;
      try {
        rec = JSON.parse(lineRaw);
      } catch {
        return {
          ok: false,
          error: `The approval record ${id} is truncated at line ${lineNo}, so it was not exported.`,
          next: `do not edit .getadvantage/approvals/${id}.jsonl; re-run getadvantage approve to write a new record`,
          line: lineNo,
          published: "none",
        };
      }
      if (rec == null || typeof rec !== "object" || Array.isArray(rec)) {
        return {
          ok: false,
          error: `The approval record ${id} is truncated at line ${lineNo}, so it was not exported.`,
          next: `do not edit .getadvantage/approvals/${id}.jsonl; re-run getadvantage approve to write a new record`,
          line: lineNo,
          published: "none",
        };
      }
      const bad = credentialRecordField(rec);
      if (bad) {
        const field = diagnosticFieldName(bad);
        return {
          ok: false,
          error: `The ${field} value looks like a secret, so it was not exported.`,
          next: "pass a name, not a key. If this record is already stored, do not copy it; say only the field name",
          line: lineNo,
          field,
          published: "none",
        };
      }
      const nested = nestedOwnField(rec);
      if (nested) {
        const field = diagnosticFieldName(nested);
        return {
          ok: false,
          error: `The ${field} value is not a name string, so it was not exported.`,
          next: "pass a name, not a list. If this record is already stored, do not copy it; say only the field name",
          line: lineNo,
          field,
          published: "none",
        };
      }
      const ver = own(rec, "version");
      if (ver != null && (typeof ver !== "number" || !PROOF_RECORD_VERSIONS.has(ver))) {
        return {
          ok: false,
          error: `The approval record ${id} has an unsupported version at line ${lineNo}, so it was not exported.`,
          next: "this export accepts integer version 1 or 2. There is no released approval schema. Lines with no prevDigest export as unverified",
          line: lineNo,
          published: "none",
        };
      }
      const digest = jsonlLineDigest(rawBytes);
      const storedPrev = own(rec, "prevDigest");
      const wellFormed = isWellFormedPrevDigest(storedPrev);
      if (chainStarted) {
        if (!wellFormed) {
          return {
            ok: false,
            error: `The approval record ${id} is missing its previous-line digest at line ${lineNo}, so it was not exported.`,
            next: "treat this file as untrusted; do not copy it; run getadvantage approve to write a new record id",
            line: lineNo,
            published: "none",
          };
        }
        if (storedPrev !== prev) {
          return {
            ok: false,
            error: `The approval record ${id} does not match its previous line at line ${lineNo}, so it was not exported.`,
            next: "treat this file as untrusted; do not copy it; run getadvantage approve to write a new record id",
            line: lineNo,
            published: "none",
          };
        }
        boundCount += 1;
      } else if (storedPrev == null || storedPrev === "") {
        unboundCount += 1;
      } else {
        if (!wellFormed || storedPrev !== prev) {
          return {
            ok: false,
            error: `The approval record ${id} does not match its previous line at line ${lineNo}, so it was not exported.`,
            next: "treat this file as untrusted; do not copy it; run getadvantage approve to write a new record id",
            line: lineNo,
            published: "none",
          };
        }
        chainStarted = true;
        boundCount += 1;
      }
      const chainBound = wellFormed && storedPrev === prev;
      const event = projectProofRecord(rec, projected.length, digest, chainBound);
      if (event.dataTouched.dataClass === "allowed" || event.dataTouched.dataClass === "allow") {
        event.dataTouched.dataClass = "unknown";
      }
      projected.push(event);
      prev = digest;
      lastLineDigest = digest;
      lineCount += 1;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const escaped = /escaped \.getadvantage\/approvals/.test(msg);
    return {
      ok: false,
      error: escaped
        ? "That id is not a local record name (it tries to leave .getadvantage/approvals/)."
        : `Could not read the approval record (${msg}).`,
      next: escaped
        ? "pass the record id printed by getadvantage approve, not a file path"
        : "check that the file is readable, then re-run proof export",
      published: "none",
    };
  }

  if (lineCount === 0) {
    return {
      ok: false,
      error: `No approval record named ${id} was found under .getadvantage/approvals/.`,
      next: "run getadvantage approve for the action, then re-run proof export with that record id",
      published: "none",
    };
  }

  const sourceSha256 = fileHash.digest("hex");
  let tipMatched = false;
  try {
    const tip = readTipFile(abs);
    const tipAbs = tipPathFor(abs);
    const tipPresent = existsSync(tipAbs);
    if (tipPresent) {
      if (!isTipStructurallyValid(tip) || tip.lineCount !== lineCount || tip.tipDigest !== lastLineDigest) {
        return {
          ok: false,
          error: `The approval record ${id} does not match its write checkpoint, so it was not exported.`,
          next: "treat this file as untrusted; do not copy it; run getadvantage approve to write a new record id",
          published: "none",
        };
      }
      tipMatched = true;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/escaped \.getadvantage\/approvals/.test(msg)) {
      return {
        ok: false,
        error: "That id is not a local record name (it tries to leave .getadvantage/approvals/).",
        next: "pass the record id printed by getadvantage approve, not a file path",
        published: "none",
      };
    }
    throw e;
  }

  const jsonRel = `${MARKER_DIR}/${APPROVALS_SUBDIR}/${id}.packet.json`;
  const htmlRel = `${MARKER_DIR}/${APPROVALS_SUBDIR}/${id}.html`;
  const contentDigest = createHash("sha256").update(JSON.stringify(projected), "utf8").digest("hex");
  let chainStatus = chainStatusOf(boundCount, unboundCount, lineCount);
  if (chainStatus === "verified" && !tipMatched) {
    chainStatus = "unverified";
  }
  const packet = {
    schemaVersion: PROOF_PACKET_SCHEMA,
    kind: "getadvantage.proof.packet",
    id,
    timeVaryingFields: ["exportedAt"],
    exportedAt: now,
    cliVersion: cliVersion(),
    source: {
      path: `${MARKER_DIR}/${APPROVALS_SUBDIR}/${id}.jsonl`,
      sha256: sourceSha256,
      lineCount,
    },
    resourceNaming: "digest-only",
    compatibility: {
      recordVersions: [1, 2],
      promise:
        "A reader may rely on id, kind, outcome, approver, approverKind, model, dataTouched.dataClass, dataTouched.resourceDigest, createdAt, lineDigest, chain.status, and chain.ok. This checkout writes integer version 1 with a previous-line digest. Lines with no prevDigest export as unverified. There is no released approval schema; approve has never shipped. Missing dataClass becomes unknown. Resource plaintext is never present. chain.status is unverified, partial, or verified. chain.ok is true only when every line is bound and the write checkpoint matches. Chain: intact prints only for verified.",
    },
    chain: {
      algorithm: "sha256",
      encoding: "hex",
      hashed: "complete jsonl line bytes without trailing newline",
      genesis: PROOF_GENESIS_DIGEST,
      status: chainStatus,
      ok: chainStatus === "verified",
      boundCount,
      unboundCount,
      lineCount,
    },
    contentDigest,
    records: projected,
    humanPage: {
      path: htmlRel,
      hosted: false,
      url: null,
    },
    limitations: [
      "Local files only. Not a hosted page. There is no public URL.",
      "The resource match string is not stored. dataClass names the class; resourceDigest identifies the resource.",
      "There is no released approval schema. Approve has never shipped. npm 0.15.3 did not write these records. This checkout writes version 1 with a previous-line digest. A line with no prevDigest is unbound and exports as unverified; that is a local unsigned import, not compatibility with a released v1.",
      "chain.status unverified means no line is bound, or a bound file has no matching write checkpoint. partial means an unbound prefix then a bound suffix. verified means every line is bound and the write checkpoint matches the tail. A missing prevDigest after the chain starts is a failure, not an unsigned line. unverified is not a trustworthy unsigned history.",
      "A write-time line-count and tip-digest checkpoint is stored beside the ledger. Export refuses a present checkpoint that disagrees with the file. A missing checkpoint is never verified. Deleting the tip and stripping every prevDigest is a downgrade, not a refusal: export exits 0, content may be rewritten, and the copy is labelled unverified with ok false.",
      "An attacker who rewrites both the ledger and the checkpoint consistently still gets chain.status verified and the intact headline. Export-time hashing cannot authenticate the terminal digest. Write access to .getadvantage/approvals/ is enough.",
      "A crash after the ledger line is appended and before the checkpoint is replaced can leave a matching gap; export then refuses. That is fail-closed, not a recovery path. Run getadvantage approve to write a new record id.",
      "A name on --by is a name string, not a cryptographic identity.",
      "Not in the published package until a release.",
    ],
    latest: latestFromProjected(projected),
  };

  const packetSecret = credentialInTree(packet, "id", 0);
  if (packetSecret) {
    return {
      ok: false,
      error: "The id value looks like a secret, so it was not exported.",
      next: "pass a name, not a key. If this record is already stored, do not copy it; say only the field name",
      field: diagnosticFieldName(packetSecret),
      published: "none",
    };
  }

  const html = renderProofHtml(packet);
  try {
    const written = writeProofOutputs(cwd, id, packet, html);
    return {
      ok: true,
      packet,
      html,
      jsonRel: written.jsonRel,
      htmlRel: written.htmlRel,
      jsonAbs: written.jsonAbs,
      htmlAbs: written.htmlAbs,
      published: written.published,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const escaped = /escaped \.getadvantage\/approvals/.test(msg);
    return {
      ok: false,
      error: escaped
        ? "That id is not a local record name (it tries to leave .getadvantage/approvals/)."
        : `Could not write the local copy (${msg}).`,
      next: escaped
        ? "pass the record id printed by getadvantage approve, not a file path"
        : "check that .getadvantage/approvals/ is writable, then re-run proof export",
      published: e && e.published ? e.published : "none",
    };
  }
}

function descriptorFromFlags(flags, invocationCwd) {
  const out = {
    action: "",
    resource: "",
    dataClass: "",
    actor: "",
    model: "",
    summary: "",
    tool: "",
  };
  const file = flags["action-file"];
  if (typeof file === "string" && file.length > 0) {
    const abs = path.resolve(invocationCwd, file);
    const r = readJsonFile(abs);
    if (!r.exists) {
      return { error: `action file not found: ${file}`, descriptor: out };
    }
    if (!r.ok) {
      return {
        error: `action file is not valid JSON (${r.error?.message || "invalid JSON"})`,
        descriptor: out,
      };
    }
    if (r.json === null || typeof r.json !== "object" || Array.isArray(r.json)) {
      return { error: "action file root must be a JSON object", descriptor: out };
    }
    for (const key of ["action", "resource", "dataClass", "actor", "model", "summary", "tool"]) {
      const v = own(r.json, key);
      if (typeof v === "string") out[key] = v;
    }
    // kebab alias in the file, for humans
    if (!out.dataClass && typeof own(r.json, "data-class") === "string") {
      out.dataClass = own(r.json, "data-class");
    }
  }
  if (typeof flags.action === "string") out.action = flags.action;
  if (typeof flags.resource === "string") out.resource = flags.resource;
  if (typeof flags["data-class"] === "string") out.dataClass = flags["data-class"];
  if (typeof flags.actor === "string") out.actor = flags.actor;
  if (typeof flags.model === "string") out.model = flags.model;
  if (typeof flags.summary === "string") out.summary = flags.summary;
  if (typeof flags.tool === "string") out.tool = flags.tool;
  return { error: null, descriptor: out };
}

function usageError(msg) {
  console.error(c.red(`✗ ${msg}`));
  console.error(c.gray(`  Run \`${binName()} help approve\` to see what this command accepts.`));
  return 1;
}

function printNonGit() {
  console.error(c.red("✗ This folder isn't a git repository, so there is no committed policy to read."));
  console.error("Nothing ran.");
  console.error(c.gray("  → git init && git add -A, then commit .getadvantage/policy.json"));
  console.error(c.gray("  → then re-run getadvantage approve"));
}

function whoText(decision) {
  if (decision.outcome === "escalate") {
    return decision.escalateTo
      ? `${decision.escalateTo} (put that name on --by)`
      : "any named person you pass to --by";
  }
  if (decision.outcome === "allow") {
    if (decision.ruleId) return `policy rule ${decision.ruleId}`;
    return "the committed default (blanket allow)";
  }
  if (decision.ruleId) return `policy rule ${decision.ruleId}`;
  return "the committed default";
}

function printDecisionScreen({ decision, id, warnings, now }) {
  const bin = binName();
  console.log("getAdvantage — approval decision");
  console.log("");
  const label =
    decision.outcome === "allow"
      ? "allowed"
      : decision.outcome === "block"
        ? "blocked"
        : "waiting on a person";
  console.log(`Outcome: ${label}`);
  console.log(`Who: ${whoText(decision)}`);
  console.log(`Why: ${decision.reason}`);
  if (decision.outcome === "allow") {
    console.log("");
    if (decision.ruleId) {
      console.log("This was a real yes. A committed policy rule allowed this action.");
    } else {
      console.log("This was a real yes. The committed default permits unmatched actions. That is not a missing check.");
    }
  }
  console.log("");
  if (decision.outcome === "allow") {
    console.log("This command allowed only the action you passed in.");
  } else if (decision.outcome === "block") {
    console.log("Nothing ran. The committed policy blocked this action.");
    console.log("This command only decided the action you passed in. It does not watch the rest of the machine.");
  } else {
    console.log("Nothing ran. A person has to say yes or no.");
    console.log("This command only decides the action you passed in. It does not watch the rest of the machine.");
    console.log("");
    console.log("Next (copy these, put a real person's name on --by):");
    const byHint = decision.escalateTo ? `"${decision.escalateTo}"` : "<name>";
    console.log(`  ${bin} approve --resolve ${id} --allow --by ${byHint}`);
    console.log(`  ${bin} approve --resolve ${id} --deny --by ${byHint}`);
  }
  console.log("");
  console.log(`Record: ${MARKER_DIR}/${APPROVALS_SUBDIR}/${id}.jsonl`);
  console.log(`When:  ${now}`);
  if (warnings.length) {
    console.log("");
    for (const w of warnings) console.log(c.gray(`Note: ${w}`));
  }
}

function printResolveScreen({ id, by, resolution, now }) {
  const verb = resolution === "allow" ? "allowed" : "denied";
  console.log("getAdvantage — approval decision");
  console.log("");
  console.log(`Recorded: ${by} ${verb} this action.`);
  console.log("The original record was not changed. A new line was appended.");
  console.log("");
  console.log(`Record: ${MARKER_DIR}/${APPROVALS_SUBDIR}/${id}.jsonl`);
  console.log(`When:  ${now}`);
}

export function printApproveHelp() {
  const bin = binName();
  console.log(`${c.bold("approve")} - yes, no, or wait for a named person. Default: wait.`);
  console.log("Only the action you pass in. Local record. Not in the published package until a release.");
  console.log("");
  console.log("Usage");
  console.log(`  ${bin} approve --action <name> --resource <res> --actor <who> [--data-class <class>] [--model <m>] [--summary <line>]`);
  console.log(`  ${bin} approve --action-file <path.json>`);
  console.log(`  ${bin} approve --resolve <id> --allow|--deny --by <name>`);
  console.log(`  ${bin} approve --json ...`);
  console.log("");
  console.log("Policy is the committed `.getadvantage/policy.json` (git index, not an unstaged edit).");
  console.log("Untracked or unstaged policy cannot say yes.");
  console.log("No matching rule -> wait (nothing is allowed automatically).");
  console.log("A missing data class is treated as unknown and is never allowed by a wildcard rule.");
  console.log("Every decision writes a local record under `.getadvantage/approvals/` (resource and summary as digests; a secret-shaped name is refused).");
  console.log("");
  console.log("Exit codes: allowed 0 · blocked 1 · wait 2 · usage/config error 1.");
  console.log("Not a proxy. Not always on. Does not change the policy on its own.");
}

export function printProofHelp() {
  const bin = binName();
  console.log(`${c.bold("proof")} - write a local copy of one approval record. Not in the published package until a release.`);
  console.log("");
  console.log("Usage");
  console.log(`  ${bin} proof export <id>`);
  console.log(`  ${bin} proof export <id> --json`);
  console.log("");
  console.log("Reads `.getadvantage/approvals/<id>.jsonl` on this machine. Nothing is uploaded.");
  console.log("There is no hosted page. A disagreeing chain or secret-shaped record is refused.");
  console.log("There is no released approval schema. Lines with no previous-line digest export as unverified.");
  console.log("");
  console.log("Exit codes: printed 0 · refused 1.");
}

function proofFail(msg, next, published) {
  console.error(c.red(`✗ ${msg}`));
  if (published === "partial") console.error("A partial local copy may have been written.");
  else console.error("Nothing was written.");
  if (next) console.error(c.gray(`  → ${next}`));
  return 1;
}

function outcomeLabel(outcome) {
  if (outcome === "allow") return "allowed";
  if (outcome === "block") return "blocked";
  if (outcome === "escalate") return "waiting on a person";
  return outcome || "unknown";
}

function oneTerminalLine(v) {
  return asString(v).replace(/[\r\n]+/g, " ").trim();
}

function printProofScreen({ packet, jsonRel, htmlRel }) {
  const latest = packet.latest || {};
  console.log("getAdvantage - local approval record");
  console.log("");
  console.log(`Id: ${oneTerminalLine(packet.id)}`);
  console.log(`Lines: ${packet.chain.lineCount}`);
  console.log(`Chain: ${chainStatusLabel(packet.chain)}`);
  console.log(`Data class: ${oneTerminalLine(latest.dataClass || "unknown")}`);
  if (nonempty(latest.model)) console.log(`Model: ${oneTerminalLine(latest.model)}`);
  console.log(`Outcome: ${oneTerminalLine(outcomeLabel(latest.outcome))}`);
  console.log(`Wrote: ${oneTerminalLine(jsonRel)}`);
  console.log(`Page: ${oneTerminalLine(htmlRel)}`);
  console.log("This is a local copy. Nothing was uploaded. There is no hosted page.");
}

/**
 * CLI entry for `getadvantage proof`. Returns an exit code. Never throws.
 *
 * @param {{ cwd?: string, flags?: Record<string, unknown>, positional?: string[], now?: string, emitJson?: ((doc: object) => void)|null }} opts
 */
export function runProof(opts = {}) {
  try {
    const flags = opts.flags || {};
    const positional = Array.isArray(opts.positional) ? opts.positional : [];
    const invocationCwd = opts.cwd || process.cwd();
    const emitJson = typeof opts.emitJson === "function" ? opts.emitJson : null;
    const now = opts.now || new Date().toISOString();

    if (flags.help) {
      printProofHelp();
      return 0;
    }

    const sub = positional[1] || "";
    const idArg = positional[2];
    if (!sub || sub === "help") {
      printProofHelp();
      return 0;
    }
    if (sub !== "export") {
      return proofFail(
        `Unknown proof subcommand: ${sub}.`,
        `Run \`${binName()} proof export <id>\` to write a local copy.`,
      );
    }
    if (!nonempty(idArg)) {
      return proofFail(
        "Need an id (the record id printed by getadvantage approve).",
        `Run \`${binName()} help proof\` to see what this command accepts.`,
      );
    }

    const gitCwd = classifyGitCwd(invocationCwd);
    const repoCwd = gitCwd.kind === "worktree" ? gitCwd.root : invocationCwd;

    const result = exportProofRecord(repoCwd, idArg, { now });
    if (!result.ok) {
      const errorDoc = {
        command: "proof",
        action: "export",
        outcome: null,
        exitCode: 1,
        reason: result.error,
        generatedAt: now,
      };
      const safeId = nonempty(idArg) ? sanitizeRecordId(idArg) : null;
      if (
        safeId &&
        !fieldLooksLikeCredential(idArg) &&
        !fieldLooksLikeCredential(safeId)
      ) {
        errorDoc.id = safeId;
      }
      emitErrorJson(emitJson, errorDoc);
      return proofFail(result.error, result.next, result.published);
    }

    printProofScreen({
      packet: result.packet,
      jsonRel: result.jsonRel,
      htmlRel: result.htmlRel,
    });
    if (emitJson) {
      emitJson(result.packet);
    }
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(c.red(`✗ Could not finish the proof export (${msg}).`));
    console.error("Nothing was written.");
    emitErrorJson(typeof opts.emitJson === "function" ? opts.emitJson : null, {
      command: "proof",
      action: "export",
      outcome: null,
      exitCode: 1,
      reason: msg,
      generatedAt: opts.now || new Date().toISOString(),
    });
    return 1;
  }
}

function makeId(now, nonce) {
  const stamp = String(now).replace(/[:.]/g, "-");
  return sanitizeRecordId(`dec-${stamp}-${nonce}`);
}

function jsonDocForDecision({ decision, id, now, descriptor }) {
  return {
    command: "approve",
    outcome: decision.outcome,
    exitCode: EXIT[decision.outcome] ?? 1,
    id,
    ruleId: decision.ruleId,
    reason: decision.reason,
    escalateTo: decision.escalateTo,
    approver: decision.ruleId || (decision.outcome === "allow" ? "default" : null),
    model: nonempty(descriptor?.model) || null,
    dataClass: nonempty(descriptor?.dataClass) || null,
    disclosedAllow: !!decision.disclosedAllow,
    blanketAllow: decision.outcome === "allow" && !decision.ruleId,
    generatedAt: now,
  };
}

/**
 * CLI entry. Returns an exit code. Never throws to the caller.
 * `now` / `nonce` are injectable so tests stay deterministic; production
 * fills them from the clock and `randomBytes`.
 *
 * @param {{ cwd?: string, flags?: Record<string, unknown>, now?: string, nonce?: string, emitJson?: ((doc: object) => void)|null }} opts
 */
export function runApprove(opts = {}) {
  try {
    const flags = opts.flags || {};
    const invocationCwd = opts.cwd || process.cwd();
    const emitJson = typeof opts.emitJson === "function" ? opts.emitJson : null;
    const now = opts.now || new Date().toISOString();
    const nonce = opts.nonce || randomBytes(4).toString("hex");

    if (flags.help) {
      printApproveHelp();
      return 0;
    }

    const gitCwd = classifyGitCwd(invocationCwd);
    if (gitCwd.kind !== "worktree") {
      printNonGit();
      emitErrorJson(emitJson, {
        command: "approve",
        outcome: null,
        exitCode: 1,
        reason: "not a git worktree",
        generatedAt: now,
      });
      return 1;
    }
    const repoCwd = gitCwd.root;

    if ((flags.allow || flags.deny) && (flags.resolve == null || flags.resolve === false)) {
      return usageError("--allow and --deny are only for --resolve, not for asking a decision.");
    }

    if (flags.resolve != null && flags.resolve !== false) {
      const idRaw = flags.resolve === true ? "" : String(flags.resolve);
      if (!nonempty(idRaw)) return usageError("--resolve needs an id");
      const by = flags.by === true ? "" : asString(flags.by);
      if (!nonempty(by)) {
        return usageError("A named person is required to resolve an escalation (--by <name>).");
      }
      if (credentialProofField({}, { by: nonempty(by) })) {
        emitErrorJson(emitJson, {
          command: "approve",
          action: "resolve",
          outcome: null,
          exitCode: 1,
          reason:
            "The --by value looks like a secret, so it was not stored and this action was not allowed. Pass a person's name, not a key.",
          generatedAt: now,
        });
        return usageError(
          "The --by value looks like a secret, so it was not stored and this action was not allowed. Pass a person's name, not a key.",
        );
      }
      const allow = !!flags.allow;
      const deny = !!flags.deny;
      if (allow === deny) {
        return usageError("Say --allow or --deny (exactly one).");
      }
      const id = sanitizeRecordId(idRaw);
      if (fieldLooksLikeCredential(idRaw) || fieldLooksLikeCredential(id)) {
        emitErrorJson(emitJson, {
          command: "approve",
          action: "resolve",
          outcome: null,
          exitCode: 1,
          reason:
            "The id value looks like a secret, so it was not stored and this action was not allowed. Pass a name, not a key.",
          generatedAt: now,
        });
        return usageError(
          "The id value looks like a secret, so it was not stored and this action was not allowed. Pass a name, not a key.",
        );
      }
      let existingAbs;
      try {
        existingAbs = proofPathForId(repoCwd, id, { create: false });
      } catch {
        return usageError(`No approval record named ${id} was found under .getadvantage/approvals/.`);
      }
      if (!existsSync(existingAbs)) {
        return usageError(`No approval record named ${id} was found under .getadvantage/approvals/.`);
      }
      const ctx = readDecisionContext(existingAbs);
      const resolution = allow ? "allow" : "deny";
      const record = buildProofRecord({
        kind: "resolution",
        id,
        decision: {
          outcome: allow ? "allow" : "block",
          ruleId: null,
          reason: `${by} ${allow ? "allowed" : "denied"} this action`,
          escalateTo: null,
        },
        descriptor: {
          action: ctx.action || "",
          actor: ctx.actor || "",
          model: ctx.model || "",
          dataClass: ctx.dataClass || "",
        },
        now,
        extra: {
          by: nonempty(by),
          resolves: id,
          resolution,
          resourceDigest: ctx.resourceDigest,
          summaryDigest: ctx.summaryDigest,
        },
      });
      record.approver = nonempty(by);
      const abs = appendProofRecord(repoCwd, record);
      printResolveScreen({ id, by: nonempty(by), resolution, now });
      if (emitJson) {
        emitJson({
          command: "approve",
          action: "resolve",
          outcome: resolution,
          exitCode: 0,
          id,
          by: nonempty(by),
          proof: abs,
          generatedAt: now,
        });
      }
      return 0;
    }

    const built = descriptorFromFlags(flags, invocationCwd);
    if (built.error) return usageError(built.error);
    const descriptor = built.descriptor;
    if (!nonempty(descriptor.action) || !nonempty(descriptor.resource) || !nonempty(descriptor.actor)) {
      return usageError("Need --action, --resource and --actor (or an --action-file that has them).");
    }
    const credField = credentialProofField(descriptor);
    if (credField) {
      emitErrorJson(emitJson, {
        command: "approve",
        outcome: null,
        exitCode: 1,
        reason: `The ${diagnosticFieldName(credField)} value looks like a secret, so it was not stored and this action was not allowed. Pass a name, not a key.`,
        generatedAt: now,
      });
      return usageError(
        `The ${credField} value looks like a secret, so it was not stored and this action was not allowed. Pass a name, not a key.`,
      );
    }

    const loaded = loadApprovalsPolicy(repoCwd);
    if (!loaded.ok) {
      console.error(c.red(`✗ ${loaded.error}`));
      console.error("The action was not allowed.");
      emitErrorJson(emitJson, {
        command: "approve",
        outcome: null,
        exitCode: 1,
        reason: loaded.error,
        generatedAt: now,
      });
      return 1;
    }

    const decision = decide(descriptor, loaded.policy);
    const id = makeId(now, nonce);
    const record = buildProofRecord({
      kind: "decision",
      id,
      decision,
      descriptor,
      now,
    });
    const abs = appendProofRecord(repoCwd, record);
    printDecisionScreen({
      decision,
      id,
      warnings: loaded.warnings,
      now,
    });
    if (emitJson) {
      const doc = jsonDocForDecision({ decision, id, now, descriptor });
      doc.proof = abs;
      emitJson(doc);
    }
    return EXIT[decision.outcome] ?? 1;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const catchJson = typeof opts.emitJson === "function" ? opts.emitJson : null;
    const catchNow = opts.now || new Date().toISOString();
    if (e && e.code === "PROOF_PARTIAL_WRITE") {
      console.error(c.red(`✗ ${msg}`));
      console.error("The ledger line was written. Treat this record as incomplete.");
      emitErrorJson(catchJson, {
        command: "approve",
        outcome: null,
        exitCode: 1,
        reason: msg,
        generatedAt: catchNow,
      });
      return 1;
    }
    console.error(c.red(`✗ Could not finish the approval decision (${msg}).`));
    console.error("The action was not allowed.");
    emitErrorJson(catchJson, {
      command: "approve",
      outcome: null,
      exitCode: 1,
      reason: msg,
      generatedAt: catchNow,
    });
    return 1;
  }
}
