# Social / advertising pack — getadvantage **0.10.0 LIVE**

> **Owner:** Grok Build. This is the sole CLI advertising-truth source. Maintain
> it in one assigned lane and keep all 8 evidence checks GREEN. Growth may
> distribute this truth autonomously after its factual, voice, duplication,
> platform, and rate preflight. Grok may release only after the objective product
> gate and independent audit have no open P1/P2.

> **Live:** **getadvantage@0.10.0** (2026-07-23). Independent **REVIEW_GO** on
> fingerprint `b4a1612` plus release-gate fix (gitlink fail-closed); gated Actions
> publish (tests + evidence + Materialize + `uses: ./` fixture self-gate green
> before npm), registry `gitHead` = `705986c` (release commit), tags `v0.10.0` +
> floating `v1`, GitHub Release, cold published package verified (version + Intent
> init/check GO + outside-allow NO-GO + core secret path). Prefer leading with
> the eight core GO/NO-GO claims below; Intent is the trust-layer follow-on —
> always *scope verified; semantic correctness not proven*.
>
> **Also live in 0.10.0:** Intent Contract (`intent init` / `intent check`; part
> of `check` when freeze trusted); first-party GitHub Action + PR summary
> (`uses: BellmeJoe/getadvantage-cli@v1` or `@v0.10.0`); secret scan of committed
> `.next/static/**` client bundles (non-static `.next` still skipped honestly);
> public prefixes (`NEXT_PUBLIC_*` / `VITE_*`) are not exemptions; SARIF 2.1 via
> `check --sarif` and the Action path. Not a security guarantee — same gate as
> local `check`, exported for the PR surface. Rollback: **getadvantage@0.9.1** /
> tag `v0.9.1`, **0.9.0** / `v0.9.0`, or **0.8.4** / `v0.8.4`.

**For any session that posts, ads, or briefs creators.**  
Do not invent features. The eight claims in the Evidence map are proven by
`npm run evidence`; that result does not automatically prove every client,
workflow, or market statement elsewhere in this pack. Other feature claims need
their named current test or source. Anything marked *roadmap* is not live.

| Field | Value |
|--------|--------|
| **npm (live)** | `getadvantage@0.10.0` |
| **Checkout** | Live **0.10.0** (Intent Contract + client-bundle `.next/static` scan + first-party Action + SARIF) |
| **Install** | `npx getadvantage` or `npx getadvantage@0.10.0` (no signup) |
| **GitHub** | https://github.com/BellmeJoe/getadvantage-cli · [Release v0.10.0](https://github.com/BellmeJoe/getadvantage-cli/releases/tag/v0.10.0) · Action `@v1` / `@v0.10.0` |
| **Site** | https://getadvantage.app |
| **Owner truth** | `npm run evidence` → **8/8 GREEN** · **96/96** tests @ 0.10.0 · cold published path verified (2026-07-23) · registry `gitHead` `705986c` |
| **Tone** | Soft/beta, demo-led. Not “gitleaks killer.” Not “enterprise control plane day one.” |

---

## One sentence (memorize this)

**AI agents write the code. getAdvantage is the outside checker that says GO or NO-GO before it ships.**

---

## The product in three beats (customer story)

1. **Problem** — AI ships fast. Secrets, `.env`, and dirty trees still ship with them.  
2. **Action** — `npx getadvantage check`  
3. **Outcome** — Plain **GO** or **NO-GO**. Blocked until the leak is gone.

**Visual:** `docs/launch/verdict-hero.html` — sourcemap key → NO-GO → fix → GO.

---

## Feature catalog (what to advertise)

### A. Core — advertise hard (this is why millions *could* care)

| Feature | User-facing line | Command / surface | Proof |
|---------|------------------|-------------------|--------|
| **Pre-deploy GO/NO-GO** | Safe to ship? Yes or no. Exit 0 / 1. | `npx getadvantage check` · alias `ship` (+build) | Evidence: clean-go, catches-the-leak, … |
| **Secret scan** | Catches committed keys — including inside **sourcemaps/dist** and committed **`.next/static`** browser assets (**LIVE 0.9.1+**). Public prefixes (`NEXT_PUBLIC_*` / `VITE_*`) are not treated as proof a private value is safe. Never prints the full secret. Not a security seal. | part of `check` | Evidence: catches-the-leak, build-output-leak · shipped tests: `.next/static` + Vite dist hostiles · cold `getadvantage@0.10.0` |
| **Tracked `.env`** | A committed `.env` is a leak by itself. | part of `check` | Evidence: tracked-env |
| **Dirty-tree guard** | Stops “I deployed my uncommitted mess” (vercel --prod ships the working tree). | part of `check` | Evidence: dirty-tree |
| **Honest skips** | No TypeScript? No fake typecheck fail. Not checkable ≠ silent GO on manifests. | part of `check` | Honesty principle + tests |
| **First-run rescue** | Outside a git repo: points to `demo` / `git init`, not a brick wall. | any command outside repo | Evidence: outside-git-rescue |

### B. Orientation — advertise as “also”

| Feature | User-facing line | Command |
|---------|------------------|---------|
| **Map** | What does this app have? Routes, integrations, schedules — orientation, not a verdict. Client apps get plain language (no Express jargon on a Vite SPA). **Candidate only (not LIVE on published 0.10.0; do not lead ads until release gate):** estate **Vite/React/Supabase client orientation** (evidence-only statuses/paths); SPA “route mapping does not apply”; no invented Express routes; Supabase SDK ≠ RLS seal. | `npx getadvantage map` · `map --json` · MCP tool `map` |
| **Architecture** | Where is the code accreting? Advisory only — never blocks ship. | `npx getadvantage architecture` · MCP tool `architecture` |

### C. Agent / multi-model workflow — advertise to builders (demo-led)

| Feature | User-facing line | Command |
|---------|------------------|---------|
| **MCP server** | Exposes the gate to agent clients over MCP; registration examples are documented for Claude, Codex, and Grok Build. Do not say a named client is confirmed without a current end-to-end client test. | `npx getadvantage mcp` · 8 tools; evidence proves protocol list + call |
| **Project brain** | `PROJECT-BRIEF.md` — any model starts cold. Notes preserved across refresh. | `brief` · `init` · `handoff` · `switch` |
| **Safe fan-in** | Parallel agent lanes; land only what stays green **together**. Quarantine “green alone, red together.” | `fan-out` · `fan-in` · **`demo`** (wow) |
| **CI** | Same gate on every PR. SARIF upload to code scanning on public repos (private needs Code Security + `actions: read`). Not a security seal. | `github-action` · `check --sarif` · publish pipeline runs tests + evidence |
| **First-party Action + PR summary** | One-copy `uses: BellmeJoe/getadvantage-cli@v1` (or `@v0.10.0`), update-in-place PR comment, job-summary fallback. Same GO/NO-GO gate as local `check`. | root `action.yml` · npm **0.10.0** · tags `v1`/`v0.10.0` |

### D. Trust layer — advertise to builders who run agents (honest scope)

| Feature | User-facing line | Command / surface | Proof |
|---------|------------------|-------------------|--------|
| **Intent Contract** (**LIVE 0.10.0**) | Pin baseline + dedicated freeze **before** the agent starts; after work (including commits), prove every **non-ignored** change after baseline stayed inside the freeze envelope. GO/NO-GO + `contractHash` + `receiptHash`. Nested git + gitlink fail-closed. Local trust only. *Scope verified; semantic correctness not proven.* | `intent init` · `intent check` · part of `check` when freeze trusted | Cold `npx getadvantage@0.10.0` init+check GO / outside-allow NO-GO · tests 96/96 · registry `gitHead` `705986c` |

**LIVE one-liner (builders / agent workflow):**
```
Before the agent starts: getadvantage intent init --goal "…" --allow "src/…"
Commit only intent.json (dedicated freeze). After: intent check → every
post-baseline change inside the human envelope? Scope only — not semantics.
(getadvantage@0.10.0 · LIVE)
```

### E. Do **not** lead with (true but wrong first sentence)

- Full “enterprise control plane” / SaaS cockpit  
- “We make ChatGPT recommend you” (**Get Found** — secondary service / plus×plus DE)  
- “Conflict-free multi-agent coding” (fan-in is honest quarantine, not magic)  
- `npx ship-safe` (different npm package)  
- “Replaces gitleaks / every security scanner”
- Policy/allowlist surface (shipped safe in 0.8.3; still a secondary detail — lead with GO/NO-GO, not config)
- “Intent proves the AI did the right thing” (scope only — not semantic correctness)

---

## Ready-to-post copy

### X / LinkedIn (primary)

```
AI agents write the code.
Who checks it before it ships?

npx getadvantage check
→ GO or NO-GO

Catches live keys (even in sourcemaps), committed .env, dirty deploys.
Local. Open source. No signup.

getadvantage.app
```

### X (with verdict visual)

```
Committed a live key in a sourcemap.
Gate said NO-GO. Fixed. GO.

npx getadvantage check
```

### Show HN title

```
Show HN: getAdvantage – GO/NO-GO before you deploy an AI-built app
```

### Show HN body — use `docs/launch/SHOW-HN.md` (keep claims tight)

### MCP one-liners (builders)

```
claude mcp add getadvantage -- npx getadvantage mcp
```

(Codex / Grok Build: see README registration blocks.)

### Demo hook (power users)

```
npx getadvantage demo
```

One command: collision map → merge train → quarantine the lane that breaks the combined tree.

---

## Positioning vs “millions of users”

| Path to scale | Why |
|---------------|-----|
| **Default step in agent workflows** (MCP + CI) | Millions of AI-built deploys; gate becomes habit |
| **One memorable outcome** (GO/NO-GO) | Shareable, screenshotable, no security degree |
| **Dogfood proof** | Gate caught AWS example keys in its own docs — story sells honesty |
| **Not** “another scan dashboard” | Crowded; we sell **ship decision** |

Cool product for millions = **invisible infrastructure habit**, not a flashy dashboard.  
Roadmap 0.9 (Vite/Supabase ICP failure modes) is the **wedge expansion**; 0.8.x is **table stakes + false-positive hatch**.

---

## Evidence map (for honesty)

| Claim in ads | Must stay GREEN in `npm run evidence` |
|--------------|----------------------------------------|
| Catches committed keys | `catches-the-leak` |
| Catches keys in build/sourcemap | `build-output-leak` |
| Catches keys in committed `.next/static` (**LIVE 0.9.1+**) | Integration tests in `tests/run.mjs` + cold published path; evidence suite covers dist/sourcemap via `build-output-leak` |
| Blocks tracked .env | `tracked-env` |
| Clean repo gets GO | `clean-go` |
| Dirty tree blocks | `dirty-tree` |
| Outside git not a dead end | `outside-git-rescue` |
| Vite/React map honest | `client-app-map` |
| Vite+React+Supabase client orientation (candidate) | Integration tests in `tests/run.mjs` §47 + cold packed map; evidence `client-app-map` |
| Express routes mapped | `server-map-coherent` |

If evidence is red, **do not post**.

---

## Feature depth (for technical threads)

| Surface | What it does |
|---------|----------------|
| `check` / `ship` | Dirty tree, secrets, tracked .env, manifest integrity, typecheck (local tsc only — never npx tsc), optional build, schema-bump warn, overview maps |
| `map` | Estate + API surface + integrations + schedules; stack-aware (Next/Express/Flask/FastAPI/client). **Candidate (not LIVE on published 0.10.0):** Vite/React/Supabase client orientation + `map --json` `clientOrientation` — do not advertise as shipped until release gate |
| `brief` / `handoff` / `init` / `switch` / `gauge` / `ledger` | Portable brain + session continuity |
| `fan-out` / `fan-in` / `demo` | Parallel lanes + safe conductor |
| `mcp` | tools: get_brief, refresh_brief, get_handoff, save_handoff, check, gauge, **map**, **architecture** |
| `github-action` | CI workflow writer — first-party Action consumer (`uses: …@v1` or `@v0.10.0`) + SARIF upload path (**live 0.10.0**) |
| `check --sarif` | Write SARIF 2.1 after the gate; redacted; successful write keeps the gate exit (NO-GO stays non-zero); bad path/write failure exits non-zero |
| First-party Action | Root `action.yml` composite: gate + SARIF + PR summary (**live 0.10.0** · `@v1` / `@v0.10.0`) |
| `deploy` | Advanced: clean worktree vercel deploy (opt-in) |

Zero runtime dependencies. Node ≥18. Local-by-default.

---

## Brand (visual posts)

- **Live site chrome:** gold signal `#d4a853`, geometric mark, serif “getAdvantage”  
- **Not:** teal rounded A-chip (retired)  
- Assets: `docs/launch/verdict-hero.html`, `gif-storyboard-15s.html`

---

## Sibling products (don’t mix in ads for this CLI)

| Product | Story |
|---------|--------|
| **getAdvantage CLI** (this package) | GO/NO-GO ship gate |
| **getAdvantage site** | Trust / ship / control plane; Get Found secondary |
| **plus×plus** | German market Get Found / sales-led — other repo |

---

*Update this pack only when evidence suite or npm version changes.*
