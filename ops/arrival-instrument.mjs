#!/usr/bin/env node
// getAdvantage — arrival instrument (ops tooling only).
//
// Upstream counterpart to ops/retained-team-detector.mjs: this observes
// *arrival* (GitHub traffic on BellmeJoe/getadvantage-cli); the detector
// observes week-two *reuse*. No product-surface CLI, no telemetry from user
// machines — this script runs in agent-ops / owner tooling only.
//
// Reads ONLY this repository's own traffic API. Never scrapes other repos,
// never phones home from end-user machines, never implies adoption.
//
// Usage:
//   GITHUB_TOKEN=… node ops/arrival-instrument.mjs
//   GITHUB_TOKEN=… node ops/arrival-instrument.mjs --ledger path.tsv
//   GITHUB_TOKEN=… node ops/arrival-instrument.mjs --out report.txt
//
// Exit codes:
//   0  — observation succeeded (including honest zero traffic)
//   1  — UNKNOWN (auth / rate-limit / network / missing token /
//                positive-control failure / push-access 403 /
//                malformed body / ledger unwritable)
//
// Node built-ins only. ESM. Injectable `fetch` for hermetic tests.
//
// Ledger duplicate policy (idempotent per calendar day of measurement):
//   Re-running on the same UTC calendar day skips appending rows for traffic
//   days already recorded under that measurement day. History is never
//   truncated, rewritten, or reordered. A later UTC day always appends a
//   fresh block even when the traffic-day set overlaps.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_OWNER = "BellmeJoe";
export const DEFAULT_REPO = "getadvantage-cli";
export const DEFAULT_FULL_NAME = `${DEFAULT_OWNER}/${DEFAULT_REPO}`;

/**
 * World-fact positive-control code-search query.
 *
 * Why this shape (not a repo-scoped / traffic-scoped control):
 * - `filename:package.json left-pad` is a globally popular, long-lived artifact
 *   (left-pad's infamous unpublish / npm incident). Measured ~2060 hits when the
 *   GitHub code-search API is healthy — expected non-zero and stable enough that
 *   a count of 0 means "instrument broken", not "left-pad vanished".
 * - CRITICAL: do NOT use `repo:BellmeJoe/getadvantage-cli …`. Live measurement
 *   (2026-08-18, retained-team-detector) showed that repo-scoped shape returns
 *   `incomplete_results: true` even on a healthy API, which would fail-closed
 *   the instrument forever.
 * - Traffic endpoints themselves cannot be a control: they need push access and
 *   return zeros on a quiet day — a zero is a real observation, not instrument
 *   failure. Code search separates "API/token works" from "traffic is empty".
 *
 * Judged by count only (must be non-zero). Do NOT apply production traffic
 * guards to the control response.
 */
export const CONTROL_QUERY = "filename:package.json left-pad";
export const CONTROL_MIN_COUNT = 1;

/** Source column written into every ledger row. */
export const LEDGER_SOURCE = "github-traffic-api";

/** Canonical TSV header — must stay byte-compatible with the stopgap ledger. */
export const LEDGER_HEADER =
  "measured_at_utc\tsource\tday\tviews\tunique_views\tclones_14d_total\tclones_14d_uniques\ttop_referrer\treferrer_count\treferrer_uniques";

/**
 * Default ledger path: `~/agent-ops/runs/github-traffic-ledger.tsv`.
 * Extends the existing stopgap ledger in place (migrate-by-path, zero row loss)
 * rather than inventing an ops/ successor that would fork history.
 */
export function defaultLedgerPath() {
  return path.join(homedir(), "agent-ops", "runs", "github-traffic-ledger.tsv");
}

/** Per-request timeout (ms). Overall run stays well under the 30 s cold-path budget. */
export const FETCH_TIMEOUT_MS = 8_000;

/** Clone count at/above which a quiet-view day is treated as a CI-like spike. */
export const CLONE_SPIKE_MIN = 5;

/**
 * Path substrings that mark owner/self activity (not external arrival).
 * `/releases/edit/` is the live evidence from 2026-08-21 (owner editing v0.13.1).
 */
export const OWNER_PATH_MARKERS = [
  "/releases/edit/",
  "/settings",
  "/actions/runs/",
  "/edit/",
];

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

// ---------------------------------------------------------------------------
// Pure helpers (exported for hostile unit tests)
// ---------------------------------------------------------------------------

/** UTC calendar day `YYYY-MM-DD` from a Date or ISO timestamp. */
export function utcDay(input) {
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Extract `YYYY-MM-DD` from a traffic timestamp (`2026-08-20T00:00:00Z`). */
export function trafficDay(timestamp) {
  if (typeof timestamp !== "string" || timestamp.length < 10) return null;
  const day = timestamp.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * Classify a popular path as owner/self vs external.
 * @returns {{ owner: boolean, reason?: string }}
 */
export function classifyPath(pathStr) {
  const p = String(pathStr || "");
  for (const marker of OWNER_PATH_MARKERS) {
    if (p.includes(marker)) {
      return { owner: true, reason: `matches owner marker ${marker}` };
    }
  }
  return { owner: false };
}

/**
 * Decide whether a day's clone counts look CI-/self-contaminated.
 *
 * Heuristic (explicit, not magical):
 * - clones >= CLONE_SPIKE_MIN AND (views == 0 OR clones >= 2 * max(views, 1))
 *   → spike relative to human page views (CI runners clone without browsing).
 *
 * @param {{ views?: number, clones?: number }} day
 */
export function isCloneSpike(day) {
  const views = Number(day?.views) || 0;
  const clones = Number(day?.clones) || 0;
  if (clones < CLONE_SPIKE_MIN) return false;
  if (views === 0) return true;
  return clones >= 2 * views;
}

/**
 * Parse a ledger TSV into rows. A truncated/malformed line (< 10 columns)
 * is recorded (`truncatedTail`, `parseOk: false`) and **skipped** — scanning
 * continues to EOF so valid rows written after a torn line still count
 * (same-day idempotent re-runs must see them). The file is never rewritten.
 *
 * @param {string} text
 * @returns {{
 *   header: string|null,
 *   rows: object[],
 *   completeText: string,
 *   truncatedTail: string|null,
 *   parseOk: boolean
 * }}
 */
export function parseLedger(text) {
  const raw = typeof text === "string" ? text : "";
  if (!raw) {
    return {
      header: null,
      rows: [],
      completeText: "",
      truncatedTail: null,
      parseOk: true,
    };
  }

  // Split preserving whether the file ended with a newline.
  const endsWithNl = raw.endsWith("\n");
  const lines = raw.split(/\r?\n/);
  // trailing empty from final newline
  if (endsWithNl && lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }

  let header = null;
  const rows = [];
  const completeLines = [];
  let truncatedTail = null;
  let parseOk = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.startsWith("measured_at_utc")) {
      header = line;
      completeLines.push(line);
      continue;
    }
    if (!line) {
      // blank line mid-file — keep bytes by treating as complete non-row
      completeLines.push(line);
      continue;
    }
    const cols = line.split("\t");
    // A complete data row has at least the header's column count (10).
    // Fewer columns = torn/malformed line: record it, skip, keep scanning.
    // Breaking here would hide valid rows written after a crash-recovery
    // append (H-G) and make a same-day re-run duplicate history.
    if (cols.length < 10) {
      if (truncatedTail == null) truncatedTail = line;
      parseOk = false;
      continue;
    }
    const row = {
      measured_at_utc: cols[0],
      source: cols[1],
      day: cols[2],
      views: Number(cols[3]) || 0,
      unique_views: Number(cols[4]) || 0,
      clones_14d_total: Number(cols[5]) || 0,
      clones_14d_uniques: Number(cols[6]) || 0,
      top_referrer: cols[7] || "",
      referrer_count: Number(cols[8]) || 0,
      referrer_uniques: Number(cols[9]) || 0,
      _raw: line,
    };
    rows.push(row);
    completeLines.push(line);
  }

  const completeText =
    completeLines.length === 0
      ? ""
      : completeLines.join("\n") + (completeLines.length ? "\n" : "");

  return { header, rows, completeText, truncatedTail, parseOk };
}

/**
 * Set of traffic days already recorded for a given measurement UTC calendar day.
 * Used by the idempotent-per-measurement-day policy.
 */
export function recordedDaysForMeasurementDay(rows, measurementUtcDay) {
  const out = new Set();
  for (const r of rows) {
    const mDay = utcDay(r.measured_at_utc);
    if (mDay === measurementUtcDay && r.day) out.add(r.day);
  }
  return out;
}

/**
 * Name days present in a prior ledger snapshot that have fallen off the
 * current API window (permanently lost from the live endpoint).
 *
 * @param {string[]} ledgerDays — sorted unique days previously recorded
 * @param {string[]} apiDays — days present in the current API response
 */
export function lostWindowDays(ledgerDays, apiDays) {
  if (!Array.isArray(ledgerDays) || ledgerDays.length === 0) return [];
  if (!Array.isArray(apiDays) || apiDays.length === 0) {
    // If the API returned nothing, every previously known day in the rolling
    // window sense is "lost" only when it is older than the newest API gap.
    // Without an API window we cannot name losses relative to it.
    return [];
  }
  const apiSet = new Set(apiDays);
  const apiMin = [...apiDays].sort()[0];
  // A day is lost when it was in the ledger AND is strictly before the current
  // API window start AND is absent from the API response.
  return [...new Set(ledgerDays)]
    .filter((d) => d < apiMin && !apiSet.has(d))
    .sort();
}

/**
 * Build ledger row objects in memory (no I/O). Fail-closed callers append
 * only after this succeeds for the full observation.
 */
export function buildLedgerRows({
  measuredAt,
  viewsByDay,
  clonesTotal,
  clonesUniques,
  topReferrer,
}) {
  const measured = measuredAt || new Date().toISOString();
  const ref = topReferrer || {
    referrer: "",
    count: 0,
    uniques: 0,
  };
  const days = Object.keys(viewsByDay || {}).sort();
  return days.map((day) => {
    const v = viewsByDay[day] || { views: 0, uniques: 0 };
    return {
      measured_at_utc: measured,
      source: LEDGER_SOURCE,
      day,
      views: Number(v.views) || 0,
      unique_views: Number(v.uniques) || 0,
      clones_14d_total: Number(clonesTotal) || 0,
      clones_14d_uniques: Number(clonesUniques) || 0,
      top_referrer: ref.referrer || "",
      referrer_count: Number(ref.count) || 0,
      referrer_uniques: Number(ref.uniques) || 0,
    };
  });
}

/**
 * Replace TSV-breaking control characters in one field.
 * Tabs/newlines in API-supplied text (e.g. `top_referrer`) would otherwise
 * forge extra ledger rows. Visible placeholders keep the value inspectable.
 */
export function sanitizeTsvField(value) {
  const s = value == null ? "" : String(value);
  return s.replace(/[\u0000-\u001F\u007F]/g, (ch) => {
    if (ch === "\t") return "\\t";
    if (ch === "\n") return "\\n";
    if (ch === "\r") return "\\r";
    const hex = ch.charCodeAt(0).toString(16).padStart(2, "0");
    return `\\x${hex}`;
  });
}

/** Serialise one ledger row to a TSV line (no trailing newline). */
export function formatLedgerRow(row) {
  return [
    sanitizeTsvField(row.measured_at_utc),
    sanitizeTsvField(row.source || LEDGER_SOURCE),
    sanitizeTsvField(row.day),
    sanitizeTsvField(String(row.views ?? 0)),
    sanitizeTsvField(String(row.unique_views ?? 0)),
    sanitizeTsvField(String(row.clones_14d_total ?? 0)),
    sanitizeTsvField(String(row.clones_14d_uniques ?? 0)),
    sanitizeTsvField(row.top_referrer ?? ""),
    sanitizeTsvField(String(row.referrer_count ?? 0)),
    sanitizeTsvField(String(row.referrer_uniques ?? 0)),
  ].join("\t");
}

/**
 * Strip token material from a string that will be reflected into the report
 * (stdout / `--out`). Named causes stay intact.
 *
 * Covers: `Bearer <...>`, `gh[pousr]_` / `github_pat_` shapes, and the
 * token value itself when provided.
 */
export function redactReflectedMessage(message, token) {
  let s = message == null ? "" : String(message);
  s = s.replace(/\bBearer\s+[A-Za-z0-9._\-+/=]+/gi, "Bearer [REDACTED]");
  s = s.replace(/\bgh[pousr]_[A-Za-z0-9_]+/g, "[REDACTED]");
  s = s.replace(/\bgithub_pat_[A-Za-z0-9_]+/g, "[REDACTED]");
  const t = token == null ? "" : String(token).trim();
  if (t.length >= 8) {
    s = s.split(t).join("[REDACTED]");
  }
  return s;
}

/**
 * Compute the bytes to append. Pure: never touches the filesystem.
 * Returns `{ appendText, skippedDays, newRows }` where appendText is "" when
 * every candidate row is already recorded for this measurement UTC day.
 */
export function planLedgerAppend({ existingText, newRows, measuredAt }) {
  const parsed = parseLedger(existingText || "");
  const measurementDay = utcDay(measuredAt);
  const already = recordedDaysForMeasurementDay(parsed.rows, measurementDay);
  const toWrite = [];
  const skippedDays = [];
  for (const row of newRows) {
    if (already.has(row.day)) {
      skippedDays.push(row.day);
      continue;
    }
    toWrite.push(row);
  }

  let appendText = "";
  const needsHeader = !parsed.header;
  if (needsHeader && toWrite.length > 0) {
    appendText += LEDGER_HEADER + "\n";
  } else if (needsHeader && toWrite.length === 0 && !(existingText || "").trim()) {
    // Brand-new empty ledger with nothing to write yet — still create header
    // so H-F (missing file) leaves a valid empty ledger behind when the
    // observation itself succeeded with zero traffic days (degenerate).
    appendText += LEDGER_HEADER + "\n";
  }

  // If the file ended mid-row (truncatedTail), we must NOT destroy prior bytes.
  // Append after a newline if the surviving completeText does not already end
  // with one, so the new block starts on a fresh line. The truncated tail stays
  // on disk untouched (we never rewrite).
  if (toWrite.length > 0) {
    for (const row of toWrite) {
      appendText += formatLedgerRow(row) + "\n";
    }
  }

  return {
    appendText,
    skippedDays,
    newRows: toWrite,
    parseOk: parsed.parseOk,
    truncatedTail: parsed.truncatedTail,
    completeText: parsed.completeText,
    needsHeader,
  };
}

/**
 * Fail-closed append. Computes the plan, then writes ONLY via appendFileSync
 * (or create-with-header). Never truncates. Never rewrites prior bytes.
 *
 * H-G: when the file has a truncated mid-row, prior complete bytes survive
 * because we only append; we never open with "w".
 *
 * @returns {{ appended: number, skippedDays: string[], created: boolean }}
 */
export function appendLedgerFailClosed(ledgerPath, newRows, measuredAt) {
  const abs = path.resolve(ledgerPath);
  mkdirSync(path.dirname(abs), { recursive: true });

  let existingText = "";
  let created = false;
  if (!existsSync(abs)) {
    created = true;
    existingText = "";
  } else {
    // Refuse to destroy a read-only / unwritable file (H-H): probe writability
    // before computing the append so a failure leaves bytes untouched.
    try {
      const st = statSync(abs);
      // On Windows, chmod bits are advisory; the real probe is open-append.
      // We still surface a clear error if the subsequent append throws.
      void st;
      existingText = readFileSync(abs, "utf8");
    } catch (e) {
      const err = new Error(
        `ledger unreadable: ${e && e.message ? e.message : e}`,
      );
      err.code = "LEDGER_UNREADABLE";
      throw err;
    }
  }

  const plan = planLedgerAppend({
    existingText,
    newRows,
    measuredAt,
  });

  if (!plan.appendText) {
    return { appended: 0, skippedDays: plan.skippedDays, created: false };
  }

  try {
    if (created || !existsSync(abs)) {
      writeFileSync(abs, plan.appendText, { encoding: "utf8", flag: "wx" });
      created = true;
    } else {
      // If the surviving file does not end with a newline and we have a
      // truncated mid-row, insert a leading newline so new rows don't glue
      // onto the broken tail — prior bytes remain byte-identical.
      let payload = plan.appendText;
      if (
        existingText.length > 0 &&
        !existingText.endsWith("\n") &&
        !payload.startsWith("\n")
      ) {
        payload = "\n" + payload;
      }
      appendFileSync(abs, payload, "utf8");
    }
  } catch (e) {
    if (e && (e.code === "EACCES" || e.code === "EPERM" || e.code === "EROFS")) {
      const err = new Error(
        `ledger unwritable (read-only or permission denied): ${abs}`,
      );
      err.code = "LEDGER_UNWRITABLE";
      throw err;
    }
    if (e && e.code === "EEXIST") {
      // Race: file appeared between exists check and wx create — fall through
      // to append.
      try {
        appendFileSync(abs, plan.appendText, "utf8");
        created = false;
      } catch (e2) {
        const err = new Error(
          `ledger append failed: ${e2 && e2.message ? e2.message : e2}`,
        );
        err.code = "LEDGER_UNWRITABLE";
        throw err;
      }
    } else {
      const err = new Error(
        `ledger write failed: ${e && e.message ? e.message : e}`,
      );
      err.code = "LEDGER_UNWRITABLE";
      throw err;
    }
  }

  return {
    appended: plan.newRows.length,
    skippedDays: plan.skippedDays,
    created,
  };
}

/**
 * Build the dated auditable report string.
 * Never implies adoption / retained teams / installs.
 */
export function formatReport(result) {
  const lines = [];
  const generated = result.generatedAt || new Date().toISOString();

  if (result.status === "UNKNOWN") {
    const reason = result.failureReason || "unknown";
    lines.push("# getAdvantage arrival-instrument report");
    lines.push(`# generated: ${generated}`);
    lines.push(`# repo: ${result.fullName || DEFAULT_FULL_NAME}`);
    lines.push("");
    lines.push("UNKNOWN");
    lines.push("");
    lines.push("## Failure");
    lines.push(`- reason: ${reason}`);
    if (result.httpStatus != null) lines.push(`- httpStatus: ${result.httpStatus}`);
    lines.push("");
    const reasonLower = String(reason).toLowerCase();
    if (/missing.*github_token|github_token/.test(reasonLower) && /missing/.test(reasonLower)) {
      lines.push(
        "This is not an arrival observation of 0. Missing GITHUB_TOKEN prevented",
      );
      lines.push("any observation.");
    } else if (/push access|403/.test(reasonLower)) {
      lines.push(
        "This is not an arrival observation of 0. Traffic endpoints require push",
      );
      lines.push("access on the repository; this token was refused (403).");
    } else if (
      /positive.?control|control query|control search|control returned|instrument/i.test(
        reason,
      )
    ) {
      lines.push(
        "This is not an arrival observation of 0. Instrument failure (positive",
      );
      lines.push("control) prevented a reliable observation.");
    } else {
      lines.push(
        "This is not an arrival observation of 0. Auth, rate-limit, network,",
      );
      lines.push("malformed body, or ledger failure prevented a reliable observation.");
    }
    lines.push("");
    return lines.join("\n");
  }

  const controlLine =
    result.controlTotalCount != null
      ? `# positive-control-total-count: ${result.controlTotalCount}`
      : null;

  const viewsTotal = result.viewsTotal ?? 0;
  const viewsUniques = result.viewsUniques ?? 0;
  const clonesTotal = result.clonesTotal ?? 0;
  const clonesUniques = result.clonesUniques ?? 0;
  const honestZero =
    viewsTotal === 0 &&
    viewsUniques === 0 &&
    clonesTotal === 0 &&
    clonesUniques === 0;

  if (honestZero) {
    lines.push("0");
    lines.push("");
    lines.push("# getAdvantage arrival-instrument report");
    lines.push(`# generated: ${generated}`);
    lines.push(`# repo: ${result.fullName || DEFAULT_FULL_NAME}`);
    lines.push("# status: ok — honest zero traffic in the current window");
    lines.push("# retained-external-teams: 0 (unchanged; this tool does not measure reuse)");
    if (controlLine) lines.push(controlLine);
    lines.push("");
    lines.push(
      "Zero is the real number. This is not adoption, not retained teams, and",
    );
    lines.push("not an instrument failure.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("# getAdvantage arrival-instrument report");
  lines.push(`# generated: ${generated}`);
  lines.push(`# repo: ${result.fullName || DEFAULT_FULL_NAME}`);
  lines.push("# status: ok");
  lines.push(
    "# retained-external-teams: 0 (unchanged; this tool measures arrival, not reuse)",
  );
  if (controlLine) lines.push(controlLine);
  lines.push("");

  lines.push("## Plausible human views (not users, not adopters)");
  lines.push(
    `- views (14d total): ${viewsTotal}  unique viewers (plausible humans looking): ${viewsUniques}`,
  );
  lines.push(
    "- These are page-view signals only. They are not installs, not retained",
  );
  lines.push(
    "  teams, and not adoption. Retained external teams remain 0 until the",
  );
  lines.push("  retained-team-detector says otherwise.");
  lines.push("");

  lines.push("## Clones — CI-CONTAMINATED (do not quote as arrival)");
  lines.push(
    `- clones (14d total): ${clonesTotal}  unique cloners: ${clonesUniques}`,
  );
  lines.push(
    "- Raw clone counts are contaminated by this repository's own CI runners",
  );
  lines.push(
    "  and release workflows. They must never be reported as human arrival.",
  );
  if (Array.isArray(result.cloneSpikes) && result.cloneSpikes.length) {
    lines.push("- CI-like clone spike days (clones ≫ views):");
    for (const s of result.cloneSpikes) {
      lines.push(
        `  - ${s.day}: clones=${s.clones} views=${s.views} (${s.reason || "spike"})`,
      );
    }
  } else {
    lines.push("- No per-day clone spike crossed the heuristic threshold this window.");
  }
  lines.push("");

  if (Array.isArray(result.referrers) && result.referrers.length) {
    lines.push("## Referrers (top, 14d)");
    for (const r of result.referrers) {
      lines.push(
        `- ${r.referrer || "(empty)"}: count=${r.count ?? 0} uniques=${r.uniques ?? 0}`,
      );
    }
    lines.push("");
  }

  if (Array.isArray(result.paths) && result.paths.length) {
    lines.push("## Popular paths (top, 14d)");
    for (const p of result.paths) {
      const cls = classifyPath(p.path);
      const tag = cls.owner ? `  [OWNER/SELF — ${cls.reason}]` : "";
      lines.push(
        `- ${p.path}: count=${p.count ?? 0} uniques=${p.uniques ?? 0}${tag}`,
      );
    }
    lines.push("");
  }

  if (Array.isArray(result.lostDays) && result.lostDays.length) {
    lines.push("## Lost window days (fallen off the live 14-day API)");
    lines.push(
      "- These days survive only in the append-only ledger. The live endpoint",
    );
    lines.push("  no longer returns them:");
    for (const d of result.lostDays) {
      lines.push(`  - ${d}`);
    }
    lines.push("");
  } else {
    lines.push("## Lost window days");
    lines.push("- None named this run (ledger empty or window has not advanced).");
    lines.push("");
  }

  if (result.ledger) {
    lines.push("## Ledger");
    lines.push(`- path: ${result.ledger.path}`);
    lines.push(`- appended rows: ${result.ledger.appended ?? 0}`);
    if (result.ledger.skippedDays?.length) {
      lines.push(
        `- skipped (same UTC measurement day, idempotent): ${result.ledger.skippedDays.join(", ")}`,
      );
    }
    if (result.ledger.created) lines.push("- created new ledger file (header written)");
    lines.push("");
  }

  if (result.controlTotalCount != null) {
    lines.push("## Positive control");
    lines.push(
      `- query: ${JSON.stringify(CONTROL_QUERY)}  total_count: ${result.controlTotalCount}`,
    );
    lines.push("");
  }

  lines.push(
    "# reminder: retained-external-teams is 0 — this report must not be read as adoption",
  );
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Network + orchestration
// ---------------------------------------------------------------------------

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "getadvantage-arrival-instrument",
  };
}

function isFailureStatus(status) {
  return status === 401 || status === 403 || status === 429;
}

/**
 * Bounded fetch with AbortController. Rejects on timeout so H-D cannot hang.
 *
 * Races the abort signal explicitly: a fetchImpl that ignores `signal` (hostile
 * hang mock) still loses to the timer. Native fetch that respects signal also
 * works — whichever settles first wins.
 */
export async function fetchWithTimeout(fetchImpl, url, init, timeoutMs = FETCH_TIMEOUT_MS) {
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : FETCH_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const merged = { ...(init || {}), signal: ctrl.signal };
    const fetchPromise = Promise.resolve().then(() => fetchImpl(url, merged));
    const abortPromise = new Promise((_, reject) => {
      const rejectAbort = () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      };
      if (ctrl.signal.aborted) {
        rejectAbort();
        return;
      }
      ctrl.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    return await Promise.race([fetchPromise, abortPromise]);
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonOrThrow(res, label) {
  let text;
  try {
    text = await res.text();
  } catch (e) {
    const err = new Error(
      `${label}: failed reading body: ${e && e.message ? e.message : e}`,
    );
    err.code = "MALFORMED_BODY";
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error(
      `${label}: truncated/malformed JSON: ${e && e.message ? e.message : e}`,
    );
    err.code = "MALFORMED_BODY";
    throw err;
  }
}

/**
 * Run the arrival instrument.
 *
 * Fail-closed ledger rule: every network response is collected and every
 * candidate row is computed in memory first. The ledger is touched ONLY after
 * the full observation succeeds. A mid-fetch failure leaves the ledger
 * byte-identical to its prior state (no partial rows).
 *
 * @param {object} opts
 * @param {string} [opts.token]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {string} [opts.ledgerPath]
 * @param {string} [opts.out]
 * @param {string} [opts.owner]
 * @param {string} [opts.repo]
 * @param {boolean} [opts.silent]
 * @param {boolean} [opts.dryLedger] — compute plan but do not write (tests)
 * @param {number} [opts.timeoutMs]
 * @param {string|Date} [opts.now] — injectable clock for idempotency tests
 * @returns {Promise<{ exitCode: number, report: string, result: object }>}
 */
export async function runArrival(opts = {}) {
  const token = opts.token ?? process.env.GITHUB_TOKEN ?? "";
  const fetchImpl =
    typeof opts.fetchImpl === "function" ? opts.fetchImpl : globalThis.fetch;
  const owner = opts.owner || DEFAULT_OWNER;
  const repo = opts.repo || DEFAULT_REPO;
  const fullName = `${owner}/${repo}`;
  const ledgerPath = opts.ledgerPath || defaultLedgerPath();
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const generatedAt = opts.now
    ? new Date(opts.now).toISOString()
    : new Date().toISOString();

  const fail = (failureReason, httpStatus, extra = {}) => {
    const result = {
      status: "UNKNOWN",
      failureReason: redactReflectedMessage(failureReason, token),
      httpStatus: httpStatus ?? null,
      fullName,
      generatedAt,
      ...extra,
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

  // -------------------------------------------------------------------------
  // Positive control FIRST (same session / same API / same token).
  // Count-only. A failing control is never rescued by traffic data.
  // -------------------------------------------------------------------------
  const controlUrl = `${API}/search/code?q=${encodeURIComponent(CONTROL_QUERY)}&per_page=1`;

  let controlRes;
  try {
    controlRes = await fetchWithTimeout(
      fetchImpl,
      controlUrl,
      { method: "GET", headers },
      timeoutMs,
    );
  } catch (e) {
    const msg = e && e.name === "AbortError"
      ? `positive-control search timed out after ${timeoutMs}ms`
      : `positive-control search network failure: ${e && e.message ? e.message : e}`;
    const out = fail(msg);
    emit(out.report, opts);
    return out;
  }

  if (isFailureStatus(controlRes.status)) {
    const out = fail(
      controlRes.status === 401
        ? "positive-control search auth failure (401)"
        : controlRes.status === 429
          ? "positive-control search rate-limited (429)"
          : "positive-control search rate-limited or forbidden (403)",
      controlRes.status,
    );
    emit(out.report, opts);
    return out;
  }

  if (!controlRes.ok) {
    const out = fail(
      `positive-control search HTTP ${controlRes.status}`,
      controlRes.status,
    );
    emit(out.report, opts);
    return out;
  }

  let controlBody;
  try {
    controlBody = await readJsonOrThrow(controlRes, "positive-control");
  } catch (e) {
    const out = fail(e.message || "positive-control malformed body");
    emit(out.report, opts);
    return out;
  }

  const controlCount =
    typeof controlBody?.total_count === "number"
      ? controlBody.total_count
      : Array.isArray(controlBody?.items)
        ? controlBody.items.length
        : 0;

  if (!(controlCount >= CONTROL_MIN_COUNT)) {
    const out = fail(
      `positive-control search returned ${controlCount} hits (expected ≥${CONTROL_MIN_COUNT} for query ${JSON.stringify(CONTROL_QUERY)}); instrument unusable — refusing to report arrival`,
    );
    emit(out.report, opts);
    return out;
  }

  // -------------------------------------------------------------------------
  // Traffic endpoints — collect ALL four in memory before any ledger write.
  // Mid-fetch failure → exit 1, ledger untouched (fail-closed).
  // -------------------------------------------------------------------------
  const trafficBase = `${API}/repos/${owner}/${repo}/traffic`;
  const endpoints = [
    { key: "views", url: `${trafficBase}/views?per=day` },
    { key: "clones", url: `${trafficBase}/clones?per=day` },
    { key: "referrers", url: `${trafficBase}/popular/referrers` },
    { key: "paths", url: `${trafficBase}/popular/paths` },
  ];

  /** @type {Record<string, any>} */
  const payloads = {};

  for (const ep of endpoints) {
    let res;
    try {
      res = await fetchWithTimeout(
        fetchImpl,
        ep.url,
        { method: "GET", headers },
        timeoutMs,
      );
    } catch (e) {
      const msg =
        e && e.name === "AbortError"
          ? `traffic/${ep.key} timed out after ${timeoutMs}ms`
          : `network failure on traffic/${ep.key}: ${e && e.message ? e.message : e}`;
      const out = fail(msg);
      emit(out.report, opts);
      return out;
    }

    if (res.status === 403) {
      const out = fail(
        "traffic API 403: this needs push access on the repo (traffic endpoints require it)",
        403,
      );
      emit(out.report, opts);
      return out;
    }

    if (res.status === 401) {
      const out = fail("traffic API auth failure (401)", 401);
      emit(out.report, opts);
      return out;
    }

    if (res.status === 429) {
      const out = fail("traffic API rate-limited (429)", 429);
      emit(out.report, opts);
      return out;
    }

    if (!res.ok) {
      const out = fail(
        `traffic/${ep.key} HTTP ${res.status}`,
        res.status,
      );
      emit(out.report, opts);
      return out;
    }

    try {
      payloads[ep.key] = await readJsonOrThrow(res, `traffic/${ep.key}`);
    } catch (e) {
      const out = fail(e.message || `traffic/${ep.key} malformed body`);
      emit(out.report, opts);
      return out;
    }
  }

  // -------------------------------------------------------------------------
  // All fetches succeeded — compute rows + report in memory, THEN append.
  // -------------------------------------------------------------------------
  const viewsBody = payloads.views || {};
  const clonesBody = payloads.clones || {};
  const referrers = Array.isArray(payloads.referrers) ? payloads.referrers : [];
  const paths = Array.isArray(payloads.paths) ? payloads.paths : [];

  const viewsArr = Array.isArray(viewsBody.views) ? viewsBody.views : [];
  const clonesArr = Array.isArray(clonesBody.clones) ? clonesBody.clones : [];

  const viewsByDay = {};
  for (const v of viewsArr) {
    const day = trafficDay(v.timestamp);
    if (!day) continue;
    viewsByDay[day] = {
      views: Number(v.count) || 0,
      uniques: Number(v.uniques) || 0,
    };
  }
  // Ensure clone-only days still appear in the ledger window.
  for (const c of clonesArr) {
    const day = trafficDay(c.timestamp);
    if (!day) continue;
    if (!viewsByDay[day]) viewsByDay[day] = { views: 0, uniques: 0 };
  }

  const clonesByDay = {};
  for (const c of clonesArr) {
    const day = trafficDay(c.timestamp);
    if (!day) continue;
    clonesByDay[day] = {
      clones: Number(c.count) || 0,
      uniques: Number(c.uniques) || 0,
    };
  }

  const cloneSpikes = [];
  for (const day of Object.keys(viewsByDay).sort()) {
    const views = viewsByDay[day]?.views || 0;
    const clones = clonesByDay[day]?.clones || 0;
    if (isCloneSpike({ views, clones })) {
      cloneSpikes.push({
        day,
        views,
        clones,
        reason: views === 0
          ? `clones=${clones} with zero views (CI/self likely)`
          : `clones=${clones} >= 2× views=${views}`,
      });
    }
  }

  const viewsTotal =
    typeof viewsBody.count === "number"
      ? viewsBody.count
      : Object.values(viewsByDay).reduce((s, v) => s + (v.views || 0), 0);
  const viewsUniques =
    typeof viewsBody.uniques === "number"
      ? viewsBody.uniques
      : null; // API provides window uniques; do not sum daily uniques
  const viewsUniquesOut =
    viewsUniques != null
      ? viewsUniques
      : Object.values(viewsByDay).reduce((s, v) => s + (v.uniques || 0), 0);

  const clonesTotal =
    typeof clonesBody.count === "number"
      ? clonesBody.count
      : Object.values(clonesByDay).reduce((s, v) => s + (v.clones || 0), 0);
  const clonesUniques =
    typeof clonesBody.uniques === "number"
      ? clonesBody.uniques
      : Object.values(clonesByDay).reduce((s, v) => s + (v.uniques || 0), 0);

  const topReferrer = referrers[0] || {
    referrer: "",
    count: 0,
    uniques: 0,
  };

  const newRows = buildLedgerRows({
    measuredAt: generatedAt,
    viewsByDay,
    clonesTotal,
    clonesUniques,
    topReferrer,
  });

  // Lost window: compare prior ledger days against current API days.
  let lostDays = [];
  let existingText = "";
  try {
    if (existsSync(ledgerPath)) {
      existingText = readFileSync(ledgerPath, "utf8");
      const parsed = parseLedger(existingText);
      const ledgerDays = parsed.rows.map((r) => r.day).filter(Boolean);
      const apiDays = Object.keys(viewsByDay);
      lostDays = lostWindowDays(ledgerDays, apiDays);
    }
  } catch {
    // Unreadable ledger is handled at append time; lost-day naming is best-effort.
  }

  let ledgerMeta = {
    path: ledgerPath,
    appended: 0,
    skippedDays: [],
    created: false,
  };

  if (!opts.dryLedger) {
    try {
      const writeResult = appendLedgerFailClosed(
        ledgerPath,
        newRows,
        generatedAt,
      );
      ledgerMeta = {
        path: ledgerPath,
        appended: writeResult.appended,
        skippedDays: writeResult.skippedDays,
        created: writeResult.created,
      };
    } catch (e) {
      const reason =
        e && e.code === "LEDGER_UNWRITABLE"
          ? e.message
          : e && e.code === "LEDGER_UNREADABLE"
            ? e.message
            : `ledger write failed: ${e && e.message ? e.message : e}`;
      const out = fail(reason);
      emit(out.report, opts);
      return out;
    }
  } else {
    const plan = planLedgerAppend({
      existingText,
      newRows,
      measuredAt: generatedAt,
    });
    ledgerMeta = {
      path: ledgerPath,
      appended: plan.newRows.length,
      skippedDays: plan.skippedDays,
      created: plan.needsHeader,
      dry: true,
    };
  }

  const result = {
    status: "ok",
    fullName,
    generatedAt,
    controlTotalCount: controlCount,
    viewsTotal,
    viewsUniques: viewsUniquesOut,
    clonesTotal,
    clonesUniques,
    cloneSpikes,
    referrers,
    paths,
    lostDays,
    ledger: ledgerMeta,
    viewsByDay,
    clonesByDay,
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
  const out = { out: null, ledger: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) {
      out.out = argv[++i];
    } else if (argv[i] === "--ledger" && argv[i + 1]) {
      out.ledger = argv[++i];
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      out.help = true;
    }
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(`Usage: GITHUB_TOKEN=… node ops/arrival-instrument.mjs [--ledger path] [--out path]

Reads GitHub traffic for ${DEFAULT_FULL_NAME} ONLY
(traffic/views, traffic/clones, traffic/popular/referrers, traffic/popular/paths).

What it reads:
  - This repository's own traffic API (requires push access on the token).
  - A world-fact positive-control code-search query (${JSON.stringify(CONTROL_QUERY)}).

What it never reads:
  - Other repositories' traffic.
  - End-user machines (no telemetry, no product-surface network).
  - Anything that would imply adoption or retained teams.

Append-only ledger (default: ~/agent-ops/runs/github-traffic-ledger.tsv):
  Idempotent per UTC calendar day of measurement — same-day re-runs skip
  rewriting prior rows for those traffic days. History is never truncated.

Exit 0 on successful observation (including honest zero traffic).
Exit 1 with UNKNOWN on auth / rate-limit / network / positive-control /
push-access 403 / malformed body / ledger failure.
`);
    return 0;
  }

  const { exitCode } = await runArrival({
    token: process.env.GITHUB_TOKEN,
    out: args.out || undefined,
    ledgerPath: args.ledger || undefined,
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
