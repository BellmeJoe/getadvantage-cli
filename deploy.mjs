// Ship-Safe — the safe-deploy ritual (`ship-safe deploy`).
//
// This productizes getAdvantage's hard-won deploy rules:
//   1. `vercel --prod` ships the WORKING TREE, so we deploy from a CLEAN
//      DETACHED worktree of the exact target commit — never the live, possibly
//      dirty, shared checkout (a concurrent session's uncommitted work has
//      shipped to prod this way before).
//   2. We CONFIRM the resulting deployment URL starts with the EXPECTED project
//      prefix (derived from your linked .vercel project, or set with
//      --expect-prefix); a different prefix means we deployed the WRONG
//      project — STOP, non-zero exit.
//   3. The Vercel token is read from an ENV VAR by NAME — never hardcoded,
//      never echoed/logged.
//
// IMPORTANT: this runs only when you explicitly invoke `ship-safe deploy`.
// It runs `vercel --prod` for real.

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { c, git, gitSafe, readJsonFile, section } from "./util.mjs";
import { runChecks } from "./checks-runner.mjs";

/** Read the linked Vercel project (.vercel/project.json), or null. Used to derive
 *  a sensible wrong-project guard prefix when --expect-prefix isn't given. */
function readVercelProject(cwd) {
  // BOM-tolerant (PowerShell default) — see util.readJsonFile.
  return readJsonFile(path.join(cwd, ".vercel", "project.json")).json;
}

/**
 * @param {object} o
 * @param {string} o.cwd           repo root
 * @param {string} o.commit        target commit-ish (default HEAD)
 * @param {string} o.expectPrefix  required deployment-URL prefix (default: derived from .vercel projectName; guard skipped if none)
 * @param {string} o.scope         Vercel team scope (passed through to vercel)
 * @param {string} o.tokenEnv      NAME of the env var holding the Vercel token
 * @param {boolean} o.force        deploy even if `check` returns NO-GO
 * @param {boolean} o.runBuild     whether `check` should run a full build too
 */
export async function deploy(o) {
  const cwd = o.cwd;
  const commit = o.commit || "HEAD";
  const tokenEnv = o.tokenEnv || "VERCEL_TOKEN";
  // The wrong-project guard. Prefer an explicit --expect-prefix; otherwise derive
  // it from the linked Vercel project so the guard works in ANY repo (not just
  // ours). If we can't derive one, the guard is disabled and we say so — we never
  // silently assume a project.
  let expectPrefix = o.expectPrefix;
  if (!expectPrefix) {
    const proj = readVercelProject(cwd);
    if (proj && typeof proj.projectName === "string" && proj.projectName) {
      expectPrefix = `${proj.projectName}-`;
    }
  }

  console.log(c.bold("\nShip-Safe — safe deploy"));
  console.log(
    c.dim(`  target commit: ${commit}   expect prefix: ${expectPrefix || "(none — wrong-project guard disabled)"}\n`),
  );

  // ---- 0. Resolve the token by NAME, never echo it. -----------------------
  const token = process.env[tokenEnv];
  if (!token) {
    console.error(c.red(`✗ Env var ${tokenEnv} is not set — can't authenticate to Vercel.`));
    console.error(c.gray(`  Set it (e.g. from your User-scoped VERCEL_TOKEN) and retry; the value is never printed.`));
    return 1;
  }

  // ---- 1. Gate on `check` first (unless --force). -------------------------
  section("Pre-deploy checks");
  const { exitCode } = await runChecks({ cwd, runBuild: o.runBuild });
  if (exitCode !== 0) {
    if (!o.force) {
      console.error(c.red("\n✗ NO-GO — checks failed. Aborting deploy. (Re-run with --force to override at your own risk.)"));
      return 1;
    }
    console.error(c.yellow("\n⚠ Checks failed but --force was passed — proceeding anyway."));
  }

  // ---- 2. Resolve the exact commit SHA we're shipping. --------------------
  const sha = git(["rev-parse", commit], { cwd });

  // ---- 3. Create a CLEAN DETACHED worktree of that commit. ----------------
  // A detached worktree is a pristine checkout of the SHA — none of the live
  // checkout's uncommitted work can ride along. We place it in the OS temp dir
  // so we never disturb sibling repos / the shared folder.
  const wtDir = mkdtempSync(path.join(tmpdir(), "ship-safe-deploy-"));
  let deployed = false;
  let deployUrl = "";
  try {
    section("Clean worktree");
    console.log(c.gray(`  Creating detached worktree at ${wtDir} @ ${sha.slice(0, 10)}`));
    // --detach: no branch, just the commit. The worktree is a clean tree.
    git(["worktree", "add", "--detach", wtDir, sha], { cwd });

    // ---- 4. Copy `.vercel` (project link) into the worktree. --------------
    // The worktree is a fresh checkout and won't contain the gitignored .vercel
    // dir, so vercel wouldn't know which project to target. Copy it over.
    const srcVercel = path.join(cwd, ".vercel");
    if (existsSync(srcVercel)) {
      cpSync(srcVercel, path.join(wtDir, ".vercel"), { recursive: true });
      console.log(c.gray("  Copied .vercel project link into the worktree."));
    } else {
      console.error(c.red("✗ No .vercel/ found in the repo — can't confirm the target project. Run `vercel link` first."));
      return 1;
    }

    // ---- 5. Run `vercel --prod` FROM the worktree. ------------------------
    // We pass the token via the --token flag value (read from env above) and the
    // scope through --scope. The token value is never logged by us; we spawn
    // with stdio inherited so vercel's own output streams to the founder.
    section("Deploying");
    const vercelArgs = ["--yes", "vercel", "--prod", "--yes"];
    if (o.scope) vercelArgs.push("--scope", o.scope);
    vercelArgs.push("--token", token); // value from env; not printed by us

    // Print a redacted version of the command (token masked) for transparency.
    const shown = vercelArgs.map((a) => (a === token ? "<token:hidden>" : a));
    console.log(c.gray(`  npx ${shown.join(" ")}   (cwd=${wtDir})`));

    // Capture stdout so we can read the deployment URL, but also echo it live.
    const proc = spawnSync("npx", vercelArgs, {
      cwd: wtDir,
      encoding: "utf8",
      shell: process.platform === "win32",
      maxBuffer: 32 * 1024 * 1024,
    });
    deployed = true;
    const stdout = proc.stdout || "";
    const stderr = proc.stderr || "";
    // Echo vercel's output (it normally prints the URL on stdout).
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);

    if (proc.status !== 0) {
      console.error(c.red(`\n✗ vercel exited with code ${proc.status}. Deploy not confirmed.`));
      return proc.status || 1;
    }

    // ---- 6. Extract + CONFIRM the deployment URL prefix. ------------------
    // Vercel prints a https://<project>-<hash>-<scope>.vercel.app URL. Grab the
    // last vercel.app URL in the output and check its host's prefix.
    const urls = `${stdout}\n${stderr}`.match(/https:\/\/[a-z0-9-]+\.vercel\.app/gi) || [];
    deployUrl = urls.length ? urls[urls.length - 1] : "";
    if (!deployUrl) {
      console.error(c.red("\n✗ Could not find a deployment URL in vercel's output — STOP and verify manually."));
      return 1;
    }

    const host = deployUrl.replace(/^https:\/\//, "");
    section("Confirm target");
    if (expectPrefix) {
      if (!host.startsWith(expectPrefix)) {
        // WRONG PROJECT. This is the load-bearing guard — a host with a
        // different prefix means we shipped to the wrong project. Hard stop.
        console.error(
          c.red(
            `\n✗ STOP — deployment host "${host}" does NOT start with the expected "${expectPrefix}".`,
          ),
        );
        console.error(
          c.red(
            "   You may have deployed the WRONG project. Verify in the Vercel dashboard and roll back if needed.",
          ),
        );
        return 2;
      }
      console.log(c.green(`✓ Deployed to ${deployUrl} — host prefix "${expectPrefix}" confirmed.`));
    } else {
      console.log(
        c.yellow(`⚠ Deployed to ${deployUrl} — no expected prefix set, so the wrong-project guard was skipped.`),
      );
      console.log(c.gray("   Pass --expect-prefix <project>- (or link a .vercel project) to enable the guard."));
    }
    return 0;
  } catch (e) {
    console.error(c.red(`\n✗ Deploy failed: ${e.message || e}`));
    return 1;
  } finally {
    // ---- 7. Always clean up the temp worktree. ---------------------------
    // Deregister it from git AND remove the dir, best-effort. We never touch
    // the live checkout here.
    try {
      gitSafe(["worktree", "remove", "--force", wtDir], { cwd });
    } catch {
      /* ignore */
    }
    try {
      if (existsSync(wtDir)) rmSync(wtDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    // Prune any dangling worktree admin entry.
    gitSafe(["worktree", "prune"], { cwd });
    if (deployed && deployUrl) {
      console.log(c.dim("  (temp worktree cleaned up.)"));
    }
  }
}
