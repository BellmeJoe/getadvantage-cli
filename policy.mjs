// getAdvantage — repo policy config (allowlist / baseline).
//
// The gate must be adoptable in real repos. Docs and fixtures ship well-known
// placeholder "secrets" (AWS' own AKIA…EXAMPLE, sample tokens in README tables)
// that hard-block with no escape hatch → false NO-GO and abandonment.
//
// Contract (honesty principle):
//   • Built-in ignores cover only public documentation examples, never live shapes.
//   • User ignores live in the repo's `.getadvantage/config.json` (commit-friendly).
//   • Every allowlisted hit is DISCLOSED on the result (never a silent false GO).
//   • Full secret values are never printed — only fingerprints + reason codes.
//
// Zero dependencies. Node built-ins only.

import path from "node:path";
import { existsSync } from "node:fs";
import {
  fingerprint,
  MARKER_DIR,
  LEGACY_MARKER_DIR,
  readJsonFile,
} from "./util.mjs";

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
// Load policy
// ---------------------------------------------------------------------------

/**
 * Empty / default policy — only built-ins apply.
 * @returns {{ version: number, ignore: { values: Set<string>, fingerprints: Set<string>, paths: string[], patternIds: Set<string> }, source: string|null, warnings: string[] }}
 */
export function emptyPolicy() {
  return {
    version: 0,
    ignore: {
      values: new Set(),
      fingerprints: new Set(),
      paths: [],
      patternIds: new Set(),
    },
    source: null,
    warnings: [],
  };
}

/**
 * Load `.getadvantage/config.json` (or legacy `.ship-safe/config.json`).
 * Malformed config → warnings, built-ins still work.
 * @param {string} cwd
 */
export function loadPolicy(cwd) {
  const policy = emptyPolicy();
  const candidates = [
    path.join(cwd, MARKER_DIR, "config.json"),
    path.join(cwd, LEGACY_MARKER_DIR, "config.json"),
  ];
  let abs = null;
  for (const c of candidates) {
    if (existsSync(c)) {
      abs = c;
      break;
    }
  }
  if (!abs) return policy;

  const r = readJsonFile(abs);
  const rel = abs.includes(LEGACY_MARKER_DIR)
    ? `${LEGACY_MARKER_DIR}/config.json`
    : `${MARKER_DIR}/config.json`;
  if (!r.ok) {
    policy.warnings.push(
      `Policy ${rel} exists but could not be parsed — ignore rules not applied (${r.error?.message || "invalid JSON"}).`,
    );
    return policy;
  }
  const json = r.json;
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    policy.warnings.push(`Policy ${rel} root must be a JSON object — ignore rules not applied.`);
    return policy;
  }

  policy.source = rel;
  policy.version = typeof json.version === "number" ? json.version : 1;

  const secrets = json.secrets && typeof json.secrets === "object" ? json.secrets : json;
  const ignore = secrets.ignore && typeof secrets.ignore === "object" ? secrets.ignore : null;
  if (!ignore) return policy;

  if (Array.isArray(ignore.values)) {
    for (const v of ignore.values) {
      if (typeof v === "string" && v.length > 0) policy.ignore.values.add(v);
    }
  }
  if (Array.isArray(ignore.fingerprints)) {
    for (const fp of ignore.fingerprints) {
      if (typeof fp === "string" && fp.length > 0) policy.ignore.fingerprints.add(fp);
    }
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
 * @param {string} match - full matched string (never printed by callers)
 * @param {{ file: string, patternId: string, policy: ReturnType<typeof emptyPolicy> }} ctx
 * @returns {{ allowed: boolean, reason: string|null, fp: string }}
 */
export function secretAllowDecision(match, ctx) {
  const fp = fingerprint(match);
  const { file, patternId, policy } = ctx;

  const built = builtinSecretAllowReason(match, patternId);
  if (built) return { allowed: true, reason: built, fp };

  if (policy?.ignore?.patternIds?.has(patternId)) {
    return { allowed: true, reason: `policy: patternId "${patternId}"`, fp };
  }

  if (policy?.ignore?.values?.has(match)) {
    return { allowed: true, reason: "policy: value", fp };
  }

  if (policy?.ignore?.fingerprints?.has(fp)) {
    return { allowed: true, reason: "policy: fingerprint", fp };
  }

  if (policy?.ignore?.paths?.length) {
    for (const pat of policy.ignore.paths) {
      if (pathMatchesGlob(file, pat)) {
        return { allowed: true, reason: `policy: path "${pat}"`, fp };
      }
    }
  }

  return { allowed: false, reason: null, fp };
}

