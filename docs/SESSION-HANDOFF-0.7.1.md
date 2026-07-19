# Session handoff — getAdvantage CLI 0.7.1

**Date:** 2026-07-17 · **Repo:** `C:\Users\ben\projects\getadvantage-cli`
(GitHub `BellmeJoe/getadvantage-cli`, npm `getadvantage`) · **Read this + `ROADMAP.md` first.**

This is a cold-start brief for continuing the CLI work in a fresh session. It is
self-contained: you do not need the previous chat.

---

## TL;DR

- **0.7.1 is code-complete in the working tree, fully tested (originally 29/29;
  suite now 34/34 with 0.7.2), and UNPUBLISHED + UNCOMMITTED.**
- It fixes the 3 verified blockers + 2 majors found in the Cold-QA of the live
  `getadvantage@0.7.0` package. `ROADMAP.md` is the version-by-version plan of
  record; 0.7.2 honesty sweep landed on top (package version now **0.7.2**).
- **Independent review of these trust fixes:** `docs/REVIEW-0.7.1.md` (2026-07-19)
  → **SHIP** verdict; residual gaps documented, none reopen the cold-QA repros.
- **Do not publish, push, tag, or deploy without the founder.** Releases are the
  founder's to cut (hard rule).

---

## What shipped in 0.7.1 (this session)

Every fix carries the QA finding id and a regression test in `tests/run.mjs`.

| # | Fix | Where | Finding id | Severity |
|---|---|---|---|---|
| 1 | UTF-16 secret false-GO: a committed key in a UTF-16-LE file (PowerShell `>` default) was skipped as "binary" → GO. Now BOM-decoded and scanned. | `checks.mjs` — `decodeText`/`decodeUtf16`/`bomEncoding` + both read paths in `checkSecrets` | `gate-utf16-false-go` | blocker |
| 2 | Non-ASCII filenames silently dropped: `git ls-files` octal-escapes/quotes umlaut paths (`core.quotepath`), so they failed to open. Now listed with `-z` (NUL-terminated, unquoted). | `util.mjs` — new `gitFilesZ`; `checks.mjs` — `filesToScan` + `checkTrackedEnv` | `gate-nonascii-filename-skipped` | blocker |
| 3 | Gate downloaded + ran third-party code: `npx --yes tsc` fetched a squatted `tsc` package when TypeScript was declared-but-not-installed. Now resolves the local `node_modules/typescript/bin/tsc` via `node`; honest warn if absent — never downloads a compiler. | `checks.mjs` — `checkTypecheck`; `runCapture` gained a `shell` override | `gate-npx-tsc-thirdparty` | blocker |
| 4 | `ship` returned GO on a corrupt `package.json`. New always-on manifest check NO-GOs on an unparseable manifest ("not checkable ≠ GO"); build/typecheck defer to it. | `checks.mjs` — new `checkManifest`; wired into `checks-runner.mjs` (`runChecks` + `gateTree`) | `gate-ship-go-on-corrupt-packagejson` | major |
| 5 | `demo` dead-ended outside a git repo though it scaffolds its own temp repo. Dispatch moved before the repo-root gate. | `index.mjs` | `demo-requires-git-repo` | major |
| 6 | Generated CI workflow now installs deps (`--ignore-scripts`) before the gate (so the real compiler is present, closing #3's CI vector) and pins `getadvantage@<version>`. | `action.mjs` | `ci-workflow-unpinned` + #3 CI vector | minor |

Version bumped `0.7.0 → 0.7.1` in `package.json`.

### How it was verified

- **`npm test` → 29/29 scenarios pass** (25 existing + 4 new: UTF-16 secret,
  umlaut filename, tsc-declared-but-not-installed, demo-outside-repo). Scenario
  8c was updated on purpose: it encoded the *old wrong* behavior (broken manifest
  = warn + GO) and now asserts NO-GO.
- **Live-style repros against the local build** (`node index.mjs …` in `%TEMP%`
  scratch repos) confirmed real behavior, not just unit tests:
  - UTF-16 file with a key → NO-GO, key found + redacted.
  - Umlaut-named file with a key → NO-GO (verified `git ls-files` still quotes it,
    but the scan finds it anyway).
  - TS declared-but-not-installed → honest warn, **nothing downloaded** (no
    `node_modules` created); with TS actually installed, the local `tsc` runs
    (pass on good code, fail on bad).
  - Corrupt `package.json` + `ship` → NO-GO via the Package manifest check.
  - Generated workflow inspected: install step + `getadvantage@0.7.1` pin present.

---

## Working-tree state (as of this handoff)

Modified: `action.mjs`, `checks-runner.mjs`, `checks.mjs`, `index.mjs`,
`package.json`, `tests/run.mjs`, `util.mjs`.
New (untracked): `ROADMAP.md`, `docs/SESSION-HANDOFF-0.7.1.md`.

Nothing is staged or committed. The `.mjs` files + `tests/` are what npm would
publish (see `files` in `package.json`); `ROADMAP.md` and `docs/` are internal
(not in the publish whitelist).

---

## Guardrails (do not violate)

1. **No publish / push / tag / deploy without the founder.** `npm publish` is
   the founder's call. When it happens it should be `npm publish --provenance`
   from GitHub Actions (see `no-npm-provenance` in the roadmap) — the colliding
   foreign `ship-safe` package has SLSA provenance; a trust product should too.
2. **The `ship-safe` bin alias collides with a real, actively-maintained foreign
   npm package.** The README still teaches 9 commands under the bare `ship-safe`
   name; `npx ship-safe …` runs the stranger's package. Scheduled for 0.7.2
   (`shipsafe-name-collision`) — teach only `getadvantage`, decide the alias.
3. Zero dependencies, Node built-ins only, local-by-default (one opt-in network
   callsite in `report.mjs`). Keep it that way.
4. Honesty principle: the gate reads and reports, never calls an app secure;
   skips are honest, not fake passes; "not checkable ≠ GO".

---

## What's next — start of 0.7.2

0.7.2 is the **honesty + branding sweep** (full list in `ROADMAP.md`). Highest
value first:

1. **`brief` eats manual edits** (`brief-eats-manual-edits`, major) — add a
   protected notes block to PROJECT-BRIEF.md like HANDOFF.md already has.
2. **`ship-safe` branding residue + bin collision** (`shipsafe-brand-residue`,
   `shipsafe-codename-in-artifacts`, `shipsafe-name-collision`) — the `deploy`
   header still says "Ship-Safe"; generated files carry `ship_safe_*` frontmatter
   + `<!-- ship-safe:* -->` markers customers commit. Rename to `getadvantage_*`
   with back-compat reads; make the README teach only `getadvantage`.
3. **`map` vs `check` disagree** (`map-vs-check-routes`, major) — `map` reports 0
   routes where `check`'s overview finds them; unify on one parser.
4. Polish batch: `switch cursor` claims a `.cursorrules` it never writes;
   missing-vs-stale brief wording; "won't collide" over-claim; deploy token via
   argv → env; MCP inputSchema enforcement; zero-commit raw `fatal:` leak;
   typo → full-help dump (add "did you mean"); `map --json` ignored; npm
   maintainer email = founder's personal Gmail → hello@getadvantage.app.

After 0.7.2: **0.8** (CI table stakes — policy config/baseline, SARIF, published
Action, client-bundle key check) then **0.9** (the wedge — Vite+React+Supabase
support + Supabase-RLS check + paste-ready fixes). The ICP ships Vite+Supabase,
not Next.js — today `map` returns nothing for a Lovable/Bolt export.

---

## Key file map

```
index.mjs           command dispatch + arg parse + --version + help. Repo-root gate
                    lives here; mcp/login/logout/demo run BEFORE it (no repo needed).
checks.mjs          the gate checks: dirty-tree, secret scan, tracked .env,
                    checkManifest (NEW), typecheck, build, schema-bump.
checks-runner.mjs   runChecks (the visible gate) + gateTree (fan-in combined-tree gate).
detect.mjs          project/stack detection (package.json parse, typecheckable, etc.).
util.mjs            git wrappers (git/gitRaw/gitSafe/gitFilesZ), JSON+BOM read,
                    color, marker-dir (.getadvantage/, legacy .ship-safe/ read).
overviews.mjs       the map lanes (estate / API surface / integrations / schedules).
fanout.mjs          fan-out (worktree lanes) + fan-in (safe conductor).
demo.mjs            the one-command showcase (scaffolds a throwaway repo).
brief/handoff/      the portable "project brain" (PROJECT-BRIEF.md + HANDOFF.md).
  ledger/switch/init/gauge/models
action.mjs          github-action writer. deploy.mjs  vercel deploy (guarded).
mcp.mjs             dependency-free MCP stdio server (6 tools).
report.mjs          the ONE opt-in network callsite (--report to the account).
tests/run.mjs       integration suite — runs the real CLI vs throwaway repos. `npm test`.
ROADMAP.md          the plan of record (0.7.1 → 0.9 → later), tagged by finding id.
```

---

## Open decisions for the founder

1. **Cut 0.7.1?** Code is ready; needs the founder to commit + `npm publish`
   (ideally with provenance from CI + a matching GitHub tag, closing
   `github-source-lag`).
2. **`ship-safe` alias:** keep with a loud collision warning, or drop it? (0.7.2)
3. **npm account email:** move off the personal Gmail to hello@getadvantage.app?

---

## Resume prompt (paste into the new session)

> Continue the getAdvantage CLI. Read `docs/SESSION-HANDOFF-0.7.1.md` and
> `ROADMAP.md`, confirm `npm test` is green, then start 0.7.2 top-down (begin
> with `brief` preserving manual edits). Do not publish, push, tag, or deploy
> without me.
