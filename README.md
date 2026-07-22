# getadvantage

> **The open-source GO / NO-GO gate for AI-built code.** One command tells you whether it's safe to ship — leaked secrets, committed `.env`, dirty tree, typecheck, build — and exits `0` (GO) or `1` (NO-GO). Local, dependency-free, nothing leaves your machine.

[![npm version](https://img.shields.io/npm/v/getadvantage)](https://www.npmjs.com/package/getadvantage)
[![npm downloads](https://img.shields.io/npm/dm/getadvantage)](https://www.npmjs.com/package/getadvantage)
[![license](https://img.shields.io/npm/l/getadvantage)](./LICENSE)
[![node](https://img.shields.io/node/v/getadvantage)](https://nodejs.org)

AI agents write the code. **Who checks it before it ships?**

```bash
npx getadvantage                 # GO / NO-GO in seconds — no install, no signup
```

Give your agent an outside checker it must pass (Claude Code · Cursor · Codex · Grok Build):

```bash
claude mcp add getadvantage -- npx getadvantage mcp
```

Put the same gate in front of every push:

```bash
npx getadvantage github-action   # writes the CI workflow for you
```

If the gate caught something before it shipped, **[star the repo](https://github.com/BellmeJoe/getadvantage-cli/stargazers)** — stars are how other builders know they can rely on it. Hit a problem or want a check we don't have? **[Open an issue](https://github.com/BellmeJoe/getadvantage-cli/issues)** — every one gets read and answered.

## What you get

A local, dependency-free **pre-deploy gate + portable project brain** for apps
built with AI — Claude Code, Cursor, Lovable, Bolt, v0, Replit, and friends.

Run it in your repo. It reads your project and gives you:

- **A plain-language GO / NO-GO before you deploy** — no secrets in code, no
  committed `.env`, a clean working tree, build + typecheck, a schema-version
  check.
- **A portable project brain** (`PROJECT-BRIEF.md`) — a one-page, model-agnostic
  memory of your project that *any* model, session, or tool reads first, so you
  never re-explain it.
- **A session handoff** (`HANDOFF.md`) — save your place, then start a fresh, fast
  session (or switch models) with zero loss.
- **An MCP server** (`getadvantage mcp`) — so an AI agent (Claude Code, Cursor)
  can call the brain + checks *mid-session*, without leaving the chat.
- **Fan-out + the safe fan-in conductor** (`getadvantage fan-out <n>` ·
  `fan-in`) — **land a fleet of AI agents safely.** Anyone can run agents in
  parallel (each in its own git worktree, all sharing one brain); the hard part
  is landing what they produce. The conductor reconciles them into ONE verified main: a
  **collision map** (which files >1 lane touched), a **merge-train** (textual
  conflicts up front), and a **combined-tree gate** that re-runs your checks after
  each merge so a "both-green-but-red-together" break is caught and that lane is
  quarantined — never landed. No conflict reaches main un-verified. Try it in one
  command: `getadvantage demo`.
- **Opt-in run reporting** (`--report`) — `getadvantage login` once, then
  `check --report` / `fan-in --report` posts each run's **verdict + metadata**
  (the `--json` report — never your source code) to your getAdvantage account.
  `getadvantage github-action` wires the same gate into CI. Without `--report`,
  nothing ever leaves your machine.

Your context lives in your **repo**, not your tool. Switch from Claude to Cursor
to Qwen and keep going — and start a clean, fast session instead of dragging a
slow, bloated one.

## Use it

No install needed:

```bash
npx getadvantage            # run the pre-deploy checks (GO / NO-GO)
npx getadvantage brief      # generate / refresh the project brain
npx getadvantage init       # auto-load the brain at every session start
npx getadvantage handoff    # save your place for the next session
npx getadvantage switch     # move to a new tool/model without losing context
npx getadvantage mcp        # run the MCP server (an agent calls the brain mid-session)
npx getadvantage fan-out 3  # 3 parallel lanes sharing one brain (then `fan-in`)
```

Or add it to your project:

```bash
npm install --save-dev getadvantage
```

```jsonc
// package.json — always invoke the getadvantage bin (not the bare ship-safe name)
{ "scripts": { "gate": "getadvantage check", "ship": "getadvantage ship" } }
```

## Commands

Teach and use **`getadvantage`** only. A `ship-safe` binary is still installed as a
compat alias of the same code, but **`npx ship-safe` is a different package on npm**
(an unrelated, actively maintained project). Do not `npx ship-safe …` — you will not
run getAdvantage.

| Command | What it does |
|---|---|
| `getadvantage ship` | The full gate, including the production build: is this safe to ship? Exit `0` on **GO**, `1` on **NO-GO**. Same as `check --build` — the name you remember. |
| `getadvantage check` | Read-only pre-deploy checks → exit `0` on **GO**, `1` on **NO-GO**. Add `--build` for a full build. Default when you run `getadvantage` with no subcommand. |
| `getadvantage map` | A read-only map of what your app has: API surface (what is gated, what mutates — with a `⚠` on any mutating route that has no obvious gate), agents & integrations, schedules & jobs. Route mapping covers **Next.js** App Router, **Express/Fastify**, and **Flask/FastAPI** (best-effort regex parsing — no code is run); other stacks get the estate view and an honest scope note. Orientation, never a verdict — always exits `0`. |
| `getadvantage brief` | Generate / refresh `PROJECT-BRIEF.md` — the **COLD** layer (what the project *is*). Hand-written notes between the `getadvantage:brief:notes` markers are preserved across regenerations. `--check` warns if it's stale; it never blocks. |
| `getadvantage handoff` | Refresh the brief **and** write `HANDOFF.md` — the **HOT** layer (where you *left off*). Your notes are preserved across refreshes; it never overwrites a `HANDOFF.md` it didn't create. |
| `getadvantage init` | Wire the brain into your agent's instructions file (`CLAUDE.md` / `AGENTS.md` / `.cursorrules` / `.windsurfrules` / `.clinerules`) so `PROJECT-BRIEF.md` + `HANDOFF.md` load automatically at session start. |
| `getadvantage switch [tool]` | Switch tools/models without losing context — saves your place, wires every AI-tool file, and prints the prompt to start the new session. |
| `getadvantage models` | A plain-language playbook for choosing + switching AI models (principles, not benchmarks). |
| `getadvantage gauge` | A quick "is this session getting heavy?" read (repo activity since your last handoff) that nudges a reset before things slow down — a heuristic, not a token count. |
| `getadvantage ledger` | Show the session ledger — the running log of save-points each `handoff` records (kept in `.getadvantage/ledger.md`; a legacy `.ship-safe/` dir is still read and migrates forward on the next write). |
| `getadvantage mcp` | Run a dependency-free **MCP server** over stdio so an AI agent (Claude Code, Cursor) can call the brain, gate, and maps mid-session. Tools: `get_brief`, `refresh_brief`, `get_handoff`, `save_handoff`, `check`, `map`, `architecture`, `gauge`. Same engine as the CLI — no API keys, no network. |
| `getadvantage fan-out <n>` | Open **N parallel lanes** (1–8) as git worktrees off `HEAD`, each with the brain copied in + wired. Add `--task "..."` to print a shared task into each lane's guidance. Open a different model/tool per lane, work in parallel. |
| `getadvantage fan-in` | **The safe fan-in conductor.** Reconcile the lanes into one verified main: a **collision map**, a **merge-train** dry-run (textual conflicts up front), and — with `--apply` — actually merge the clean lanes one at a time, re-running the check gate on the **combined tree** after each so a lane that's green alone but red merged is **quarantined** (rolled back), never landed. Default is a read-only preview; `--apply` to land. |
| `getadvantage demo` | Spin up a throwaway sample repo with 3 pre-made divergent lanes (one clean, one that breaks the build, one that conflicts) and run the **whole conductor** on it — the entire wow in one command, zero setup. |
| `getadvantage architecture` | **The accretion scanner** — where is the code rotting by being built *over* instead of collapsed? Ranks the top collapse candidates by **size × churn × duplication**: oversized files (>600 / >1000 / >1800 lines), git-churn hotspots (last 100 commits), repeated ≥15-line blocks (exact/near-exact, appearing ≥3×), plus an explicitly approximate JS/TS complexity read. It **surfaces** the signal an AI coding agent is missing — it never refactors, and finding nothing means the heuristics found nothing, *not* that the architecture is clean. **Advisory only — always exits 0**; `--json` for the machine report, `--top <n>` to size the ranking. |
| `getadvantage login` / `logout` | Store (or remove) your `adv_live_` API key in `~/.getadvantage/config.json` — per-user, owner-only file, never inside a repo. Used by `--report`; the `GETADVANTAGE_API_KEY` env var always wins over the stored key. The key is never printed back. |
| `getadvantage github-action` | Write `.github/workflows/getadvantage.yml` for a **one-copy** first-party Action install: `uses: BellmeJoe/getadvantage-cli@v1`. The Action runs the same gate as local `check`, writes SARIF, uploads via `github/codeql-action/upload-sarif@v4` (even on NO-GO), posts an **update-in-place** PR summary (stable `<!-- getadvantage:pr-summary -->` marker; job-summary fallback when PR write is unavailable, e.g. many fork PRs), then fails the job on NO-GO or action error. Optional `--report` uses the `GETADVANTAGE_API_KEY` repo secret. Idempotent — never clobbers a differing or pre-0.9.0 workflow without `--force`. Alias: `init --github-action`. Workflow permissions: `contents: read`, `security-events: write`, `actions: read`, `pull-requests: write`. Does **not** use `pull_request_target`. Public code scanning; private/internal also need GitHub Code Security. Not a security guarantee. |
| `getadvantage intent` | **Intent Contract** (local change-scope proof). `intent init --goal "…" --allow <glob> [--deny …]` pins immutable `baselineCommit` (full HEAD SHA) and writes `.getadvantage/intent.json`. **Commit only that file** as a dedicated freeze before the agent starts — authorization is the **freeze commit blob**, not the worktree, not a later broadened HEAD, not `--base-ref`. After the agent works, `intent check` diffs **every** change after `baselineCommit` (committed + staged + unstaged + deleted + renamed + untracked) → **GO / NO-GO** + `contractHash` + `receiptHash`. Nested git boundaries fail closed. Local trust only (no crypto human-identity claim). `check` includes this when a trusted freeze is present; no contract → omitted (never a false “intent verified”). **Limitation:** *scope verified; semantic correctness not proven.* |
| `getadvantage deploy` | _(Advanced)_ Deploy from a clean, detached worktree and confirm the deployment URL's project prefix. Runs a real `vercel --prod`; the project prefix is derived from your linked `.vercel` (or pass `--expect-prefix`). |

### Intent Contract (cold path)

Prove that repository changes stayed inside the task the human authorized — not an LLM opinion, not a semantic code review:

```bash
# 1. Human freezes the envelope before the agent starts
npx getadvantage intent init \
  --goal "Add password reset" \
  --allow "src/auth/**" --allow "tests/auth/**" \
  --deny ".github/**"
# pins baselineCommit = current HEAD (full 40-hex SHA)
git add .getadvantage/intent.json && git commit -m "chore: intent contract"
# dedicated freeze only — do not mix other files into this commit

# 2. Agent works (may commit)…

# 3. Prove every change after baseline stayed in scope
npx getadvantage intent check
# → GO or NO-GO + contractHash + receiptHash (baseline, freeze, head, paths, violations)
#    scope verified; semantic correctness not proven
```

Deny overrides allow. Renames check both old and new paths. Committed work after the freeze is included (not only the dirty tree). Editing or re-committing a broader contract cannot self-authorize — the freeze blob remains the authorizer. Nested untracked git repos fail closed. Absolute paths, traversal, malformed schema, missing/non-ancestor baseline, non-dedicated freeze, and any `intent check --base-ref` fail closed. Local trust only: without signatures/protected remotes, history rewrite cannot be proven human.

## The gate (what `check` actually does)

| Check | Verdict | Detail |
|---|---|---|
| Dirty-tree guard | **BLOCKS** | Tracked files modified/staged would ship with `vercel --prod`. Untracked-only files warn instead. |
| Intent Contract | **BLOCKS** (when present) | When a **trusted freeze** of `.getadvantage/intent.json` exists after pinned `baselineCommit`, every committed-since-baseline + staged/unstaged/deleted/renamed/untracked path is checked against allow/deny/require/maxFiles. Freeze blob authorizes (not worktree/later HEAD). Nested git → NO-GO. No contract → check omitted (never a false “intent verified”). Scope only — not semantic correctness. |
| Secret scan | **BLOCKS** | Leaked-secret patterns over every tracked + staged **text** file — including lockfiles, `.map` sourcemaps, committed `dist/**` / `build/**` output, and committed Next.js browser assets under `.next/static/**` (other `.next` paths such as `cache`/`server` stay skipped): OpenAI, Anthropic, Stripe (live/restricted/webhook), AWS, GitHub (classic + fine-grained), Google OAuth, Slack, SendGrid, npm tokens, bare JWTs, database URLs with embedded passwords, Vercel tokens, KV/REST credentials, private-key blocks, Bearer literals, and getAdvantage's own platform keys (`adv_live_`). Hits are reported as **masked display fingerprints plus a sha256 auth id** (full value never printed). Public-looking names (`NEXT_PUBLIC_*`, `VITE_*`) are **not** an exemption — only the value shape decides a hit; intentional public client config that does not match private patterns is not a secret NO-GO. Files over 2 MB are scanned partially (first + last 256 KB), disclosed and named — never silent. This is pattern coverage of committed text, not a security guarantee. **Allowlist (0.8.3):** built-in ignore for public AWS documentation keys (`AKIA…EXAMPLE`); repo policy in a **tracked/committed** `.getadvantage/config.json` (`secrets.ignore`: `values`, `hashes`, `paths`, `patternIds`). Authorizing content is the **git index** blob only — untracked, gitignored, or unstaged worktree policy cannot authorize ignores. Allowlisted hits are disclosed, never silent. |
| Tracked .env file | **BLOCKS** | A committed `.env` is a leak by itself, whatever it contains, because git history keeps every value. Local `.env` files that are *not* gitignored warn instead. Gitignored `.env` files are never read. Templates (`.env.example` etc.) are fine. |
| Typecheck | **BLOCKS** | `tsc --noEmit`, only when the project actually has a `tsconfig.json` plus a local TypeScript dependency (project-aware, via the same detection `fan-in`'s combined-tree gate uses). Plain-JS projects get an honest skip, not a fake failure. |
| Build | **BLOCKS** | Runs the project's own `build` script, only with `--build` and only if one exists. |
| Schema-bump check | **WARNS** | DDL changed without a `SCHEMA_VERSION` bump (skipped honestly if the project doesn't carry that convention). |
| Overview maps | **WARNS** | Read-only maps of your API surface, integrations, and schedules. Informational, never blocking. |

- The database-URL pattern deliberately ignores placeholder passwords
  (`mypassword`, `changeme`, …) and URLs pointing at local dev hosts
  (`localhost`, `127.0.0.1`, `0.0.0.0`, `::1`, `host.docker.internal`) — so a
  real production credential that happens to use one of those shapes would not
  be flagged.
- A pattern scan can miss a secret that matches no known shape, and the middle
  of files over 2 MB is not scanned (only the first + last 256 KB).
- Binary assets (images, fonts, video, archives, PDFs) are skipped — they don't
  hold source-pasted keys. Text is detected by content, so a file in an unusual
  encoding *without* a byte-order mark (e.g. UTF-16 with no BOM) may be treated as
  binary and skipped; UTF-8 and BOM-marked files are always scanned.
- Under committed `.next/`, only **`.next/static/**`** client assets are scanned.
  `.next/cache`, `.next/server`, and similar non-static internals are still
  skipped (often binary/huge). A key that only lives there is not claimed covered.

### Secret allowlist (policy config)

False-positive escape hatch for docs fixtures and baselined sample tokens —
without silent GOs. Built-in: AWS public documentation access key IDs
(`AKIAIOSFODNN7EXAMPLE` and any `AKIA…EXAMPLE`). For everything else, put
ignore rules in a **tracked** `.getadvantage/config.json` and **commit** it.
Authorization reads the **git index** blob only — untracked, gitignored, or
unstaged worktree edits to the policy are warned and **cannot** authorize
ignores. A dirty tracked/staged `config.json` is ship-risk (the CLI never
regenerates it), so overall GO needs a clean tree with the intended policy
committed:

```json
{
  "version": 1,
  "secrets": {
    "ignore": {
      "values": ["sk_live_…exact fixture value…"],
      "hashes": ["0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"],
      "paths": ["docs/**", "fixtures/*"],
      "patternIds": ["jwt"]
    }
  }
}
```

Copy the **auth** id (64-char sha256 hex) from a prior `getadvantage check`
report, or pin the exact fixture value / path / pattern id. Display
fingerprints (`sk_live_…abcd (32 chars)`) are for humans only and are **not**
authorization identifiers. Complete private-key blocks are matched BEGIN…END
(hash/value pin the full block). Incomplete PEMs (BEGIN without a matching END)
still **NO-GO** under `private-key-incomplete` and cannot be allowlisted via
value/hash (the header is not unique); use an explicit path or
`patternIds: ["private-key-incomplete"]` if a fixture must pass. Every
allowlisted hit is still **named in the Secret scan output** with a reason
(`built-in:…` or `policy:…`). Real keys outside the allowlist still **NO-GO**.

## Use it as an MCP server (call the brain mid-session)

`getadvantage mcp` runs a dependency-free **Model Context Protocol** server over
stdio. Point your agent at it and it can call the brain, the gate, and the maps
*while you're working* — `get_brief`, `refresh_brief`, `get_handoff`,
`save_handoff`, `check`, `map`, `architecture`, `gauge` — instead of you running
the CLI by hand. It's the same engine as the CLI: no API keys, no network,
nothing leaves your machine.

**Claude Code** — add it with one command:

```bash
claude mcp add getadvantage -- npx getadvantage mcp
```

or in your MCP config JSON:

```json
{
  "mcpServers": {
    "getadvantage": {
      "command": "npx",
      "args": ["getadvantage", "mcp"]
    }
  }
}
```

**Cursor** — add the same block to `.cursor/mcp.json` (project) or
`~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "getadvantage": {
      "command": "npx",
      "args": ["getadvantage", "mcp"]
    }
  }
}
```

**OpenAI Codex** (CLI / VS Code extension / desktop — shared config):

```bash
codex mcp add getadvantage -- npx -y getadvantage mcp
```

If the first start times out (a cold `npx` download can exceed Codex's 10 s
handshake default), add `startup_timeout_sec = 60` to the
`[mcp_servers.getadvantage]` block in `~/.codex/config.toml`.

**xAI Grok Build** (CLI, beta):

```bash
grok mcp add getadvantage -- npx -y getadvantage mcp
```

Grok Build also reads existing Claude/Cursor MCP config files, so if you added
getadvantage there it may already be available. (Web-based agents — Codex
cloud, grok.com — can't spawn local stdio servers; use the CLI surfaces.)

Each tool takes an optional `cwd` (defaults to where the server runs) so you can
point it at any project repo on your machine.

## Land the fleet safely (fan-out / fan-in)

Because your brain lives in the repo, you can run **several models at once** on
the same project — and, the part that actually matters, **land their work safely**:

```bash
npx getadvantage fan-out 3 --task "add a settings page"
```

This refreshes the brain, then creates three git worktrees
(`../<repo>-lane-1 … -lane-3`) — each a fresh branch off `HEAD` with
`PROJECT-BRIEF.md` + `HANDOFF.md` copied in and wired. Open a *different*
model/tool in each lane (ChatGPT, Claude, Gemini, Cursor, Qwen…), let them work,
then:

```bash
npx getadvantage fan-in           # preview: collision map + merge-train dry-run
npx getadvantage fan-in --apply   # land the clean + green lanes, gated
```

`fan-in` is **the safe fan-in conductor**. It first draws a **collision map**
(which files more than one lane touched), then runs a **merge-train** dry-run to
find textual conflicts *before* anything is merged. With `--apply` it merges the
clean lanes one at a time onto your current branch and — the part nobody else
does — **re-runs your check gate on the combined tree after each merge**. Two
branches can each be green and still be red together; when that happens the
offending lane is **quarantined** (its merge rolled back) instead of poisoning
main. It ends on one verdict screen telling you exactly which lanes landed and
which need you.

`--apply` starts only from a **clean working tree** (so a half-merge can never
ship) and is **safe for automation**: it exits `0` only when every landable lane
landed green, and non-zero if a lane needs you *or* the run was refused (e.g. a
dirty tree) — so `fan-in --apply && deploy` never proceeds on a no-op. `fan-out`
commits its own brain refresh for you, so that clean-tree start is the default.
Cleanup is conservative by design: rollbacks only ever undo the in-flight merge —
**a landed lane is never reverted** — and if unexpected working-tree changes
appear after the train, it stops and tells you exactly where you are instead of
resetting anything. If a merge brings **new dependencies** (package.json / a
lockfile changed), the conductor runs your install (`npm ci` with a lockfile,
else `npm install`) before gating, and reports an install failure as exactly
that.

For CI and tooling, both `check` and `fan-in` take **`--json`**: stdout carries
exactly one JSON document — `{ command, verdict, exitCode, checks?/lanes?,
generatedAt }` — with the human rendering routed to stderr:

```bash
npx getadvantage check --json
npx getadvantage fan-in --apply --json
```

**SARIF 2.1.0** (for GitHub code scanning): `check --sarif <path>` writes a
dependency-free SARIF file after the gate. Human output and `--json` are
unchanged; exit code stays the gate verdict (NO-GO stays non-zero). Messages
use display fingerprints and sha256 auth ids — **never** full secrets, tokens,
or private-key material. Secret and tracked-`.env` findings use GitHub
`security-severity` + the `security` tag; other gate failures (dirty tree,
build, typecheck, …) use `problem.severity` with quality/reliability tags so
they are not mis-labeled as security alerts. Invalid paths or write failures
exit non-zero with a next action. Example:

```bash
npx getadvantage check --sarif getadvantage.sarif
```

Honest by design: we *detect* overlap and *gate* the combined result — we don't
claim to make incompatible work compatible. **No conflict reaches main
un-verified.** It's all git-native: no API keys, and no network unless you
explicitly opt in with `--report` (below). You bring the models; the CLI holds
the brain and the orchestration ground.

See the whole thing on a throwaway repo in one command:

```bash
npx getadvantage demo
```

## Report runs to your getAdvantage account (opt-in)

**Local by default.** No command ever touches the network unless you explicitly
opt in with `--report` (or `GETADVANTAGE_REPORT=1`). When you do, `check` and
`fan-in` post the finished run to your getAdvantage account, so your dashboard
shows every gate that ran — in CI and on your machine.

**What is sent — exactly:** the run **report**, i.e. the same `--json` document
the command prints (verdict, exit code, check results / lane outcomes), plus the
repo name (`owner/name`), branch and commit id. **Never your source code, your
diffs, or your files.** Without `--report`, nothing is sent, ever.

```bash
npx getadvantage login                    # store your adv_live_ key once (owner-only file in ~/.getadvantage/)
npx getadvantage check --report           # gate as usual + post the verdict
npx getadvantage fan-in --apply --report  # land the lanes + post the fan-in outcome
npx getadvantage logout                   # remove the stored key
```

On success the CLI prints the run's report URL: `→ verdict posted: https://…`.

- **Key:** `GETADVANTAGE_API_KEY` (env — always wins) or the key stored by
  `login`. It is only ever sent as the `Authorization` header — never printed,
  logged, or written into a repo.
- **Endpoint:** `https://getadvantage.app`; override with `GETADVANTAGE_API_URL`
  (staging/self-hosted).
- **Best-effort by design:** a failed post is a loud warning, never a changed
  verdict — the exit code stays the gate's GO / NO-GO, so a network hiccup can't
  fail your CI. Pass `--report-required` if you *want* a failed post to exit
  non-zero.

### In CI (GitHub Actions)

**One-copy install** (generated workflow):

```bash
npx getadvantage github-action     # writes .github/workflows/getadvantage.yml
```

Or paste the consumer step yourself after checkout:

```yaml
- uses: BellmeJoe/getadvantage-cli@v1
```

**Tag architecture:** floating git tag `v1` is the Action API major (moved on each
shipped action-compatible release). Exact source/npm release tags remain
`v0.9.0`, `v0.9.1`, … — pin `uses: BellmeJoe/getadvantage-cli@v0.9.0` when you
need bit-for-bit reproducibility. npm installs use package versions / dist-tags,
not the floating `v1` git tag.

The generated workflow checks out your repo, then runs the first-party composite
Action (Node 20 via `actions/setup-node@v6` inside the Action, project deps with
`--ignore-scripts`, gate + SARIF, update-in-place PR summary, then
`upload-sarif@v4` under `always()` when SARIF was written, then fail on NO-GO).
`--ci` never prompts, tolerates detached-HEAD checkouts, and defaults base
comparisons to `origin/main` (or the PR's `GITHUB_BASE_REF`). Permissions:
`contents: read`, `security-events: write`, `actions: read` (private workflows),
and `pull-requests: write` (same-repo PR comments). Fork PRs often cannot write
comments with `GITHUB_TOKEN` — the Action falls back to the job summary and never
claims otherwise. The product does **not** use `pull_request_target` (unsafe for
untrusted PR code). Add `GETADVANTAGE_API_KEY` as a repo secret for optional
`--report`; without it the gate still runs. Code scanning on private/internal
repositories also requires GitHub Code Security — the workflow does not create
that entitlement. Not a security seal.

## What it is — and isn't

- It **reads and reports** — "here's what I found before you ship." It does **not**
  claim your app is "secure" or "certified."
- It's **dependency-free** (Node built-ins only) and **read-only**, except for the
  explicit `brief` / `handoff` writes (your two repo-resident files) and the
  explicit `deploy` command.
- It's **local by default** — nothing leaves your machine unless you explicitly
  pass `--report` (or set `GETADVANTAGE_REPORT=1`). Reporting sends exactly the
  run report — the `--json` document (verdict, exit code, check results / lane
  outcomes) plus repo name, branch and commit id — to your getAdvantage account.
  It **never** sends your source code, your diffs, or your files.

It also ships its own proof: `npm test` runs an integration suite (including a
self-test that plants leaks in a throwaway fixture repo — a committed `.env`,
an oversized file with a trailing key, docs/CSS false-positive bait — and
asserts the gate catches every real leak while staying quiet on the rest).

### 0.6.0: secret-scan hardening

- **Committed `.env` files are no longer skipped by the secret scan.** Earlier
  versions skipped `.env*` basenames on the theory that they're gitignored.
  But gitignored files never reach the scanner anyway, so the skip only ever
  suppressed the dangerous case. Fixed, plus a dedicated **tracked-.env check**
  that blocks a committed `.env` outright (and warns if a local one isn't
  gitignored yet).
- **Oversized files (>2 MB) are no longer skipped silently.** The first and
  last 256 KB are scanned and the partial scan is disclosed in the output,
  naming the files it applies to.
- **New patterns:** Anthropic keys (checked before the broader OpenAI shape so
  `sk-ant-…` is never mislabeled), npm access tokens, bare JWTs
  (header-validated to avoid false positives), and database URLs with
  embedded passwords (placeholder passwords and local dev hosts are ignored).
- **All occurrences are counted** per file, not just the first match.

Requires **Node ≥ 18**. Built by [getAdvantage](https://getadvantage.app).
