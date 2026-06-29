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
// safe default (feature "absent") on any error.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function readJson(abs) {
  try {
    return JSON.parse(readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

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
 *   hasPackageJson: boolean,
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
  const pkg = readJson(path.join(cwd, "package.json"));
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
  else label = "generic repo";

  return {
    pkg,
    scripts,
    deps,
    hasPackageJson,
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
