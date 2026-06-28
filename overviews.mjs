// Ship-Safe v1.1 — the OVERVIEW SCANNERS.
//
// Three READ-ONLY repo scans that hand the builder a MAP of what their app
// actually has. This is the "understand what you built" differentiator: an
// AI agent can ship a hundred routes in an afternoon, and the human has no
// idea which ones mutate data, who can reach them, what external services
// they call, or what runs unattended on a schedule. These scanners read the
// repo and answer those questions in plain language.
//
//   1. API surface map   — every Next.js App Router route, its methods, and
//                           whether it looks auth-gated. ⚠ on a MUTATING route
//                           that looks UNauthenticated (the dangerous ones).
//   2. Agents & integrations map — external/LLM/3rd-party calls + which env
//                           keys back them. ⚠ if a secret looks reachable from
//                           the client or an unauthenticated path.
//   3. Schedules & jobs map — vercel.json crons + app/api/cron/* routes, their
//                           schedule, and whether each is gated. ⚠ on an
//                           ungated (publicly triggerable) cron.
//
// Every scanner returns the same `result(status, label, detail, extra)` shape
// the runner already renders. Node built-ins only; nothing here mutates the
// repo (it only READS files). Overall verdict is INFORMATIONAL — these emit
// `pass`/`warn`, never `fail`, so a surprising map never blocks a ship on its
// own (the v1 safety checks own the NO-GO).

import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { result, walkFiles, readText, relPath } from "./util.mjs";

// ===========================================================================
// shared helpers
// ===========================================================================

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Find every App Router route handler (app/api/**\/route.ts|js). */
function routeFiles(cwd) {
  const apiDir = path.join(cwd, "app", "api");
  if (!existsSync(apiDir)) return [];
  return walkFiles(apiDir, (abs) => /[\\/]route\.(ts|tsx|js|mjs)$/.test(abs)).sort();
}

/**
 * Turn an absolute app/api/.../route.ts path into its public URL path.
 *   app/api/sites/route.ts            → /api/sites
 *   app/api/team/[memberId]/route.ts  → /api/team/[memberId]
 *   app/api/[transport]/route.ts      → /api/[transport]   (=> the MCP server)
 */
function routeUrlFromFile(abs, cwd) {
  const rel = relPath(abs, cwd); // app/api/.../route.ts
  const segs = rel.split("/");
  // drop leading "app" and the trailing "route.xx"
  const parts = segs.slice(1, -1); // ["api", "sites"] etc.
  return "/" + parts.join("/");
}

/** Which HTTP methods a route file exports (handles `export async function POST`,
 *  `export function GET`, and `export { handler as GET, handler as POST }`). */
function methodsExported(text) {
  const found = new Set();
  for (const m of HTTP_METHODS) {
    // export (async)? function GET(...)
    if (new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\b`).test(text)) found.add(m);
    // export const GET = ...
    if (new RegExp(`export\\s+const\\s+${m}\\b`).test(text)) found.add(m);
    // export { handler as GET } / export { x as POST, y as GET }
    if (new RegExp(`\\bas\\s+${m}\\b`).test(text)) found.add(m);
  }
  return [...found].sort((a, b) => HTTP_METHODS.indexOf(a) - HTTP_METHODS.indexOf(b));
}

// Tokens that signal a handler authenticates / authorizes the caller. Drawn
// from this repo's real conventions (currentAccount, getSession, the API-key
// resolver, the per-caller rate-limiter) but kept generic enough to catch the
// usual names an AI agent emits in any Next.js app.
const AUTH_TOKENS = [
  /\bcurrentAccount\b/,
  /\bgetSession\b/,
  /\brequireAuth\b/,
  /\brequireSession\b/,
  /\bverifySession\b/,
  /\bresolveCaller\b/,            // app/lib/server/api-auth (key-or-keyless)
  /\bresolveApiKeySecret\b/,      // API-key auth
  /\brateLimitCaller\b/,          // per-caller (key/plan) limiter
  /\bgetServerSession\b/,         // next-auth idiom
  /\bauth\(\)/,                   // next-auth v5 idiom
];

/**
 * Strip line (`// …`) and block (`/* … *\/`) comments from JS/TS source so a
 * commented-out auth/secret token never counts as real gating. This is a
 * heuristic stripper (it does not parse strings/regex literals), which is the
 * right trade-off here: the auth/secret tokens we grep for are identifiers that
 * never legitimately live inside a string literal, but they DO commonly live in
 * commented-out code (e.g. the deferred `withMcpAuth` block in
 * app/api/[transport]/route.ts references `resolveApiKeySecret` only in a
 * comment). Removing comments first keeps that out of the gating decision.
 */
function stripComments(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    // Block comment /* … */
    if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    // Line comment // …
    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", i + 2);
      i = end === -1 ? n : end; // keep the newline so line structure survives
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Does the handler reference an auth/session check? Comments are stripped first
 *  so commented-out gating never counts (see stripComments). */
function looksAuthGated(text) {
  const code = stripComments(text);
  return AUTH_TOKENS.some((re) => re.test(code));
}

// Tokens signalling a route authorizes its caller via a CRON / shared secret
// (Vercel cron sends `Authorization: Bearer <CRON_SECRET>`; this repo also
// accepts x-cron-secret and compares constant-time). A route gated this way is
// NOT session-authed but is NOT publicly triggerable either — so the API
// surface map must not flag it as an "unauthenticated mutator".
const SECRET_GATE_TOKENS = [
  /\bCRON_SECRET\b/,
  /\btimingSafeEqual\b/,
  /x-cron-secret/i,
];

/** Does the handler gate on a CRON / shared secret (vs. an auth header it might
 *  read for other reasons)? We require a concrete secret token, not just the
 *  word "authorization", to avoid false "gated" calls. Comments are stripped
 *  first so commented-out gating never counts (see stripComments). */
function looksSecretGated(text) {
  const code = stripComments(text);
  return SECRET_GATE_TOKENS.some((re) => re.test(code));
}

// A cron route is "gated" when it checks a CRON / shared secret — same precise
// secret-token detection the API surface map uses, so the two maps agree.
// (Declared here, next to looksSecretGated, so the shared scanners below — which
// run before section 3 in source order — can reference it; a `const` alias is
// not hoisted like a function declaration.)
const looksCronGated = looksSecretGated;

// ===========================================================================
// SHARED SCANNERS (pure data) — reused by both the `check` overview maps and
// the `brief` generator (PROJECT-BRIEF.md). These functions do the file
// reading + classification and return plain data; the `overview*` functions
// below wrap that data in the runner's `result()` shape, and brief.mjs renders
// the same data as markdown. ONE scan, two presentations — no duplicated logic.
// ===========================================================================

/**
 * Scan the API surface → structured rows + summary counts.
 * @returns {{ rows: Array<{url,methods:string[],mutates,sessionGated,secretGated,devOnly}>,
 *             gatedCount:number, mutatingCount:number, dangerous:any[] }}
 */
export function scanApiSurface(cwd) {
  const files = routeFiles(cwd);
  const rows = [];
  for (const abs of files) {
    const text = readText(abs);
    const url = routeUrlFromFile(abs, cwd);
    const methods = methodsExported(text);
    const mutates = methods.some((m) => MUTATING.has(m));
    const sessionGated = looksAuthGated(text);
    const secretGated = looksSecretGated(text);
    const devOnly =
      /NODE_ENV\s*===\s*["']production["']/.test(text) &&
      /\b(?:404|"Not found"|Not found)\b/.test(text);
    rows.push({ url, methods, mutates, sessionGated, secretGated, devOnly });
  }
  const gatedCount = rows.filter((r) => r.sessionGated || r.secretGated).length;
  const mutatingCount = rows.filter((r) => r.mutates).length;
  const dangerous = rows.filter(
    (r) => r.mutates && !r.sessionGated && !r.secretGated && !r.devOnly,
  );
  return { rows, gatedCount, mutatingCount, dangerous };
}

/** A short human tag for a single API row (shared by the map + the brief). */
export function apiRowTag(r) {
  if (r.devOnly) return "dev-only (inert in prod)";
  if (r.sessionGated) return "auth-gated";
  if (r.secretGated) return "secret-gated (cron/shared)";
  if (r.mutates) return "PUBLIC + mutates ⚠";
  return "public (read-only)";
}

/**
 * Scan integrations → label → { files:Set, keys:Set }, plus client-secret hits
 * and whether an MCP server route was found.
 * @returns {{ integrations: Map, clientSecretHits: Array<{file,key}>, mcpRouteFound: boolean }}
 */
export function scanIntegrations(cwd) {
  const appDir = path.join(cwd, "app");
  const integrations = new Map(); // label -> { files:Set, keys:Set }
  const clientSecretHits = [];
  let mcpRouteFound = false;
  if (!existsSync(appDir)) return { integrations, clientSecretHits, mcpRouteFound };

  const files = walkFiles(appDir, (abs) => /\.(ts|tsx|js|mjs)$/.test(abs));
  function note(label, keys, file) {
    if (!integrations.has(label)) integrations.set(label, { files: new Set(), keys: new Set() });
    const e = integrations.get(label);
    e.files.add(file);
    for (const k of keys) e.keys.add(k);
  }

  for (const abs of files) {
    const text = readText(abs);
    if (!text) continue;
    const rel = relPath(abs, cwd);

    for (const h of INTEGRATION_HOSTS) {
      if (text.includes(h.host)) note(h.label, h.keys, rel);
    }
    for (const s of INTEGRATION_SDKS) {
      if (s.re.test(text)) {
        note(s.label, s.keys, rel);
        if (s.label.startsWith("MCP server")) mcpRouteFound = true;
      }
    }

    if (isClientFile(text)) {
      let m;
      SECRET_ENV_RE.lastIndex = 0;
      while ((m = SECRET_ENV_RE.exec(text)) !== null) {
        const key = m[1];
        if (key.startsWith("NEXT_PUBLIC_")) continue;
        clientSecretHits.push({ file: rel, key });
      }
    }
  }
  return { integrations, clientSecretHits, mcpRouteFound };
}

/**
 * Scan schedules/jobs → rows + derived buckets.
 * @returns {{ rows: any[], ungated:any[], orphanRoutes:any[], missing:any[], cronCount:number }}
 */
export function scanSchedules(cwd) {
  const crons = vercelCrons(cwd);
  const allRoutes = routeFiles(cwd);
  const cronRouteFiles = allRoutes.filter((abs) => {
    const url = routeUrlFromFile(abs, cwd);
    return url.startsWith("/api/cron") || crons.has(url);
  });

  const rows = [];
  const seenUrls = new Set();
  for (const abs of cronRouteFiles) {
    const url = routeUrlFromFile(abs, cwd);
    seenUrls.add(url);
    const text = readText(abs);
    rows.push({
      url,
      schedule: crons.get(url) || null,
      gated: looksCronGated(text),
      scheduled: crons.has(url),
    });
  }
  for (const [p, sched] of crons) {
    if (!seenUrls.has(p)) {
      rows.push({ url: p, schedule: sched, gated: null, scheduled: true, missing: true });
    }
  }
  rows.sort((a, b) => a.url.localeCompare(b.url));

  const ungated = rows.filter((r) => r.gated === false);
  const orphanRoutes = rows.filter((r) => !r.scheduled && !r.missing);
  const missing = rows.filter((r) => r.missing);
  return { rows, ungated, orphanRoutes, missing, cronCount: crons.size };
}

/** A short human tag for a single schedule row (shared by the map + the brief). */
export function scheduleRowTag(r) {
  if (r.missing) return "no handler found ⚠";
  if (r.gated === false) return "UNGATED ⚠ (publicly triggerable)";
  if (r.gated) return "gated (CRON_SECRET)";
  return "ungated?";
}

// ===========================================================================
// 1. API SURFACE MAP
// ===========================================================================
// For each App Router route: URL path, exported HTTP methods, and whether it
// looks auth-gated. The dangerous case we flag is a route that MUTATES
// (POST/PUT/PATCH/DELETE) yet shows no sign of authenticating the caller —
// the classic "an AI agent wired up a write endpoint and forgot the gate".
//
// NOTE on gating: in this repo `proxy.ts` gates `/app/*` but its matcher
// EXCLUDES `/api/`, so API routes are NOT covered by the proxy — each handler
// must authenticate itself. We therefore judge each /api route by its own
// body. (A route under /app/* would be proxy-gated; we note that too.)

export function overviewApiSurface(cwd) {
  const { rows, gatedCount, mutatingCount, dangerous } = scanApiSurface(cwd);
  if (rows.length === 0) {
    return result(
      "pass",
      "API surface map",
      "No app/api/**/route files found — nothing to map.",
    );
  }

  // Build the listing (capped so a big app stays readable).
  const lines = [];
  const CAP = 60;
  for (const r of rows.slice(0, CAP)) {
    const methodStr = r.methods.length ? r.methods.join(",") : "—";
    lines.push(`${r.url}  [${methodStr}]  ${apiRowTag(r)}`);
  }
  if (rows.length > CAP) lines.push(`…and ${rows.length - CAP} more route(s)`);

  const detail =
    `${rows.length} route(s) · ${gatedCount} look gated (session or cron secret) · ` +
    `${mutatingCount} mutate (write) · ${dangerous.length} mutate without any obvious gate.`;

  if (dangerous.length > 0) {
    // Surface the dangerous ones FIRST, then the full map below them.
    const flagged = dangerous
      .slice(0, 20)
      .map((r) => `⚠ ${r.url} [${r.methods.join(",")}] — mutates but no auth/session check found`);
    return result(
      "warn",
      "API surface map",
      detail,
      [
        ...flagged,
        ...(dangerous.length > 20 ? [`…and ${dangerous.length - 20} more flagged`] : []),
        "Confirm each ⚠ route is meant to be public (some, like a rate-limited lead/contact",
        "endpoint, legitimately are) — and that the others authenticate the caller before writing.",
        "— full map —",
        ...lines,
      ],
    );
  }

  return result("pass", "API surface map", detail, lines);
}

// ===========================================================================
// 2. AGENTS & INTEGRATIONS MAP
// ===========================================================================
// What external services + LLMs the app talks to, and which env keys back
// them. We detect via (a) known host strings in fetch()/URL literals,
// (b) well-known SDK imports, (c) the MCP server route, then map each to the
// env key(s) it reads. The risk flag: a secret/LLM key that looks reachable
// from the CLIENT BUNDLE or an UNAUTHENTICATED route.

// host substring → { label, keys[] }. Keys are the env vars that typically
// back that integration in this kind of app (names only — never values).
const INTEGRATION_HOSTS = [
  { host: "api.openai.com", label: "OpenAI", keys: ["OPENAI_API_KEY"] },
  { host: "api.anthropic.com", label: "Anthropic (Claude)", keys: ["ANTHROPIC_API_KEY"] },
  { host: "api.perplexity.ai", label: "Perplexity", keys: ["PERPLEXITY_API_KEY"] },
  { host: "generativelanguage.googleapis.com", label: "Google Gemini", keys: ["GEMINI_API_KEY"] },
  { host: "api.stripe.com", label: "Stripe (HTTP)", keys: ["STRIPE_SECRET_KEY"] },
  { host: "api.resend.com", label: "Resend (email)", keys: ["RESEND_API_KEY"] },
  { host: "api.improvmx.com", label: "ImprovMX (email aliases)", keys: ["IMPROVMX_API_TOKEN"] },
  { host: "api.vercel.com", label: "Vercel API", keys: ["VERCEL_TOKEN"] },
  { host: "api.cal.com", label: "Cal.com (booking)", keys: ["CAL_API_KEY"] },
  { host: "crt.sh", label: "crt.sh (CT-log harvest)", keys: [] },
];

// SDK import → { label, keys[] }. Catches integrations that go through an SDK
// rather than a literal fetch URL (e.g. the Stripe + Resend SDKs).
const INTEGRATION_SDKS = [
  { re: /from\s+["']stripe["']/, label: "Stripe (SDK)", keys: ["STRIPE_SECRET_KEY"] },
  { re: /from\s+["']openai["']/, label: "OpenAI (SDK)", keys: ["OPENAI_API_KEY"] },
  { re: /from\s+["']@anthropic-ai\/sdk["']/, label: "Anthropic (SDK)", keys: ["ANTHROPIC_API_KEY"] },
  { re: /from\s+["']resend["']/, label: "Resend (SDK)", keys: ["RESEND_API_KEY"] },
  { re: /from\s+["']mcp-handler["']/, label: "MCP server (mcp-handler)", keys: [] },
];

// Env names that hold a SECRET (vs. public config). A match of one of these in
// a CLIENT-reachable file is the risk we flag. NEXT_PUBLIC_* is deliberately
// NOT secret (it's compiled into the browser bundle by design).
const SECRET_ENV_RE = /\bprocess\.env\.([A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*)\b/g;

/** A module is "client-reachable" if it (or the file declaring it) is a Client
 *  Component — i.e. carries the "use client" directive. Server Components,
 *  route handlers and app/lib/server/* never ship to the browser. */
function isClientFile(text) {
  // The directive must be at the very top (first non-comment statement). A loose
  // check is fine for a heuristic: look for it in the first ~400 chars.
  return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(text.slice(0, 400));
}

export function overviewIntegrations(cwd) {
  const appDir = path.join(cwd, "app");
  if (!existsSync(appDir)) {
    return result("pass", "Agents & integrations map", "No app/ directory found — nothing to map.");
  }

  const { integrations, clientSecretHits, mcpRouteFound } = scanIntegrations(cwd);

  if (integrations.size === 0 && clientSecretHits.length === 0) {
    return result(
      "pass",
      "Agents & integrations map",
      "No external LLM / 3rd-party integrations detected in app/.",
    );
  }

  // Build the integration listing, alphabetical, with backing keys.
  const labels = [...integrations.keys()].sort();
  const lines = [];
  for (const label of labels) {
    const e = integrations.get(label);
    const keys = [...e.keys];
    const keyStr = keys.length ? ` — key: ${keys.join(", ")}` : " — no key (public endpoint)";
    lines.push(`${label}${keyStr}  (${e.files.size} file${e.files.size === 1 ? "" : "s"})`);
  }
  if (mcpRouteFound) {
    lines.push("MCP server is EXPOSED at /api/mcp — model-callable tools; confirm its auth posture (keyless vs key-scoped).");
  }

  const detail = `${labels.length} integration(s) detected${mcpRouteFound ? " (incl. an MCP server)" : ""}.`;

  // Risk flag: secret key reachable from the client bundle.
  if (clientSecretHits.length > 0) {
    const seen = new Set();
    const flagged = [];
    for (const h of clientSecretHits) {
      const k = `${h.file}::${h.key}`;
      if (seen.has(k)) continue;
      seen.add(k);
      flagged.push(`⚠ ${h.file} reads process.env.${h.key} in a "use client" component — it would ship in the browser bundle.`);
    }
    return result(
      "warn",
      "Agents & integrations map",
      detail,
      [
        ...flagged.slice(0, 15),
        "Move secret reads to a server module (app/lib/server/* or a route handler). Only NEXT_PUBLIC_* belongs client-side.",
        "— integrations —",
        ...lines,
      ],
    );
  }

  return result("pass", "Agents & integrations map", detail, lines);
}

// ===========================================================================
// 3. SCHEDULES & JOBS MAP
// ===========================================================================
// Cron / scheduled jobs: vercel.json "crons" (path + schedule) plus every
// app/api/cron/* route. For each: route, schedule (if declared), and whether
// it's GATED (checks CRON_SECRET / does a secret compare / inspects the
// authorization header). The flag: a cron route that looks publicly
// triggerable — anyone who knows the URL could fire it.

/** Parse vercel.json crons → Map(path → schedule). Best-effort; tolerates a
 *  missing or malformed file. */
function vercelCrons(cwd) {
  const map = new Map();
  const file = path.join(cwd, "vercel.json");
  if (!existsSync(file)) return map;
  let json;
  try {
    json = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return map;
  }
  const crons = Array.isArray(json?.crons) ? json.crons : [];
  for (const c of crons) {
    if (c && typeof c.path === "string") map.set(c.path, c.schedule || "(no schedule)");
  }
  return map;
}

export function overviewSchedules(cwd) {
  const { rows, ungated, orphanRoutes, missing, cronCount } = scanSchedules(cwd);

  if (rows.length === 0) {
    return result("pass", "Schedules & jobs map", "No cron routes or vercel.json crons found.");
  }

  const lines = [];
  for (const r of rows) {
    const sched = r.schedule ? r.schedule : "not in vercel.json";
    lines.push(`${r.url}  [${sched}]  ${scheduleRowTag(r)}`);
  }

  const detail =
    `${rows.length} job(s) · ${cronCount} scheduled in vercel.json · ` +
    `${ungated.length} ungated · ${orphanRoutes.length} cron route(s) not wired to a schedule.`;

  const warnBits = [];
  if (ungated.length > 0) {
    warnBits.push(
      ...ungated.map((r) => `⚠ ${r.url} — no CRON_SECRET / auth-header check; anyone with the URL could trigger it.`),
    );
  }
  if (missing.length > 0) {
    warnBits.push(
      ...missing.map((r) => `⚠ ${r.url} — scheduled in vercel.json but no matching route handler found.`),
    );
  }

  if (warnBits.length > 0) {
    return result("warn", "Schedules & jobs map", detail, [
      ...warnBits,
      "Gate each scheduled route on CRON_SECRET (constant-time compare of the Authorization bearer).",
      "— full map —",
      ...lines,
    ]);
  }

  // Orphan cron routes (handler exists, not scheduled) are informational, not a warn.
  const extra = [...lines];
  if (orphanRoutes.length > 0) {
    extra.push(
      `Note: ${orphanRoutes.length} cron route(s) have a handler but aren't wired into vercel.json — they only run if triggered manually.`,
    );
  }
  return result("pass", "Schedules & jobs map", detail, extra);
}
