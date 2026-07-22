// getAdvantage — Intent Contract (local change-scope trust layer).
//
// Access control asks whether an agent was allowed to *use* a tool. This module
// answers a different local proof question: did repository changes stay inside
// the task envelope the human authorized?
//
// Trust model (fail-closed):
//   • Authorization is the COMMITTED blob at a verified local baseline
//     (default: HEAD:.getadvantage/intent.json via `git show`). An uncommitted
//     or only-staged worktree copy cannot broaden scope.
//   • Deny globs override allow globs.
//   • Every staged / unstaged / deleted / renamed / untracked path is accounted
//     for; renames check BOTH old and new paths.
//   • Malformed schema, absolute paths, traversal, unsafe globs, missing trust
//     data, or ambiguous baseline → NO-GO with actionable text.
//   • Acceptance notes are bound into the receipt hash only — NEVER executed,
//     NEVER claimed semantically verified.
//
// Honest limitation always emitted:
//   "scope verified; semantic correctness not proven"
//
// Zero dependencies. Node built-ins only. ESM. No network, no shell hooks, no
// model calls, no printing of file contents / tokens / secrets.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  binName,
  c,
  gitRaw,
  gitSafe,
  MARKER_DIR,
  pl,
  printResult,
  result,
  section,
  stripBom,
} from "./util.mjs";
import { pathMatchesGlob } from "./policy.mjs";

/** Repo-relative contract path (forward slashes). */
export const INTENT_REL = `${MARKER_DIR}/intent.json`;

/** Supported schema versions. */
export const INTENT_SCHEMA_VERSIONS = new Set([1]);

/** Always-emitted honesty bound into receipts and human/JSON output. */
export const INTENT_LIMITATION = "scope verified; semantic correctness not proven";

/** Max goal / notes length kept in receipts (bound, never truncated in hash input). */
const GOAL_DISPLAY_CAP = 200;
const NOTES_DISPLAY_CAP = 400;

// ---------------------------------------------------------------------------
// Path / glob safety
// ---------------------------------------------------------------------------

/**
 * Normalize a repo-relative path for comparison.
 * Forward slashes, no leading `./`. Does NOT case-fold (case-sensitive
 * platforms stay strict). Windows separators become `/`.
 */
export function normalizeRepoPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/");
}

/**
 * True when a path/glob is unsafe for a contract (absolute, drive letter,
 * traversal, null bytes, empty).
 */
export function isUnsafePathOrGlob(raw) {
  if (typeof raw !== "string") return true;
  const s = raw.trim();
  if (!s) return true;
  if (s.includes("\0")) return true;
  // Absolute POSIX or Windows (C:\…, \\server\…, /abs)
  if (s.startsWith("/") || s.startsWith("\\")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(s)) return true;
  if (s.startsWith("//") || s.startsWith("\\\\")) return true;
  const norm = normalizeRepoPath(s);
  if (!norm || norm === "." || norm === "..") return true;
  const parts = norm.split("/");
  if (parts.some((seg) => seg === "..")) return true;
  // Reject globs that try to escape via absolute-looking segments after expand.
  if (parts[0] === "" ) return true;
  return false;
}

/**
 * Validate a glob pattern string for contract use. Returns error message or null.
 */
export function validateGlob(raw) {
  if (typeof raw !== "string" || !raw.trim()) return "empty glob";
  if (isUnsafePathOrGlob(raw)) return `unsafe path/glob: ${JSON.stringify(raw)}`;
  // Extremely pathological: bare ** alone would authorize the whole tree — that
  // is allowed (human choice) but empty patterns after strip are not.
  const n = normalizeRepoPath(raw.trim());
  if (!n) return "empty glob after normalize";
  return null;
}

// ---------------------------------------------------------------------------
// Canonicalization + hash
// ---------------------------------------------------------------------------

/**
 * Build the canonical object used for SHA-256 identity. Only trusted fields;
 * key order is fixed; arrays sorted for stability.
 * @param {object} contract validated contract
 */
export function canonicalizeContract(contract) {
  const allow = [...(contract.allow || [])].map((g) => normalizeRepoPath(g)).sort();
  const deny = [...(contract.deny || [])].map((g) => normalizeRepoPath(g)).sort();
  const require = [...(contract.require || [])].map((g) => normalizeRepoPath(g)).sort();
  const out = {
    schemaVersion: contract.schemaVersion,
    goal: String(contract.goal || ""),
    allow,
    deny,
    require,
  };
  if (contract.maxFiles != null) out.maxFiles = contract.maxFiles;
  if (contract.acceptanceNotes != null && String(contract.acceptanceNotes).length > 0) {
    out.acceptanceNotes = String(contract.acceptanceNotes);
  }
  if (contract.baselineRef != null && String(contract.baselineRef).length > 0) {
    out.baselineRef = String(contract.baselineRef);
  }
  return out;
}

/**
 * Stable SHA-256 hex of the canonicalized contract JSON (no whitespace variance).
 * @returns {string} 64-char lowercase hex
 */
export function computeIntentHash(contract) {
  const canon = canonicalizeContract(contract);
  const payload = JSON.stringify(canon);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Parse + validate contract JSON
// ---------------------------------------------------------------------------

/**
 * Parse and validate contract JSON text. Fail-closed.
 * @returns {{ ok: true, contract: object } | { ok: false, error: string }}
 */
export function parseAndValidateContract(text) {
  let json;
  try {
    json = JSON.parse(stripBom(String(text ?? "")));
  } catch (e) {
    return { ok: false, error: `intent contract is not valid JSON (${e.message || e})` };
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, error: "intent contract root must be a JSON object" };
  }

  const schemaVersion = json.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    return { ok: false, error: "intent contract requires integer schemaVersion" };
  }
  if (!INTENT_SCHEMA_VERSIONS.has(schemaVersion)) {
    return {
      ok: false,
      error: `unsupported intent schemaVersion ${schemaVersion} (supported: ${[...INTENT_SCHEMA_VERSIONS].join(", ")})`,
    };
  }

  const goal = json.goal;
  if (typeof goal !== "string" || !goal.trim()) {
    return { ok: false, error: "intent contract requires a non-empty human-readable goal string" };
  }

  if (!Array.isArray(json.allow) || json.allow.length === 0) {
    return { ok: false, error: "intent contract requires a non-empty allow array of relative-path globs" };
  }
  for (const g of json.allow) {
    const err = validateGlob(g);
    if (err) return { ok: false, error: `allow: ${err}` };
  }

  const deny = Array.isArray(json.deny) ? json.deny : [];
  if (json.deny != null && !Array.isArray(json.deny)) {
    return { ok: false, error: "intent contract deny must be an array of globs when present" };
  }
  for (const g of deny) {
    const err = validateGlob(g);
    if (err) return { ok: false, error: `deny: ${err}` };
  }

  const require = Array.isArray(json.require) ? json.require : [];
  if (json.require != null && !Array.isArray(json.require)) {
    return { ok: false, error: "intent contract require must be an array of globs when present" };
  }
  for (const g of require) {
    const err = validateGlob(g);
    if (err) return { ok: false, error: `require: ${err}` };
  }

  let maxFiles = null;
  if (json.maxFiles != null) {
    if (typeof json.maxFiles !== "number" || !Number.isInteger(json.maxFiles) || json.maxFiles < 0) {
      return { ok: false, error: "intent contract maxFiles must be a non-negative integer when present" };
    }
    maxFiles = json.maxFiles;
  }

  let acceptanceNotes = null;
  if (json.acceptanceNotes != null) {
    if (typeof json.acceptanceNotes !== "string") {
      return { ok: false, error: "intent contract acceptanceNotes must be a string when present" };
    }
    acceptanceNotes = json.acceptanceNotes;
  }

  let baselineRef = null;
  if (json.baselineRef != null) {
    if (typeof json.baselineRef !== "string" || !json.baselineRef.trim()) {
      return { ok: false, error: "intent contract baselineRef must be a non-empty string when present" };
    }
    // Local-only ref names: HEAD[~^N], refs/heads/…, simple branch/SHA-like tokens.
    // Remote / PR refs are rejected at resolve time too.
    const br = json.baselineRef.trim();
    if (/[\0\n\r]/.test(br) || br.includes("..") || /:\/\//.test(br)) {
      return { ok: false, error: `intent contract baselineRef is not a safe local ref name: ${JSON.stringify(br)}` };
    }
    if (!/^(HEAD([~^][0-9]+)*|refs\/heads\/[A-Za-z0-9._\/-]+|[A-Za-z0-9][A-Za-z0-9._\/-]*)$/.test(br)) {
      return { ok: false, error: `intent contract baselineRef is not a safe local ref name: ${JSON.stringify(br)}` };
    }
    baselineRef = br;
  }

  // Reject unknown top-level keys that look like executable hooks.
  const FORBIDDEN_KEYS = [
    "hooks", "run", "exec", "command", "commands", "script", "scripts",
    "shell", "onCheck", "preCheck", "postCheck", "network", "url", "model",
  ];
  for (const k of FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(json, k)) {
      return { ok: false, error: `intent contract must not contain executable field "${k}"` };
    }
  }

  const contract = {
    schemaVersion,
    goal: goal.trim(),
    allow: json.allow.map((g) => normalizeRepoPath(String(g).trim())),
    deny: deny.map((g) => normalizeRepoPath(String(g).trim())),
    require: require.map((g) => normalizeRepoPath(String(g).trim())),
    maxFiles,
    acceptanceNotes,
    baselineRef,
  };
  return { ok: true, contract };
}

// ---------------------------------------------------------------------------
// Trust: read committed blob only
// ---------------------------------------------------------------------------

/**
 * Read a blob at `ref:path` via git show. Never the worktree.
 * @returns {string|null}
 */
export function readGitCommitBlob(cwd, ref, relPath) {
  const want = normalizeRepoPath(relPath);
  if (!want || isUnsafePathOrGlob(want)) return null;
  // ref is pre-validated for baseline; still refuse shell metacharacters.
  if (!ref || /[\0\n\r]/.test(ref)) return null;
  try {
    return gitRaw(["show", `${ref}:${want}`], { cwd });
  } catch {
    return null;
  }
}

/**
 * Resolve a baseline ref to a verified LOCAL commit SHA only.
 * Never follows attacker-controlled remote PR refs silently.
 * @returns {{ ok: true, sha: string, ref: string } | { ok: false, error: string }}
 */
export function resolveLocalBaseline(cwd, refName) {
  const name = (refName || "HEAD").trim();
  if (!name) return { ok: false, error: "empty baseline ref" };

  // Refuse remote-tracking and special GitHub merge refs unless they already
  // exist as *local* objects the operator explicitly has. We only accept:
  //   HEAD, HEAD~N, branch names, refs/heads/*, and full/abbrev local SHAs
  // that `git rev-parse --verify <ref>^{commit}` resolves WITHOUT fetching.
  if (/^(refs\/remotes\/|remotes\/|origin\/|pull\/|refs\/pull\/)/i.test(name)) {
    return {
      ok: false,
      error: `baseline ref ${JSON.stringify(name)} looks remote/PR-controlled — refuse (pass an explicit local branch or SHA)`,
    };
  }

  // Must resolve to a local commit object.
  const sha = gitSafe(["rev-parse", "--verify", `${name}^{commit}`], { cwd });
  if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) {
    return {
      ok: false,
      error: `baseline ref ${JSON.stringify(name)} does not resolve to a local commit`,
    };
  }

  // Confirm the object is present locally (no implicit network).
  const type = gitSafe(["cat-file", "-t", sha], { cwd });
  if (type !== "commit") {
    return { ok: false, error: `baseline ${sha.slice(0, 12)} is not a local commit object` };
  }

  return { ok: true, sha: sha.toLowerCase(), ref: name };
}

/**
 * Whether the intent path is present as a regular blob on the given commit
 * (not a symlink / gitlink). Fail closed on unusual modes when detectable.
 */
function intentBlobIsSafeOnRef(cwd, ref) {
  // `git ls-tree` mode: 100644/100755 blob, 120000 symlink, 160000 gitlink
  const out = gitSafe(["ls-tree", ref, "--", INTENT_REL], { cwd });
  if (!out) return { ok: false, error: `${INTENT_REL} is not present on ${ref}` };
  const mode = out.split(/\s+/)[0];
  if (mode === "120000") {
    return { ok: false, error: `${INTENT_REL} is a symlink on ${ref} — refuse (adversarial)` };
  }
  if (mode === "160000") {
    return { ok: false, error: `${INTENT_REL} is a gitlink/submodule on ${ref} — refuse` };
  }
  if (mode !== "100644" && mode !== "100755") {
    return { ok: false, error: `${INTENT_REL} has unexpected git mode ${mode} on ${ref}` };
  }
  return { ok: true };
}

/**
 * Load the trusted Intent Contract from a committed baseline.
 * Worktree edits never authorize.
 *
 * @param {string} cwd
 * @param {{ baselineRef?: string }} [opts] CLI override for baseline (must be local)
 * @returns {{
 *   present: boolean,
 *   trusted: boolean,
 *   contract: object|null,
 *   hash: string|null,
 *   baseline: { ref: string, sha: string }|null,
 *   error: string|null,
 *   worktreeDiffers: boolean,
 * }}
 */
export function loadTrustedIntent(cwd, opts = {}) {
  const empty = {
    present: false,
    trusted: false,
    contract: null,
    hash: null,
    baseline: null,
    error: null,
    worktreeDiffers: false,
  };

  // Detect worktree presence (informational only — never authorizes).
  const abs = path.join(cwd, ...INTENT_REL.split("/"));
  let worktreeExists = false;
  try {
    worktreeExists = existsSync(abs);
  } catch {
    worktreeExists = false;
  }

  // Adversarial: if worktree path is a symlink, note it; still only trust HEAD blob.
  if (worktreeExists) {
    try {
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) {
        // Do not fail solely on worktree symlink if HEAD is a regular blob;
        // but if there is no trusted HEAD blob, this alone is not trust.
      }
    } catch {
      /* ignore */
    }
  }

  // Resolve baseline: CLI override > contract field (after we load HEAD) > HEAD.
  // First try HEAD for the contract body (must be committed). Optional
  // baselineRef inside the contract may re-point the *diff* baseline, but the
  // authorizing contract text is always the blob at the trust ref.
  //
  // Trust ref selection:
  //   1. Explicit CLI --base-ref (local only) — contract blob must exist there
  //   2. Else HEAD — contract must be committed on HEAD
  const cliBase = opts.baselineRef ? String(opts.baselineRef).trim() : "";
  const trustRefName = cliBase || "HEAD";
  const trustRes = resolveLocalBaseline(cwd, trustRefName);
  if (!trustRes.ok) {
    // No commits yet / bad ref: if nothing on disk either, absent; else fail closed.
    if (!worktreeExists) return empty;
    return {
      ...empty,
      present: true,
      error: trustRes.error,
    };
  }

  const modeCheck = intentBlobIsSafeOnRef(cwd, trustRes.sha);
  if (!modeCheck.ok) {
    // Genuinely absent on trust ref.
    const absent = /is not present/.test(modeCheck.error || "");
    if (absent && !worktreeExists && !cliBase) return empty;
    if (absent && worktreeExists) {
      return {
        ...empty,
        present: true,
        error:
          `${INTENT_REL} exists in the working tree but is not committed on ${trustRes.ref} — ` +
          `commit the contract before the agent starts so the baseline is reviewable and frozen.`,
      };
    }
    return { ...empty, present: true, error: modeCheck.error };
  }

  const blob = readGitCommitBlob(cwd, trustRes.sha, INTENT_REL);
  if (blob == null) {
    if (!worktreeExists) return empty;
    return {
      ...empty,
      present: true,
      error: `could not read committed ${INTENT_REL} from ${trustRes.sha.slice(0, 12)}`,
    };
  }

  const parsed = parseAndValidateContract(blob);
  if (!parsed.ok) {
    return {
      ...empty,
      present: true,
      baseline: { ref: trustRes.ref, sha: trustRes.sha },
      error: parsed.error,
    };
  }

  // Diff baseline: optional contract.baselineRef or CLI override, else trust ref.
  // CLI --base-ref already used as trust ref. Contract field may further pin
  // the *change* comparison base when trust is HEAD.
  let diffRef = trustRes;
  const contractBase = parsed.contract.baselineRef;
  if (!cliBase && contractBase) {
    const br = resolveLocalBaseline(cwd, contractBase);
    if (!br.ok) {
      return {
        ...empty,
        present: true,
        baseline: { ref: trustRes.ref, sha: trustRes.sha },
        error: `contract baselineRef: ${br.error}`,
      };
    }
    // Contract still authorized from trustRes blob; diff uses br.
    diffRef = br;
  }

  // Worktree differs disclosure (never authorizes).
  let worktreeDiffers = false;
  if (worktreeExists) {
    try {
      const wt = readFileSync(abs, "utf8");
      if (wt !== blob) worktreeDiffers = true;
    } catch {
      /* ignore */
    }
  }

  const hash = computeIntentHash(parsed.contract);
  return {
    present: true,
    trusted: true,
    contract: parsed.contract,
    hash,
    baseline: { ref: diffRef.ref, sha: diffRef.sha, trustSha: trustRes.sha, trustRef: trustRes.ref },
    error: null,
    worktreeDiffers,
  };
}

// ---------------------------------------------------------------------------
// Change collection (staged + unstaged + deleted + renamed + untracked)
// ---------------------------------------------------------------------------

/**
 * Parse `git diff --name-status -z` output into path records.
 * Renames produce { path, kind, oldPath }.
 */
function parseNameStatusZ(buf) {
  const out = [];
  if (!buf) return out;
  const parts = buf.split("\0").filter((p) => p.length > 0);
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    if (!status) break;
    const code = status[0];
    if (code === "R" || code === "C") {
      const oldPath = parts[i++] || "";
      const newPath = parts[i++] || "";
      if (oldPath) out.push({ path: normalizeRepoPath(oldPath), kind: code === "R" ? "rename-from" : "copy-from", oldPath: null });
      if (newPath) out.push({ path: normalizeRepoPath(newPath), kind: code === "R" ? "rename-to" : "copy-to", oldPath: normalizeRepoPath(oldPath) });
    } else {
      const p = parts[i++] || "";
      if (!p) continue;
      let kind = "modify";
      if (code === "A") kind = "add";
      else if (code === "D") kind = "delete";
      else if (code === "M") kind = "modify";
      else if (code === "T") kind = "typechange";
      else if (code === "U") kind = "unmerged";
      else kind = "change";
      out.push({ path: normalizeRepoPath(p), kind, oldPath: null });
    }
  }
  return out;
}

/**
 * Collect every path that differs from the baseline commit through the
 * current index + worktree + untracked files. Fail closed on unmerged paths.
 *
 * @returns {{ ok: true, paths: Array<{path,kind,oldPath}>, ambiguous: string|null }
 *          | { ok: false, error: string }}
 */
export function collectChangedPaths(cwd, baselineSha) {
  if (!baselineSha || !/^[0-9a-f]{40}$/i.test(baselineSha)) {
    return { ok: false, error: "invalid baseline SHA for change collection" };
  }

  // Detect nested repo / submodule ambiguity: if .git is a file (worktree) ok;
  // if multiple nested .git dirs appear as untracked, we still list paths but
  // flag gitlinks from name-status.
  try {
    // Index vs baseline (covers all committed-since-baseline + staged).
    const cached = gitRaw(["diff", "--name-status", "-z", "-M", "--cached", baselineSha], { cwd });
    // Worktree vs index (unstaged).
    const unstaged = gitRaw(["diff", "--name-status", "-z", "-M"], { cwd });
    // Untracked (not ignored).
    const untrackedRaw = gitRaw(["ls-files", "-o", "--exclude-standard", "-z"], { cwd });

    const records = [
      ...parseNameStatusZ(cached),
      ...parseNameStatusZ(unstaged),
    ];
    for (const p of untrackedRaw.split("\0").filter(Boolean)) {
      records.push({ path: normalizeRepoPath(p), kind: "untracked", oldPath: null });
    }

    // Unmerged / conflicted → fail closed.
    const unmerged = records.filter((r) => r.kind === "unmerged");
    if (unmerged.length > 0) {
      return {
        ok: false,
        error: `repo has unmerged/conflicted paths (${unmerged
          .map((r) => r.path)
          .slice(0, 5)
          .join(", ")}) — resolve before intent check`,
      };
    }

    // Dedupe by path; keep first kind (rename-from/to both retained as separate
    // path keys already).
    const byPath = new Map();
    for (const r of records) {
      if (!r.path) continue;
      if (isUnsafePathOrGlob(r.path)) {
        return {
          ok: false,
          error: `changed path fails safety checks: ${JSON.stringify(r.path)}`,
        };
      }
      // Nested .git directory as a changed path → adversarial / nested repo.
      if (r.path === ".git" || r.path.startsWith(".git/") || /(^|\/)\.git\//.test(r.path + "/")) {
        return {
          ok: false,
          error: `nested or embedded .git path in changes (${r.path}) — refuse (ambiguous repo boundary)`,
        };
      }
      if (!byPath.has(r.path)) byPath.set(r.path, r);
      else {
        // Prefer more specific kinds when merging duplicates.
        const prev = byPath.get(r.path);
        if (prev.kind === "modify" && r.kind !== "modify") byPath.set(r.path, r);
      }
    }

    return { ok: true, paths: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)), ambiguous: null };
  } catch (e) {
    return { ok: false, error: `failed to collect changes: ${e.message || e}` };
  }
}

// ---------------------------------------------------------------------------
// Policy evaluation
// ---------------------------------------------------------------------------

/**
 * Does any glob in list match path?
 */
function matchesAny(relPath, globs) {
  for (const g of globs || []) {
    if (pathMatchesGlob(relPath, g)) return g;
  }
  return null;
}

/**
 * Evaluate changed paths against a trusted contract.
 * Deny wins. Outside allow → violation. Required globs must each match ≥1 change.
 * maxFiles counts unique paths (rename-from and rename-to are separate if both listed).
 *
 * @returns {{
 *   ok: boolean,
 *   violations: Array<{ path: string, reason: string, rule?: string }>,
 *   changedPaths: string[],
 *   requiredMissing: string[],
 * }}
 */
export function evaluateIntentScope(contract, pathRecords) {
  const violations = [];
  const changedPaths = pathRecords.map((r) => r.path);
  const uniqueCount = changedPaths.length;

  for (const rec of pathRecords) {
    const p = rec.path;
    const denyHit = matchesAny(p, contract.deny);
    if (denyHit) {
      violations.push({
        path: p,
        reason: "denied",
        rule: denyHit,
      });
      continue;
    }
    const allowHit = matchesAny(p, contract.allow);
    if (!allowHit) {
      violations.push({
        path: p,
        reason: "outside-allow",
        rule: null,
      });
    }
  }

  // Required globs: each must match at least one changed path.
  const requiredMissing = [];
  for (const g of contract.require || []) {
    const hit = changedPaths.some((p) => pathMatchesGlob(p, g));
    if (!hit) requiredMissing.push(g);
  }
  for (const g of requiredMissing) {
    violations.push({
      path: "(none)",
      reason: "required-missing",
      rule: g,
    });
  }

  if (contract.maxFiles != null && uniqueCount > contract.maxFiles) {
    violations.push({
      path: "(count)",
      reason: "max-files",
      rule: String(contract.maxFiles),
    });
  }

  return {
    ok: violations.length === 0,
    violations,
    changedPaths,
    requiredMissing,
    fileCount: uniqueCount,
  };
}

// ---------------------------------------------------------------------------
// Receipt + check result
// ---------------------------------------------------------------------------

/**
 * Build a plain JSON-serializable proof receipt (no secrets, no file bodies).
 */
export function buildIntentReceipt(o) {
  const goal = String(o.goal || "");
  const notes = o.acceptanceNotes != null ? String(o.acceptanceNotes) : null;
  return {
    goal: goal.length > GOAL_DISPLAY_CAP ? goal.slice(0, GOAL_DISPLAY_CAP) + "…" : goal,
    contractHash: o.hash ? `sha256:${o.hash}` : null,
    baseline: o.baseline
      ? {
          ref: o.baseline.ref,
          sha: o.baseline.sha,
          ...(o.baseline.trustSha && o.baseline.trustSha !== o.baseline.sha
            ? { trustSha: o.baseline.trustSha }
            : {}),
        }
      : null,
    changedPaths: o.changedPaths || [],
    violations: (o.violations || []).map((v) => ({
      path: v.path,
      reason: v.reason,
      ...(v.rule ? { rule: v.rule } : {}),
    })),
    fileCount: o.fileCount ?? (o.changedPaths || []).length,
    worktreeContractDiffers: !!o.worktreeDiffers,
    limitation: INTENT_LIMITATION,
    ...(notes
      ? {
          acceptanceNotes:
            notes.length > NOTES_DISPLAY_CAP ? notes.slice(0, NOTES_DISPLAY_CAP) + "…" : notes,
        }
      : {}),
  };
}

/**
 * Produce a checks-runner result for Intent Contract.
 * When no trusted contract: return null (caller omits — no false "intent verified").
 * When present but untrusted/malformed: fail closed.
 * When trusted: GO/NO-GO from scope evaluation.
 *
 * @param {string} cwd
 * @param {{ baselineRef?: string }} [opts]
 * @returns {ReturnType<typeof result> | null}
 */
export function checkIntent(cwd, opts = {}) {
  const loaded = loadTrustedIntent(cwd, opts);

  if (!loaded.present) {
    // No contract at all — do not emit a check (no false verified claim).
    return null;
  }

  if (!loaded.trusted || loaded.error || !loaded.contract) {
    const r = result(
      "fail",
      "Intent Contract",
      `NO-GO — cannot trust intent baseline: ${loaded.error || "untrusted contract"}`,
      [
        `Contract path: ${INTENT_REL}`,
        "Authorization requires a committed contract on a verified local ref (default: HEAD).",
        "Fix: write the contract with `getadvantage intent init …`, commit it, then re-run.",
        INTENT_LIMITATION,
      ],
    );
    r.findings = [
      {
        ruleId: "intent/untrusted",
        label: "Intent Contract untrusted",
        message: loaded.error || "untrusted contract",
      },
    ];
    r.intent = buildIntentReceipt({
      goal: "",
      hash: null,
      baseline: loaded.baseline,
      changedPaths: [],
      violations: [{ path: INTENT_REL, reason: "untrusted", rule: null }],
      worktreeDiffers: loaded.worktreeDiffers,
    });
    return r;
  }

  const collected = collectChangedPaths(cwd, loaded.baseline.sha);
  if (!collected.ok) {
    const r = result(
      "fail",
      "Intent Contract",
      `NO-GO — ${collected.error}`,
      [INTENT_LIMITATION],
    );
    r.findings = [
      {
        ruleId: "intent/ambiguous-state",
        label: "Intent Contract ambiguous state",
        message: collected.error,
      },
    ];
    r.intent = buildIntentReceipt({
      goal: loaded.contract.goal,
      hash: loaded.hash,
      baseline: loaded.baseline,
      changedPaths: [],
      violations: [{ path: "(repo)", reason: "ambiguous", rule: null }],
      worktreeDiffers: loaded.worktreeDiffers,
      acceptanceNotes: loaded.contract.acceptanceNotes,
    });
    return r;
  }

  const evaled = evaluateIntentScope(loaded.contract, collected.paths);
  const receipt = buildIntentReceipt({
    goal: loaded.contract.goal,
    hash: loaded.hash,
    baseline: loaded.baseline,
    changedPaths: evaled.changedPaths,
    violations: evaled.violations,
    fileCount: evaled.fileCount,
    worktreeDiffers: loaded.worktreeDiffers,
    acceptanceNotes: loaded.contract.acceptanceNotes,
  });

  if (evaled.ok) {
    const extras = [
      `goal: ${receipt.goal}`,
      `contract: ${receipt.contractHash}`,
      `baseline: ${loaded.baseline.ref} @ ${loaded.baseline.sha.slice(0, 12)}`,
      `changed: ${evaled.fileCount} path${pl(evaled.fileCount)}`,
      INTENT_LIMITATION,
    ];
    if (loaded.worktreeDiffers) {
      extras.push(
        `note: worktree ${INTENT_REL} differs from trusted commit — only the committed blob authorizes (edits cannot broaden scope).`,
      );
    }
    if (evaled.changedPaths.length > 0) {
      extras.push(...evaled.changedPaths.slice(0, 30).map((p) => `  · ${p}`));
      if (evaled.changedPaths.length > 30) {
        extras.push(`  · …and ${evaled.changedPaths.length - 30} more`);
      }
    }
    const r = result(
      "pass",
      "Intent Contract",
      `GO — all ${evaled.fileCount} changed path${pl(evaled.fileCount)} inside authorized scope.`,
      extras,
    );
    r.findings = [];
    r.intent = receipt;
    return r;
  }

  // NO-GO: name violating paths only — never file contents.
  const lines = [];
  for (const v of evaled.violations) {
    if (v.reason === "denied") {
      lines.push(`${v.path} — DENY matched ${JSON.stringify(v.rule)}`);
    } else if (v.reason === "outside-allow") {
      lines.push(`${v.path} — outside allowlist`);
    } else if (v.reason === "required-missing") {
      lines.push(`required change missing — no path matched ${JSON.stringify(v.rule)}`);
    } else if (v.reason === "max-files") {
      lines.push(`too many files changed: ${evaled.fileCount} > maxFiles ${v.rule}`);
    } else {
      lines.push(`${v.path} — ${v.reason}`);
    }
  }
  const extras = [
    `goal: ${receipt.goal}`,
    `contract: ${receipt.contractHash}`,
    `baseline: ${loaded.baseline.ref} @ ${loaded.baseline.sha.slice(0, 12)}`,
    ...lines.slice(0, 40),
    ...(lines.length > 40 ? [`…and ${lines.length - 40} more violations`] : []),
    INTENT_LIMITATION,
  ];
  if (loaded.worktreeDiffers) {
    extras.push(
      `note: worktree ${INTENT_REL} differs from trusted commit — broadening the worktree copy cannot authorize itself.`,
    );
  }
  const r = result(
    "fail",
    "Intent Contract",
    `NO-GO — ${evaled.violations.length} scope violation${pl(evaled.violations.length)} against the Intent Contract.`,
    extras,
  );
  r.findings = evaled.violations.slice(0, 50).map((v) => ({
    ruleId: `intent/${v.reason}`,
    label: "Intent Contract violation",
    file: v.path !== "(none)" && v.path !== "(count)" ? v.path : undefined,
    message: lines.find((l) => l.startsWith(v.path) || l.includes(v.reason)) || v.reason,
  }));
  r.intent = receipt;
  return r;
}

// ---------------------------------------------------------------------------
// CLI: intent init / intent check
// ---------------------------------------------------------------------------

/**
 * Write a new Intent Contract into the worktree and explain freeze/commit.
 * @returns {number} exit code
 */
export function runIntentInit(o) {
  const cwd = o.cwd;
  const goal = o.goal;
  const allow = o.allow || [];
  const deny = o.deny || [];
  const require = o.require || [];
  const maxFiles = o.maxFiles;
  const notes = o.acceptanceNotes;
  const force = !!o.force;

  if (!goal || !String(goal).trim()) {
    console.error(c.red("✗ intent init requires --goal \"…\" (non-empty human description of the authorized task)."));
    console.error(c.gray(`  Example: ${binName()} intent init --goal "Add password reset" --allow "src/auth/**" --allow "tests/auth/**"`));
    return 1;
  }
  if (!allow.length) {
    console.error(c.red("✗ intent init requires at least one --allow <glob> (repo-relative)."));
    console.error(c.gray(`  Example: ${binName()} intent init --goal "…" --allow "src/**" --deny ".github/**"`));
    return 1;
  }

  // Validate before write.
  const draft = {
    schemaVersion: 1,
    goal: String(goal).trim(),
    allow,
    deny,
    require,
    maxFiles: maxFiles != null ? maxFiles : undefined,
    acceptanceNotes: notes != null ? String(notes) : undefined,
  };
  // Drop undefined keys for cleaner file.
  if (draft.maxFiles === undefined) delete draft.maxFiles;
  if (draft.acceptanceNotes === undefined) delete draft.acceptanceNotes;
  if (!draft.deny.length) draft.deny = [];
  if (!draft.require.length) delete draft.require;

  const check = parseAndValidateContract(JSON.stringify(draft));
  if (!check.ok) {
    console.error(c.red(`✗ invalid contract: ${check.error}`));
    return 1;
  }

  const abs = path.join(cwd, ...INTENT_REL.split("/"));
  if (existsSync(abs) && !force) {
    console.error(c.red(`✗ ${INTENT_REL} already exists — pass --force to overwrite (then re-commit).`));
    return 1;
  }

  mkdirSync(path.dirname(abs), { recursive: true });
  const body = JSON.stringify(
    {
      schemaVersion: check.contract.schemaVersion,
      goal: check.contract.goal,
      allow: check.contract.allow,
      deny: check.contract.deny,
      ...(check.contract.require.length ? { require: check.contract.require } : {}),
      ...(check.contract.maxFiles != null ? { maxFiles: check.contract.maxFiles } : {}),
      ...(check.contract.acceptanceNotes != null
        ? { acceptanceNotes: check.contract.acceptanceNotes }
        : {}),
    },
    null,
    2,
  ) + "\n";
  writeFileSync(abs, body, "utf8");

  const hash = computeIntentHash(check.contract);
  section("Intent Contract");
  console.log(`  ${c.green("wrote")} ${c.bold(INTENT_REL)}`);
  console.log(`  ${c.gray("goal:")} ${check.contract.goal}`);
  console.log(`  ${c.gray("allow:")} ${check.contract.allow.join(", ")}`);
  if (check.contract.deny.length) console.log(`  ${c.gray("deny:")} ${check.contract.deny.join(", ")}`);
  if (check.contract.require.length) console.log(`  ${c.gray("require:")} ${check.contract.require.join(", ")}`);
  if (check.contract.maxFiles != null) console.log(`  ${c.gray("maxFiles:")} ${check.contract.maxFiles}`);
  console.log(`  ${c.gray("hash:")} sha256:${hash}`);
  console.log("");
  console.log(c.bold("  Freeze this contract before the agent starts:"));
  console.log(c.cyan(`    git add ${INTENT_REL} && git commit -m "chore: intent contract"`));
  console.log("");
  console.log(
    c.gray(
      "  Authorization uses the COMMITTED blob on HEAD (not the worktree). An agent that\n" +
        "  edits the file to broaden --allow cannot authorize itself. After the agent works:\n" +
        `    ${binName()} intent check`,
    ),
  );
  console.log(c.gray(`  Limitation: ${INTENT_LIMITATION}`));
  return 0;
}

/**
 * CLI `intent check` — print human (and optional structured) result.
 * @returns {{ exitCode: number, result: object|null, receipt: object|null }}
 */
export function runIntentCheck(o) {
  const cwd = o.cwd;
  const r = checkIntent(cwd, { baselineRef: o.baselineRef });

  section("Intent Contract");
  if (!r) {
    console.log(
      `  ${c.yellow("–")} ${c.bold("Intent Contract")} — no trusted contract on HEAD (${INTENT_REL}).`,
    );
    console.log(
      c.gray(
        `      Create one with \`${binName()} intent init --goal "…" --allow "src/**"\`, commit it, then re-run.`,
      ),
    );
    console.log(c.gray(`      ${INTENT_LIMITATION}`));
    // No contract is not a false GO claim — exit 0 for bare `intent check` when
    // absent would imply pass. Prefer exit 1 with clear "not configured" so CI
    // that explicitly runs intent check fails closed. Spec: main `check` omits;
    // dedicated `intent check` without contract → actionable non-zero.
    return {
      exitCode: 1,
      result: result(
        "fail",
        "Intent Contract",
        `no trusted contract on HEAD (${INTENT_REL})`,
        [
          `Create one: ${binName()} intent init --goal "…" --allow "…"`,
          "Commit it before the agent starts.",
          INTENT_LIMITATION,
        ],
      ),
      receipt: null,
    };
  }

  printResult(r);
  const exitCode = r.status === "fail" ? 1 : 0;
  section("Verdict");
  if (exitCode === 0) {
    console.log("\n" + c.green(c.bold("  GO")) + c.green(" — change scope matches the Intent Contract."));
    console.log(c.gray(`  ${INTENT_LIMITATION}`));
  } else {
    console.log("\n" + c.red(c.bold("  NO-GO")) + c.red(" — changes left the authorized scope (or trust failed)."));
    console.log(c.gray(`  ${INTENT_LIMITATION}`));
  }
  return { exitCode, result: r, receipt: r.intent || null };
}

/**
 * Dispatch `intent` subcommand (init | check | help).
 * @returns {number|Promise<number>}
 */
export function runIntent(o) {
  const sub = (o.sub || "help").toLowerCase();
  if (sub === "init") {
    return runIntentInit({
      cwd: o.cwd,
      goal: o.flags.goal,
      allow: o.flags.allow || [],
      deny: o.flags.deny || [],
      require: o.flags.require || [],
      maxFiles: o.flags["max-files"] != null ? Number(o.flags["max-files"]) : undefined,
      acceptanceNotes: o.flags.notes || o.flags["acceptance-notes"],
      force: !!o.flags.force,
    });
  }
  if (sub === "check") {
    const { exitCode, result: r, receipt } = runIntentCheck({
      cwd: o.cwd,
      baselineRef: o.flags["base-ref"],
    });
    if (o.flags.json) {
      // Caller may emit JSON; when runIntent owns stdout, print here if requested.
      // index.mjs handles --json routing; return structured via o._jsonDoc if set.
      if (o.emitJson) {
        o.emitJson({
          command: "intent",
          sub: "check",
          verdict: exitCode === 0 ? "GO" : "NO-GO",
          exitCode,
          intent: receipt || (r && r.intent) || null,
          check: r
            ? {
                status: r.status,
                label: r.label,
                detail: r.detail,
                extra: r.extra || [],
              }
            : null,
          limitation: INTENT_LIMITATION,
          generatedAt: new Date().toISOString(),
        });
      }
    }
    return exitCode;
  }
  printIntentHelp();
  return sub === "help" || !o.sub ? 0 : 1;
}

export function printIntentHelp() {
  const bin = binName();
  console.log(`
${c.bold("intent")} — local Intent Contract: prove repo changes stayed inside the human-authorized task.

${c.bold("Usage")}
  ${bin} intent init --goal "…" --allow <glob> [--allow <glob> …]
                     [--deny <glob>] [--require <glob>] [--max-files N]
                     [--notes "…"] [--force]
  ${bin} intent check [--json] [--base-ref <local-ref>]

${c.bold("Cold path")}
  1. Human writes the contract ${c.bold("before")} the agent starts:
       ${bin} intent init --goal "Add password reset" \\
         --allow "src/auth/**" --allow "tests/auth/**" --deny ".github/**"
  2. ${c.bold("Commit")} ${INTENT_REL} — authorization is the committed HEAD blob,
     not a mutable worktree copy the agent could broaden.
  3. After the agent works:
       ${bin} intent check
     → GO / NO-GO + stable proof receipt (goal, contract hash, baseline,
       changed paths, violations). ${c.bold(INTENT_LIMITATION)}.

${c.bold("Trust")}
  • Deny overrides allow. Renames check old and new paths.
  • Staged, unstaged, deleted, renamed, and untracked paths all count.
  • Editing the worktree contract cannot authorize a broader scope.
  • No network, no shell hooks, no model calls, no file-content dumps.

${c.bold("Main gate")}
  \`${bin} check\` includes the Intent Contract result when a trusted contract
  is present on HEAD. Projects without a contract keep existing checks only —
  there is never a false "intent verified" claim.
`);
}
