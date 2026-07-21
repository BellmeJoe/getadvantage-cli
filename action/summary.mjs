// getAdvantage Action — PR / job summary helpers (dependency-free).
//
// Stable marker + update-in-place so reruns do not spam duplicate comments.
// All user- and finding-derived text is sanitized and redacted before emit.
// Comment lookup paginates with a safe cap and updates only bot-owned markers
// (spoofed user markers are ignored — never PATCH 403'd into a fallback loop).
// Node built-ins only. ESM. Safe to import from tests without GitHub env.

import { appendFileSync as defaultAppendFileSync } from "node:fs";
import { redactForSarif } from "../sarif.mjs";

/** Hidden HTML comment marker — do not change without a migration plan. */
export const PR_SUMMARY_MARKER = "<!-- getadvantage:pr-summary -->";

/** Max length of a single finding line in the summary. */
const LINE_CAP = 240;
/** Max failing/warning checks listed. */
const CHECK_CAP = 12;
/** Comments per page when listing issue comments. */
export const COMMENT_PAGE_SIZE = 100;
/** Safe cap on list pages (prevents unbounded API walk). */
export const COMMENT_PAGE_CAP = 10;

/**
 * Strip C0 control characters, neutralize Markdown images / raw HTML /
 * @mentions / unsafe URIs, break HTML-comment escape sequences, and run the
 * central credential redactor.
 */
export function sanitizeSummaryText(text) {
  let s = String(text ?? "");
  // Remove C0 controls except \t \n \r — then normalize newlines.
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  s = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Collapse runaway newlines so a finding cannot pad the comment indefinitely.
  s = s.replace(/\n{3,}/g, "\n\n");
  // Break nested HTML comment terminators / openers that could escape the marker.
  s = s.replace(/-->/g, "—>");
  s = s.replace(/<!--/g, "<ǃ--");
  // Neutralize raw HTML tags (keep text content roughly readable).
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  // Neutralize Markdown images that could load remote content (inline form).
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Neutralize reference-style Markdown images: ![alt][ref]
  s = s.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1");
  // Drop reference definitions that could bind image/link targets
  // (e.g. `[ref]: https://evil.test/x.png` or `[ref]: javascript:…`).
  s = s.replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S[^\n]*$/gm, "");
  // Neutralize Markdown links (keep label text only — no remote fetch / clickbait).
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Neutralize unsafe URI schemes in remaining prose.
  s = s.replace(/\b(?:javascript|data|vbscript):[^\s)]+/gi, "[uri omitted]");
  // Neutralize @mentions so finding text cannot notify random users.
  s = s.replace(/(^|[^A-Za-z0-9_])@([A-Za-z0-9-]{1,39})\b/g, "$1＠$2");
  s = redactForSarif(s);
  return s;
}

/**
 * Whether a path would change under redaction (credential-shaped filename).
 * When true, the path must be omitted — never emit a fake redacted path.
 */
export function isUnsafePathForSummary(filePath) {
  if (!filePath || typeof filePath !== "string") return true;
  if (/[\u0000-\u001F\u007F]/.test(filePath)) return true;
  const red = redactForSarif(filePath);
  return red !== filePath;
}

/**
 * Build the Markdown body for a PR comment or job summary.
 * Never includes full secrets, source dumps, or credential-shaped filenames.
 *
 * @param {object} o
 * @param {"GO"|"NO-GO"|"ERROR"} o.verdict
 * @param {number} o.exitCode
 * @param {Array} [o.checks] check objects from --json
 * @param {string} [o.version]
 * @param {string} [o.runUrl]
 * @param {string} [o.sarifNote]
 * @param {boolean} [o.includeMarker=true]
 */
export function buildSummaryMarkdown(o) {
  const verdict = o.verdict === "GO" || o.verdict === "NO-GO" || o.verdict === "ERROR" ? o.verdict : "ERROR";
  const exitCode = typeof o.exitCode === "number" ? o.exitCode : 1;
  const version = sanitizeSummaryText(o.version || "").slice(0, 32);
  const runUrl = typeof o.runUrl === "string" && /^https:\/\/github\.com\//.test(o.runUrl) ? o.runUrl : "";
  const checks = Array.isArray(o.checks) ? o.checks : [];
  const includeMarker = o.includeMarker !== false;

  const lines = [];
  if (includeMarker) lines.push(PR_SUMMARY_MARKER);
  lines.push("### getAdvantage check");
  lines.push("");
  lines.push(`**${verdict}** · exit \`${exitCode}\`${version ? ` · CLI \`${version}\`` : ""}`);
  lines.push("");

  const interesting = checks.filter((c) => c && (c.status === "fail" || c.status === "warn"));
  if (interesting.length === 0) {
    if (verdict === "GO") {
      lines.push("All applicable blocking checks clear.");
    } else if (verdict === "ERROR") {
      lines.push("Action or gate setup failed — this is **not** a GO.");
    } else {
      lines.push("Gate returned NO-GO (see workflow logs / code scanning).");
    }
  } else {
    lines.push("| Status | Check | Detail |");
    lines.push("| --- | --- | --- |");
    let n = 0;
    for (const c of interesting) {
      if (n >= CHECK_CAP) {
        lines.push(`| … | … | +${interesting.length - CHECK_CAP} more (see logs) |`);
        break;
      }
      const status = c.status === "fail" ? "FAIL" : "WARN";
      const label = sanitizeSummaryText(c.label || "check").slice(0, 80);
      let detail = sanitizeSummaryText(c.detail || "").slice(0, LINE_CAP);
      // Prefer a single structured finding path when safe (no credential-shaped names).
      const f0 = Array.isArray(c.findings) && c.findings[0] ? c.findings[0] : null;
      if (f0) {
        const parts = [];
        if (f0.file && !isUnsafePathForSummary(f0.file)) {
          parts.push(sanitizeSummaryText(f0.file).slice(0, 120));
        } else if (f0.file && isUnsafePathForSummary(f0.file)) {
          parts.push("(path omitted — credential-shaped name)");
        }
        if (f0.fp) parts.push(sanitizeSummaryText(f0.fp).slice(0, 80));
        if (f0.message) parts.push(sanitizeSummaryText(f0.message).slice(0, 120));
        if (parts.length) detail = parts.join(" · ").slice(0, LINE_CAP);
      }
      // Escape pipes so table cells cannot break markdown structure.
      const esc = (t) => String(t).replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(`| ${status} | ${esc(label)} | ${esc(detail)} |`);
      n += 1;
    }
  }

  lines.push("");
  if (o.sarifNote) {
    lines.push(sanitizeSummaryText(o.sarifNote).slice(0, 300));
    lines.push("");
  }
  lines.push(
    "_Same gate as local `getadvantage check`. Not a security seal. Private code scanning needs GitHub Code Security + `actions: read`._",
  );
  if (runUrl) {
    lines.push("");
    lines.push(`[Workflow run](${runUrl})`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Narrowly known default Actions bot identity (never arbitrary `[bot]` accounts). */
export const ACTIONS_BOT_LOGIN = "github-actions[bot]";

/**
 * True when a login is the narrowly known Actions bot.
 * Used only for optional actorLogin overrides — never treats a human
 * GITHUB_ACTOR or an unrelated `something[bot]` as ownership authority.
 */
export function isVerifiedBotLogin(login) {
  if (!login || typeof login !== "string") return false;
  return login === ACTIONS_BOT_LOGIN;
}

/**
 * True when a comment is owned by the authenticated token identity.
 * Spoofed human markers and unrelated bots must never be patched — even when
 * GITHUB_ACTOR matches a human login (common on pull_request).
 *
 * Ownership rules:
 *   1. Exact match to the resolved authenticated token login (from GET /user), or
 *   2. When no token identity was resolved, only github-actions[bot].
 * Never: human GITHUB_ACTOR, arbitrary `[bot]` accounts.
 *
 * @param {{user?: {login?: string, type?: string}, body?: string}} comment
 * @param {string} [tokenBotLogin] resolved authenticated token /user login only
 */
export function isBotOwnedMarkerComment(comment, tokenBotLogin) {
  if (!comment || typeof comment.body !== "string") return false;
  if (!comment.body.includes(PR_SUMMARY_MARKER)) return false;
  const login = comment.user?.login || "";
  if (!login) return false;
  // Explicit human User type is never an ownership match.
  if (comment.user?.type === "User") return false;
  const owner = tokenBotLogin && String(tokenBotLogin).trim() ? String(tokenBotLogin).trim() : ACTIONS_BOT_LOGIN;
  // Exact identity only — do not accept arbitrary [bot] accounts.
  return login === owner;
}

/**
 * Find the first bot-owned marker comment (ignores spoofed human markers).
 * @param {Array} comments
 * @param {string} [actorLogin]
 * @returns {{id:number,body:string,user?:object}|null}
 */
export function findMarkerComment(comments, actorLogin) {
  if (!Array.isArray(comments)) return null;
  for (const c of comments) {
    if (isBotOwnedMarkerComment(c, actorLogin)) {
      return { id: c.id, body: c.body, user: c.user };
    }
  }
  return null;
}

/**
 * List issue comments with pagination up to COMMENT_PAGE_CAP pages.
 * When the final page at the cap is still full, sets truncated=true — callers
 * must not POST a new marker (lookup is ambiguous; fall back to job summary).
 * @returns {Promise<{ok:boolean, comments?:Array, truncated?:boolean, reason?:string}>}
 */
export async function listIssueCommentsPaginated(o) {
  const fetchImpl = o.fetchImpl;
  const headers = o.headers;
  const apiBase = o.apiBase;
  const owner = o.owner;
  const repo = o.repo;
  const issue = o.issue;
  const all = [];
  let truncated = false;
  for (let page = 1; page <= COMMENT_PAGE_CAP; page++) {
    let listRes;
    try {
      listRes = await fetchImpl(
        `${apiBase}/repos/${owner}/${repo}/issues/${issue}/comments?per_page=${COMMENT_PAGE_SIZE}&page=${page}`,
        { method: "GET", headers },
      );
    } catch (e) {
      return { ok: false, reason: `list-error:${e.message || e}` };
    }
    if (listRes.status === 401 || listRes.status === 403) {
      return { ok: false, reason: `permission:${listRes.status}` };
    }
    if (!listRes.ok) {
      return { ok: false, reason: `list-http:${listRes.status}` };
    }
    let batch;
    try {
      batch = await listRes.json();
    } catch {
      return { ok: false, reason: "list-parse" };
    }
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < COMMENT_PAGE_SIZE) break;
    // Full page at the safe cap — more comments may exist; lookup is truncated.
    if (page === COMMENT_PAGE_CAP) truncated = true;
  }
  return { ok: true, comments: all, truncated };
}

/**
 * Upsert a PR comment: PATCH existing bot-owned marker comment, else POST new.
 * Never throws on HTTP failure — returns a result object for fallbacks.
 * Never PATCHes a user-spoofed or human-owned marker.
 * When comment lookup is truncated at COMMENT_PAGE_CAP with no bot marker found,
 * does not POST (ambiguous) — caller falls back to job summary.
 *
 * Ownership uses the authenticated token identity from GET /user, never
 * GITHUB_ACTOR (human PR authors). Optional o.actorLogin is only used when it
 * is itself a verified bot login (tests / advanced callers).
 *
 * @param {object} o
 * @param {string} o.token
 * @param {string} o.owner
 * @param {string} o.repo
 * @param {number|string} o.issueNumber
 * @param {string} o.body
 * @param {string} [o.actorLogin] verified bot login override only (not GITHUB_ACTOR)
 * @param {typeof fetch} [o.fetchImpl]
 * @param {string} [o.apiBase]
 */
export async function upsertPrComment(o) {
  const fetchImpl = o.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return { ok: false, mode: "none", reason: "no-fetch" };
  }
  const token = String(o.token || "");
  if (!token) {
    return { ok: false, mode: "none", reason: "no-token" };
  }
  const apiBase = (o.apiBase || "https://api.github.com").replace(/\/$/, "");
  const owner = encodeURIComponent(o.owner);
  const repo = encodeURIComponent(o.repo);
  const issue = encodeURIComponent(String(o.issueNumber));
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "getadvantage-cli-action",
  };

  // Resolve ownership from the authenticated token only. Never trust a human
  // GITHUB_ACTOR login for PATCH eligibility. Do not accept arbitrary [bot]
  // accounts as owners unless that login is the authenticated identity.
  let tokenBotLogin = "";
  try {
    const me = await fetchImpl(`${apiBase}/user`, { method: "GET", headers });
    if (me.ok) {
      const j = await me.json();
      if (j?.login && j?.type === "Bot") {
        // Authenticated bot identity (Actions app, installation app, …).
        tokenBotLogin = j.login;
      } else if (j?.login && isVerifiedBotLogin(j.login)) {
        tokenBotLogin = j.login;
      }
      // Human /user identities are ignored — fall through to Actions bot.
    }
  } catch {
    /* optional — fall through to defaults */
  }
  // Explicit override only for the narrowly known Actions bot (unit tests).
  if (!tokenBotLogin && o.actorLogin && isVerifiedBotLogin(o.actorLogin)) {
    tokenBotLogin = o.actorLogin;
  }
  if (!tokenBotLogin) tokenBotLogin = ACTIONS_BOT_LOGIN;

  const listed = await listIssueCommentsPaginated({
    fetchImpl,
    headers,
    apiBase,
    owner,
    repo,
    issue,
  });
  if (!listed.ok) {
    return { ok: false, mode: "none", reason: listed.reason };
  }

  const existing = findMarkerComment(listed.comments, tokenBotLogin);
  if (existing) {
    let patchRes;
    try {
      patchRes = await fetchImpl(`${apiBase}/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ body: o.body }),
      });
    } catch (e) {
      return { ok: false, mode: "none", reason: `patch-error:${e.message || e}` };
    }
    if (patchRes.status === 401 || patchRes.status === 403) {
      return { ok: false, mode: "none", reason: `permission:${patchRes.status}` };
    }
    if (!patchRes.ok) {
      return { ok: false, mode: "none", reason: `patch-http:${patchRes.status}` };
    }
    return { ok: true, mode: "pr-comment", action: "updated", id: existing.id };
  }

  // Truncated listing with no bot marker: do not POST a duplicate; job summary.
  if (listed.truncated) {
    return { ok: false, mode: "none", reason: "list-truncated" };
  }

  let postRes;
  try {
    postRes = await fetchImpl(`${apiBase}/repos/${owner}/${repo}/issues/${issue}/comments`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ body: o.body }),
    });
  } catch (e) {
    return { ok: false, mode: "none", reason: `post-error:${e.message || e}` };
  }
  if (postRes.status === 401 || postRes.status === 403) {
    return { ok: false, mode: "none", reason: `permission:${postRes.status}` };
  }
  if (!postRes.ok) {
    return { ok: false, mode: "none", reason: `post-http:${postRes.status}` };
  }
  let created = null;
  try {
    created = await postRes.json();
  } catch {
    /* ignore */
  }
  return { ok: true, mode: "pr-comment", action: "created", id: created?.id };
}

/**
 * Append body to the GitHub Actions job summary file.
 * @param {string} summaryPath path from GITHUB_STEP_SUMMARY
 * @param {string} body markdown
 * @param {{appendFileSync?: Function}} [fs]
 */
export function writeJobSummary(summaryPath, body, fs) {
  if (!summaryPath) return { ok: false, reason: "no-summary-path" };
  const append = typeof fs?.appendFileSync === "function" ? fs.appendFileSync : defaultAppendFileSync;
  append(summaryPath, body.endsWith("\n") ? body : body + "\n", "utf8");
  return { ok: true, mode: "job-summary" };
}
