// getAdvantage Action — credential-scrubbed project dependency install.
//
// Invoked from action.yml before the gate. Runs npm ci / npm install with
// --ignore-scripts in a child process whose environment has all credentials
// stripped (GITHUB_TOKEN, OIDC, GETADVANTAGE_API_KEY, npm/cloud secrets, …).
// A hostile repo .npmrc that interpolates ${ENV_VAR} therefore cannot see
// inherited Actions secrets.
//
// Non-mutating: when package-lock.json is absent, uses
// `npm install --ignore-scripts --no-package-lock` so no lockfile is created.
// Node built-ins only. ESM.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scrubCredentialEnv } from "../util.mjs";

/**
 * Decide install argv for the working directory.
 * @param {string} cwd
 * @returns {{args:string[], mode:string}|{skip:true, reason:string}}
 */
export function planProjectInstall(cwd) {
  const root = cwd || process.cwd();
  if (existsSync(path.join(root, "package-lock.json"))) {
    return { args: ["ci", "--ignore-scripts"], mode: "ci" };
  }
  if (existsSync(path.join(root, "package.json"))) {
    return { args: ["install", "--ignore-scripts", "--no-package-lock"], mode: "install-no-lock" };
  }
  return { skip: true, reason: "no-package-json" };
}

/**
 * Run project install with a fully credential-scrubbed environment.
 * @param {object} [o]
 * @param {string} [o.cwd]
 * @param {NodeJS.ProcessEnv|Record<string,string|undefined>} [o.env]
 * @param {typeof spawnSync} [o.spawnSyncImpl]
 * @returns {{ok:boolean, code:number, mode:string, reason?:string, scrubbedKeys?:string[]}}
 */
export function runProjectInstall(o = {}) {
  const cwd = o.cwd || process.cwd();
  const plan = planProjectInstall(cwd);
  if (plan.skip) {
    console.log(`getadvantage-action: install skipped (${plan.reason}).`);
    return { ok: true, code: 0, mode: "skip", reason: plan.reason };
  }

  const parentEnv = o.env || process.env;
  const scrubbed = scrubCredentialEnv(parentEnv);
  // Defense in depth: never re-introduce high-risk keys even if scrub regresses.
  for (const k of [
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_URL",
    "ACTIONS_RUNTIME_TOKEN",
    "GETADVANTAGE_API_KEY",
    "NPM_TOKEN",
    "NODE_AUTH_TOKEN",
    "NPM_AUTH_TOKEN",
  ]) {
    delete scrubbed[k];
  }

  const spawnImpl = typeof o.spawnSyncImpl === "function" ? o.spawnSyncImpl : spawnSync;
  const result = spawnImpl("npm", plan.args, {
    cwd,
    env: scrubbed,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    timeout: 10 * 60 * 1000,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const code = typeof result.status === "number" ? result.status : 1;
  if (result.error || code !== 0) {
    console.error(
      `getadvantage-action: project install failed (mode=${plan.mode}, code=${code}${result.error ? `, ${result.error.message}` : ""}).`,
    );
    return { ok: false, code: code || 1, mode: plan.mode, reason: "install-failed" };
  }
  console.log(`getadvantage-action: project install ok (mode=${plan.mode}, --ignore-scripts).`);
  return { ok: true, code: 0, mode: plan.mode };
}

/** CLI entry for action.yml. */
export function runInstallFromEnv(env = process.env) {
  const r = runProjectInstall({ cwd: process.cwd(), env });
  return r.ok ? 0 : r.code || 1;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  process.exit(runInstallFromEnv(process.env));
}
