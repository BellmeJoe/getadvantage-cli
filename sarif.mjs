// getAdvantage CLI — dependency-free SARIF 2.1.0 export for `check --sarif`.
//
// Emits a GitHub code-scanning-compatible SARIF document from gate results.
// Never includes full secrets, tokens, private keys, or raw matches — only
// display fingerprints, auth ids, paths, and redacted messages already safe
// for humans. Writing the file does not change GO/NO-GO exit semantics when
// serialization succeeds; write/serialize failures fail honestly.
//
// Node built-ins only. ESM.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cliVersion } from "./util.mjs";

const SARIF_VERSION = "2.1.0";
const SARIF_SCHEMA =
  "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json";

/** Map check status → SARIF result level. */
function levelForStatus(status) {
  if (status === "fail") return "error";
  if (status === "warn") return "warning";
  return "note";
}

/**
 * Whether a rule is a true security finding (secret / tracked-env leak risk).
 * Only these carry GitHub `security-severity` and the `security` tag.
 * Build, dirty-tree, typecheck, and other ship-gate checks are quality/
 * reliability — they use `problem.severity` so GitHub does not treat them as
 * security alerts.
 */
export function isSecurityRule(ruleId, finding, checkLabel) {
  const id = String(ruleId || "");
  if (id.startsWith("secret/")) return true;
  if (id === "check/tracked-env-file" || id.startsWith("check/tracked-env")) return true;
  if (finding?.patternId) return true;
  const label = String(checkLabel || "").toLowerCase();
  if (/^secret\b/.test(label) || /tracked\s*\.env/.test(label)) return true;
  return false;
}

/** GitHub-supported non-security problem severity from SARIF level. */
function problemSeverityForLevel(level) {
  if (level === "error") return "error";
  if (level === "warning") return "warning";
  return "recommendation";
}

/**
 * Stable rule id for a check or a structured finding.
 * Secret findings use `secret/<patternId>`; other checks use `check/<slug>`.
 */
export function ruleIdFor(checkLabel, finding) {
  if (finding?.ruleId && typeof finding.ruleId === "string") return finding.ruleId;
  if (finding?.patternId) return `secret/${finding.patternId}`;
  const slug = String(checkLabel || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `check/${slug || "unknown"}`;
}

/** Human rule name (short). */
function ruleNameFor(ruleId, checkLabel, finding) {
  if (finding?.label) return String(finding.label);
  if (ruleId.startsWith("secret/")) return String(finding?.label || checkLabel || ruleId);
  return String(checkLabel || ruleId);
}

/**
 * Defensive message sanitizer: never let a full secret-shaped token slip into
 * SARIF. Replaces long credential-like tokens with a redacted placeholder while
 * leaving fingerprints, auth hex, and short prose alone.
 */
export function redactForSarif(text) {
  let s = String(text ?? "");
  // PEM blocks (complete or truncated header+body) — never emit key material.
  s = s.replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, "[redacted-private-key]");
  // Common high-entropy credential shapes (length-gated so fingerprints stay).
  s = s.replace(/\bsk_live_[A-Za-z0-9]{16,}\b/g, "sk_live_…[redacted]");
  s = s.replace(/\brk_live_[A-Za-z0-9]{16,}\b/g, "rk_live_…[redacted]");
  s = s.replace(/\bsk-ant-[A-Za-z0-9_-]{16,}\b/g, "sk-ant-…[redacted]");
  s = s.replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, "sk-…[redacted]");
  s = s.replace(/\bghp_[A-Za-z0-9]{20,}\b/g, "ghp_…[redacted]");
  s = s.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "github_pat_…[redacted]");
  s = s.replace(/\bAKIA[0-9A-Z]{16}\b/g, "AKIA…[redacted]");
  s = s.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "xox…[redacted]");
  s = s.replace(/\bwhsec_[A-Za-z0-9]{16,}\b/g, "whsec_…[redacted]");
  s = s.replace(/\bvcp_[A-Za-z0-9]{16,}\b/g, "vcp_…[redacted]");
  s = s.replace(/\bnpm_[A-Za-z0-9]{20,}\b/g, "npm_…[redacted]");
  s = s.replace(/\badv_live_[a-z0-9]{16,}\b/g, "adv_live_…[redacted]");
  s = s.replace(/\bGOCSPX-[A-Za-z0-9_-]{16,}\b/g, "GOCSPX-…[redacted]");
  s = s.replace(/\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, "SG.…[redacted]");
  s = s.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "eyJ…[redacted-jwt]");
  // Env-style KEY=value assignments with long values.
  s = s.replace(/\b([A-Z][A-Z0-9_]{2,})=\S{12,}/g, "$1=[redacted]");
  return s;
}

/**
 * Build a SARIF 2.1.0 document from `runChecks` results.
 * Only fail + warn produce results (pass/skip are not findings).
 *
 * @param {object} o
 * @param {Array} o.results   check results from runChecks
 * @param {number} o.exitCode gate exit code (0=GO, 1=NO-GO)
 * @param {string} [o.cwd]    repo root (for uriBaseId; not required)
 * @returns {object} SARIF document (plain JSON-serializable)
 */
export function buildSarif(o) {
  const results = Array.isArray(o.results) ? o.results : [];
  const exitCode = typeof o.exitCode === "number" ? o.exitCode : 0;
  const version = cliVersion();
  const rulesById = new Map();
  const sarifResults = [];

  function ensureRule(ruleId, name, helpText, level, security) {
    if (rulesById.has(ruleId)) return;
    const severity = level === "error" ? "error" : level === "warning" ? "warning" : "note";
    const properties = security
      ? {
          // GitHub security results only: 0.0–10.0 prioritization — not a CVSS claim.
          "security-severity": level === "error" ? "8.0" : level === "warning" ? "4.0" : "1.0",
          tags: ruleId.startsWith("secret/")
            ? ["security", "secret", "ship-gate"]
            : ["security", "ship-gate"],
        }
      : {
          // Non-security ship-gate checks — quality/reliability, not security alerts.
          "problem.severity": problemSeverityForLevel(level),
          tags: ["quality", "reliability", "ship-gate"],
        };
    rulesById.set(ruleId, {
      id: ruleId,
      name: String(name || ruleId).slice(0, 200),
      shortDescription: { text: redactForSarif(name || ruleId).slice(0, 200) },
      fullDescription: {
        text: redactForSarif(helpText || name || ruleId).slice(0, 1000),
      },
      defaultConfiguration: { level: severity },
      properties,
    });
  }

  for (const r of results) {
    if (!r || (r.status !== "fail" && r.status !== "warn")) continue;
    const level = levelForStatus(r.status);
    const findings = Array.isArray(r.findings) && r.findings.length > 0 ? r.findings : null;

    if (findings) {
      for (const f of findings) {
        const ruleId = ruleIdFor(r.label, f);
        const security = isSecurityRule(ruleId, f, r.label);
        ensureRule(ruleId, f.label || r.label, r.detail, level, security);
        const msgParts = [];
        if (f.message) msgParts.push(String(f.message));
        else {
          if (f.label) msgParts.push(String(f.label));
          if (f.fp) msgParts.push(String(f.fp));
          if (f.authId) msgParts.push(`auth ${f.authId}`);
          if (f.count > 1) msgParts.push(`(+${f.count - 1} more)`);
        }
        if (msgParts.length === 0) msgParts.push(String(r.detail || r.label || "finding"));
        const messageText = redactForSarif(msgParts.join(" — "));

        const result = {
          ruleId,
          level,
          message: { text: messageText },
        };

        if (f.file) {
          const uri = encodeArtifactUri(f.file);
          if (uri) {
            const loc = {
              physicalLocation: {
                artifactLocation: { uri },
              },
            };
            // Region only when the scanner has a defensible 1-based line.
            if (typeof f.startLine === "number" && f.startLine >= 1) {
              loc.physicalLocation.region = {
                startLine: f.startLine,
              };
              if (typeof f.startColumn === "number" && f.startColumn >= 1) {
                loc.physicalLocation.region.startColumn = f.startColumn;
              }
              if (typeof f.endColumn === "number" && f.endColumn >= 1) {
                loc.physicalLocation.region.endColumn = f.endColumn;
              }
            }
            result.locations = [loc];
          }
        }

        // Stable-ish partial fingerprint for GitHub de-dupe (no secret material).
        const fpKey = [ruleId, f.file || "", f.fp || "", f.authId || "", f.startLine || ""].join("|");
        result.partialFingerprints = {
          primaryLocationLineHash: simpleHash(fpKey),
        };

        sarifResults.push(result);
      }
    } else {
      // No structured findings: emit a single summary result from the
      // gate-authored detail only. NEVER copy check.extra into SARIF — that is
      // often raw build/typecheck stdout and can contain credentials, tokens,
      // or query-string secrets. No location inference from extras either.
      const ruleId = ruleIdFor(r.label, null);
      const security = isSecurityRule(ruleId, null, r.label);
      ensureRule(ruleId, r.label, r.detail, level, security);
      const summary = [r.label, r.detail].filter(Boolean).join(": ");
      const messageText = redactForSarif(summary || "check finding").slice(0, 1000);
      const result = {
        ruleId,
        level,
        message: { text: messageText },
      };
      result.partialFingerprints = {
        primaryLocationLineHash: simpleHash([ruleId, messageText.slice(0, 200)].join("|")),
      };
      sarifResults.push(result);
    }
  }

  return {
    $schema: SARIF_SCHEMA,
    version: SARIF_VERSION,
    runs: [
      {
        tool: {
          driver: {
            name: "getAdvantage",
            version,
            informationUri: "https://getadvantage.app",
            rules: [...rulesById.values()],
          },
        },
        results: sarifResults,
        invocations: [
          {
            executionSuccessful: true,
            exitCode,
            exitCodeDescription:
              exitCode === 0
                ? "GO — all applicable blocking checks clear"
                : "NO-GO — one or more blocking checks failed",
          },
        ],
        // Honest automation id for multi-upload category uniqueness.
        automationDetails: {
          id: "getadvantage/check",
        },
      },
    ],
  };
}

/**
 * Encode a repo-relative path as a SARIF artifact URI reference.
 * Spaces, `#`, `%`, Unicode, and other reserved characters must not be raw.
 * Slashes remain path separators; each segment is percent-encoded.
 *
 * Credential-shaped path material (e.g. a filename that is itself
 * `sk_live_…`) must not appear in `artifactLocation.uri`. If redaction would
 * change the path, omit the location entirely — never emit a fake redacted
 * path that does not exist in the repository.
 */
export function encodeArtifactUri(filePath) {
  if (filePath == null || filePath === "") return "";
  const normalized = String(filePath).replace(/\\/g, "/");
  // Reject absolute URLs (scheme://…) — never lift credential-bearing tool
  // stdout into artifactLocation.uri. Real repo paths are relative.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized)) {
    return "";
  }
  // Path itself is credential-shaped → omit (do not encode a leaky URI).
  if (redactForSarif(normalized) !== normalized) {
    return "";
  }
  // Percent-encode each segment so spaces, #, %, &, =, Unicode, etc. are valid URI refs.
  return normalized
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

/** Short non-crypto hash for partialFingerprints (stable, not security-sensitive). */
function simpleHash(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Serialize and write SARIF to `outPath`. Creates parent directories.
 * @param {object} o
 * @param {object} o.doc      SARIF document from buildSarif
 * @param {string} o.outPath  destination file path
 * @throws {Error} on empty path, serialization, or write failure
 */
export function writeSarifFile(o) {
  const outPath = o?.outPath;
  if (!outPath || typeof outPath !== "string" || !outPath.trim()) {
    const err = new Error(
      "SARIF output path is empty. Pass a file path: getadvantage check --sarif getadvantage.sarif",
    );
    err.code = "SARIF_PATH";
    throw err;
  }
  const abs = path.resolve(outPath);
  // Refuse writing to a directory path ending in separator-only nonsense.
  const base = path.basename(abs);
  if (!base || base === "." || base === "..") {
    const err = new Error(
      `SARIF output path is not a file path: ${outPath}\n  → Pass a concrete file, e.g. --sarif getadvantage.sarif`,
    );
    err.code = "SARIF_PATH";
    throw err;
  }

  let json;
  try {
    json = JSON.stringify(o.doc, null, 2);
  } catch (e) {
    const err = new Error(
      `SARIF serialization failed: ${e.message || e}\n  → Re-run without --sarif, or file an issue with the check --json output (no secrets).`,
    );
    err.code = "SARIF_SERIALIZE";
    throw err;
  }

  // Final belt-and-braces: refuse to write if serialization somehow contains
  // raw PEM markers (should already be redacted in messages).
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(json)) {
    const err = new Error(
      "SARIF export refused: private-key material would have been written.\n  → This is a bug; re-run without --sarif and report it.",
    );
    err.code = "SARIF_REDACT";
    throw err;
  }

  try {
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, json + "\n", "utf8");
  } catch (e) {
    const err = new Error(
      `Could not write SARIF file to ${outPath}: ${e.message || e}\n  → Check the path is writable and not a directory; e.g. --sarif getadvantage.sarif`,
    );
    err.code = "SARIF_WRITE";
    throw err;
  }
  return abs;
}
