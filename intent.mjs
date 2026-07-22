// getAdvantage — Intent Contract (local change-scope trust layer).
//
// Access control asks whether an agent was allowed to *use* a tool. This module
// answers a different local proof question: did repository changes stay inside
// the task envelope the human authorized?
//
// Trust model (fail-closed, honest local trust):
//   • `intent init` pins immutable `baselineCommit` (full 40-hex SHA of HEAD).
//   • Human commits the contract as a *dedicated linear freeze* after that
//     baseline. Authorization is the freeze-commit blob — never the worktree,
//     never a runtime --base-ref, never a later broadened HEAD blob.
//   • Unsigned local mode allows ONE Intent Contract lineage per reachable
//     history: freeze discovery walks all commits reachable from HEAD and uses
//     the earliest introduction of INTENT_REL. The current HEAD contract is a
//     presence/tamper signal only — never a trust pointer for which history
//     slice to search. Deletion, re-addition, or any later mutation of the
//     intent path after that original freeze is always NO-GO.
//   • `intent init` refuses if INTENT_REL ever existed in HEAD ancestry (no
//     fake --force trust reset).
//   • `intent check` diffs EVERY change after baselineCommit: committed,
//     staged, unstaged, deleted, renamed, copied, type-changed, untracked.
//   • Deny globs override allow globs. Renames check BOTH old and new paths.
//   • Nested git / gitlink / symlink contract / unmerged state → NO-GO.
//   • Local unsigned Git history cannot prove human identity or resist a party
//     that rewrites all reachable history. We never claim cryptographic
//     attestation or human-identity proof.
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

const FULL_SHA_RE = /^[0-9a-f]{40}$/;

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
  if (parts[0] === "") return true;
  return false;
}

/**
 * Validate a glob pattern string for contract use. Returns error message or null.
 */
export function validateGlob(raw) {
  if (typeof raw !== "string" || !raw.trim()) return "empty glob";
  if (isUnsafePathOrGlob(raw)) return `unsafe path/glob: ${JSON.stringify(raw)}`;
  const n = normalizeRepoPath(raw.trim());
  if (!n) return "empty glob after normalize";
  return null;
}

// ---------------------------------------------------------------------------
// Canonicalization + hashes
// ---------------------------------------------------------------------------

/**
 * Build the canonical object used for SHA-256 contract identity. Only trusted
 * fields; key order is fixed; arrays sorted for stability.
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
    baselineCommit: String(contract.baselineCommit || "").toLowerCase(),
  };
  if (contract.maxFiles != null) out.maxFiles = contract.maxFiles;
  if (contract.acceptanceNotes != null && String(contract.acceptanceNotes).length > 0) {
    out.acceptanceNotes = String(contract.acceptanceNotes);
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

/**
 * Full proof receipt hash — binds trusted identity + evaluation outcome.
 * Separate from contractHash (contract identity alone).
 * @param {object} o
 * @returns {string} 64-char lowercase hex
 */
export function computeReceiptHash(o) {
  const paths = [...(o.paths || [])]
    .map((p) => ({
      path: normalizeRepoPath(p.path || p),
      kind: String(p.kind || "change"),
    }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
  const violations = [...(o.violations || [])]
    .map((v) => ({
      path: String(v.path || ""),
      reason: String(v.reason || ""),
      ...(v.rule != null && v.rule !== "" ? { rule: String(v.rule) } : {}),
    }))
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path) ||
        a.reason.localeCompare(b.reason) ||
        String(a.rule || "").localeCompare(String(b.rule || "")),
    );
  const canon = {
    contractHash: o.contractHash ? String(o.contractHash).replace(/^sha256:/, "") : null,
    baselineCommit: o.baselineCommit ? String(o.baselineCommit).toLowerCase() : null,
    freezeCommit: o.freezeCommit ? String(o.freezeCommit).toLowerCase() : null,
    headCommit: o.headCommit ? String(o.headCommit).toLowerCase() : null,
    paths,
    violations,
    verdict: o.verdict === "GO" ? "GO" : "NO-GO",
    limitation: String(o.limitation || INTENT_LIMITATION),
  };
  return createHash("sha256").update(JSON.stringify(canon), "utf8").digest("hex");
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

  // Movable symbolic baselineRef is not accepted for trust. Require immutable SHA.
  if (json.baselineRef != null) {
    return {
      ok: false,
      error:
        "intent contract must not use baselineRef (movable/symbolic) — " +
        "use baselineCommit (full 40-hex SHA pinned at init). Re-run `intent init`.",
    };
  }

  const bcRaw = json.baselineCommit;
  if (typeof bcRaw !== "string" || !bcRaw.trim()) {
    return {
      ok: false,
      error:
        "intent contract requires baselineCommit (full 40-hex SHA of the pre-freeze HEAD). " +
        "Re-run `intent init` and commit as a dedicated freeze.",
    };
  }
  const baselineCommit = bcRaw.trim().toLowerCase();
  if (!FULL_SHA_RE.test(baselineCommit)) {
    return {
      ok: false,
      error: `intent contract baselineCommit must be a full 40-hex commit SHA (got ${JSON.stringify(bcRaw.trim())})`,
    };
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
    baselineCommit,
  };
  return { ok: true, contract };
}

// ---------------------------------------------------------------------------
// Git helpers (local only)
// ---------------------------------------------------------------------------

/**
 * Read a blob at `ref:path` via git show. Never the worktree.
 * @returns {string|null}
 */
export function readGitCommitBlob(cwd, ref, relPath) {
  const want = normalizeRepoPath(relPath);
  if (!want || isUnsafePathOrGlob(want)) return null;
  if (!ref || /[\0\n\r]/.test(ref)) return null;
  try {
    return gitRaw(["show", `${ref}:${want}`], { cwd });
  } catch {
    return null;
  }
}

/**
 * Resolve a name to a verified LOCAL full commit SHA only.
 * @returns {{ ok: true, sha: string } | { ok: false, error: string }}
 */
export function resolveLocalCommit(cwd, name) {
  const n = String(name || "").trim();
  if (!n) return { ok: false, error: "empty commit ref" };
  if (/[\0\n\r]/.test(n) || n.includes("..") || /:\/\//.test(n)) {
    return { ok: false, error: `unsafe commit ref ${JSON.stringify(n)}` };
  }
  if (/^(refs\/remotes\/|remotes\/|origin\/|pull\/|refs\/pull\/)/i.test(n)) {
    return {
      ok: false,
      error: `ref ${JSON.stringify(n)} looks remote/PR-controlled — refuse`,
    };
  }
  const sha = gitSafe(["rev-parse", "--verify", `${n}^{commit}`], { cwd });
  if (!sha || !FULL_SHA_RE.test(sha)) {
    return {
      ok: false,
      error: `ref ${JSON.stringify(n)} does not resolve to a local full commit SHA (missing, shallow, or unresolvable)`,
    };
  }
  const type = gitSafe(["cat-file", "-t", sha], { cwd });
  if (type !== "commit") {
    return { ok: false, error: `${sha.slice(0, 12)} is not a local commit object` };
  }
  return { ok: true, sha: sha.toLowerCase() };
}

/** True when `ancestor` is an ancestor of `desc` (or equal). */
function isAncestorOrEqual(cwd, ancestor, desc) {
  if (ancestor === desc) return true;
  // merge-base --is-ancestor exits 0 when true; gitSafe swallows exit codes → use try.
  try {
    gitRaw(["merge-base", "--is-ancestor", ancestor, desc], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the intent path is present as a regular blob on the given commit
 * (not a symlink / gitlink). Fail closed on unusual modes when detectable.
 */
function intentBlobIsSafeOnRef(cwd, ref) {
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

/** Paths changed in a single commit vs its parent (name-only, no renames split). */
function pathsChangedInCommit(cwd, commitSha, parentSha) {
  try {
    const buf = gitRaw(
      ["diff", "--name-status", "-z", "-M", parentSha, commitSha],
      { cwd },
    );
    return parseNameStatusZ(buf);
  } catch {
    return null;
  }
}

/**
 * True when INTENT_REL was ever introduced/touched on a commit reachable from
 * the given tip (including after a later deletion). Used by `intent init` to
 * refuse a second freeze on the same clean lineage.
 */
export function intentPathEverInAncestry(cwd, tipRef = "HEAD") {
  try {
    const out = gitRaw(["rev-list", "-n", "1", tipRef, "--", INTENT_REL], { cwd }).trim();
    return !!out;
  } catch {
    return false;
  }
}

/**
 * History-first discovery of the original Intent Contract freeze.
 *
 * Walks every commit reachable from headSha (oldest → newest). The first
 * introduction of INTENT_REL is the only possible freeze. Its blob supplies
 * the authorizing contract + baselineCommit. Any later touch (delete, modify,
 * re-add) sets laterContractChange. Does NOT take baseline from the HEAD
 * contract — the current contract never chooses which history slice is searched.
 *
 * @returns {{ ok: true, freezeSha: string, blob: string, contract: object, hash: string, laterContractChange: boolean, baselineSha: string }
 *          | { ok: false, error: string, present?: boolean }}
 */
export function discoverOriginalFreeze(cwd, headSha) {
  if (!FULL_SHA_RE.test(headSha)) {
    return { ok: false, error: "HEAD must be a full 40-hex SHA" };
  }

  let revList = "";
  try {
    revList = gitRaw(["rev-list", "--reverse", headSha], { cwd }).trim();
  } catch (e) {
    return {
      ok: false,
      present: true,
      error: `cannot walk reachable history from HEAD: ${e.message || e}`,
    };
  }
  const revs = revList
    .split(/\r?\n/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (revs.length === 0) {
    return { ok: false, present: false, error: "no commits reachable from HEAD" };
  }

  let freezeSha = null;
  let freezeBlob = null;
  let freezeContract = null;
  let freezeHash = null;
  let baselineSha = null;
  let laterContractChange = false;
  let sawUnsafeMode = null;

  for (const sha of revs) {
    const parentLine = gitSafe(["rev-list", "--parents", "-n", "1", sha], { cwd });
    if (!parentLine) {
      return { ok: false, present: true, error: `cannot read parents of ${sha.slice(0, 12)}` };
    }
    const parts = parentLine.split(/\s+/).filter(Boolean);
    const parents = parts.slice(1).map((p) => p.toLowerCase());

    const modeOn = intentBlobIsSafeOnRef(cwd, sha);
    const presentHere = modeOn.ok;
    const presentErrIsAbsent = /is not present/.test(modeOn.error || "");

    if (!presentHere && !presentErrIsAbsent) {
      // Symlink/gitlink/etc. on this commit
      if (!freezeSha) {
        return { ok: false, present: true, error: modeOn.error };
      }
      // After freeze, unsafe mode is later tamper.
      laterContractChange = true;
      sawUnsafeMode = modeOn.error;
      continue;
    }

    // Did INTENT_REL change in this commit relative to parents?
    let intentTouched = false;
    if (parents.length === 0) {
      intentTouched = presentHere;
    } else if (parents.length > 1) {
      const hereBlob = presentHere ? readGitCommitBlob(cwd, sha, INTENT_REL) : null;
      for (const p of parents) {
        const parentBlob = readGitCommitBlob(cwd, p, INTENT_REL);
        if (parentBlob !== hereBlob) {
          intentTouched = true;
          break;
        }
      }
      if (!intentTouched) continue;

      // Merge touching intent: never a valid freeze; after freeze → later change.
      if (!freezeSha) {
        return {
          ok: false,
          present: true,
          error:
            `merge commit ${sha.slice(0, 12)} introduces or changes ${INTENT_REL} — ` +
            `freeze must be an unambiguous single-parent dedicated commit`,
        };
      }
      laterContractChange = true;
      continue;
    } else {
      const parent = parents[0];
      const parentBlob = readGitCommitBlob(cwd, parent, INTENT_REL);
      const hereBlob = presentHere ? readGitCommitBlob(cwd, sha, INTENT_REL) : null;
      intentTouched = parentBlob !== hereBlob;
    }

    if (!intentTouched) continue;

    if (!presentHere) {
      // Deletion of contract
      if (freezeSha) {
        laterContractChange = true;
        continue;
      }
      return {
        ok: false,
        present: true,
        error: `commit ${sha.slice(0, 12)} removes ${INTENT_REL} without a prior freeze — refuse`,
      };
    }

    // Present and touched.
    if (!freezeSha) {
      // Original introduction — must be dedicated single-parent freeze.
      if (parents.length !== 1) {
        return {
          ok: false,
          present: true,
          error: `freeze candidate ${sha.slice(0, 12)} is not a single-parent commit — refuse`,
        };
      }
      const parent = parents[0];
      const changed = pathsChangedInCommit(cwd, sha, parent);
      if (!changed) {
        return {
          ok: false,
          present: true,
          error: `cannot list files in freeze candidate ${sha.slice(0, 12)}`,
        };
      }
      const uniquePaths = [...new Set(changed.map((r) => r.path))];
      if (uniquePaths.length !== 1 || uniquePaths[0] !== INTENT_REL) {
        return {
          ok: false,
          present: true,
          error:
            `freeze commit ${sha.slice(0, 12)} must be dedicated to ${INTENT_REL} only ` +
            `(found: ${uniquePaths.slice(0, 8).join(", ") || "(none)"}) — refuse`,
        };
      }

      const blob = readGitCommitBlob(cwd, sha, INTENT_REL);
      if (blob == null) {
        return {
          ok: false,
          present: true,
          error: `could not read ${INTENT_REL} from freeze ${sha.slice(0, 12)}`,
        };
      }
      const parsed = parseAndValidateContract(blob);
      if (!parsed.ok) {
        return {
          ok: false,
          present: true,
          error: `freeze contract invalid: ${parsed.error}`,
        };
      }
      const declaredBaseline = parsed.contract.baselineCommit;
      if (declaredBaseline !== parent) {
        return {
          ok: false,
          present: true,
          error:
            `freeze contract baselineCommit ${declaredBaseline.slice(0, 12)} ` +
            `≠ freeze parent ${parent.slice(0, 12)} — refuse`,
        };
      }
      // Baseline must not already carry the contract (pre-freeze point).
      const atBase = gitSafe(["ls-tree", declaredBaseline, "--", INTENT_REL], { cwd });
      if (atBase) {
        return {
          ok: false,
          present: true,
          error:
            `${INTENT_REL} already exists at baselineCommit ${declaredBaseline.slice(0, 12)} — ` +
            `baseline must be the pre-contract freeze point.`,
        };
      }
      if (!isAncestorOrEqual(cwd, declaredBaseline, headSha)) {
        return {
          ok: false,
          present: true,
          error:
            `baselineCommit ${declaredBaseline.slice(0, 12)} is not an ancestor of HEAD ` +
            `${headSha.slice(0, 12)} (rewritten, non-ancestor, or wrong baseline) — refuse`,
        };
      }

      freezeSha = sha;
      freezeBlob = blob;
      freezeContract = parsed.contract;
      freezeHash = computeIntentHash(parsed.contract);
      baselineSha = declaredBaseline;
    } else {
      // Any later committed change to the contract path (modify / re-add).
      laterContractChange = true;
    }
  }

  if (!freezeSha) {
    const onHead = intentBlobIsSafeOnRef(cwd, headSha);
    if (onHead.ok || (sawUnsafeMode && !/is not present/.test(sawUnsafeMode))) {
      return {
        ok: false,
        present: true,
        error:
          `could not locate a dedicated linear freeze for ${INTENT_REL} in reachable history — ` +
          `refuse (ambiguous or non-dedicated history)`,
      };
    }
    return {
      ok: false,
      present: false,
      error: `no freeze commit introducing ${INTENT_REL} in reachable HEAD ancestry`,
    };
  }

  return {
    ok: true,
    freezeSha,
    blob: freezeBlob,
    contract: freezeContract,
    hash: freezeHash,
    baselineSha,
    laterContractChange,
  };
}

/**
 * Locate the dedicated linear freeze for INTENT_REL.
 *
 * History-first: walks all commits reachable from headSha and uses the earliest
 * introduction as the only freeze. When baselineSha is provided (legacy callers),
 * the discovered freeze's declared baseline must match it.
 *
 * @returns {{ ok: true, freezeSha: string, blob: string, contract: object, hash: string, laterContractChange: boolean }
 *          | { ok: false, error: string, present?: boolean }}
 */
export function findFreezeCommit(cwd, baselineSha, headSha) {
  if (!FULL_SHA_RE.test(headSha)) {
    return { ok: false, error: "HEAD must be a full 40-hex SHA" };
  }
  if (baselineSha != null && baselineSha !== "" && !FULL_SHA_RE.test(baselineSha)) {
    return { ok: false, error: "baseline must be a full 40-hex SHA when provided" };
  }

  const disc = discoverOriginalFreeze(cwd, headSha);
  if (!disc.ok) return disc;

  if (baselineSha && FULL_SHA_RE.test(baselineSha) && disc.baselineSha !== baselineSha) {
    // Callers that still pass a baseline (e.g. from a later replacement contract)
    // must not re-root trust. The original freeze is the only authorizer; report
    // later-contract-change semantics rather than inventing a new window.
    return {
      ok: true,
      freezeSha: disc.freezeSha,
      blob: disc.blob,
      contract: disc.contract,
      hash: disc.hash,
      laterContractChange: true,
    };
  }

  return {
    ok: true,
    freezeSha: disc.freezeSha,
    blob: disc.blob,
    contract: disc.contract,
    hash: disc.hash,
    laterContractChange: disc.laterContractChange,
  };
}

/**
 * Load the trusted Intent Contract from frozen history.
 * Worktree / later HEAD blobs never authorize.
 * Freeze discovery is independent of the baselineCommit declared by the current
 * HEAD contract — HEAD is only a presence/tamper signal.
 * Runtime --base-ref must never select trust (removed).
 *
 * @param {string} cwd
 * @param {{}} [opts]
 */
export function loadTrustedIntent(cwd, _opts = {}) {
  const empty = {
    present: false,
    trusted: false,
    contract: null,
    hash: null,
    baseline: null,
    freezeSha: null,
    headSha: null,
    error: null,
    worktreeDiffers: false,
    laterContractChange: false,
  };

  const abs = path.join(cwd, ...INTENT_REL.split("/"));
  let worktreeExists = false;
  try {
    worktreeExists = existsSync(abs);
  } catch {
    worktreeExists = false;
  }

  const headRes = resolveLocalCommit(cwd, "HEAD");
  if (!headRes.ok) {
    if (!worktreeExists) return empty;
    return {
      ...empty,
      present: true,
      error:
        `cannot resolve HEAD to a local commit (${headRes.error}). ` +
        `Create an initial commit, run intent init, then commit the contract as a dedicated freeze.`,
    };
  }
  const headSha = headRes.sha;

  const headMode = intentBlobIsSafeOnRef(cwd, headSha);
  const headHasIntent = headMode.ok;
  const headAbsentClean = !headHasIntent && /is not present/.test(headMode.error || "");
  const headUnsafe = !headHasIntent && !headAbsentClean;

  // History-first: original freeze discovery never uses HEAD's baselineCommit.
  const disc = discoverOriginalFreeze(cwd, headSha);

  if (!disc.ok && disc.present === false) {
    // No historical freeze. Worktree-only or nothing.
    if (!worktreeExists && !headHasIntent) return empty;
    if (worktreeExists && !headHasIntent) {
      return {
        ...empty,
        present: true,
        headSha,
        error:
          `${INTENT_REL} exists in the working tree but is not committed — ` +
          `run intent init (pins baselineCommit), then commit only that file as a dedicated freeze before the agent starts.`,
      };
    }
    if (headUnsafe) {
      return { ...empty, present: true, headSha, error: headMode.error };
    }
    // HEAD claims a contract but discovery failed (e.g. non-dedicated).
    return {
      ...empty,
      present: true,
      headSha,
      error: disc.error || "could not locate a dedicated linear freeze",
    };
  }

  if (!disc.ok) {
    // Historical presence but untrusted / invalid freeze lineage.
    return {
      ...empty,
      present: true,
      headSha,
      error: disc.error,
    };
  }

  // Trusted original freeze found (may be deleted or mutated later).
  const headBlob = headHasIntent ? readGitCommitBlob(cwd, headSha, INTENT_REL) : null;
  let worktreeDiffers = false;
  if (worktreeExists) {
    try {
      if (readFileSync(abs, "utf8") !== disc.blob) worktreeDiffers = true;
    } catch {
      worktreeDiffers = true;
    }
  } else if (!headHasIntent) {
    // Deleted from HEAD and worktree — still a tamper signal.
    worktreeDiffers = true;
  }
  const headDiffers = headHasIntent ? headBlob !== disc.blob : true;
  if (headDiffers) worktreeDiffers = true;

  const laterContractChange = disc.laterContractChange || headDiffers;

  return {
    present: true,
    trusted: true,
    contract: disc.contract,
    hash: disc.hash,
    baseline: {
      ref: "baselineCommit",
      sha: disc.baselineSha || disc.contract.baselineCommit,
      trustSha: disc.freezeSha,
      trustRef: "freeze",
    },
    freezeSha: disc.freezeSha,
    headSha,
    error: null,
    worktreeDiffers,
    laterContractChange,
  };
}

// ---------------------------------------------------------------------------
// Change collection (committed-since-baseline + staged + unstaged + untracked)
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
      if (oldPath) {
        out.push({
          path: normalizeRepoPath(oldPath),
          kind: code === "R" ? "rename-from" : "copy-from",
          oldPath: null,
        });
      }
      if (newPath) {
        out.push({
          path: normalizeRepoPath(newPath),
          kind: code === "R" ? "rename-to" : "copy-to",
          oldPath: normalizeRepoPath(oldPath),
        });
      }
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
 * Detect nested repository / worktree boundaries that hide files from normal
 * untracked listing. Fail closed.
 * @returns {string|null} error message or null if clean
 */
export function detectNestedRepoBoundary(cwd, pathRecords) {
  for (const r of pathRecords || []) {
    const p = r.path || "";
    if (p === ".git" || p.startsWith(".git/") || /(^|\/)\.git(\/|$)/.test(p)) {
      return `nested or embedded .git path in changes (${p}) — refuse (ambiguous repo boundary)`;
    }
    if (r.kind === "gitlink" || r.kind === "submodule") {
      return `gitlink/submodule change (${p}) — refuse (ambiguous repo boundary)`;
    }
  }

  // Untracked directory entries (git may hide contents of nested repos).
  let dirEntries = "";
  try {
    dirEntries = gitRaw(["ls-files", "-o", "--directory", "--exclude-standard", "-z"], { cwd });
  } catch {
    dirEntries = "";
  }
  for (const raw of dirEntries.split("\0").filter(Boolean)) {
    const d = normalizeRepoPath(raw).replace(/\/$/, "");
    if (!d) continue;
    if (d === ".git" || d.endsWith("/.git") || /(^|\/)\.git(\/|$)/.test(d + "/")) {
      return `nested or embedded .git path (${d}) — refuse (ambiguous repo boundary)`;
    }
    const abs = path.join(cwd, ...d.split("/"));
    try {
      const st = lstatSync(abs);
      if (st.isDirectory()) {
        const gitMarker = path.join(abs, ".git");
        if (existsSync(gitMarker)) {
          return (
            `untracked nested repository at ${d}/ (contains .git) — refuse ` +
            `(nested repos can hide unauthorized files from change listing)`
          );
        }
      } else if (st.isFile() && (d === ".git" || d.endsWith("/.git"))) {
        return `nested gitfile at ${d} — refuse (ambiguous repo boundary)`;
      }
    } catch {
      /* ignore race */
    }
  }

  // Also scan unique parent dirs of untracked files for a .git child.
  const untrackedParents = new Set();
  for (const r of pathRecords || []) {
    if (r.kind !== "untracked") continue;
    const parts = normalizeRepoPath(r.path).split("/");
    for (let i = 1; i < parts.length; i++) {
      untrackedParents.add(parts.slice(0, i).join("/"));
    }
    // Top-level file: still check nothing. Top-level dir file path "evil/x" → evil
  }
  for (const d of untrackedParents) {
    const gitMarker = path.join(cwd, ...d.split("/"), ".git");
    try {
      if (existsSync(gitMarker)) {
        return (
          `untracked nested repository at ${d}/ (contains .git) — refuse ` +
          `(nested repos can hide unauthorized files from change listing)`
        );
      }
    } catch {
      /* ignore */
    }
  }

  // gitlinks in the index/tree vs baseline via diff-tree filter
  try {
    const raw = gitRaw(["status", "--porcelain=v1", "-z"], { cwd });
    // Look for submodule-ish entries (git status shows "M  path" with special modes elsewhere).
    // Also catch "?? foo/" patterns already covered.
    void raw;
  } catch {
    /* ignore */
  }

  return null;
}

/**
 * Collect every path that differs from the baseline commit through current
 * HEAD commits + index + worktree + untracked. Fail closed on unmerged paths
 * and nested repos.
 *
 * @returns {{ ok: true, paths: Array<{path,kind,oldPath}> }
 *          | { ok: false, error: string }}
 */
export function collectChangedPaths(cwd, baselineSha) {
  if (!baselineSha || !FULL_SHA_RE.test(baselineSha)) {
    return { ok: false, error: "invalid baseline SHA for change collection" };
  }

  try {
    // Committed-since-baseline + staged (index vs baseline).
    const cached = gitRaw(
      ["diff", "--name-status", "-z", "-M", "--cached", baselineSha],
      { cwd },
    );
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

    const byPath = new Map();
    for (const r of records) {
      if (!r.path) continue;
      if (isUnsafePathOrGlob(r.path)) {
        return {
          ok: false,
          error: `changed path fails safety checks: ${JSON.stringify(r.path)}`,
        };
      }
      if (!byPath.has(r.path)) byPath.set(r.path, r);
      else {
        const prev = byPath.get(r.path);
        if (prev.kind === "modify" && r.kind !== "modify") byPath.set(r.path, r);
      }
    }

    const paths = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));

    const nestedErr = detectNestedRepoBoundary(cwd, paths);
    if (nestedErr) return { ok: false, error: nestedErr };

    return { ok: true, paths };
  } catch (e) {
    return { ok: false, error: `failed to collect changes: ${e.message || e}` };
  }
}

/**
 * Exclude the freeze contract path from evaluation only when invariants hold:
 * content still matches freeze blob, and no later change (committed/index/worktree).
 */
export function filterFreezeContractPath(cwd, paths, freezeSha, freezeBlob, laterContractChange) {
  if (!freezeSha || freezeBlob == null) return paths;
  if (laterContractChange) return paths;

  const abs = path.join(cwd, ...INTENT_REL.split("/"));
  // Current content must match freeze exactly.
  let current = null;
  if (existsSync(abs)) {
    try {
      current = readFileSync(abs, "utf8");
    } catch {
      return paths;
    }
  } else {
    // Prefer HEAD blob if file deleted in worktree — that is a later change.
    current = readGitCommitBlob(cwd, "HEAD", INTENT_REL);
    if (current == null) return paths;
  }
  if (current !== freezeBlob) return paths;

  // Index must also match freeze when staged differently.
  try {
    const indexBlob = gitRaw(["show", `:${INTENT_REL}`], { cwd });
    if (indexBlob !== freezeBlob) return paths;
  } catch {
    // Not in index — if worktree matches and committed freeze matches, OK only
    // if HEAD still has the freeze blob.
    const headBlob = readGitCommitBlob(cwd, "HEAD", INTENT_REL);
    if (headBlob !== freezeBlob) return paths;
  }

  return paths.filter((r) => r.path !== INTENT_REL);
}

// ---------------------------------------------------------------------------
// Policy evaluation
// ---------------------------------------------------------------------------

function matchesAny(relPath, globs) {
  for (const g of globs || []) {
    if (pathMatchesGlob(relPath, g)) return g;
  }
  return null;
}

/**
 * Evaluate changed paths against a trusted contract.
 * Deny wins. Outside allow → violation. Required globs must each match ≥1 change.
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
  const pathRecords = o.pathRecords || (o.changedPaths || []).map((p) => ({ path: p, kind: "change" }));
  const verdict = o.verdict === "GO" ? "GO" : "NO-GO";
  const contractHashHex = o.hash || null;
  const receiptHashHex = computeReceiptHash({
    contractHash: contractHashHex,
    baselineCommit: o.baselineCommit || (o.baseline && o.baseline.sha) || null,
    freezeCommit: o.freezeSha || null,
    headCommit: o.headSha || null,
    paths: pathRecords,
    violations: o.violations || [],
    verdict,
    limitation: INTENT_LIMITATION,
  });

  return {
    goal: goal.length > GOAL_DISPLAY_CAP ? goal.slice(0, GOAL_DISPLAY_CAP) + "…" : goal,
    contractHash: contractHashHex ? `sha256:${contractHashHex}` : null,
    receiptHash: `sha256:${receiptHashHex}`,
    baseline: o.baseline
      ? {
          ref: o.baseline.ref,
          sha: o.baseline.sha,
          ...(o.baseline.trustSha ? { freezeSha: o.baseline.trustSha } : {}),
        }
      : null,
    freezeCommit: o.freezeSha || null,
    headCommit: o.headSha || null,
    changedPaths: o.changedPaths || [],
    changedPathRecords: pathRecords.map((r) => ({
      path: r.path,
      kind: r.kind,
    })),
    violations: (o.violations || []).map((v) => ({
      path: v.path,
      reason: v.reason,
      ...(v.rule ? { rule: v.rule } : {}),
    })),
    fileCount: o.fileCount ?? (o.changedPaths || []).length,
    worktreeContractDiffers: !!o.worktreeDiffers,
    laterContractChange: !!o.laterContractChange,
    verdict,
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
 * @param {{}} [opts]  (no trust-selecting base-ref — ignored if passed)
 * @returns {ReturnType<typeof result> | null}
 */
export function checkIntent(cwd, opts = {}) {
  // Defense in depth: never honor runtime trust selection.
  if (opts && (opts.baselineRef || opts.baseRef || opts.trustRef)) {
    const r = result(
      "fail",
      "Intent Contract",
      "NO-GO — runtime trust selection is not allowed (--base-ref cannot choose the authorizing contract).",
      [
        "Authorization always comes from the dedicated freeze commit after baselineCommit.",
        "Remove --base-ref from intent check. Schema-bump --base-ref is unrelated.",
        INTENT_LIMITATION,
      ],
    );
    r.findings = [
      {
        ruleId: "intent/trust-selection-forbidden",
        label: "Intent Contract trust selection forbidden",
        message: "runtime --base-ref / baselineRef cannot select authorizing contract",
      },
    ];
    r.intent = buildIntentReceipt({
      goal: "",
      hash: null,
      baseline: null,
      changedPaths: [],
      violations: [{ path: INTENT_REL, reason: "trust-selection-forbidden", rule: null }],
      verdict: "NO-GO",
    });
    return r;
  }

  const loaded = loadTrustedIntent(cwd, opts);

  if (!loaded.present) {
    return null;
  }

  if (!loaded.trusted || loaded.error || !loaded.contract) {
    const r = result(
      "fail",
      "Intent Contract",
      `NO-GO — cannot trust intent baseline: ${loaded.error || "untrusted contract"}`,
      [
        `Contract path: ${INTENT_REL}`,
        "Authorization requires baselineCommit (full SHA) + a dedicated linear freeze commit of the contract.",
        "Fix: getadvantage intent init …  then: git add .getadvantage/intent.json && git commit -m \"chore: intent contract\"",
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
      baselineCommit: loaded.baseline && loaded.baseline.sha,
      freezeSha: loaded.freezeSha,
      headSha: loaded.headSha,
      changedPaths: [],
      violations: [{ path: INTENT_REL, reason: "untrusted", rule: null }],
      worktreeDiffers: loaded.worktreeDiffers,
      laterContractChange: loaded.laterContractChange,
      verdict: "NO-GO",
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
      baselineCommit: loaded.baseline.sha,
      freezeSha: loaded.freezeSha,
      headSha: loaded.headSha,
      changedPaths: [],
      violations: [{ path: "(repo)", reason: "ambiguous", rule: null }],
      worktreeDiffers: loaded.worktreeDiffers,
      laterContractChange: loaded.laterContractChange,
      acceptanceNotes: loaded.contract.acceptanceNotes,
      verdict: "NO-GO",
    });
    return r;
  }

  const freezeBlob = readGitCommitBlob(cwd, loaded.freezeSha, INTENT_REL);
  let evalPaths = filterFreezeContractPath(
    cwd,
    collected.paths,
    loaded.freezeSha,
    freezeBlob,
    loaded.laterContractChange,
  );

  const evaled = evaluateIntentScope(loaded.contract, evalPaths);

  // Deletion / re-add / any later mutation of the intent path after the original
  // freeze is always NO-GO. Replacement broad contracts never authorize.
  const violations = [...evaled.violations];
  if (loaded.laterContractChange) {
    const already = violations.some((v) => v.reason === "later-contract-change");
    if (!already) {
      violations.push({
        path: INTENT_REL,
        reason: "later-contract-change",
        rule: null,
      });
    }
  }

  const verdict = violations.length === 0 ? "GO" : "NO-GO";
  const receipt = buildIntentReceipt({
    goal: loaded.contract.goal,
    hash: loaded.hash,
    baseline: loaded.baseline,
    baselineCommit: loaded.baseline.sha,
    freezeSha: loaded.freezeSha,
    headSha: loaded.headSha,
    changedPaths: evaled.changedPaths,
    pathRecords: evalPaths,
    violations,
    fileCount: evaled.fileCount,
    worktreeDiffers: loaded.worktreeDiffers,
    laterContractChange: loaded.laterContractChange,
    acceptanceNotes: loaded.contract.acceptanceNotes,
    verdict,
  });

  if (verdict === "GO") {
    const extras = [
      `goal: ${receipt.goal}`,
      `contract: ${receipt.contractHash}`,
      `receipt: ${receipt.receiptHash}`,
      `baseline: ${loaded.baseline.sha.slice(0, 12)}`,
      `freeze: ${(loaded.freezeSha || "").slice(0, 12)}`,
      `head: ${(loaded.headSha || "").slice(0, 12)}`,
      `changed: ${evaled.fileCount} path${pl(evaled.fileCount)}`,
      INTENT_LIMITATION,
    ];
    if (loaded.worktreeDiffers) {
      extras.push(
        `note: worktree/HEAD ${INTENT_REL} differs from freeze blob — only the freeze commit authorizes (edits cannot broaden scope).`,
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

  const lines = [];
  for (const v of violations) {
    if (v.reason === "denied") {
      lines.push(`${v.path} — DENY matched ${JSON.stringify(v.rule)}`);
    } else if (v.reason === "outside-allow") {
      lines.push(`${v.path} — outside allowlist`);
    } else if (v.reason === "required-missing") {
      lines.push(`required change missing — no path matched ${JSON.stringify(v.rule)}`);
    } else if (v.reason === "max-files") {
      lines.push(`too many files changed: ${evaled.fileCount} > maxFiles ${v.rule}`);
    } else if (v.reason === "later-contract-change") {
      lines.push(
        `${INTENT_REL} — lineage tamper: deleted, re-added, or mutated after the original freeze ` +
          `(unsigned local mode allows one freeze per clean lineage; replacement contracts never authorize)`,
      );
    } else {
      lines.push(`${v.path} — ${v.reason}`);
    }
  }
  const extras = [
    `goal: ${receipt.goal}`,
    `contract: ${receipt.contractHash}`,
    `receipt: ${receipt.receiptHash}`,
    `baseline: ${loaded.baseline.sha.slice(0, 12)}`,
    `freeze: ${(loaded.freezeSha || "").slice(0, 12)}`,
    ...lines.slice(0, 40),
    ...(lines.length > 40 ? [`…and ${lines.length - 40} more violations`] : []),
    INTENT_LIMITATION,
  ];
  if (loaded.worktreeDiffers || loaded.laterContractChange) {
    extras.push(
      `note: original freeze blob remains the only authorizer — broadening or re-freezing ${INTENT_REL} after the first freeze cannot self-authorize.`,
    );
  }
  const r = result(
    "fail",
    "Intent Contract",
    `NO-GO — ${violations.length} scope violation${pl(violations.length)} against the Intent Contract.`,
    extras,
  );
  r.findings = violations.slice(0, 50).map((v) => ({
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
 * Resolve current HEAD to full SHA for baseline pin. Fail if no trustworthy commit.
 */
export function resolveInitBaseline(cwd) {
  return resolveLocalCommit(cwd, "HEAD");
}

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

  const baseRes = resolveInitBaseline(cwd);
  if (!baseRes.ok) {
    console.error(c.red(`✗ intent init cannot pin baselineCommit: ${baseRes.error}`));
    console.error(c.gray("  Create at least one local commit first, then re-run intent init."));
    console.error(c.gray("  Next: git add -A && git commit -m \"chore: initial\" && getadvantage intent init …"));
    return 1;
  }
  const baselineCommit = baseRes.sha;

  // Unsigned local mode: one Intent Contract lineage per reachable history.
  // Deleting and re-initing must never mint a new authorizing freeze.
  if (intentPathEverInAncestry(cwd, "HEAD")) {
    console.error(
      c.red(
        `✗ intent init refused — ${INTENT_REL} already exists in reachable HEAD ancestry.`,
      ),
    );
    console.error(
      c.gray(
        "  Unsigned local mode allows one freeze per clean lineage. Deleting the contract\n" +
          "  and re-running init cannot mint a new authorizing baseline (that would be a false-GO attack).",
      ),
    );
    console.error(
      c.gray(
        "  Start a new branch from a trusted clean base (no intent history), or use a future\n" +
          "  signed/protected reset path. There is no --force trust reset for local unsigned mode.",
      ),
    );
    return 1;
  }

  const draft = {
    schemaVersion: 1,
    goal: String(goal).trim(),
    allow,
    deny,
    require,
    baselineCommit,
    maxFiles: maxFiles != null ? maxFiles : undefined,
    acceptanceNotes: notes != null ? String(notes) : undefined,
  };
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
    console.error(
      c.red(
        `✗ ${INTENT_REL} already exists in the worktree — pass --force to overwrite the uncommitted draft ` +
          `(then commit only that file as the dedicated freeze).`,
      ),
    );
    console.error(
      c.gray(
        "  --force only rewrites an uncommitted worktree draft; it is not a trust reset after a freeze.",
      ),
    );
    return 1;
  }

  mkdirSync(path.dirname(abs), { recursive: true });
  const body =
    JSON.stringify(
      {
        schemaVersion: check.contract.schemaVersion,
        goal: check.contract.goal,
        allow: check.contract.allow,
        deny: check.contract.deny,
        baselineCommit: check.contract.baselineCommit,
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
  console.log(`  ${c.gray("baselineCommit:")} ${baselineCommit}`);
  console.log(`  ${c.gray("hash:")} sha256:${hash}`);
  console.log("");
  console.log(c.bold("  Freeze this contract as a dedicated commit before the agent starts:"));
  console.log(c.cyan(`    git add ${INTENT_REL} && git commit -m "chore: intent contract"`));
  console.log("");
  console.log(
    c.gray(
      "  Authorization uses the FREEZE commit blob (first dedicated linear commit of this file\n" +
        "  after baselineCommit) — not the worktree, not a later broadened HEAD, not --base-ref.\n" +
        "  Local trust only: history rewrite without signatures cannot be proven human.\n" +
        `  After the agent works: ${binName()} intent check`,
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

  // Reject trust-selecting flags explicitly (fail closed).
  if (o.baselineRef) {
    section("Intent Contract");
    const msg =
      "NO-GO — intent check does not accept --base-ref (cannot select authorizing contract at runtime).";
    console.log(`  ${c.red("✗")} ${c.bold("Intent Contract")} — ${msg}`);
    console.log(
      c.gray(
        "      Trust always comes from baselineCommit + dedicated freeze history. " +
          "Schema-bump --base-ref on `check` is unrelated.",
      ),
    );
    console.log(c.gray(`      ${INTENT_LIMITATION}`));
    const r = result("fail", "Intent Contract", msg, [INTENT_LIMITATION]);
    r.intent = buildIntentReceipt({
      goal: "",
      hash: null,
      violations: [{ path: INTENT_REL, reason: "trust-selection-forbidden", rule: null }],
      verdict: "NO-GO",
    });
    return { exitCode: 1, result: r, receipt: r.intent };
  }

  const r = checkIntent(cwd, {});

  section("Intent Contract");
  if (!r) {
    console.log(
      `  ${c.yellow("–")} ${c.bold("Intent Contract")} — no trusted contract (${INTENT_REL}).`,
    );
    console.log(
      c.gray(
        `      Create one with \`${binName()} intent init --goal "…" --allow "src/**"\`, ` +
          `commit it as a dedicated freeze, then re-run.`,
      ),
    );
    console.log(c.gray(`      ${INTENT_LIMITATION}`));
    return {
      exitCode: 1,
      result: result(
        "fail",
        "Intent Contract",
        `no trusted contract (${INTENT_REL})`,
        [
          `Create one: ${binName()} intent init --goal "…" --allow "…"`,
          "Commit only that file as a dedicated freeze before the agent starts.",
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
  ${bin} intent check [--json]

${c.bold("Cold path")}
  1. Human writes the contract ${c.bold("before")} the agent starts:
       ${bin} intent init --goal "Add password reset" \\
         --allow "src/auth/**" --allow "tests/auth/**" --deny ".github/**"
     → pins immutable ${c.bold("baselineCommit")} (full SHA of current HEAD).
  2. ${c.bold("Commit only")} ${INTENT_REL} as a dedicated freeze:
       git add ${INTENT_REL} && git commit -m "chore: intent contract"
     Authorization is that freeze blob — not the worktree, not later HEAD, not --base-ref.
  3. After the agent works (including commits):
       ${bin} intent check
     → diffs every change after baselineCommit (committed + staged + unstaged +
       deleted + renamed + untracked) → GO / NO-GO + contractHash + receiptHash.
     ${c.bold(INTENT_LIMITATION)}.

${c.bold("Trust")}
  • Deny overrides allow. Renames check old and new paths.
  • Staged, unstaged, deleted, renamed, untracked, and post-freeze commits all count.
  • Freeze discovery walks reachable history; the first introduction of ${INTENT_REL} is the only freeze.
  • Deleting, re-adding, or mutating the contract after that freeze is always NO-GO — replacement contracts never authorize.
  • \`intent init\` refuses if ${INTENT_REL} ever existed in HEAD ancestry (no --force trust reset).
  • Nested git repos / gitfiles that hide files → NO-GO.
  • No runtime flag selects the authorizing contract. Local unsigned history only — not cryptographic attestation or human-identity proof.
  • No network, no shell hooks, no model calls, no file-content dumps.

${c.bold("Main gate")}
  \`${bin} check\` includes the Intent Contract result when a trusted freeze is present.
  Projects without a contract keep existing checks only — never a false "intent verified".
`);
}
