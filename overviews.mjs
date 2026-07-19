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
import { existsSync, readdirSync } from "node:fs";
import { result, walkFiles, readText, relPath, readJsonFile } from "./util.mjs";
import { detectProject, detectRepoStack, pythonDeclaredDeps } from "./detect.mjs";

// ===========================================================================
// shared helpers
// ===========================================================================

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Find every App Router route handler under app/api and src/app/api
 * (both layouts are valid Next.js). Returns absolute paths, sorted, deduped.
 */
function routeFiles(cwd) {
  const roots = [
    path.join(cwd, "app", "api"),
    path.join(cwd, "src", "app", "api"),
  ];
  const out = [];
  for (const apiDir of roots) {
    if (!existsSync(apiDir)) continue;
    out.push(...walkFiles(apiDir, (abs) => /[\\/]route\.(ts|tsx|js|mjs)$/.test(abs)));
  }
  return [...new Set(out)].sort();
}

/**
 * Turn an absolute .../app/api/.../route.ts path into its public URL path.
 *   app/api/sites/route.ts                → /api/sites
 *   src/app/api/team/[memberId]/route.ts  → /api/team/[memberId]
 *   app/api/[transport]/route.ts          → /api/[transport]   (=> the MCP server)
 */
function routeUrlFromFile(abs, cwd) {
  const rel = relPath(abs, cwd); // app/api/.../route.ts or src/app/api/...
  const segs = rel.split("/");
  // URL starts at the "api" segment (works for both app/ and src/app/ layouts).
  const apiIdx = segs.indexOf("api");
  if (apiIdx === -1) {
    // Fallback: drop leading dir + trailing route.xx (legacy behaviour).
    return "/" + segs.slice(1, -1).join("/");
  }
  return "/" + segs.slice(apiIdx, -1).join("/");
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

// ===========================================================================
// CROSS-STACK ROUTE PARSING — Express / Fastify (node) and Flask / FastAPI
// (python). The Next.js lane above reads the App Router file tree; these two
// read SOURCE and pull out route registrations with best-effort regex (no code
// is executed). Both return the SAME row shape as scanApiSurface so the map +
// brief render every stack identically:
//   { url, methods:string[], mutates, sessionGated, secretGated, devOnly }
// `secretGated`/`devOnly` are Next-only concepts (a CRON secret gate / a
// prod-404 dev route) and stay false here — honest, not invented.
// ===========================================================================

// Directory segments the route lanes never parse (vendored, generated, tests,
// examples, virtualenvs). walkFiles already skips node_modules/.next/dist/build
// /coverage/.turbo; this adds the test + example + python-env dirs a route scan
// must also ignore so a fixture/test route never lands on the real map.
const ROUTE_SKIP_SEGMENTS = new Set([
  "node_modules", "dist", "build", ".next", ".vercel", ".data", "coverage", ".turbo", ".git",
  "test", "tests", "__tests__", "__mocks__", "spec", "examples", "example", "fixtures",
  "venv", ".venv", "env", ".env", "site-packages", "__pycache__",
]);

/** True if any path segment of `rel` is a dir we must not parse routes from. */
function underSkippedDir(rel) {
  return rel.split("/").some((seg) => ROUTE_SKIP_SEGMENTS.has(seg));
}

/** A forward window of source starting at `from`, capped at `max` chars and cut
 *  at the first `;` — enough to see a route's middleware list / verb chain but
 *  not bleed into the NEXT statement (which would falsely gate a public route
 *  from a gated neighbour). Middlewares precede the handler body, so cutting at
 *  the statement terminator still captures them. */
function argWindow(text, from, max = 300) {
  let w = text.slice(from, from + max);
  const semi = w.indexOf(";");
  return semi === -1 ? w : w.slice(0, semi);
}

// ---- Express / Fastify (node) ---------------------------------------------

// Auth/middleware tokens that mark an Express/Fastify route as gated. Only the
// well-known names an agent actually emits — a match in the route's OWN argument
// window is what tags it; we never guess "gated" without one (default public).
const EXPRESS_AUTH_TOKENS = [
  /\brequireAuth\b/, /\bauthenticate\b/, /\bensureLoggedIn\b/, /\bpassport\b/,
  /\bisAuthenticated\b/, /\bverifyToken\b/, /\brequireUser\b/,
];

/** Does a route's argument window reference an auth middleware? */
function expressGated(win) {
  return EXPRESS_AUTH_TOKENS.some((re) => re.test(win));
}

/**
 * Parse Express / Fastify route registrations across the repo's JS/TS source.
 * Detects the shapes an AI agent emits:
 *   app.get("/x", …) · router.post("/y", …) · fastify.delete("/z", …)
 *   app.route("/x").get(…).post(…)                (Express verb chains)
 *   fastify.route({ method: "POST", url: "/x" })  (Fastify object form)
 * Only single/double-quoted paths starting with "/" are taken as literal routes
 * (so cache.get("key") / params.get("q") never masquerade as endpoints);
 * non-literal (variable / template) router paths are counted in `dynamicCount`.
 * @returns {{ rows, gatedCount, mutatingCount, dangerous, dynamicCount, stackKind }}
 */
export function scanExpressRoutes(cwd) {
  const files = walkFiles(cwd, (abs) => /\.(?:js|mjs|cjs|ts)$/.test(abs))
    .filter((abs) => !underSkippedDir(relPath(abs, cwd)))
    .sort();

  const seen = new Map(); // "url|methods" -> row (dedupe identical registrations)
  let dynamicCount = 0;

  const pushRow = (url, methods, win) => {
    const mset = methods.length ? methods : ["—"];
    const key = url + "|" + mset.join(",");
    if (seen.has(key)) return;
    const mutates = mset.some((m) => MUTATING.has(m) || m === "ALL");
    seen.set(key, {
      url,
      methods: mset,
      mutates,
      sessionGated: expressGated(win),
      secretGated: false,
      devOnly: false,
    });
  };

  for (const abs of files) {
    const raw = readText(abs);
    if (!raw) continue;
    const text = stripComments(raw);
    let m;

    // (1) shorthand verb calls: <ident>.get("/path", …). Path must start "/".
    const verbRe = /\b([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|options|head|all)\s*\(\s*(['"])(\/[^'"]*)\3/g;
    while ((m = verbRe.exec(text)) !== null) {
      const method = m[2].toUpperCase();
      const url = m[4];
      const win = argWindow(text, m.index + m[0].length);
      pushRow(url, [method], win);
    }

    // (2) router-like verb calls with a NON-literal path → dynamic tally only
    //     (variable / template-literal / concatenated paths we can't resolve).
    const dynRe = /\b(?:app|router|fastify|server|api|route|_?router|v\d+|[A-Za-z_$][\w$]*[Rr]outer)\.(?:get|post|put|patch|delete|options|head|all)\s*\(\s*(?!['"])/g;
    while ((m = dynRe.exec(text)) !== null) dynamicCount++;

    // (3) Express verb chains: <ident>.route("/path").get(…).post(…)
    const chainRe = /\.route\s*\(\s*(['"])(\/[^'"]*)\1\s*\)/g;
    while ((m = chainRe.exec(text)) !== null) {
      const url = m[2];
      const win = argWindow(text, m.index + m[0].length, 400);
      const methods = [];
      const vm = /\.(get|post|put|patch|delete|options|head|all)\s*\(/g;
      let v;
      while ((v = vm.exec(win)) !== null) {
        const mm = v[1].toUpperCase();
        if (!methods.includes(mm)) methods.push(mm);
      }
      pushRow(url, methods, win);
    }

    // (4) Fastify object form: fastify.route({ method: "POST", url: "/path" })
    const objRe = /\.route\s*\(\s*\{/g;
    while ((m = objRe.exec(text)) !== null) {
      const win = text.slice(m.index, m.index + 400);
      const urlM = win.match(/\burl\s*:\s*(['"])(\/[^'"]*)\1/);
      if (!urlM) continue;
      const url = urlM[2];
      const methods = [];
      const arr = win.match(/\bmethod\s*:\s*\[([^\]]*)\]/);
      const single = win.match(/\bmethod\s*:\s*(['"])([A-Za-z]+)\1/);
      if (arr) {
        for (const mm of arr[1].matchAll(/['"]([A-Za-z]+)['"]/g)) methods.push(mm[1].toUpperCase());
      } else if (single) {
        methods.push(single[2].toUpperCase());
      }
      pushRow(url, methods, win);
    }
  }

  const rows = [...seen.values()].sort(
    (a, b) => a.url.localeCompare(b.url) || a.methods.join().localeCompare(b.methods.join()),
  );
  const gatedCount = rows.filter((r) => r.sessionGated || r.secretGated).length;
  const mutatingCount = rows.filter((r) => r.mutates).length;
  const dangerous = rows.filter((r) => r.mutates && !r.sessionGated && !r.secretGated && !r.devOnly);
  return { rows, gatedCount, mutatingCount, dangerous, dynamicCount, stackKind: "node" };
}

// ---- Flask / FastAPI (python) ---------------------------------------------

// Auth tokens that mark a Python route as gated — a decorator on the route
// (@login_required / @jwt_required) or a FastAPI dependency in the handler
// signature (Depends(get_current_user) / Depends(require_…)).
const PY_AUTH_TOKENS = [
  /\blogin_required\b/,
  /\bjwt_required\b/,
  /Depends\(\s*get_current_user/,
  /Depends\(\s*require_/,
];

/**
 * The auth-relevant window for a Python route decorator: its OWN decorator
 * stack (adjacent `@…` lines above and below the route decorator) plus the
 * following `def …(…):` signature (where a FastAPI `Depends(…)` lives). Bounded
 * to this one route — a naive char window bleeds a neighbour's gate across
 * tightly-packed routes and would falsely gate the public ones (and suppress
 * the ⚠ a mutating ungated route must show).
 */
function pyGated(text, idx) {
  const lines = text.split("\n");
  // Which line does `idx` fall on?
  let acc = 0;
  let li = 0;
  for (; li < lines.length; li++) {
    if (acc + lines[li].length + 1 > idx) break;
    acc += lines[li].length + 1;
  }
  const win = [];
  // Backward: stacked decorators immediately ABOVE this route decorator.
  for (let i = li - 1; i >= 0 && i >= li - 5; i--) {
    if (lines[i].trimStart().startsWith("@")) win.push(lines[i]);
    else break;
  }
  // Forward from the route decorator: more stacked decorators, then the `def`
  // signature (which may span lines). Stop once the signature's `:` is reached.
  let seenDef = false;
  for (let i = li; i < lines.length && i <= li + 8; i++) {
    win.push(lines[i]);
    if (/^\s*def\b/.test(lines[i])) seenDef = true;
    if (seenDef && /:\s*$/.test(lines[i])) break;
  }
  const text2 = win.join("\n");
  return PY_AUTH_TOKENS.some((re) => re.test(text2));
}

/** Blank out fully-commented (`# …`) lines while preserving line structure, so a
 *  commented-out decorator never counts as a real route (mirrors stripComments
 *  for JS). Best-effort: an inline `#` after code is left alone (route
 *  decorators live on their own line, so this is safe). */
function stripPyComments(text) {
  return text
    .split("\n")
    .map((line) => (line.trimStart().startsWith("#") ? "" : line))
    .join("\n");
}

/**
 * Parse Flask / FastAPI route decorators across the repo's Python source.
 *   Flask:   @app.route("/path", methods=["POST"]) · @bp.route("/x")  (GET default)
 *   FastAPI: @app.get("/path") · @router.post("/path")  (verb = method)
 * @returns {{ rows, gatedCount, mutatingCount, dangerous, dynamicCount, stackKind }}
 */
export function scanPythonRoutes(cwd) {
  const files = walkFiles(cwd, (abs) => /\.py$/.test(abs))
    .filter((abs) => !underSkippedDir(relPath(abs, cwd)))
    .sort();

  const seen = new Map();
  let dynamicCount = 0;

  const pushRow = (url, methods, gated) => {
    const mset = methods.length ? methods : ["GET"]; // Flask default is GET
    const key = url + "|" + mset.join(",");
    if (seen.has(key)) return;
    const mutates = mset.some((mm) => MUTATING.has(mm));
    seen.set(key, { url, methods: mset, mutates, sessionGated: gated, secretGated: false, devOnly: false });
  };

  for (const abs of files) {
    const raw = readText(abs);
    if (!raw) continue;
    const text = stripPyComments(raw);
    let m;

    // (1) Flask: @app.route("/path", methods=[...]) / @bp.route("/path")
    const routeRe = /@\s*[A-Za-z_]\w*\.route\s*\(\s*(['"])([^'"]+)\1([^)]*)\)/g;
    while ((m = routeRe.exec(text)) !== null) {
      const url = m[2];
      const methods = [];
      const mm = (m[3] || "").match(/methods\s*=\s*\[([^\]]*)\]/);
      if (mm) for (const t of mm[1].matchAll(/['"]([A-Za-z]+)['"]/g)) methods.push(t[1].toUpperCase());
      pushRow(url, methods, pyGated(text, m.index));
    }

    // (2) FastAPI / APIRouter: @app.get("/path") / @router.post("/path")
    const verbRe = /@\s*[A-Za-z_]\w*\.(get|post|put|patch|delete|options|head)\s*\(\s*(['"])([^'"]+)\2/g;
    while ((m = verbRe.exec(text)) !== null) {
      pushRow(m[3], [m[1].toUpperCase()], pyGated(text, m.index));
    }

    // (3) non-literal decorator paths → dynamic tally.
    const dynRe = /@\s*[A-Za-z_]\w*\.(?:route|get|post|put|patch|delete|options|head)\s*\(\s*(?!['"])/g;
    while ((m = dynRe.exec(text)) !== null) dynamicCount++;
  }

  const rows = [...seen.values()].sort(
    (a, b) => a.url.localeCompare(b.url) || a.methods.join().localeCompare(b.methods.join()),
  );
  const gatedCount = rows.filter((r) => r.sessionGated || r.secretGated).length;
  const mutatingCount = rows.filter((r) => r.mutates).length;
  const dangerous = rows.filter((r) => r.mutates && !r.sessionGated && !r.secretGated && !r.devOnly);
  return { rows, gatedCount, mutatingCount, dangerous, dynamicCount, stackKind: "python" };
}

/**
 * Stack-aware route scan — THE single source for map, check overviews, and brief.
 * Dispatches to the parser that fits the detected stack. An unsupported stack
 * (go/rust/ruby/generic) returns an empty result so the lane can print an honest
 * "not parsed yet" note.
 *
 * When no stack is supplied we detect it (detectRepoStack) so map and check never
 * disagree (finding: map-vs-check-routes). Callers that already have a stack pass
 * it to avoid a second detect.
 *
 * Hybrid honesty: a Next.js project may also host Express routes (rare); we still
 * use the Next App Router parser for kind=next. A node project without Express
 * registrations gets 0 rows — honest, not a fake Next scan.
 * @returns {{ rows, gatedCount, mutatingCount, dangerous, dynamicCount, stackKind }}
 */
export function scanRoutes(cwd, stack = null) {
  let s = stack;
  if (!s) {
    try {
      s = detectRepoStack(cwd);
    } catch {
      s = { kind: "next" };
    }
  }
  const kind = (s && s.kind) || "next";
  if (kind === "next") return { ...scanApiSurface(cwd), dynamicCount: 0, stackKind: "next" };
  if (kind === "node") return scanExpressRoutes(cwd);
  if (kind === "python") return scanPythonRoutes(cwd);
  return { rows: [], gatedCount: 0, mutatingCount: 0, dangerous: [], dynamicCount: 0, stackKind: kind };
}

/**
 * Scan integrations → label → { files:Set, keys:Set }, plus client-secret hits
 * and whether an MCP server route was found. Detection is TWO-SOURCE:
 *   1. DECLARED DEPENDENCIES — package.json (all dep fields) + requirements.txt /
 *      pyproject.toml — so an Express/Flask/plain repo's OpenAI SDK still shows
 *      up even though there is no app/ source to scan.
 *   2. app/ SOURCE — host strings + SDK imports (the Next.js-deep scan).
 * @returns {{ integrations: Map, clientSecretHits: Array<{file,key}>, mcpRouteFound: boolean }}
 */
export function scanIntegrations(cwd) {
  const appDir = path.join(cwd, "app");
  const integrations = new Map(); // label -> { files:Set, keys:Set }
  const clientSecretHits = [];
  let mcpRouteFound = false;

  function note(label, keys, file) {
    if (!integrations.has(label)) integrations.set(label, { files: new Set(), keys: new Set() });
    const e = integrations.get(label);
    e.files.add(file);
    for (const k of keys) e.keys.add(k);
  }

  // ---- 1. declared dependencies (any stack) --------------------------------
  const project = detectProject(cwd);
  for (const d of DEP_INTEGRATIONS_NODE) {
    const hit = d.dep
      ? project.deps.has(d.dep)
      : [...project.deps].some((n) => n.startsWith(d.prefix));
    if (hit) note(d.label, d.keys, "package.json (declared dependency)");
  }
  const pyDeps = pythonDeclaredDeps(cwd);
  for (const d of DEP_INTEGRATIONS_PY) {
    let src = null;
    if (d.dep) src = pyDeps.get(d.dep) || null;
    else for (const [name, s] of pyDeps) if (name.startsWith(d.prefix)) { src = s; break; }
    if (src) note(d.label, d.keys, `${src} (declared dependency)`);
  }

  // ---- 2. app/ source (Next.js-deep) ---------------------------------------
  const files = existsSync(appDir) ? walkFiles(appDir, (abs) => /\.(ts|tsx|js|mjs)$/.test(abs)) : [];
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

/** The empty-lane message, honest per detected stack. Next keeps its exact
 *  historical wording (the `check`/`ship` gate calls this with no stack, so its
 *  message must never drift). Parseable non-Next stacks name themselves; only a
 *  genuinely unsupported stack keeps the "aren't parsed yet" disclaimer. */
function emptyRouteDetail(kind, stack, dynamicCount) {
  const dyn =
    dynamicCount > 0
      ? ` (${dynamicCount} route${dynamicCount === 1 ? "" : "s"} with computed paths not shown)`
      : "";
  if (kind === "next") {
    return "No Next.js App Router routes (app/api/**/route.* or src/app/api/**/route.*) found — this lane reads Next.js App Router route files only.";
  }
  if (kind === "node") {
    if (stack && stack.frontend) {
      return `No server routes${dyn} — this looks like a client-side app, so there's nothing server-side to map. That's expected, not a problem.`;
    }
    return `No server routes found${dyn} — this lane reads your server's route definitions; none matched in ${stack ? stack.label : "this project"}.`;
  }
  if (kind === "python") {
    return `No server routes found${dyn} — this lane reads your Python route decorators; none matched in ${stack ? stack.label : "this project"}.`;
  }
  const what = stack ? stack.label.replace(/ project$/, "") : "this stack";
  return `No routes parsed — ${what} routes aren't parsed yet (this lane reads Next.js, Node, and Python web apps).`;
}

export function overviewApiSurface(cwd, stack = null) {
  const scan = scanRoutes(cwd, stack);
  const { rows, gatedCount, mutatingCount, dangerous } = scan;
  const kind = scan.stackKind;
  const dynamicCount = scan.dynamicCount || 0;

  if (rows.length === 0) {
    return result("pass", "API surface map", emptyRouteDetail(kind, stack, dynamicCount));
  }

  // Build the listing (capped so a big app stays readable).
  const lines = [];
  const CAP = 60;
  for (const r of rows.slice(0, CAP)) {
    const methodStr = r.methods.length ? r.methods.join(",") : "—";
    lines.push(`${r.url}  [${methodStr}]  ${apiRowTag(r)}`);
  }
  if (rows.length > CAP) lines.push(`…and ${rows.length - CAP} more route(s)`);
  if (dynamicCount > 0) {
    lines.push(`(${dynamicCount} route${dynamicCount === 1 ? "" : "s"} with computed paths not shown)`);
  }

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

// Declared npm dependency → integration. This is what makes the lane honest on
// a NON-Next.js repo: an Express app's `openai` dependency is an integration
// even though there's no app/ source for the deep scan to read.
const DEP_INTEGRATIONS_NODE = [
  { dep: "openai", label: "OpenAI (SDK)", keys: ["OPENAI_API_KEY"] },
  { dep: "@anthropic-ai/sdk", label: "Anthropic (SDK)", keys: ["ANTHROPIC_API_KEY"] },
  { prefix: "@anthropic-ai/", label: "Anthropic (SDK)", keys: ["ANTHROPIC_API_KEY"] },
  { dep: "@google/generative-ai", label: "Google Gemini (SDK)", keys: ["GEMINI_API_KEY"] },
  { dep: "@google/genai", label: "Google Gemini (SDK)", keys: ["GEMINI_API_KEY"] },
  { dep: "ai", label: "Vercel AI SDK", keys: [] },
  { dep: "langchain", label: "LangChain", keys: [] },
  { prefix: "@langchain/", label: "LangChain", keys: [] },
  { dep: "llamaindex", label: "LlamaIndex", keys: [] },
  { dep: "groq-sdk", label: "Groq (SDK)", keys: ["GROQ_API_KEY"] },
  { dep: "@mistralai/mistralai", label: "Mistral (SDK)", keys: ["MISTRAL_API_KEY"] },
  { dep: "cohere-ai", label: "Cohere (SDK)", keys: ["COHERE_API_KEY"] },
  { dep: "replicate", label: "Replicate (SDK)", keys: ["REPLICATE_API_TOKEN"] },
  { dep: "ollama", label: "Ollama (SDK)", keys: [] },
  { dep: "@modelcontextprotocol/sdk", label: "MCP (SDK)", keys: [] },
  { dep: "mcp-handler", label: "MCP server (mcp-handler)", keys: [] },
  { dep: "stripe", label: "Stripe (SDK)", keys: ["STRIPE_SECRET_KEY"] },
  { dep: "resend", label: "Resend (SDK)", keys: ["RESEND_API_KEY"] },
  { dep: "@sendgrid/mail", label: "SendGrid (SDK)", keys: ["SENDGRID_API_KEY"] },
  { dep: "twilio", label: "Twilio (SDK)", keys: ["TWILIO_AUTH_TOKEN"] },
  { dep: "@supabase/supabase-js", label: "Supabase (SDK)", keys: ["SUPABASE_URL", "SUPABASE_ANON_KEY"] },
];

// Declared Python dependency (requirements.txt / pyproject.toml) → integration.
const DEP_INTEGRATIONS_PY = [
  { dep: "openai", label: "OpenAI (SDK)", keys: ["OPENAI_API_KEY"] },
  { dep: "anthropic", label: "Anthropic (SDK)", keys: ["ANTHROPIC_API_KEY"] },
  { dep: "langchain", label: "LangChain", keys: [] },
  { prefix: "langchain-", label: "LangChain", keys: [] },
  { dep: "litellm", label: "LiteLLM", keys: [] },
  { dep: "google-generativeai", label: "Google Gemini (SDK)", keys: ["GEMINI_API_KEY"] },
  { dep: "google-genai", label: "Google Gemini (SDK)", keys: ["GEMINI_API_KEY"] },
  { dep: "cohere", label: "Cohere (SDK)", keys: ["COHERE_API_KEY"] },
  { dep: "mistralai", label: "Mistral (SDK)", keys: ["MISTRAL_API_KEY"] },
  { dep: "groq", label: "Groq (SDK)", keys: ["GROQ_API_KEY"] },
  { dep: "llama-index", label: "LlamaIndex", keys: [] },
  { dep: "mcp", label: "MCP (SDK)", keys: [] },
  { dep: "stripe", label: "Stripe (SDK)", keys: ["STRIPE_SECRET_KEY"] },
  { dep: "boto3", label: "AWS (boto3)", keys: ["AWS_ACCESS_KEY_ID"] },
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

export function overviewIntegrations(cwd, stack = null) {
  const { integrations, clientSecretHits, mcpRouteFound } = scanIntegrations(cwd);

  if (integrations.size === 0 && clientSecretHits.length === 0) {
    return result(
      "pass",
      "Agents & integrations map",
      "No known LLM / 3rd-party integrations found — none declared in dependencies (package.json / requirements.txt / pyproject.toml) and none detected in app/ source.",
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

  const detail = `${labels.length} integration(s) detected (declared dependencies + app/ source)${mcpRouteFound ? ", incl. an MCP server" : ""}.`;

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
  // BOM-tolerant read (PowerShell default) — see util.readJsonFile.
  const { json } = readJsonFile(path.join(cwd, "vercel.json"));
  if (!json) return map;
  const crons = Array.isArray(json?.crons) ? json.crons : [];
  for (const c of crons) {
    if (c && typeof c.path === "string") map.set(c.path, c.schedule || "(no schedule)");
  }
  return map;
}

export function overviewSchedules(cwd, stack = null) {
  const { rows, ungated, orphanRoutes, missing, cronCount } = scanSchedules(cwd);

  if (rows.length === 0) {
    return result(
      "pass",
      "Schedules & jobs map",
      "No vercel.json crons or app/api/cron/* routes found — this lane reads Vercel cron config only; other schedulers (OS cron, Celery, GitHub Actions schedules) aren't parsed yet.",
    );
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

// ===========================================================================
// 4. PROJECT ESTATE (the generic map lane — useful on ANY repo)
// ===========================================================================
// The deep lanes above are Next.js-specific. This lane is not: a top-level
// module inventory (dirs + file counts + languages) plus dependency highlights,
// so `map` on an Express/Flask/Go/plain repo still hands the builder a real
// orientation instead of three "nothing to map" lines.

const ESTATE_SKIP_DIR = new Set([
  ".git", "node_modules", ".next", ".vercel", ".data", "dist", "build", "coverage",
  ".turbo", "__pycache__", ".venv", "venv", "target", "vendor",
]);

const EXT_LANG = {
  ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".jsx": "JavaScript",
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript",
  ".py": "Python", ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".java": "Java",
  ".kt": "Kotlin", ".php": "PHP", ".cs": "C#", ".c": "C", ".cpp": "C++", ".h": "C/C++",
  ".css": "CSS", ".scss": "CSS", ".html": "HTML", ".sql": "SQL",
  ".sh": "Shell", ".ps1": "PowerShell", ".md": "Markdown", ".yml": "YAML", ".yaml": "YAML",
};

/** Tally languages for a list of absolute file paths → sorted ["TypeScript (41)", …]. */
function languageTally(files) {
  const tally = new Map();
  for (const abs of files) {
    const lang = EXT_LANG[path.extname(abs).toLowerCase()];
    if (lang) tally.set(lang, (tally.get(lang) || 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Scan the top-level estate → pure data (modules, languages, dependency
 * highlights). Read-only, best-effort.
 */
export function scanEstate(cwd) {
  let entries = [];
  try {
    entries = readdirSync(cwd, { withFileTypes: true });
  } catch { /* best-effort */ }

  const modules = [];
  let looseFiles = 0;
  const allFiles = [];
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (ESTATE_SKIP_DIR.has(ent.name)) continue;
      const abs = path.join(cwd, ent.name);
      const files = walkFiles(abs);
      if (files.length === 0) continue;
      allFiles.push(...files);
      const langs = languageTally(files).slice(0, 2).map(([lang]) => lang);
      modules.push({ dir: ent.name, files: files.length, langs });
    } else if (ent.isFile()) {
      looseFiles++;
      allFiles.push(path.join(cwd, ent.name));
    }
  }
  modules.sort((a, b) => b.files - a.files);

  // Dependency highlights: declared runtime deps first (they shape the app),
  // then dev deps; then Python declarations. Names only, capped for readability.
  const project = detectProject(cwd);
  const depNames = [];
  if (project.pkg) {
    const runtime = project.pkg.dependencies && typeof project.pkg.dependencies === "object"
      ? Object.keys(project.pkg.dependencies) : [];
    const dev = project.pkg.devDependencies && typeof project.pkg.devDependencies === "object"
      ? Object.keys(project.pkg.devDependencies) : [];
    depNames.push(...runtime, ...dev.filter((d) => !runtime.includes(d)));
  }
  const pyDeps = [...pythonDeclaredDeps(cwd).keys()];

  return { modules, looseFiles, languages: languageTally(allFiles), depNames, pyDeps, project };
}

/** The estate lane, rendered in the runner's result shape. Never warns — it's
 *  pure orientation. */
export function overviewEstate(cwd) {
  const { modules, looseFiles, languages, depNames, pyDeps, project } = scanEstate(cwd);

  const totalFiles = modules.reduce((n, m) => n + m.files, 0) + looseFiles;
  const topLangs = languages.slice(0, 3).map(([lang, n]) => `${lang} (${n})`);
  const detail =
    `${modules.length} top-level module(s) · ${totalFiles} file(s)` +
    (topLangs.length ? ` · languages: ${topLangs.join(", ")}` : "");

  const lines = [];
  const CAP = 15;
  for (const m of modules.slice(0, CAP)) {
    lines.push(`${m.dir}/ — ${m.files} file(s)${m.langs.length ? ` (${m.langs.join(", ")})` : ""}`);
  }
  if (modules.length > CAP) lines.push(`…and ${modules.length - CAP} more top-level dir(s)`);
  if (looseFiles > 0) lines.push(`(plus ${looseFiles} file(s) at the repo root)`);

  if (depNames.length > 0) {
    const shown = depNames.slice(0, 12);
    lines.push(
      `Dependencies (package.json): ${shown.join(", ")}${depNames.length > shown.length ? ` …and ${depNames.length - shown.length} more` : ""}`,
    );
  } else if (project.packageJsonBroken) {
    lines.push("Dependencies: package.json exists but could not be parsed — fix the JSON to see them here.");
  }
  if (pyDeps.length > 0) {
    const shown = pyDeps.slice(0, 12);
    lines.push(
      `Dependencies (Python): ${shown.join(", ")}${pyDeps.length > shown.length ? ` …and ${pyDeps.length - shown.length} more` : ""}`,
    );
  }
  if (depNames.length === 0 && pyDeps.length === 0 && !project.packageJsonBroken) {
    lines.push("No declared dependencies found (package.json / requirements.txt / pyproject.toml).");
  }

  return result("pass", "Project estate", detail, lines);
}
