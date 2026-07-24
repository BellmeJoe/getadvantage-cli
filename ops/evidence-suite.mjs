// getAdvantage — EVIDENCE SUITE
// ============================================================================
// The deterministic, LLM-free half of the release ritual (Loop 1). It scaffolds
// a fixed set of throwaway repos, runs the REAL CLI against each, and asserts the
// verdict that would make or break trust — then prints a GREEN/RED scoreboard.
//
// This is the cheap gate you run before EVERY release (seconds, no API cost):
//   node ops/evidence-suite.mjs            # scoreboard to the terminal
//   node ops/evidence-suite.mjs --json     # machine JSON (for trend/CI)
//
// It answers ONE question in one glance — "does the tool still do the thing?" —
// so a wall of commits from many models can't hide a regression in the behaviour
// that matters. The subjective half ("is the OUTPUT sensible for the ICP, what
// did we miss?") is the two-model refute workflow, run per minor release; this
// suite is the objective floor beneath it.
//
// Exit code: 0 iff every capability is GREEN (so it can gate a release).
// ============================================================================

import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = path.join(ROOT, "index.mjs");
const VERSION = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const JSON_OUT = process.argv.includes("--json");

const useColor = !process.env.NO_COLOR && !JSON_OUT;
const c = {
  green: (s) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  dim: (s) => (useColor ? `\x1b[90m${s}\x1b[0m` : s),
  bold: (s) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
};

// --- fixture + run helpers --------------------------------------------------
function git(dir, args) {
  execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}
function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "evidence@getadvantage.app"]);
  git(dir, ["config", "user.name", "evidence-suite"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
}
function write(dir, rel, content) {
  const abs = path.join(dir, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}
function commit(dir) {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "fixture"]);
}
function run(args, cwd) {
  const r = spawnSync(process.execPath, [INDEX, ...args], {
    cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 120000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: r.status ?? -1, out: (r.stdout || "") + (r.stderr || ""), stdout: r.stdout || "" };
}
const GATE = ["check", "--json", "--no-brief-check", "--no-overview"];
const FAKE_STRIPE = "sk_live_" + "9".repeat(26); // obviously-fake fixture key
const PKG = '{"name":"app","version":"1.0.0","private":true}\n';

// A green capability is one whose verdict protects (or helps) the user. Each
// carries WHY it matters, so the scoreboard reads as trust, not test-count.
const CAPABILITIES = [
  {
    id: "catches-the-leak",
    title: "Catches the leak",
    why: "a committed API key must block the ship, and the key is never echoed",
    judge(d) {
      initRepo(d); write(d, "package.json", PKG);
      write(d, "src/config.js", `export const stripe = "${FAKE_STRIPE}";\n`);
      commit(d);
      const r = run(GATE, d);
      const j = safeJson(r.stdout); // --json writes pure JSON to stdout; the banner goes to stderr
      const scan = j && j.checks && j.checks.find((x) => /Secret scan/i.test(x.label));
      const leaked = r.out.includes(FAKE_STRIPE);
      const ok = r.code === 1 && scan && scan.status === "fail" && !leaked;
      return { ok, detail: r.code === 1 ? `NO-GO · key ${leaked ? "LEAKED ⚠" : "redacted"}` : "expected NO-GO, got GO" };
    },
  },
  {
    id: "build-output-leak",
    title: "Leak in build output",
    why: "a key bundled into a committed sourcemap/dist file is the invisible case",
    judge(d) {
      initRepo(d); write(d, "package.json", PKG);
      write(d, "dist/bundle.js.map", `{"version":3,"sourcesContent":["const k='${FAKE_STRIPE}';"]}\n`);
      commit(d);
      const r = run(GATE, d);
      const ok = r.code === 1 && /bundle\.js\.map/.test(r.out) && !r.out.includes(FAKE_STRIPE);
      return { ok, detail: ok ? "NO-GO · names the .map file" : "sourcemap key slipped through → GO" };
    },
  },
  {
    id: "tracked-env",
    title: "Committed .env blocks",
    why: "a tracked .env is a leak by itself — git history keeps every value",
    judge(d) {
      initRepo(d); write(d, "package.json", PKG); write(d, ".env", `STRIPE=${FAKE_STRIPE}\n`);
      commit(d);
      const r = run(GATE, d);
      return { ok: r.code === 1, detail: r.code === 1 ? "NO-GO" : "expected NO-GO, got GO" };
    },
  },
  {
    id: "clean-go",
    title: "Clean repo ships",
    why: "no false NO-GO — a clean project must get a GO, or nobody trusts the gate",
    judge(d) {
      initRepo(d); write(d, "package.json", PKG); write(d, "src/app.js", "export const x = 1;\n");
      commit(d);
      const r = run(GATE, d);
      return { ok: r.code === 0, detail: r.code === 0 ? "GO" : "false NO-GO on a clean repo" };
    },
  },
  {
    id: "dirty-tree",
    title: "Uncommitted work caught",
    why: "vercel --prod ships the working tree — a tracked edit must warn before deploy",
    judge(d) {
      initRepo(d); write(d, "package.json", PKG); write(d, "src/app.js", "export const x = 1;\n");
      commit(d);
      write(d, "src/app.js", "export const x = 2; // uncommitted\n");
      const r = run(GATE, d);
      return { ok: r.code === 1, detail: r.code === 1 ? "NO-GO on dirty tree" : "shipped dirty tree as GO" };
    },
  },
  {
    id: "outside-git-rescue",
    title: "First run has a next step",
    why: "a non-expert running it outside a repo must be pointed somewhere, not bricked",
    judge(d) {
      mkdirSync(d, { recursive: true }); write(d, "package.json", PKG);
      const r = run(["check"], d);
      const ok = r.code === 1 && /demo/i.test(r.out) && /git init/i.test(r.out);
      return { ok, detail: ok ? "offers demo + git init" : "dead-end error, no next step" };
    },
  },
  {
    id: "client-app-map",
    title: "Client apps read honestly",
    why: "the default ICP is Vite/React — no backend jargon, honest empty-SPA line + client orientation",
    judge(d) {
      initRepo(d);
      write(d, "package.json", '{"name":"spa","version":"1.0.0","dependencies":{"react":"^19"},"devDependencies":{"vite":"^5"}}\n');
      write(d, "index.html", "<div id=root></div>"); write(d, "src/App.jsx", "export default () => null;\n");
      commit(d);
      const r = run(["map"], d);
      const jargon = /Express\/Fastify|Flask\/FastAPI/.test(r.out);
      const friendly = /client-side|nothing server-side|route mapping does not apply/i.test(r.out);
      const orient = /Vite \+ React|client orientation|vite: detected/i.test(r.out);
      const ok = !jargon && friendly && orient;
      return {
        ok,
        detail: ok
          ? "de-jargoned, honest SPA + client orientation"
          : jargon
            ? "backend jargon on a React screen"
            : !friendly
              ? "no client-app empty line"
              : "missing Vite+React client orientation",
      };
    },
  },
  {
    id: "server-map-coherent",
    title: "Server routes mapped",
    why: "on a real backend the map must find routes and flag an ungated mutating one",
    judge(d) {
      initRepo(d);
      write(d, "package.json", '{"name":"api","version":"1.0.0","dependencies":{"express":"^4"}}\n');
      write(d, "server.js", [
        "const app = require('express')();",
        "app.get('/items', (req, res) => res.json([]));",
        "app.post('/items', (req, res) => res.status(201).end());",
      ].join("\n") + "\n");
      commit(d);
      const r = run(["map"], d);
      const ok = r.code === 0 && /\/items/.test(r.out) && /POST/.test(r.out);
      return { ok, detail: ok ? "routes parsed, POST surfaced" : "did not map the routes" };
    },
  },
];

// --- run --------------------------------------------------------------------
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

const base = mkdtempSync(path.join(tmpdir(), "ga-evidence-"));
const results = [];
for (const cap of CAPABILITIES) {
  const dir = path.join(base, cap.id);
  let r;
  try { r = cap.judge(dir); } catch (e) { r = { ok: false, detail: `error: ${String(e.message || e).slice(0, 60)}` }; }
  results.push({ id: cap.id, title: cap.title, why: cap.why, ok: r.ok, detail: r.detail });
}
try { rmSync(base, { recursive: true, force: true, maxRetries: 5 }); } catch { /* windows lock — harmless */ }

const green = results.filter((r) => r.ok).length;
const allGreen = green === results.length;

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({
    tool: "getadvantage", version: VERSION,
    green, red: results.length - green, total: results.length,
    scoreboard: results.map((r) => ({ id: r.id, title: r.title, state: r.ok ? "GREEN" : "RED", detail: r.detail })),
  }, null, 2) + "\n");
} else {
  const pad = Math.max(...results.map((r) => r.title.length));
  console.log("");
  console.log(c.bold(`  getAdvantage — evidence suite · v${VERSION}`));
  console.log(c.dim("  ──────────────────────────────────────────────────────────────"));
  for (const r of results) {
    const dot = r.ok ? c.green("●") : c.red("●");
    const state = r.ok ? c.green("GREEN") : c.red(" RED ");
    console.log(`  ${dot} ${state}  ${c.bold(r.title.padEnd(pad))}  ${c.dim(r.detail)}`);
    console.log(`  ${" ".repeat(9)}${c.dim(r.why)}`);
  }
  console.log(c.dim("  ──────────────────────────────────────────────────────────────"));
  const tally = allGreen ? c.green(`${green}/${results.length} GREEN`) : c.red(`${green}/${results.length} GREEN · ${results.length - green} RED`);
  console.log(`  ${c.bold(tally)}`);
  console.log("");
}

// process.exitCode (not process.exit) so piped --json output drains fully on Windows
process.exitCode = allGreen ? 0 : 1;
