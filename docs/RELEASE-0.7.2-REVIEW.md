# getAdvantage CLI 0.7.2 — release review pack

**For a cold review session.** Everything needed to review, commit, tag, and
publish — without re-reading the chat.

| | |
|---|---|
| **Repo** | `C:\Users\ben\projects\getadvantage-cli` · GitHub `BellmeJoe/getadvantage-cli` |
| **npm package** | `getadvantage` @ **0.7.2** (in `package.json`; not published yet) |
| **Base** | last published / prior HEAD narrative: **0.7.0** on npm; git `main` tip before this work was **0.7.0** map work (`8c7cf23`) |
| **This work** | **0.7.1 trust fixes + 0.7.2 honesty/branding/polish** as one release |
| **Tests** | `npm test` → **34/34** (2026-07-19) |
| **State** | Working tree **dirty / uncommitted**. Branch `main` was **ahead 2** of `origin/main` *before* these changes (local-only commits already existed — verify with `git log origin/main..HEAD`). |
| **Hard rule** | Do **not** publish, push, tag, or deploy without the founder. |

Related docs:

- **`docs/REVIEW-0.7.1.md` — dedicated independent review of the 0.7.1 trust fixes (read this; do not skip)**  
- `docs/SESSION-HANDOFF-0.7.2.md` — cold-start engineering handoff  
- `docs/SESSION-HANDOFF-0.7.1.md` — 0.7.1 trust fixes author handoff  
- `ROADMAP.md` — plan of record (0.7.2 marked code-complete)

> **0.7.1 was never separately reviewed or published.** The review pack for 0.7.2
> bundles both versions for one npm cut, but trust blockers must be evaluated
> via `REVIEW-0.7.1.md` (verdict: **SHIP** the six fixes; residual gaps non-blocking).

---

## 1. Proposed commit message

Use a **single commit** (or one commit for code + one for docs if preferred).
Suggested subject/body for `git commit`:

```
release: getadvantage 0.7.2 — trust gate + honesty sweep

Ship the cold-QA fixes from 0.7.0 as a single versioned release:

0.7.1 (trust-critical correctness)
- Scan UTF-16 (BOM) files for secrets; stop false-GO on PowerShell-authored keys
- List files with git -z so non-ASCII paths are not silently skipped
- Run local typescript/bin/tsc via node; never npx --yes tsc
- NO-GO on unparseable package.json (not checkable ≠ GO)
- demo runs before the repo-root gate (works outside a git repo)
- Generated CI workflow: install deps + pin getadvantage@version

0.7.2 (honesty + branding + polish)
- brief: protected notes block; refuse foreign PROJECT-BRIEF.md
- getadvantage_* markers/frontmatter; legacy ship-safe reads still work
- README teaches only getadvantage; warn that npx ship-safe is another package
- map and check share scanRoutes + detectRepoStack; Next scans src/app/api
- map --json emits a real JSON document
- dirty-tree: own brain/marker artifacts are not "scratch" risk alone
- deploy: Vercel token via child env, not argv
- MCP: enforce inputSchema (additionalProperties), clear unknown-tool errors
- First-run polish: gitSafe no fatal leak, did-you-mean, login abort exit 1,
  missing-vs-stale brief wording, fan-out honesty, build 10m timeout,
  switch cursor tip, demo help arithmetic, author hello@getadvantage.app

Tests: 34/34 (npm test). Not published from this commit alone.

Closes cold-QA findings: gate-utf16-false-go, gate-nonascii-filename-skipped,
gate-npx-tsc-thirdparty, gate-ship-go-on-corrupt-packagejson,
demo-requires-git-repo, brief-eats-manual-edits, map-vs-check-routes,
shipsafe-brand-residue, shipsafe-name-collision, and the 0.7.2 polish set.
```

**Short subject-only alternative:**

```
release: 0.7.2 trust gate + honesty sweep (34 tests)
```

---

## 2. Release notes (npm / GitHub)

### Title
**getadvantage 0.7.2** — Trustworthy GO + honesty sweep

### Highlights (buyer-facing)

1. **The GO promise is trustworthy again** after cold-QA of 0.7.0: secrets in
   UTF-16 files and non-ASCII filenames no longer slip through; the typecheck
   never downloads a third-party compiler; a broken `package.json` is NO-GO.
2. **One map of routes** — `map` and `check` use the same stack-aware parsers
   (Next App Router including `src/app/api`, Express/Fastify, Flask/FastAPI).
3. **Your notes survive** — regenerating `PROJECT-BRIEF.md` keeps a protected
   notes block (same idea as HANDOFF.md).
4. **Brand clarity** — teach and use `getadvantage` only.  
   ⚠ `npx ship-safe` is a **different** package on npm. The local `ship-safe`
   bin alias remains for installed copies only.

### Full changelog

#### Trust-critical (0.7.1 → included in 0.7.2)

| Severity | Finding | Fix |
|---|---|---|
| Blocker | `gate-utf16-false-go` | BOM-detect UTF-16 LE/BE; decode before binary skip; scan secrets |
| Blocker | `gate-nonascii-filename-skipped` | `git ls-files -z` (no quotepath drop) |
| Blocker | `gate-npx-tsc-thirdparty` | Local `node_modules/typescript/bin/tsc` only; honest warn if missing |
| Major | `gate-ship-go-on-corrupt-packagejson` | Always-on manifest integrity check → NO-GO |
| Major | `demo-requires-git-repo` | Dispatch `demo` before repo-root gate |
| Minor | `ci-workflow-unpinned` | Install deps (`--ignore-scripts`) + pin `getadvantage@<version>` |

#### Honesty + branding + polish (0.7.2)

| Finding | Fix |
|---|---|
| `brief-eats-manual-edits` | `<!-- getadvantage:brief:notes -->` … preserved; foreign brief refuse |
| `shipsafe-codename-in-artifacts` | Write `getadvantage_*` / `<!-- getadvantage:* -->`; read legacy ship-safe |
| `shipsafe-name-collision` | README: only `getadvantage`; collision warning |
| `map-vs-check-routes` | Shared `scanRoutes` + stack detect; Next `src/app/api` |
| `switch-cursorrules-claim` | Cursor tip matches what `init` actually does |
| `missing-brief-called-stale` | Separate copy for missing vs stale |
| `fanout-wont-collide-overclaim` | “Share the brain, not the working tree — fan-in catches collisions” |
| `deploy-token-in-argv` | Token in child env (`VERCEL_TOKEN`), not `--token` |
| `mcp-schema-not-enforced` | Validate args; `-32602` on bad/extra properties |
| `self-artifacts-trip-dirty-guard` | Brain/marker files not treated as scratch risk alone |
| `zerocommit-git-fatal-leak` | `gitSafe` swallows stderr |
| `typo-dumps-full-help` | “Did you mean …?” + short pointer to help |
| `login-abort-exit0` | Abort → exit 1, nothing stored |
| `map --json` ignored | Emits `{ command, stack, lanes, generatedAt }` |
| `gate-build-no-timeout` | 10-minute budget for build/typecheck child processes |
| `demo-help-copy-arithmetic` | 3 lanes / 3 roles in help |
| `maintainer-personal-gmail` | author `hello@getadvantage.app`; homepage `getadvantage.app` |

### Upgrade notes for users

```bash
npx getadvantage@0.7.2 --version
# or
npm install -D getadvantage@0.7.2
```

- **`getadvantage brief`**: hand-written context goes **between** the notes
  markers. Content outside that block is still regenerated.
- **Existing PROJECT-BRIEF.md / HANDOFF.md** with old `ship-safe:*` markers:
  still recognized; next refresh rewrites to `getadvantage:*` markers and
  **keeps notes**.
- **Do not** `npx ship-safe` — that is not this package.
- Generated GitHub workflow now installs dependencies before the gate and pins
  the CLI version — regenerate with `getadvantage github-action --force` if you
  already have an old workflow.

### Not in this release (still open)

- npm provenance publish (`no-npm-provenance`) — process, founder-gated  
- GitHub tag/source sync lag (`github-source-lag`) — process  
- Dropping the `ship-safe` bin alias entirely — kept for local compat  
- 0.8: policy/baseline, SARIF, published Action product, client-bundle keys  
- 0.9: Vite+Supabase stack-fit + paste-ready fixes  

---

## 3. Files in this release (working tree)

### Modified (18)

| File | Role |
|---|---|
| `package.json` | version **0.7.2**, author, homepage |
| `README.md` | teach getadvantage only; collision warning |
| `action.mjs` | CI workflow install + version pin |
| `brief.mjs` | notes block, markers, stack-aware routes |
| `checks.mjs` | UTF-16/secrets, tsc, manifest, dirty own-artifacts, timeouts |
| `checks-runner.mjs` | stack-aware overviews; brief missing/stale wording |
| `deploy.mjs` | brand header; token via env |
| `fanout.mjs` | honest collision copy |
| `handoff.mjs` | getadvantage markers + legacy reads |
| `index.mjs` | demo pre-gate, map --json, did-you-mean, demo help |
| `init.mjs` | getadvantage auto-load markers + legacy migrate |
| `ledger.mjs` | getadvantage ledger marker + migrate |
| `mcp.mjs` | inputSchema enforcement |
| `overviews.mjs` | `src/app/api`, unified `scanRoutes` default detect |
| `report.mjs` | login abort → exit 1 |
| `switch.mjs` | honest Cursor tip |
| `tests/run.mjs` | + scenarios (29→34 total) |
| `util.mjs` | `gitFilesZ`, safer `gitSafe` |

### Untracked (should be committed for internal use; not in npm `files`)

| Path | Role |
|---|---|
| `ROADMAP.md` | Plan of record |
| `docs/SESSION-HANDOFF-0.7.1.md` | Prior handoff |
| `docs/SESSION-HANDOFF-0.7.2.md` | Engineering handoff |
| `docs/RELEASE-0.7.2-REVIEW.md` | **This file** |

npm publish whitelist (`package.json` `files`): `*.mjs`, `tests/`, `README.md` only.  
Docs/ROADMAP stay repo-only — correct.

---

## 4. Test evidence

```text
npm test
→ 34/34 scenarios passed
```

New / extended coverage includes:

- UTF-16 secret NO-GO  
- Non-ASCII filename secret NO-GO  
- tsc declared-but-not-installed (no download)  
- demo outside git repo  
- brief notes preserve + foreign refuse + legacy marker migrate  
- map vs check agreement (Next `src/app` + Express)  
- map `--json`  
- typo did-you-mean  
- dirty-tree own artifacts pass  

**Reviewer should re-run:**

```powershell
Set-Location C:\Users\ben\projects\getadvantage-cli
npm test
npx tsc --noEmit  # N/A — pure JS package; no tsconfig required
node index.mjs --version   # expect 0.7.2
```

Optional smoke (manual):

```powershell
# outside any repo
node index.mjs demo

# in a throwaway Next-style tree with src/app/api/.../route.ts
node index.mjs map --json
node index.mjs check --json --no-brief-check
# assert API surface detail strings match
```

---

## 5. Review checklist (for the other session)

### Correctness / honesty

- [ ] Secret scan: UTF-16 file with `sk_live_…` → NO-GO, redacted fingerprint  
- [ ] Umlaut filename with key → NO-GO  
- [ ] `typescript` in package.json, no node_modules → warn, **no** network fetch  
- [ ] Corrupt `package.json` + `ship` → NO-GO via Package manifest  
- [ ] `demo` from non-git cwd → exit 0, runs showcase  
- [ ] `brief` twice with edited notes block → notes survive  
- [ ] Hand-written PROJECT-BRIEF without banner → refuse overwrite  
- [ ] `map` and `check` API surface detail match on Next + Express fixtures  
- [ ] Dirty tree with only PROJECT-BRIEF.md → pass (not scratch warn)  
- [ ] MCP tools/call with extra property → -32602  
- [ ] MCP tools/call with missing name → not `Unknown tool: undefined`  

### Product / brand

- [ ] README never teaches bare `npx ship-safe` as this product  
- [ ] Deploy header says getAdvantage, not Ship-Safe  
- [ ] Generated markers are `getadvantage:*` on fresh brief/handoff  
- [ ] package author email is `hello@getadvantage.app`  

### Release process (founder)

- [ ] `git status` clean intent; no secrets in tree  
- [ ] Note local `main` may already be **ahead of origin** — rebase/merge strategy?  
- [ ] Commit with message in §1  
- [ ] Tag `v0.7.2` matching package.json  
- [ ] **Decide the publish trigger first** — `git push origin main` auto-runs `publish.yml` → `npm publish` (see §6 warning). Either accept push=publish, or switch the workflow to `workflow_dispatch`/tag-only to make publishing a separate deliberate step.  
- [ ] Push tag + main to GitHub — **this is the publish** on the current workflow (auto `npm publish`, no `--provenance`)  
- [ ] Confirm npm shows 0.7.2; `npx getadvantage@0.7.2 --version`  

### Explicit non-goals this release

- [ ] Not dropping the `ship-safe` bin alias (compat)  
- [ ] Not shipping 0.8 policy/SARIF  
- [ ] Not changing shared product DB / other repos  

---

## 6. Suggested git commands (founder only)

```powershell
Set-Location C:\Users\ben\projects\getadvantage-cli

# Review first
git status
git diff
git log origin/main..HEAD --oneline   # local-only commits already on main?
npm test

# Stage (include docs if you want them on GitHub)
git add README.md package.json action.mjs brief.mjs checks-runner.mjs checks.mjs `
  deploy.mjs fanout.mjs handoff.mjs index.mjs init.mjs ledger.mjs mcp.mjs `
  overviews.mjs report.mjs switch.mjs tests/run.mjs util.mjs `
  ROADMAP.md docs/

# Commit (paste body from §1)
git commit -m "release: getadvantage 0.7.2 — trust gate + honesty sweep" -m "..."
```

> ⚠ **PUSH = PUBLISH.** `.github/workflows/publish.yml` triggers on every push to
> `main` and runs `npm publish` whenever `package.json`'s version is not yet on npm
> (verified: npm is at 0.7.0, this tree is 0.7.2, `NPM_TOKEN` is armed, 5 prior
> releases auto-published this way). So **the push itself publishes 0.7.2** — there
> is no separate manual publish step, and the auto path publishes **without
> `--provenance`**. Do not `git push` "just to sync GitHub" until you actually
> intend to publish. To decouple them, change the workflow trigger to
> `workflow_dispatch`/tag-only first (see §7).

```powershell
# ONLY when founder is ready to PUBLISH (the push below IS the publish):
git tag -a v0.7.2 -m "getadvantage 0.7.2"
git push origin main --tags   # ← this triggers publish.yml → npm publish 0.7.2
# npm shows 0.7.2 within ~1 min; confirm:
npx getadvantage@0.7.2 --version
```

---

## 7. Risk register (review focus)

| Risk | Severity | Notes |
|---|---|---|
| Dirty-tree own-artifact pass | Medium | Could hide a *tracked* edit to AGENTS.md/CLAUDE.md if user considers those ship-critical. Own-artifact list is intentional; tracked non-brain files still fail. |
| Token via env only | Low | Custom `tokenEnv` still sets `VERCEL_TOKEN` for the child — Vercel CLI must honor env. |
| Marker migration | Low | Old `ship-safe:*` notes preserved; dual-marker edge cases tested for brief. |
| Combined 0.7.1+0.7.2 in one version | Low | Intentional; no 0.7.1 was published. Changelog sections keep the trail. |
| Local main ahead of origin | Process | Reviewer must not force-push; reconcile the pre-existing +2 commits. |

---

## 8. Resume prompt for the review session

> Review the getAdvantage CLI 0.7.2 release candidate. Read  
> `docs/RELEASE-0.7.2-REVIEW.md`, `docs/SESSION-HANDOFF-0.7.2.md`, and `ROADMAP.md`.  
> Run `npm test` (expect 34/34). Walk the review checklist. Produce a ship /  
> no-ship verdict with findings. **Do not commit, push, tag, or publish** unless  
> the founder explicitly asks after the verdict.

---

## 9. One-paragraph summary (for PR / tag body)

getAdvantage CLI **0.7.2** is the first release after the 0.7.0 cold-QA: it closes
three trust blockers (UTF-16 secrets, non-ASCII filenames, npx `tsc` third-party
exec), makes corrupt manifests and first-run `demo` honest, unifies `map`/`check`
route truth (including Next `src/app/api`), preserves human notes in the project
brief, migrates branding off the colliding `ship-safe` codename while keeping
legacy marker reads, and polishes MCP schema enforcement, dirty-tree self-artifact
handling, deploy token hygiene, and first-run UX. **34/34** integration tests green;
publish and tags are founder-gated.
