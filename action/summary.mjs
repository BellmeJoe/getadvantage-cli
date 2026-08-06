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

/** Max length of a single finding detail line in the summary table. */
export const LINE_CAP = 240;
/** Max failing/warning checks listed in the table. */
export const CHECK_CAP = 12;
/** Max findings rendered across all checks (one table row per finding when present). */
export const FINDING_CAP = 20;
/** Max findings shown for a single check (five leaked keys must fit under this). */
export const FINDINGS_PER_CHECK = 8;
/** Max findings that contribute remediation text to the PR summary. */
export const REMEDIATION_FINDING_CAP = 5;
/** Max remediation lines kept per finding (after sanitization). */
export const REMEDIATION_LINES_PER_FINDING = 8;
/** Max characters of sanitized remediation text per finding. */
export const REMEDIATION_CHARS_PER_FINDING = 480;
/** Hard cap on the full summary body (chars). Truncates with a tail note when exceeded. */
export const BODY_CHAR_CAP = 12000;
/** Comments per page when listing issue comments. */
export const COMMENT_PAGE_SIZE = 100;
/** Safe cap on list pages (prevents unbounded API walk). */
export const COMMENT_PAGE_CAP = 10;
/** Placeholder when a credential-shaped path must be omitted (never fake-redacted). */
const PATH_OMITTED = "(path omitted — credential-shaped name)";

/**
 * Format a finding location as `file:line` when the path is safe to emit.
 * Credential-shaped paths are omitted (never fake-redacted). Line numbers are
 * only appended when they are finite positive integers.
 * @param {{file?: string, startLine?: number}} f
 * @returns {string} location fragment or empty string
 */
function formatFindingLocation(f) {
  if (!f || typeof f !== "object") return "";
  if (!f.file || typeof f.file !== "string") return "";
  if (isUnsafePathForSummary(f.file)) {
    return PATH_OMITTED;
  }
  const file = sanitizeSummaryText(f.file).slice(0, 120);
  if (!file) return PATH_OMITTED;
  const line =
    typeof f.startLine === "number" && Number.isFinite(f.startLine) && f.startLine >= 1
      ? Math.floor(f.startLine)
      : null;
  if (line != null) {
    // Line number is numeric (not user-controlled free text); still sanitize the joined form.
    return sanitizeSummaryText(`${file}:${line}`).slice(0, 140);
  }
  return file;
}

/**
 * Build a single-line detail cell for one finding (path, fingerprint, message).
 * All user-derived fields run through sanitizeSummaryText / path safety checks.
 * @param {object} f finding
 * @returns {string}
 */
function formatFindingDetail(f) {
  const parts = [];
  const loc = formatFindingLocation(f);
  if (loc) parts.push(loc);
  if (f?.fp) parts.push(sanitizeSummaryText(f.fp).slice(0, 80));
  if (f?.message) parts.push(sanitizeSummaryText(f.message).slice(0, 120));
  if (f?.authId) parts.push(sanitizeSummaryText(`auth ${f.authId}`).slice(0, 60));
  return parts.join(" · ").slice(0, LINE_CAP);
}

/**
 * Compact, sanitized remediation text for one finding.
 * Prefers paste-ready value while staying size-bounded.
 * Credential-shaped finding paths are stripped from free text before redaction
 * so remediation cannot re-leak them as fake-redacted filenames.
 * @param {object} f finding with optional remediation: string[]
 * @returns {string} multi-line sanitized remediation or empty
 */
function formatFindingRemediation(f) {
  if (!f || !Array.isArray(f.remediation) || f.remediation.length === 0) return "";
  const unsafeFile =
    f.file && typeof f.file === "string" && isUnsafePathForSummary(f.file) ? f.file : "";
  const out = [];
  let chars = 0;
  for (const raw of f.remediation) {
    if (out.length >= REMEDIATION_LINES_PER_FINDING) break;
    let pre = String(raw ?? "");
    // Omit credential-shaped finding path from free text (never fake-redact it).
    if (unsafeFile) pre = pre.split(unsafeFile).join(PATH_OMITTED);
    const line = sanitizeSummaryText(pre).replace(/\n/g, " ").trim();
    if (!line) continue;
    const clipped = line.slice(0, 200);
    if (chars + clipped.length > REMEDIATION_CHARS_PER_FINDING) {
      const room = REMEDIATION_CHARS_PER_FINDING - chars;
      if (room > 20) out.push(clipped.slice(0, room) + "…");
      break;
    }
    out.push(clipped);
    chars += clipped.length;
  }
  return out.join("\n");
}

/** Escape pipes/newlines so table cells cannot break markdown structure. */
function escTableCell(t) {
  return String(t).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

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

  // Blocking-first: fail before warn; stable within each status (input order).
  const interesting = checks
    .filter((c) => c && (c.status === "fail" || c.status === "warn"))
    .slice()
    .sort((a, b) => {
      if (a.status === b.status) return 0;
      if (a.status === "fail") return -1;
      return 1;
    });

  /** @type {Array<{label: string, loc: string, text: string}>} */
  const remediationBlocks = [];

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
    let checksShown = 0;
    let findingsShown = 0;
    let checksOmitted = 0;

    for (const c of interesting) {
      if (checksShown >= CHECK_CAP || findingsShown >= FINDING_CAP) {
        checksOmitted = interesting.length - checksShown;
        break;
      }
      const status = c.status === "fail" ? "FAIL" : "WARN";
      const label = sanitizeSummaryText(c.label || "check").slice(0, 80);
      const findings = Array.isArray(c.findings) ? c.findings.filter(Boolean) : [];

      if (findings.length === 0) {
        const detail = sanitizeSummaryText(c.detail || "").slice(0, LINE_CAP);
        lines.push(`| ${status} | ${escTableCell(label)} | ${escTableCell(detail)} |`);
        checksShown += 1;
        continue;
      }

      const perCheckRoom = Math.min(FINDINGS_PER_CHECK, FINDING_CAP - findingsShown);
      const toShow = findings.slice(0, perCheckRoom);
      for (const f of toShow) {
        const detail = formatFindingDetail(f) || sanitizeSummaryText(c.detail || "").slice(0, LINE_CAP);
        lines.push(`| ${status} | ${escTableCell(label)} | ${escTableCell(detail)} |`);
        findingsShown += 1;

        // Collect remediation (bounded) for a follow-on section.
        if (remediationBlocks.length < REMEDIATION_FINDING_CAP) {
          const rem = formatFindingRemediation(f);
          if (rem) {
            const loc = formatFindingLocation(f) || label;
            remediationBlocks.push({ label, loc, text: rem });
          }
        }
      }
      const omittedHere = findings.length - toShow.length;
      if (omittedHere > 0) {
        lines.push(
          `| ${status} | ${escTableCell(label)} | ${escTableCell(`+${omittedHere} more finding(s) (see logs)`)} |`,
        );
      }
      checksShown += 1;
    }

    if (checksOmitted > 0) {
      lines.push(`| … | … | +${checksOmitted} more check(s) (see logs) |`);
    } else if (findingsShown >= FINDING_CAP) {
      // Cap hit mid-list while checks remain — note without inventing a count of remaining findings.
      const remainingChecks = interesting.length - checksShown;
      if (remainingChecks > 0) {
        lines.push(`| … | … | +${remainingChecks} more check(s) (see logs) |`);
      }
    }
  }

  // Paste-ready / smallest-safe-next-edit remediation (sanitized, size-capped).
  if (remediationBlocks.length > 0) {
    lines.push("");
    lines.push("**Remediation** (paste-ready where available)");
    for (const block of remediationBlocks) {
      const heading = sanitizeSummaryText(`${block.label} · ${block.loc}`).slice(0, 160);
      lines.push(`- ${heading}`);
      for (const rl of block.text.split("\n")) {
        // Indent as preformatted-ish prose; keep pipes safe outside tables.
        lines.push(`  ${rl}`);
      }
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

  let body = lines.join("\n");
  if (body.length > BODY_CHAR_CAP) {
    const note = "\n\n_…summary truncated for size (see workflow logs / code scanning)._\n";
    const keep = Math.max(0, BODY_CHAR_CAP - note.length);
    body = body.slice(0, keep) + note;
  }
  return body;
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
