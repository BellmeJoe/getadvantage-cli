// getAdvantage — repo policy config (allowlist / baseline).
//
// The gate must be adoptable in real repos. Docs and fixtures ship well-known
// placeholder "secrets" (AWS' own AKIA…EXAMPLE, sample tokens in README tables)
// that hard-block with no escape hatch → false NO-GO and abandonment.
//
// Contract (honesty principle):
//   • Built-in ignores cover only public documentation examples, never live shapes.
//   • User ignores live in the repo's `.getadvantage/config.json` (commit-friendly).
//   • Policy that AUTHORIZES ignores must be in the git index (tracked or staged),
//     and authorizing content is read from the index blob — never from an unstaged
//     worktree edit. Untracked / gitignored policy is warned and never suppresses hits.
//   • Allowlist match IDs are collision-resistant digests (`secretAuthId`), not
//     display fingerprints (prefix/tail/length can collide).
//   • Every allowlisted hit is DISCLOSED on the result (never a silent false GO).
//   • Full secret values are never printed — only display fingerprints, auth ids,
//     and reason codes.
//
// Zero dependencies. Node built-ins only.

import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import {
  fingerprint,
  secretAuthId,
  gitSafe,
  readGitIndexText,
  stripBom,
  MARKER_DIR,
  LEGACY_MARKER_DIR,
} from "./util.mjs";

/** Supported `version` values that may authorize ignore rules. */
const SUPPORTED_POLICY_VERSIONS = new Set([1]);

// ---------------------------------------------------------------------------
// Built-in documentation examples (public AWS docs, etc.)
// ---------------------------------------------------------------------------

/** Exact values that are public documentation samples, not live credentials. */
const BUILTIN_EXACT_VALUES = new Set([
  // https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html
  "AKIAIOSFODNN7EXAMPLE",
]);

/**
 * Built-in allowlist for a raw match.
 * @param {string} match
 * @param {string} patternId
 * @returns {string|null} human reason, or null if not built-in-allowlisted
 */
export function builtinSecretAllowReason(match, patternId) {
  if (!match) return null;
  if (BUILTIN_EXACT_VALUES.has(match)) {
    return "built-in: public documentation example";
  }
  // AWS access key IDs used in official docs always end with EXAMPLE.
  if (patternId === "aws" && /EXAMPLE$/.test(match)) {
    return "built-in: AWS EXAMPLE access key id";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Path glob (zero-deps, gitignore-ish subset)
// ---------------------------------------------------------------------------

/**
 * Match a repo-relative path against a simple glob.
 * Supports exact paths, trailing slash (dir prefix), single-segment star,
 * and double-star (any depth). Example patterns: ROADMAP.md, docs/, docs/**
 * (and docs/ then star-star then / then star.md for nested files).
 * Paths are compared with forward slashes.
 */
export function pathMatchesGlob(relPath, pattern) {
  const file = String(relPath || "").replace(/\\/g, "/").replace(/^\.\//, "");
  let pat = String(pattern || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!pat) return false;
  // Trailing slash → directory prefix (same as trailing /**)
  if (pat.endsWith("/") && !pat.endsWith("**/")) pat = pat + "**";
  if (pat.endsWith("/**")) {
    const prefix = pat.slice(0, -3); // drop /**
    if (prefix === "") return true;
    return file === prefix || file.startsWith(prefix + "/");
  }
  // Exact match shortcut (no wildcards)
  if (!/[*?]/.test(pat)) return file === pat;

  // Convert simple glob → RegExp. ** = any path incl. slashes; * = one segment.
  let re = "^";
  for (let i = 0; i < pat.length; ) {
    if (pat[i] === "*" && pat[i + 1] === "*") {
      // ** or **/
      if (pat[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 3;
      } else {
        re += ".*";
        i += 2;
      }
    } else if (pat[i] === "*") {
      re += "[^/]*";
      i += 1;
    } else if (pat[i] === "?") {
      re += "[^/]";
      i += 1;
    } else {
      const ch = pat[i];
      if (/[.+^${}()|[\]\\]/.test(ch)) re += "\\" + ch;
      else re += ch;
      i += 1;
    }
  }
  re += "$";
  try {
    return new RegExp(re).test(file);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Policy trust (authorization accounting)
// ---------------------------------------------------------------------------

/**
 * Normalize a policy entry that claims to be an authorization digest.
 * Accepts 64-char hex or `sha256:<64-hex>`. Display fingerprints and other
 * strings return null (they must never authorize).
 * @param {string} entry
 * @returns {string|null} lowercase hex, or null if not a digest form
 */
export function normalizeAuthIdEntry(entry) {
  if (typeof entry !== "string") return null;
  const s = entry.trim().toLowerCase();
  const bare = s.startsWith("sha256:") ? s.slice("sha256:".length).trim() : s;
  if (/^[0-9a-f]{64}$/.test(bare)) return bare;
  return null;
}

/**
 * True when `rel` (repo-relative, forward slashes preferred) is present in the
 * git index — tracked on HEAD and/or staged for commit. Untracked and
 * gitignored paths are false: they must not authorize secret ignores while the
 * dirty-tree own-artifact carve-out can still report GO.
 */
export function isPolicyPathInIndex(cwd, rel) {
  const want = String(rel || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  if (!want) return false;
  // --cached lists index entries (committed + staged). Untracked/ignored → empty.
  const out = gitSafe(["ls-files", "--cached", "--", want], { cwd });
  if (!out) return false;
  return out.split(/\r?\n/).some((line) => {
    const p = line.replace(/\\/g, "/").replace(/^\.\//, "");
    return p === want;
  });
}

// ---------------------------------------------------------------------------
// Load policy
// ---------------------------------------------------------------------------

/**
 * Empty / default policy — only built-ins apply.
 * @returns {{ version: number, ignore: { values: Set<string>, hashes: Set<string>, paths: string[], patternIds: Set<string> }, source: string|null, trusted: boolean, warnings: string[] }}
 */
export function emptyPolicy() {
  return {
    version: 0,
    ignore: {
      values: new Set(),
      hashes: new Set(),
      paths: [],
      patternIds: new Set(),
    },
    source: null,
    trusted: false,
    warnings: [],
  };
}

/**
 * Parse policy JSON text (BOM-tolerant). Distinguishes parse failure from
 * non-object roots so callers can warn honestly.
 * @param {string} text
 * @returns {{ ok: boolean, json: any, error: Error|null }}
 */
function parsePolicyText(text) {
  try {
    const json = JSON.parse(stripBom(String(text ?? "")));
    return { ok: true, json, error: null };
  } catch (error) {
    return { ok: false, json: null, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Load `.getadvantage/config.json` (or legacy `.ship-safe/config.json`).
 * Prefer current marker when both exist. Authorizing content is read from the
 * git index blob only — never from an unstaged worktree edit. Malformed /
 * untrusted / unsupported version → warnings; built-ins still work; ignore
 * rules not applied.
 * @param {string} cwd
 */
export function loadPolicy(cwd) {
  const policy = emptyPolicy();
  // Current marker wins over legacy when both are present (precedence).
  // Present = on disk OR in the index (deleted worktree still has index blob).
  const candidates = [
    { abs: path.join(cwd, MARKER_DIR, "config.json"), rel: `${MARKER_DIR}/config.json` },
    {
      abs: path.join(cwd, LEGACY_MARKER_DIR, "config.json"),
      rel: `${LEGACY_MARKER_DIR}/config.json`,
    },
  ];
  let chosen = null;
  for (const c of candidates) {
    if (existsSync(c.abs) || isPolicyPathInIndex(cwd, c.rel)) {
      chosen = c;
      break;
    }
  }
  if (!chosen) return policy;

  const { abs, rel } = chosen;
  policy.source = rel;

  // Trust: only index-backed policy may authorize ignores. Untracked or
  // gitignored config must never suppress hits (own-artifact dirty-tree
  // carve-out would otherwise yield false GO with no reviewable policy).
  const inIndex = isPolicyPathInIndex(cwd, rel);
  if (!inIndex) {
    policy.trusted = false;
    policy.warnings.push(
      `${rel} is not tracked or staged in git — ignore rules not applied (commit or stage the policy so authorization is reviewable).`,
    );
    return policy;
  }

  // Authorization identity is the INDEX blob — not the working tree. A tracked
  // or staged policy that is modified again without staging must not authorize
  // the unstaged ignore rules (0.8.3 Fable audit P1).
  const indexText = readGitIndexText(cwd, rel);
  if (indexText == null) {
    policy.trusted = false;
    policy.warnings.push(
      `${rel} is listed in the git index but could not be read — ignore rules not applied.`,
    );
    return policy;
  }

  // Honesty: disclose when worktree differs so operators know unstaged edits
  // do not authorize (dirty-tree also flags config.json as ship-risk now).
  if (existsSync(abs)) {
    try {
      const worktreeText = readFileSync(abs, "utf8");
      if (worktreeText !== indexText) {
        policy.warnings.push(
          `${rel} working tree differs from the git index — only the staged/tracked content authorizes ignores (unstaged edits are not applied).`,
        );
      }
    } catch {
      // unreadable worktree is fine; index content still governs
    }
  }

  const r = parsePolicyText(indexText);
  if (!r.ok) {
    policy.trusted = false;
    policy.warnings.push(
      `${rel} (git index) could not be parsed — ignore rules not applied (${r.error?.message || "invalid JSON"}).`,
    );
    return policy;
  }
  const json = r.json;
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    policy.trusted = false;
    policy.warnings.push(`${rel} (git index) root must be a JSON object — ignore rules not applied.`);
    return policy;
  }

  const rawVersion = json.version;
  const version =
    typeof rawVersion === "number" && Number.isFinite(rawVersion) ? rawVersion : 1;
  policy.version = version;

  if (!SUPPORTED_POLICY_VERSIONS.has(version)) {
    policy.trusted = false;
    policy.warnings.push(
      `${rel} has unsupported version ${version} (supported: ${[...SUPPORTED_POLICY_VERSIONS].join(", ")}) — ignore rules not applied.`,
    );
    return policy;
  }

  // Index content parsed and version supported → trusted for ignore rules.
  policy.trusted = true;

  const secrets = json.secrets && typeof json.secrets === "object" ? json.secrets : json;
  const ignore = secrets.ignore && typeof secrets.ignore === "object" ? secrets.ignore : null;
  if (!ignore) return policy;

  if (Array.isArray(ignore.values)) {
    for (const v of ignore.values) {
      if (typeof v === "string" && v.length > 0) policy.ignore.values.add(v);
    }
  }

  // Authorization digests only. Field names: `hashes` (preferred) and legacy
  // `fingerprints` when the entry is a full sha256 hex (not a display mask).
  let skippedDisplayFp = 0;
  const digestLists = [];
  if (Array.isArray(ignore.hashes)) digestLists.push(ignore.hashes);
  if (Array.isArray(ignore.fingerprints)) digestLists.push(ignore.fingerprints);
  for (const list of digestLists) {
    for (const entry of list) {
      const id = normalizeAuthIdEntry(entry);
      if (id) policy.ignore.hashes.add(id);
      else if (typeof entry === "string" && entry.length > 0) skippedDisplayFp++;
    }
  }
  if (skippedDisplayFp > 0) {
    policy.warnings.push(
      `${rel}: ${skippedDisplayFp} ignore.fingerprints/hashes entr${skippedDisplayFp === 1 ? "y" : "ies"} ignored — use a full sha256 auth id (64 hex chars), not a display fingerprint.`,
    );
  }

  if (Array.isArray(ignore.paths)) {
    for (const p of ignore.paths) {
      if (typeof p === "string" && p.length > 0) policy.ignore.paths.push(p);
    }
  }
  if (Array.isArray(ignore.patternIds)) {
    for (const id of ignore.patternIds) {
      if (typeof id === "string" && id.length > 0) policy.ignore.patternIds.add(id);
    }
  }
  // Alias: "patterns" → patternIds (friendlier name in docs)
  if (Array.isArray(ignore.patterns)) {
    for (const id of ignore.patterns) {
      if (typeof id === "string" && id.length > 0) policy.ignore.patternIds.add(id);
    }
  }

  return policy;
}

// ---------------------------------------------------------------------------
// Match an individual secret hit against policy + built-ins
// ---------------------------------------------------------------------------

/**
 * Pattern ids whose raw match is not a unique secret occurrence (e.g. a constant
 * PEM header). Value/hash allowlisting would reintroduce cross-key authorization
 * because every incomplete key of that type shares the same match string.
 * path and patternId remains explicit and honest.
 */
const NON_UNIQUE_AUTH_PATTERN_IDS = new Set(["private-key-incomplete"]);

/**
 * @param {string} match - full matched string (never printed by callers)
 * @param {{ file: string, patternId: string, policy: ReturnType<typeof emptyPolicy> }} ctx
 * @returns {{ allowed: boolean, reason: string|null, fp: string, authId: string }}
 */
export function secretAllowDecision(match, ctx) {
  const fp = fingerprint(match);
  const authId = secretAuthId(match);
  const { file, patternId, policy } = ctx;

  const built = builtinSecretAllowReason(match, patternId);
  if (built) return { allowed: true, reason: built, fp, authId };

  // Untrusted policy never authorizes (defense in depth — loadPolicy already
  // leaves ignore sets empty, but refuse even if a caller passes a dirty policy).
  if (!policy?.trusted) {
    return { allowed: false, reason: null, fp, authId };
  }

  if (policy?.ignore?.patternIds?.has(patternId)) {
    return { allowed: true, reason: `policy: patternId "${patternId}"`, fp, authId };
  }

  // Non-unique detector matches: never authorize via value/hash (header-only
  // auth ids collide across every key of that PEM type).
  const nonUniqueAuth = NON_UNIQUE_AUTH_PATTERN_IDS.has(patternId);

  if (!nonUniqueAuth && policy?.ignore?.values?.has(match)) {
    return { allowed: true, reason: "policy: value", fp, authId };
  }

  // Match collision-resistant auth id only — never the display fingerprint.
  if (!nonUniqueAuth && policy?.ignore?.hashes?.has(authId)) {
    return { allowed: true, reason: "policy: hash", fp, authId };
  }

  if (policy?.ignore?.paths?.length) {
    for (const pat of policy.ignore.paths) {
      if (pathMatchesGlob(file, pat)) {
        return { allowed: true, reason: `policy: path "${pat}"`, fp, authId };
      }
    }
  }

  return { allowed: false, reason: null, fp, authId };
}
