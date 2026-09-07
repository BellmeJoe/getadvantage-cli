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

import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathMatchesGlob, isPolicyPathInIndex } from "./policy.mjs";
import {
  binName,
  c,
  classifyGitCwd,
  markerFileForWrite,
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
const OUTCOMES = new Set(["allow", "block", "escalate"]);
const ID_MAX = 80;

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

function specificity(rule) {
  let n = 0;
  for (const key of MATCH_KEYS) {
    const v = own(rule, key);
    if (nonempty(v)) n += 1;
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
    warnings.push(`${rel} is listed in the git index but could not be read — approval rules not applied.`);
    return { ok: true, policy: empty, source: rel, warnings, error: null };
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

function approvalsAbs(cwd, file) {
  const abs = markerFileForWrite(cwd, path.join(APPROVALS_SUBDIR, file));
  mkdirSync(path.dirname(abs), { recursive: true });
  const root = path.resolve(path.join(cwd, MARKER_DIR, APPROVALS_SUBDIR));
  const resolved = path.resolve(abs);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error("approval record path escaped .getadvantage/approvals/");
  }
  return resolved;
}

export function proofPathForId(cwd, id) {
  return approvalsAbs(cwd, `${sanitizeRecordId(id)}.jsonl`);
}

/**
 * Build the proof object. Never includes summary text, resource text, or any
 * raw payload — only digests. A display fingerprint of the summary is not
 * stored: a mask of a secret still contains secret bytes (H6).
 */
export function buildProofRecord({ kind, id, decision, descriptor, now, extra }) {
  const desc = descriptor || {};
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
  }
  return rec;
}

export function appendProofRecord(cwd, record) {
  const id = sanitizeRecordId(record?.id);
  const abs = proofPathForId(cwd, id);
  appendFileSync(abs, JSON.stringify(record) + "\n", "utf8");
  return abs;
}

export function readProofLines(cwd, id) {
  const abs = proofPathForId(cwd, id);
  if (!existsSync(abs)) return { abs, raw: null, lines: [] };
  const raw = readFileSync(abs, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  return { abs, raw, lines };
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
  console.error(c.red("✗ This folder isn't a git repository, so there is no reviewable policy."));
  console.error("The action was not allowed.");
  console.error(c.gray("  → git init && git add -A, then commit .getadvantage/policy.json"));
}

function whoText(decision) {
  if (decision.outcome === "escalate") {
    return decision.escalateTo
      ? `this needs a decision from ${decision.escalateTo}`
      : "this needs a decision from a named person (set approvals.escalateTo in the committed policy)";
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
    decision.outcome === "allow" ? "allowed" : decision.outcome === "block" ? "blocked" : "escalated";
  console.log(`Outcome: ${label}`);
  console.log(`Who: ${whoText(decision)}`);
  console.log(`Why: ${decision.reason}`);
  if (decision.disclosedAllow) {
    console.log("");
    console.log("This is a blanket allow — the committed default permits unmatched actions. Every allow is disclosed.");
  }
  console.log("");
  if (decision.outcome === "allow") {
    console.log("The action was allowed by the committed policy.");
  } else if (decision.outcome === "block") {
    console.log("The action was not allowed.");
  } else {
    console.log("The action was not allowed. A person has to say yes or no.");
    console.log("");
    console.log("Next:");
    const byHint = decision.escalateTo ? decision.escalateTo : "<name>";
    console.log(`  ${bin} approve --resolve ${id} --allow --by ${byHint}`);
    console.log(`  ${bin} approve --resolve ${id} --deny --by ${byHint}`);
  }
  console.log("");
  console.log(`Proof: ${MARKER_DIR}/${APPROVALS_SUBDIR}/${id}.jsonl`);
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
  console.log(`Proof: ${MARKER_DIR}/${APPROVALS_SUBDIR}/${id}.jsonl`);
  console.log(`When:  ${now}`);
}

export function printApproveHelp() {
  const bin = binName();
  console.log(`${c.bold("approve")} — decide whether an agent action is allowed, blocked, or sent to a person.`);
  console.log("");
  console.log("Usage");
  console.log(`  ${bin} approve --action <name> --resource <res> --actor <who> [--data-class <class>] [--model <m>] [--summary <line>]`);
  console.log(`  ${bin} approve --action-file <path.json>`);
  console.log(`  ${bin} approve --resolve <id> --allow|--deny --by <name>`);
  console.log(`  ${bin} approve --json …`);
  console.log("");
  console.log("Policy is the committed `.getadvantage/policy.json` (git index, not an unstaged edit).");
  console.log("No matching rule → escalate (nothing is allowed automatically).");
  console.log("A missing data class is treated as unknown and is never allowed by a wildcard rule.");
  console.log("Every decision writes a proof line under `.getadvantage/approvals/` (digests only, never a payload).");
  console.log("");
  console.log("Exit codes: allowed 0 · blocked 1 · escalated 2 · usage/config error 1.");
  console.log("Not a network service. Not live as an always-on interceptor.");
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
      if (emitJson) {
        emitJson({
          command: "approve",
          outcome: null,
          exitCode: 1,
          reason: "not a git worktree",
          generatedAt: now,
        });
      }
      return 1;
    }
    const repoCwd = gitCwd.root;

    if (flags.resolve != null && flags.resolve !== false) {
      const idRaw = flags.resolve === true ? "" : String(flags.resolve);
      if (!nonempty(idRaw)) return usageError("--resolve needs an id");
      const by = flags.by === true ? "" : asString(flags.by);
      if (!nonempty(by)) {
        return usageError("A named person is required to resolve an escalation (--by <name>).");
      }
      const allow = !!flags.allow;
      const deny = !!flags.deny;
      if (allow === deny) {
        return usageError("Say --allow or --deny (exactly one).");
      }
      const id = sanitizeRecordId(idRaw);
      const existing = readProofLines(repoCwd, id);
      if (!existing.raw) {
        return usageError(`No approval record named ${id} was found under .getadvantage/approvals/.`);
      }
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
        descriptor: {},
        now,
        extra: { by: nonempty(by), resolves: id, resolution },
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

    const loaded = loadApprovalsPolicy(repoCwd);
    if (!loaded.ok) {
      console.error(c.red(`✗ ${loaded.error}`));
      console.error("The action was not allowed.");
      if (emitJson) {
        emitJson({
          command: "approve",
          outcome: null,
          exitCode: 1,
          reason: loaded.error,
          generatedAt: now,
        });
      }
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
    console.error(c.red(`✗ Could not finish the approval decision (${msg}).`));
    console.error("The action was not allowed.");
    return 1;
  }
}
