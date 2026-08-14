#!/usr/bin/env node
// getAdvantage — retained external team detector (ops tooling only).
//
// North-star metric observer: count week-two reuse of invisible mode via
// public GitHub code search of the zero-telemetry receipt written at
// `.getadvantage/INVISIBLE-MODE.md`. No product-surface CLI, no telemetry
// from user machines — this script runs in agent-ops / owner tooling only.
//
// Usage:
//   GITHUB_TOKEN=… node ops/retained-team-detector.mjs
//   GITHUB_TOKEN=… node ops/retained-team-detector.mjs --out report.txt
//
// Exit codes:
//   0  — query succeeded (including zero external hits → plain `0`)
//   1  — UNKNOWN (auth / rate-limit / network / missing token)
//
// Node built-ins only. ESM. Injectable `fetch` for hermetic tests.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Stable receipt header (must match invisible-hook.mjs RECEIPT_HEADER). */
export const RECEIPT_HEADER = "getAdvantage invisible-mode receipt";
export const RECEIPT_PATH = ".getadvantage/INVISIBLE-MODE.md";
export const DEFAULT_SELF_OWNER = "BellmeJoe";

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

// ---------------------------------------------------------------------------
// Pure helpers (exported for hostile unit tests)
// ---------------------------------------------------------------------------

/**
 * ISO week id for a Date or parseable timestamp string.
 * @param {Date|string|number} input
 * @returns {string|null} e.g. "2026-W32"
 */
export function isoWeekId(input) {
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  // Use UTC calendar date so ISO strings classify independently of local TZ.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday of this week decides the ISO year.
  date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  const isoYear = date.getUTCFullYear();
  // January 4 is always in week 1.
  const week1 = new Date(Date.UTC(isoYear, 0, 4));
  const weekNo =
    1 +
    Math.round(
      ((date.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${isoYear}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Classify a receipt body.
 * - missing expected header / no parseable timestamps → unknown-shape
 * - timestamps in exactly one ISO week → install (not retention)
 * - timestamps spanning ≥2 distinct ISO weeks → retained
 *
 * @param {string} text
 * @returns {{ kind: "install"|"retained"|"unknown-shape", weeks?: string[] }}
 */
export function classifyReceipt(text) {
  if (typeof text !== "string" || !text.includes(RECEIPT_HEADER)) {
    return { kind: "unknown-shape" };
  }

  // Prefer `- at: <ISO>` lines (product shape); also accept any ISO-8601 stamps.
  const timestamps = [];
  const atLineRe = /^[ \t]*-\s*at:\s*(\S+)/gim;
  let m;
  while ((m = atLineRe.exec(text)) !== null) {
    timestamps.push(m[1].trim());
  }
  if (timestamps.length === 0) {
    const isoRe =
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;
    const general = text.match(isoRe);
    if (general) timestamps.push(...general);
  }

  if (timestamps.length === 0) return { kind: "unknown-shape" };

  const weekSet = new Set();
  for (const ts of timestamps) {
    const id = isoWeekId(ts);
    if (id) weekSet.add(id);
  }
  if (weekSet.size === 0) return { kind: "unknown-shape" };

  const weeks = [...weekSet].sort();
  if (weeks.length >= 2) return { kind: "retained", weeks };
  return { kind: "install", weeks };
}

/**
 * Decide whether a GitHub repository object should be excluded from the
 * external-team count (Benjamin's own repos and forks of them).
 *
 * @param {object} repo — search/repo API repository object
 * @param {string} [selfOwner]
 * @returns {{ exclude: boolean, reason?: string, needsParent?: boolean }}
 */
export function shouldExcludeRepo(repo, selfOwner = DEFAULT_SELF_OWNER) {
  if (!repo || typeof repo !== "object") {
    return { exclude: false };
  }
  const ownerLogin =
    (repo.owner && (repo.owner.login || repo.owner.name)) ||
    (typeof repo.owner === "string" ? repo.owner : null) ||
    (typeof repo.full_name === "string" ? repo.full_name.split("/")[0] : null);

  if (
    ownerLogin &&
    String(ownerLogin).toLowerCase() === String(selfOwner).toLowerCase()
  ) {
    return {
      exclude: true,
      reason: `owner is selfOwner (${selfOwner})`,
    };
  }

  if (repo.fork === true) {
    const parentOwner =
      (repo.parent &&
        (repo.parent.owner?.login ||
          repo.parent.owner?.name ||
          (typeof repo.parent.owner === "string" ? repo.parent.owner : null))) ||
      (repo.source &&
        (repo.source.owner?.login ||
          repo.source.owner?.name ||
          (typeof repo.source.owner === "string" ? repo.source.owner : null))) ||
      null;

    if (
      parentOwner &&
      String(parentOwner).toLowerCase() === String(selfOwner).toLowerCase()
    ) {
      const parentName =
        (repo.parent && (repo.parent.name || repo.parent.full_name)) ||
        (repo.source && (repo.source.name || repo.source.full_name)) ||
        "…";
      const parentLabel = String(parentName).includes("/")
        ? parentName
        : `${selfOwner}/${parentName}`;
      return {
        exclude: true,
        reason: `fork of ${parentLabel}`,
      };
    }
    if (!parentOwner) {
      // Caller must resolve parent via repo API before a final decision.
      return { exclude: false, needsParent: true };
    }
  }

  return { exclude: false };
}

// ---------------------------------------------------------------------------
// Network + orchestration
// ---------------------------------------------------------------------------

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "getadvantage-retained-team-detector",
  };
}

function isFailureStatus(status) {
  return status === 401 || status === 403 || status === 429;
}

/**
 * Decode a contents-API JSON body (base64) or raw text.
 * @param {Response} res
 * @param {string} textBody
 */
async function decodeContentBody(res, textBody) {
  const ct = (res.headers && typeof res.headers.get === "function"
    ? res.headers.get("content-type")
    : "") || "";
  if (ct.includes("application/json") || textBody.trimStart().startsWith("{")) {
    try {
      const j = JSON.parse(textBody);
      if (j && typeof j.content === "string") {
        const enc = j.encoding || "base64";
        if (enc === "base64") {
          return Buffer.from(j.content.replace(/\n/g, ""), "base64").toString("utf8");
        }
        return String(j.content);
      }
      // Unexpected JSON shape
      return null;
    } catch {
      return null;
    }
  }
  return textBody;
}

/**
 * Build the dated auditable report string.
 * @param {object} result
 */
export function formatReport(result) {
  const lines = [];
  const generated = result.generatedAt || new Date().toISOString();

  if (result.status === "UNKNOWN") {
    lines.push("# getAdvantage retained-team-detector report");
    lines.push(`# generated: ${generated}`);
    lines.push(`# selfOwner: ${result.selfOwner || DEFAULT_SELF_OWNER}`);
    lines.push("");
    lines.push("UNKNOWN");
    lines.push("");
    lines.push(`## Failure`);
    lines.push(`- reason: ${result.failureReason || "unknown"}`);
    if (result.httpStatus != null) lines.push(`- httpStatus: ${result.httpStatus}`);
    lines.push("");
    lines.push(
      "This is not a retained-team count of 0. Auth, rate-limit, or network",
    );
    lines.push("failure prevented a reliable observation.");
    lines.push("");
    return lines.join("\n");
  }

  const retained = result.retained || [];
  const installs = result.installs || [];
  const unknownShape = result.unknownShape || [];
  const excluded = result.excluded || [];
  const retainedCount = retained.length;
  const externalCount =
    retained.length + installs.length + unknownShape.length;

  // Zero external repos found → plain `0` (north-star first-class result).
  if (externalCount === 0 && excluded.length === 0 && (result.totalSearchHits || 0) === 0) {
    lines.push("0");
    lines.push("");
    lines.push("# getAdvantage retained-team-detector report");
    lines.push(`# generated: ${generated}`);
    lines.push(`# selfOwner: ${result.selfOwner || DEFAULT_SELF_OWNER}`);
    lines.push("# status: ok — zero code-search hits");
    lines.push(`# retained-external-teams: 0`);
    lines.push("");
    return lines.join("\n");
  }

  if (externalCount === 0) {
    // Hits existed but all were excluded (self / forks of self).
    lines.push("0");
    lines.push("");
    lines.push("# getAdvantage retained-team-detector report");
    lines.push(`# generated: ${generated}`);
    lines.push(`# selfOwner: ${result.selfOwner || DEFAULT_SELF_OWNER}`);
    lines.push("# status: ok — zero external repos after exclusions");
    lines.push(`# retained-external-teams: 0`);
    lines.push(`# search-hits: ${result.totalSearchHits || 0}`);
    lines.push(`# excluded: ${excluded.length}`);
    lines.push("");
    lines.push("## Excluded (with reason)");
    for (const e of excluded) {
      lines.push(`- ${e.fullName || e.repo || "?"} — ${e.reason}`);
    }
    lines.push("");
    return lines.join("\n");
  }

  lines.push("# getAdvantage retained-team-detector report");
  lines.push(`# generated: ${generated}`);
  lines.push(`# selfOwner: ${result.selfOwner || DEFAULT_SELF_OWNER}`);
  lines.push("# status: ok");
  lines.push("");
  lines.push("## North-star: retained external teams (week-two reuse)");
  lines.push(String(retainedCount));
  lines.push("");
  lines.push("## Summary");
  lines.push(`- retained: ${retainedCount}`);
  lines.push(`- installs (single week, not retention): ${installs.length}`);
  lines.push(`- unknown-shape: ${unknownShape.length}`);
  lines.push(`- excluded: ${excluded.length}`);
  lines.push(`- search-hits: ${result.totalSearchHits || 0}`);
  lines.push("");

  if (retained.length) {
    lines.push("## Retained (gate activity in ≥2 distinct ISO weeks)");
    for (const r of retained) {
      lines.push(
        `- ${r.fullName}  weeks: ${(r.weeks || []).join(", ")}  path: ${r.path || RECEIPT_PATH}`,
      );
    }
    lines.push("");
  }

  if (installs.length) {
    lines.push("## Installs (receipt exists, single ISO week — not retention)");
    for (const r of installs) {
      lines.push(
        `- ${r.fullName}  weeks: ${(r.weeks || []).join(", ")}  path: ${r.path || RECEIPT_PATH}`,
      );
    }
    lines.push("");
  }

  if (unknownShape.length) {
    lines.push("## Unknown-shape (corrupt / hand-edited / unparseable — not retained)");
    for (const r of unknownShape) {
      lines.push(`- ${r.fullName}  path: ${r.path || RECEIPT_PATH}${r.note ? `  (${r.note})` : ""}`);
    }
    lines.push("");
  }

  if (excluded.length) {
    lines.push("## Excluded (with reason)");
    for (const e of excluded) {
      lines.push(`- ${e.fullName || e.repo || "?"} — ${e.reason}`);
    }
    lines.push("");
  }

  // Trailing plain north-star integer for easy scripting.
  lines.push(`# retained-external-teams: ${retainedCount}`);
  lines.push(String(retainedCount));
  lines.push("");
  return lines.join("\n");
}

/**
 * Run the detector.
 *
 * @param {object} opts
 * @param {string} [opts.token] — GitHub token (default: process.env.GITHUB_TOKEN)
 * @param {typeof fetch} [opts.fetchImpl] — injectable fetch (tests: zero real network)
 * @param {string} [opts.out] — optional file path for the report
 * @param {string} [opts.selfOwner] — default BellmeJoe
 * @param {boolean} [opts.silent] — if true, do not write to stdout (caller prints)
 * @returns {Promise<{ exitCode: number, report: string, result: object }>}
 */
export async function runDetector(opts = {}) {
  const token = opts.token ?? process.env.GITHUB_TOKEN ?? "";
  const fetchImpl =
    typeof opts.fetchImpl === "function" ? opts.fetchImpl : globalThis.fetch;
  const selfOwner = opts.selfOwner || DEFAULT_SELF_OWNER;
  const generatedAt = new Date().toISOString();

  const fail = (failureReason, httpStatus) => {
    const result = {
      status: "UNKNOWN",
      failureReason,
      httpStatus: httpStatus ?? null,
      selfOwner,
      generatedAt,
      retained: [],
      installs: [],
      unknownShape: [],
      excluded: [],
      totalSearchHits: 0,
    };
    const report = formatReport(result);
    return { exitCode: 1, report, result };
  };

  if (!token || !String(token).trim()) {
    const out = fail("missing GITHUB_TOKEN");
    emit(out.report, opts);
    return out;
  }

  if (typeof fetchImpl !== "function") {
    const out = fail("no fetch implementation available");
    emit(out.report, opts);
    return out;
  }

  const headers = authHeaders(String(token).trim());

  // Code search: receipt header + path. Phrase match is the countable identity.
  const q = [
    `"${RECEIPT_HEADER}"`,
    "path:.getadvantage",
    "filename:INVISIBLE-MODE.md",
  ].join(" ");
  const searchUrl = `${API}/search/code?q=${encodeURIComponent(q)}&per_page=100`;

  let searchRes;
  try {
    searchRes = await fetchImpl(searchUrl, { method: "GET", headers });
  } catch (e) {
    const out = fail(
      `network failure on code search: ${e && e.message ? e.message : e}`,
    );
    emit(out.report, opts);
    return out;
  }

  if (isFailureStatus(searchRes.status)) {
    const out = fail(
      searchRes.status === 401
        ? "auth failure (401)"
        : searchRes.status === 429
          ? "rate-limited (429)"
          : "rate-limited or forbidden (403)",
      searchRes.status,
    );
    emit(out.report, opts);
    return out;
  }

  if (!searchRes.ok) {
    const out = fail(
      `code search HTTP ${searchRes.status}`,
      searchRes.status,
    );
    emit(out.report, opts);
    return out;
  }

  let searchBody;
  try {
    searchBody = await searchRes.json();
  } catch (e) {
    const out = fail(
      `unparseable search response: ${e && e.message ? e.message : e}`,
    );
    emit(out.report, opts);
    return out;
  }

  const items = Array.isArray(searchBody.items) ? searchBody.items : [];
  const totalSearchHits =
    typeof searchBody.total_count === "number"
      ? searchBody.total_count
      : items.length;

  const retained = [];
  const installs = [];
  const unknownShape = [];
  const excluded = [];
  // Dedupe by full_name (one classification per repo).
  const seen = new Set();

  for (const item of items) {
    const repo = item.repository || {};
    const fullName =
      repo.full_name ||
      (repo.owner?.login && repo.name
        ? `${repo.owner.login}/${repo.name}`
        : null) ||
      item.repository?.full_name ||
      "?";

    if (seen.has(fullName)) continue;
    seen.add(fullName);

    let decision = shouldExcludeRepo(repo, selfOwner);

    if (decision.needsParent || (repo.fork === true && !decision.exclude)) {
      // Resolve parent via repo API when search payload lacks it.
      try {
        const repoUrl = `${API}/repos/${fullName}`;
        const repoRes = await fetchImpl(repoUrl, { method: "GET", headers });
        if (isFailureStatus(repoRes.status)) {
          const out = fail(
            repoRes.status === 401
              ? "auth failure (401) on repo lookup"
              : repoRes.status === 429
                ? "rate-limited (429) on repo lookup"
                : "rate-limited or forbidden (403) on repo lookup",
            repoRes.status,
          );
          emit(out.report, opts);
          return out;
        }
        if (repoRes.ok) {
          const full = await repoRes.json();
          decision = shouldExcludeRepo(full, selfOwner);
          // Prefer richer full_name / fork metadata for the report.
          if (full.full_name) {
            // keep fullName as-is unless empty
          }
        }
      } catch (e) {
        const out = fail(
          `network failure on repo lookup: ${e && e.message ? e.message : e}`,
        );
        emit(out.report, opts);
        return out;
      }
    }

    if (decision.exclude) {
      excluded.push({
        fullName,
        reason: decision.reason || "excluded",
      });
      continue;
    }

    // Fetch receipt content.
    const contentPath = item.path || RECEIPT_PATH;
    const contentsUrl =
      item.url ||
      `${API}/repos/${fullName}/contents/${contentPath.replace(/^\/+/, "")}`;

    let contentText = null;
    try {
      const cRes = await fetchImpl(contentsUrl, { method: "GET", headers });
      if (isFailureStatus(cRes.status)) {
        const out = fail(
          cRes.status === 401
            ? "auth failure (401) on content fetch"
            : cRes.status === 429
              ? "rate-limited (429) on content fetch"
              : "rate-limited or forbidden (403) on content fetch",
          cRes.status,
        );
        emit(out.report, opts);
        return out;
      }
      if (!cRes.ok) {
        unknownShape.push({
          fullName,
          path: contentPath,
          note: `content HTTP ${cRes.status}`,
        });
        continue;
      }
      const raw = await cRes.text();
      contentText = await decodeContentBody(cRes, raw);
      if (contentText == null) {
        unknownShape.push({
          fullName,
          path: contentPath,
          note: "unparseable content payload",
        });
        continue;
      }
    } catch (e) {
      const out = fail(
        `network failure on content fetch: ${e && e.message ? e.message : e}`,
      );
      emit(out.report, opts);
      return out;
    }

    const classification = classifyReceipt(contentText);
    const entry = {
      fullName,
      path: contentPath,
      weeks: classification.weeks || [],
      kind: classification.kind,
    };

    if (classification.kind === "retained") {
      retained.push(entry);
    } else if (classification.kind === "install") {
      installs.push(entry);
    } else {
      unknownShape.push({
        fullName,
        path: contentPath,
        note: "missing header or unparseable timestamps",
      });
    }
  }

  const result = {
    status: "ok",
    selfOwner,
    generatedAt,
    retained,
    installs,
    unknownShape,
    excluded,
    totalSearchHits,
  };
  const report = formatReport(result);
  emit(report, opts);
  return { exitCode: 0, report, result };
}

function emit(report, opts) {
  if (opts.out) {
    writeFileSync(opts.out, report, "utf8");
  }
  if (!opts.silent) {
    process.stdout.write(report.endsWith("\n") ? report : report + "\n");
  }
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) {
      out.out = argv[++i];
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      out.help = true;
    }
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(`Usage: GITHUB_TOKEN=… node ops/retained-team-detector.mjs [--out path]

Queries GitHub code search for invisible-mode receipts
(${RECEIPT_PATH}), excludes ${DEFAULT_SELF_OWNER} repos and forks of them,
classifies installs vs week-two retention, prints a dated auditable report.

Exit 0 on successful observation (including plain 0 when nothing external).
Exit 1 with UNKNOWN on auth / rate-limit / network failure.
`);
    return 0;
  }

  const { exitCode } = await runDetector({
    token: process.env.GITHUB_TOKEN,
    out: args.out || undefined,
    fetchImpl: globalThis.fetch,
  });
  return exitCode;
}

const isMain =
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  main().then((code) => process.exit(code ?? 1));
}
