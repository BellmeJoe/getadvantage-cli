// getAdvantage CLI — PROJECT DETECTION.
//
// The check gate must be trustworthy on a STRANGER'S repo, not just the
// founder's Next.js/TS app. A plain-Node project has no tsconfig.json, no
// `app/lib/server/db.ts`, no `next` dependency — blindly running `npx tsc` or
// asserting the schema-bump pattern there produces a FALSE NO-GO that destroys
// trust. So we detect what the project actually is and only run the checks that
// apply.
//
// Pure, read-only, Node built-ins only. Best-effort: every probe degrades to a
// safe default (feature "absent") on any error — EXCEPT a package.json that
// exists but cannot be parsed, which is surfaced explicitly (packageJsonBroken)
// so the gate never silently skips the build on a broken/BOM'd manifest.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { readJsonFile, stripBom } from "./util.mjs";

/** All dependency names declared in package.json (deps + dev + peer + optional). */
function allDeps(pkg) {
  if (!pkg) return new Set();
  const names = new Set();
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const m = pkg[field];
    if (m && typeof m === "object") for (const k of Object.keys(m)) names.add(k);
  }
  return names;
}

/**
 * Detect the project's shape so each check can decide whether it applies.
 * @param {string} cwd  repo root
 * @returns {{
 *   pkg: object|null,
 *   scripts: object,
 *   deps: Set<string>,
 *   hasPackageJson: boolean,        // package.json present AND parseable
 *   packageJsonExists: boolean,     // the file exists on disk (parseable or not)
 *   packageJsonBroken: boolean,     // exists but could NOT be parsed
 *   hasTsConfig: boolean,
 *   hasTypeScript: boolean,   // typescript is a (dev)dependency
 *   typecheckable: boolean,   // tsconfig + typescript both present → tsc applies
 *   hasNext: boolean,         // a Next.js app
 *   hasBuildScript: boolean,  // package.json has a "build" script
 *   buildCmd: string|null,    // the build command to run, if any
 *   hasSchemaVersionPattern: boolean,  // the SCHEMA_VERSION-sentinel db.ts pattern
 *   schemaDbPath: string|null,         // the db file carrying that pattern
 *   label: string,            // a short human description of the detected stack
 * }}
 */
export function detectProject(cwd) {
  // BOM-tolerant read that distinguishes "no file" from "exists but broken" —
  // a PowerShell-written (BOM'd) package.json must still detect as a Node
  // project, and a genuinely broken one must never masquerade as absent.
  const pkgRead = readJsonFile(path.join(cwd, "package.json"));
  const pkg = pkgRead.ok && pkgRead.json && typeof pkgRead.json === "object" ? pkgRead.json : null;
  const packageJsonExists = pkgRead.exists;
  const packageJsonBroken = pkgRead.exists && !pkg;

  const deps = allDeps(pkg);
  const scripts = (pkg && pkg.scripts && typeof pkg.scripts === "object") ? pkg.scripts : {};

  const hasPackageJson = !!pkg;
  const hasTsConfig = existsSync(path.join(cwd, "tsconfig.json"));
  const hasTypeScript = deps.has("typescript");
  const typecheckable = hasTsConfig && hasTypeScript;
  const hasNext = deps.has("next");
  const hasBuildScript = typeof scripts.build === "string" && scripts.build.trim().length > 0;
  const buildCmd = hasBuildScript ? scripts.build : null;

  // Schema-bump check only makes sense on a repo that actually uses the
  // SCHEMA_VERSION sentinel. Probe the canonical path first (fast), then a
  // couple of common alternatives — but only treat it as present if the file
  // genuinely contains a `SCHEMA_VERSION = <n>` declaration.
  const SCHEMA_CANDIDATES = [
    "app/lib/server/db.ts",
    "app/lib/db.ts",
    "lib/db.ts",
    "src/lib/server/db.ts",
    "src/db.ts",
  ];
  let schemaDbPath = null;
  for (const rel of SCHEMA_CANDIDATES) {
    const abs = path.join(cwd, rel);
    if (!existsSync(abs)) continue;
    let txt = "";
    try {
      txt = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (/SCHEMA_VERSION\s*=\s*\d+/.test(txt)) {
      schemaDbPath = rel;
      break;
    }
  }
  const hasSchemaVersionPattern = !!schemaDbPath;

  // A short human label so the gate can tell the user what it thinks the repo is.
  let label;
  if (hasNext) label = "Next.js / TypeScript app";
  else if (typecheckable) label = "TypeScript project";
  else if (hasPackageJson) label = "Node project";
  else if (packageJsonBroken) label = "Node project (package.json exists but could not be parsed)";
  else label = "generic repo";

  return {
    pkg,
    scripts,
    deps,
    hasPackageJson,
    packageJsonExists,
    packageJsonBroken,
    hasTsConfig,
    hasTypeScript,
    typecheckable,
    hasNext,
    hasBuildScript,
    buildCmd,
    hasSchemaVersionPattern,
    schemaDbPath,
    label,
  };
}

// ===========================================================================
// CROSS-STACK DETECTION (for the `map` scope line + dep-based integrations)
// ===========================================================================
// The overview lanes are Next.js-deep; on any other stack the map must OPEN
// with an honest scope statement instead of three bare "nothing to map" lines.
// This detector is best-effort and read-only.

/**
 * Declared Python dependencies (requirements.txt + pyproject.toml), lowercase
 * package name → the file it was declared in. Best-effort parse; never throws.
 * @returns {Map<string, string>}
 */
export function pythonDeclaredDeps(cwd) {
  const out = new Map();
  // requirements.txt: one requirement per line; name is the token before any
  // version/extras/marker syntax. Comments and options (-r, --hash) skipped.
  const reqAbs = path.join(cwd, "requirements.txt");
  if (existsSync(reqAbs)) {
    try {
      const raw = stripBom(readFileSync(reqAbs, "utf8"));
      for (const line of raw.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#") || t.startsWith("-")) continue;
        const m = t.match(/^([A-Za-z0-9._-]+)/);
        if (m) out.set(m[1].toLowerCase(), "requirements.txt");
      }
    } catch { /* best-effort */ }
  }
  // pyproject.toml: crude but safe — quoted requirement strings anywhere in the
  // dependencies arrays, plus poetry-style `name = "^x.y"` table keys.
  const pyAbs = path.join(cwd, "pyproject.toml");
  if (existsSync(pyAbs)) {
    try {
      const raw = stripBom(readFileSync(pyAbs, "utf8"));
      for (const m of raw.matchAll(/"([A-Za-z0-9._-]+)(?:\[[^\]]*\])?\s*(?:[><=~!^;].*)?"/g)) {
        out.set(m[1].toLowerCase(), "pyproject.toml");
      }
    } catch { /* best-effort */ }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Client-app orientation (Vite / React / Supabase) — evidence-only.
// ---------------------------------------------------------------------------
// For Lovable/Bolt-style SPA exports the map must open with useful client
// orientation, not Express jargon or invented server routes. Detection is
// root-manifest only (nested package.json packages are not claimed as the map
// root). Statuses: detected | not detected | not checkable.
// Never invents Supabase RLS/auth/security verdicts from SDK or VITE_SUPABASE_*.

const VITE_CONFIG_CANDIDATES = [
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
  "vite.config.cts",
];

const ENTRY_CANDIDATES = [
  "index.html",
  "src/main.tsx",
  "src/main.ts",
  "src/main.jsx",
  "src/main.js",
  "src/index.tsx",
  "src/index.ts",
  "src/index.jsx",
  "src/index.js",
  "main.tsx",
  "main.jsx",
  "main.ts",
  "main.js",
];

/**
 * Evidence-only Vite / React / Supabase client orientation for the estate map.
 * Root package.json + root config/entry files only — nested monorepo packages
 * are listed in the estate inventory but are not claimed as the map root.
 *
 * @param {string} cwd  repo root
 * @param {object} [project]  optional detectProject result (avoids re-parse)
 * @returns {{
 *   clientApp: { kind: string, label: string },
 *   signals: {
 *     vite: { status: string, evidence: string[] },
 *     react: { status: string, evidence: string[] },
 *     supabase: { status: string, evidence: string[] },
 *   },
 *   build: { config: string|null, entry: string|null },
 *   nextCheck: string,
 *   notes: string[],
 * }}
 */
export function detectClientOrientation(cwd, project = null) {
  const proj = project || detectProject(cwd);
  const hasFile = (rel) => existsSync(path.join(cwd, rel));

  // not checkable: package.json exists but is unparseable — we cannot trust deps.
  if (proj.packageJsonBroken) {
    return {
      clientApp: { kind: "not-checkable", label: "client stack not checkable (package.json unreadable)" },
      signals: {
        vite: { status: "not checkable", evidence: ["package.json (exists but could not be parsed)"] },
        react: { status: "not checkable", evidence: ["package.json (exists but could not be parsed)"] },
        supabase: { status: "not checkable", evidence: ["package.json (exists but could not be parsed)"] },
      },
      build: { config: null, entry: null },
      nextCheck: "Fix package.json so it parses as JSON, then re-run getadvantage map.",
      notes: [
        "Client orientation requires a readable root package.json; nested packages are not treated as the map root.",
        "No server routes, Supabase RLS, auth posture, or deployment claims are inferred from this scan.",
      ],
    };
  }

  const deps = proj.deps;
  const hasPkg = proj.hasPackageJson;

  // ---- Vite signal (root only) ----
  const viteEvidence = [];
  if (hasPkg && deps.has("vite")) viteEvidence.push("package.json (dependency: vite)");
  let viteConfig = null;
  for (const rel of VITE_CONFIG_CANDIDATES) {
    if (hasFile(rel)) {
      viteConfig = rel;
      viteEvidence.push(rel);
      break;
    }
  }
  // index.html is a weak Vite/SPA hint only when Vite is already indicated by
  // dep or config — alone it is not enough to claim Vite (static HTML exists
  // everywhere). Still useful as entry evidence below.
  let viteStatus;
  if (!hasPkg && !viteConfig) {
    viteStatus = hasFile("package.json") ? "not checkable" : "not detected";
  } else if (viteEvidence.length > 0) {
    viteStatus = "detected";
  } else {
    viteStatus = "not detected";
  }

  // ---- React signal (root only) ----
  const reactEvidence = [];
  if (hasPkg && deps.has("react")) reactEvidence.push("package.json (dependency: react)");
  if (hasPkg && deps.has("react-dom")) reactEvidence.push("package.json (dependency: react-dom)");
  // Dedup while preserving order
  const reactEvUnique = [...new Set(reactEvidence)];
  let reactStatus;
  if (!hasPkg) {
    reactStatus = hasFile("package.json") ? "not checkable" : "not detected";
  } else if (reactEvUnique.length > 0) {
    reactStatus = "detected";
  } else {
    reactStatus = "not detected";
  }

  // ---- Supabase signal (SDK only — env names alone never count as detected) ----
  // VITE_SUPABASE_* / SUPABASE_* in .env prove nothing about SDK use, RLS, or
  // auth. We deliberately do not read .env values into the map.
  const supabaseEvidence = [];
  if (hasPkg && deps.has("@supabase/supabase-js")) {
    supabaseEvidence.push("package.json (dependency: @supabase/supabase-js)");
  }
  let supabaseStatus;
  if (!hasPkg) {
    supabaseStatus = hasFile("package.json") ? "not checkable" : "not detected";
  } else if (supabaseEvidence.length > 0) {
    supabaseStatus = "detected";
  } else {
    supabaseStatus = "not detected";
  }

  // ---- Build entry evidence (paths only; never file contents / secrets) ----
  let entry = null;
  for (const rel of ENTRY_CANDIDATES) {
    if (hasFile(rel)) {
      entry = rel;
      break;
    }
  }

  const viteOk = viteStatus === "detected";
  const reactOk = reactStatus === "detected";
  const supabaseOk = supabaseStatus === "detected";

  let kind = "none";
  let label = "no client SPA stack detected at repo root";
  if (viteOk && reactOk) {
    kind = "vite-react";
    label = "Vite + React project";
  } else if (viteOk) {
    kind = "vite";
    label = "Vite project";
  } else if (reactOk) {
    kind = "react";
    label = "React project";
  }

  // Honest next check: one concrete step that helps the builder; never a
  // security seal, RLS verdict, or invented route claim.
  let nextCheck;
  if (kind === "none" && !hasPkg) {
    nextCheck = "Add a root package.json (or run map from the app package root), then re-run getadvantage map.";
  } else if (viteOk) {
    nextCheck = "Run getadvantage ship (or check --build) to verify the production build script succeeds.";
  } else if (reactOk) {
    nextCheck = "Confirm the root package.json build script, then run getadvantage ship (or check --build).";
  } else {
    nextCheck = "Run getadvantage ship for the GO / NO-GO gate (map is orientation only).";
  }

  const notes = [
    "Client orientation is evidence-only from the repo root (package.json deps + config/entry paths).",
    "Nested package.json packages are not claimed as the map root.",
    "Route mapping does not invent server/API routes for client apps.",
    "Supabase SDK presence is not an RLS, auth, or security verdict; VITE_SUPABASE_* / secret prefixes are never exemptions.",
  ];
  if (supabaseOk) {
    notes.push("Supabase: SDK declared only — no policy/migration/auth posture is inferred by this map.");
  }

  return {
    clientApp: { kind, label },
    signals: {
      vite: { status: viteStatus, evidence: viteEvidence },
      react: { status: reactStatus, evidence: reactEvUnique },
      supabase: { status: supabaseStatus, evidence: supabaseEvidence },
    },
    build: {
      config: viteConfig,
      entry,
    },
    nextCheck,
    notes,
  };
}

/**
 * Detect the repo's overall stack for the map's honest scope line.
 * @returns {{ kind: "next"|"node"|"python"|"go"|"rust"|"ruby"|"generic",
 *             label: string, nextJs: boolean, frontend?: boolean, project: object }}
 */
export function detectRepoStack(cwd) {
  const project = detectProject(cwd);
  const has = (f) => existsSync(path.join(cwd, f));

  if (project.hasPackageJson || project.packageJsonBroken) {
    const deps = project.deps;
    if (deps.has("next")) {
      return { kind: "next", label: "Next.js project", nextJs: true, project };
    }
    let label = "Node project";
    let frontend = false; // a client-side app (no server framework) → nothing server-side to map
    const hasServerFw = deps.has("express") || deps.has("fastify") || deps.has("koa");
    if (deps.has("express")) label = "Express project";
    else if (deps.has("fastify")) label = "Fastify project";
    else if (deps.has("koa")) label = "Koa project";
    else if (deps.has("vite") && deps.has("react")) {
      // Dominant ICP (Lovable/Bolt-style): name both tools when both are present.
      label = "Vite + React project";
      frontend = true;
    } else if (deps.has("react")) {
      label = "React project";
      frontend = true;
    } else if (deps.has("vue")) {
      label = "Vue project";
      frontend = true;
    } else if (deps.has("svelte")) {
      label = "Svelte project";
      frontend = true;
    } else if (deps.has("vite")) {
      label = "Vite project";
      frontend = true;
    } else if (project.packageJsonBroken) {
      label = "Node project (package.json exists but could not be parsed)";
    }
    // A frontend build tool alongside a UI lib still means client-only if no server framework is present.
    if (!frontend && deps.has("vite") && !hasServerFw) {
      frontend = true;
    }
    // React (or other SPA lib) + Vite without a server framework → client-only.
    if (!frontend && !hasServerFw && (deps.has("react") || deps.has("vue") || deps.has("svelte"))) {
      frontend = true;
    }
    return { kind: "node", label, nextJs: false, frontend, project };
  }

  if (has("requirements.txt") || has("pyproject.toml") || has("setup.py") || has("Pipfile")) {
    const py = pythonDeclaredDeps(cwd);
    let label = "Python project";
    if (py.has("django")) label = "Python (Django) project";
    else if (py.has("flask")) label = "Python (Flask) project";
    else if (py.has("fastapi")) label = "Python (FastAPI) project";
    return { kind: "python", label, nextJs: false, project };
  }

  if (has("go.mod")) return { kind: "go", label: "Go project", nextJs: false, project };
  if (has("Cargo.toml")) return { kind: "rust", label: "Rust project", nextJs: false, project };
  if (has("Gemfile")) return { kind: "ruby", label: "Ruby project", nextJs: false, project };

  return { kind: "generic", label: "generic repo (no recognized manifest)", nextJs: false, project };
}
