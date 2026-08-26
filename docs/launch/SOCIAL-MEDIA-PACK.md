# Social / advertising pack — getadvantage **0.14.2** (LIVE)

> **Owner:** Grok Build. This is the sole CLI advertising-truth source. Maintain
> it in one assigned lane and keep all 8 evidence checks GREEN. Growth may
> distribute this truth autonomously after its factual, voice, duplication,
> platform, and rate preflight. Grok may release only after the objective product
> gate and independent audit have no open P1/P2.

> **LIVE:** **getadvantage@0.14.2** published **2026-08-26 13:27 +03:00**
> (patch — a security-detection correctness fix). `dist-tags.latest` **0.14.2**,
> registry `gitHead` `a16f2d9`, tags `v0.14.2` and floating `v1` both peel to
> `a16f2d9`, GitHub Release `v0.14.2`, CI run `32958202735` (success, suite
> **324/324**, evidence **8/8**), published `dist.shasum`
> `99556dcce23816b10769efd5db79e3870800bb1e`. Released under a release-scoped
> independent `REVIEW_GO` at `d5e36de` with 0 open P1/P2; the release execution
> itself was then independently re-verified at `a16f2d9`. Prefer leading with the
> eight core GO/NO-GO claims below; Intent remains the trust-layer follow-on —
> always *scope verified; semantic correctness not proven*.
>
> **What 0.14.2 ships (patch — no new command, no new check):** before 0.14.2 a
> committed credential glued to an ordinary variable name (`PREFIX_sk_live_…`,
> `PREFIX_ghp_…`, AWS key ids, npm tokens) returned **a false clean**:
> `no leaked-secret patterns matched`, verdict **GO**, exit **0**. 27 anchors inside
> the secret pattern catalogue moved from `` to explicit non-alphanumeric
> lookarounds; the delta versus `` is exactly the underscore. Those cases now
> return **NO-GO with `file:line`**.
> **Truth limits — do not overstate this.** It does **not** make detection complete:
> a key immediately preceded or followed by a letter or digit is still a **deliberate
> miss** (matching there would flag base64 substrings). “No new false positives” holds
> **only for the two corpora actually measured** (this repo, the site repo) — it is not
> a general claim. No new checks, no verdict or exit semantics change beyond catching
> what was previously missed. **Not an adoption event** — named evaluators / installs /
> first gates / week-two reuse / retained external teams remain **0**.
>
> **Still live from 0.14.1 (historical intro):** first-contact classification +
> packed-tarball hygiene.
>
> **Still live from 0.14.0 (historical intro — new user-facing command):** `getadvantage feedback`
> prints a copy-pasteable GitHub issue URL pre-filled with redacted environment
> and gate metadata. **Nothing is sent** — no browser open, no network request,
> always exits 0, not a gate, not telemetry. Also carries: ops retained-team
> detector (ops-only, not packed), Marketplace listing readiness docs, README /
> version-claim currency, redaction catalogue unification + narrowing repair.
> **No new checks. No verdict or exit change on the gate.** Also carried a
> correctness fix (`cc9d39a`): secret **auth identity is now line-ending
> independent**, so a `secrets.ignore` allowlist entry authored on Windows now
> actually suppresses the same multi-line secret when the gate runs on Linux CI,
> and the reverse. Before this, the same secret could carry two different auth
> ids across platforms.
>
> **Still live from 0.13.1 (historical intro):** collapsed secret-row `file:line`
> restore + dry-run paste-ready JSON repair + body/transport key banner.
>
> **Still live from 0.13.0 (historical intro):** `--report-dry-run` transparency
> mode — exact body that would leave, endpoint, byte size, whether a key resolved
> (never its value), zero network. Transparency feature, not a leak fix.
>
> **Still live from 0.12.2 (historical intro):** the GitHub Action PR / job
> summary lists every finding (not only the first) with `file:line` + paste-ready
> remediation, blocking first (bounded caps). Presentation only.
>
> **Still live from 0.12.1 (historical intro):** denser human `check` output so
> the verdict sits on a short first screen, plus symlink-escape mode `120000`
> regression coverage. Measured: **CLI `check` 109 → 56 lines**; **site `check`
> 143 → 82 lines**.
>
> **Still live from 0.12.0 (historical intro):** `getadvantage init --claude-code`
> installs the gate as an **automatic hook** so every Claude Code agent session
> is gated by default; agent-trigger profile visibly omits Dirty-tree on hooks
> only; plain `check` / `check --ci` unchanged; in-repo proof receipt
> `.getadvantage/INVISIBLE-MODE.md` with **zero telemetry**. **Cursor remains
> detect-and-refuse** (disclosed narrowing — never claim Cursor automatic hooks).
> Auto-captured Intent uses project-tree-wide `allow: ["**"]` — a **tree seal,
> not a tight task envelope**.
>
> **Still live from 0.11.x (historical intro):** Paste-ready secret remediation
> (0.11.1); Intent on fan-in merge-train `gateTree` (0.11.0). **Shipped npm does
> not check Supabase RLS** — parked (`PARKED_INSUFFICIENT`), unexposed from
> `runChecks`/`gateTree` (open P1/P2 remain), not present on any shipped surface,
> and never advertised.
>
> **Also still live (from 0.10.x, historical intro):** Vite/React/Supabase
> **client orientation** on `map` (Supabase SDK ≠ RLS seal); Intent Contract
> (`intent init` / `intent check` / `check` when freeze trusted); first-party
> GitHub Action + PR summary (`uses: BellmeJoe/getadvantage-cli@v1` — floating
> major; exact tags from the [releases page](https://github.com/BellmeJoe/getadvantage-cli/releases));
> secret scan of committed `.next/static/**`; SARIF 2.1. Not a security guarantee.
> Rollback target for live **0.14.2**: **getadvantage@0.14.1** /
> tag `v0.14.1` / `f098c5e` (with **0.14.0** / `v0.14.0` / `cc9d39a` and
> **0.13.1** / `v0.13.1` / `e5b06f3` intact behind it). Prefer the
> `npm dist-tag` path over unpublish.

**For any session that posts, ads, or briefs creators.**  
Do not invent features. The eight claims in the Evidence map are proven by
`npm run evidence`; that result does not automatically prove every client,
workflow, or market statement elsewhere in this pack. Other feature claims need
their named current test or source. Anything marked *roadmap* is not live.
**Adoption, evaluators, installs, first gates, week-two reuse, retained teams:
all 0.** Downloads are reach, not adoption. Do not quote unsettled npm download
windows.

| Field | Value |
|--------|--------|
| **npm (published live)** | **`getadvantage@0.14.2`** (live 2026-08-26; registry `gitHead` `a16f2d9`) |
| **Checkout** | Live **0.14.2** patch: committed credentials glued to a variable name (`PREFIX_sk_live_…`) are caught instead of returning a false GO (detection still not complete — alphanumeric-adjacent keys remain a deliberate miss) + prior 0.14.0 `getadvantage feedback` (print-only issue URL; nothing sent) + prior 0.13.1 `file:line` / dry-run paste-ready repair + `--report-dry-run` + multi-finding Action summary + denser check + symlink-escape coverage + Claude hooks + paste-ready secret remediation + Intent in merge-train + map client orientation + client-bundle scan + Action + SARIF |
| **Install** | `npx getadvantage` (tracks `latest`) or pin an exact tag from the [releases page](https://github.com/BellmeJoe/getadvantage-cli/releases) (no signup) |
| **GitHub** | https://github.com/BellmeJoe/getadvantage-cli · [releases](https://github.com/BellmeJoe/getadvantage-cli/releases) · Action `@v1` (floating major) · Marketplace listing [getadvantage-check](https://github.com/marketplace/actions/getadvantage-check) (shelf visibility only) |
| **Site** | https://getadvantage.app |
| **Owner truth** | `npm run evidence` → **8/8 GREEN** · full suite **324/324** · release fingerprint **`a16f2d9`** · published `dist.shasum` `99556dcce23816b10769efd5db79e3870800bb1e` · tag `v0.14.2` + floating `v1` both peel to `a16f2d9` · CI run `32958202735` · post-release cold `npx getadvantage@0.14.2 check` on a fresh temp repo → **GO, exit 0, 5s** (re-measured this cycle, 2026-08-26 16:58 Amman) · 0 RLS advertised · rollback: `0.14.1` / `v0.14.1` / `f098c5e` |
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
| **Secret scan** | Catches committed keys matching its published pattern catalogue — including inside **sourcemaps/dist** and committed **`.next/static`** browser assets (**LIVE**). Public prefixes (`NEXT_PUBLIC_*` / `VITE_*`) are not treated as proof a private value is safe. From **0.14.2**, a key glued to an ordinary variable name (`PREFIX_sk_live_...`) is caught; before 0.14.2 it was not. Detection is pattern-based and **not complete**: a key immediately preceded or followed by a letter or digit is still a deliberate miss (it would flag base64 substrings). **Redacts every secret it matches**; a value it does not match is not redacted, so this is not a guarantee that no secret is ever printed. Not a security seal. On secret NO-GO only, names a smallest safe next edit + paste-ready `secrets.ignore` snippet (emission-only). | part of `check` | Evidence: catches-the-leak, build-output-leak · shipped tests: `.next/static` + Vite dist hostiles · cold published path |
| **Tracked `.env`** | A committed `.env` is a leak by itself. | part of `check` | Evidence: tracked-env |
| **Dirty-tree guard** | Stops “I deployed my uncommitted mess” (vercel --prod ships the working tree). | part of `check` | Evidence: dirty-tree |
| **Honest skips** | No TypeScript? No fake typecheck fail. Not checkable ≠ silent GO on manifests. | part of `check` | Honesty principle + tests |
| **First-run rescue** | Outside a git repo: points to `demo` / `git init`, not a brick wall. | any command outside repo | Evidence: outside-git-rescue |

### B. Orientation — advertise as “also”

| Feature | User-facing line | Command |
|---------|------------------|---------|
| **Map** | What does this app have? Routes, integrations, schedules — orientation, not a verdict. Client apps get plain language (no Express jargon on a Vite SPA). **LIVE:** estate **Vite/React/Supabase client orientation** (evidence-only statuses/paths); SPA “route mapping does not apply”; no invented Express routes from test/fixture/string literals; Supabase SDK ≠ RLS seal. | `npx getadvantage map` · `map --json` · MCP tool `map` |
| **Architecture** | Where is the code accreting? Advisory only — never blocks ship. | `npx getadvantage architecture` · MCP tool `architecture` |

### C. Agent / multi-model workflow — advertise to builders (demo-led)

| Feature | User-facing line | Command |
|---------|------------------|---------|
| **MCP server** | Exposes the gate to agent clients over MCP; registration examples are documented for Claude, Codex, and Grok Build. Do not say a named client is confirmed without a current end-to-end client test. | `npx getadvantage mcp` · 8 tools; evidence proves protocol list + call |
| **Project brain** | `PROJECT-BRIEF.md` — any model starts cold. Notes preserved across refresh. | `brief` · `init` · `handoff` · `switch` |
| **Safe fan-in** | Parallel agent lanes; land only what stays green **together**. Quarantine “green alone, red together.” | `fan-out` · `fan-in` · **`demo`** (wow) |
| **CI** | Same gate on every PR. SARIF upload to code scanning on public repos (private needs Code Security + `actions: read`). Not a security seal. | `github-action` · `check --sarif` · publish pipeline runs tests + evidence |
| **First-party Action + PR summary** | One-copy `uses: BellmeJoe/getadvantage-cli@v1` (floating major; exact tags from the [releases page](https://github.com/BellmeJoe/getadvantage-cli/releases)), update-in-place PR comment, job-summary fallback. Same GO/NO-GO gate as local `check`. Multi-finding table rows with `file:line` + paste-ready remediation, blocking first (bounded caps). | root `action.yml` · live npm · floating tag `v1` |
| **Report transparency (`--report-dry-run`)** | Shows the exact bytes that would leave your machine before anything leaves — same body as `--report`, resolved endpoint, byte size, whether an API key resolved (never its value) — and makes **zero network calls**. Transparency only; not a security fix. Source/diffs/files still never in the report body. | `check --report-dry-run` · `fan-in --report-dry-run` | product `472ca83` · 4 hostile tests · *not a leak repair* |
| **Invisible mode (Claude Code)** | One command installs the gate as an **automatic hook** so every agent session is gated by default; writes in-repo proof receipt with **zero telemetry**. Cursor is **detect-and-refuse** (not automatic). | `npx getadvantage init --claude-code` · status/uninstall/bypass · receipt `.getadvantage/INVISIBLE-MODE.md` | product `fe9e2ad` · cold published activation ~11.3s · *scope verified; semantic correctness not proven* |
| **Feedback link (`feedback`)** | Prints a copy-pasteable GitHub issue URL pre-filled with redacted environment + gate metadata. **Nothing is sent** — no browser open, no network request, always exits 0, not a gate, not telemetry. | `npx getadvantage feedback` | product `8eb494b` · honest instrumentation only |

### D. Trust layer — advertise to builders who run agents (honest scope)

| Feature | User-facing line | Command / surface | Proof |
|---------|------------------|-------------------|--------|
| **Intent Contract** (**LIVE**; merge-train gate also live) | Pin baseline + dedicated freeze **before** the agent starts; after work (including commits), prove every **non-ignored** change after baseline stayed inside the freeze envelope. GO/NO-GO + `contractHash` + `receiptHash`. Nested git + gitlink fail-closed. Quiet when Intent is not configured (no git fatal storm). Same envelope also on fan-in merge-train `gateTree` (quarantine outside-allow; no contract → clean omit). Local trust only. *Scope verified; semantic correctness not proven.* | `intent init` · `intent check` · part of `check` when freeze trusted · fan-in combined-tree gate | Cold path on published package · CI tests+evidence on release · prior cold init+check GO / outside-allow NO-GO |

**LIVE one-liner (builders / agent workflow):**
```
Before the agent starts: getadvantage intent init --goal "…" --allow "src/…"
Commit only intent.json (dedicated freeze). After: intent check → every
post-baseline change inside the human envelope? Fan-in also enforces the
envelope on the combined tree when a freeze is present. Scope only — not
semantics. (LIVE)
```

### E. Do **not** lead with (true but wrong first sentence)

- Full “enterprise control plane” / SaaS cockpit  
- “We make ChatGPT recommend you” (**Get Found** — secondary service / plus×plus DE)  
- “Conflict-free multi-agent coding” (fan-in is honest quarantine, not magic)  
- `npx ship-safe` (different npm package)  
- “Replaces gitleaks / every security scanner”
- Policy/allowlist surface (shipped; still a secondary detail — lead with GO/NO-GO, not config)
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
Roadmap era “0.9” (Vite/Supabase ICP failure modes — **historical label**) is the **wedge expansion**; era “0.8.x” is **table stakes + false-positive hatch**.

---

## Evidence map (for honesty)

| Claim in ads | Must stay GREEN in `npm run evidence` |
|--------------|----------------------------------------|
| Catches committed keys | `catches-the-leak` |
| Catches keys in build/sourcemap | `build-output-leak` |
| Catches keys in committed `.next/static` (**LIVE**) | Integration tests in `tests/run.mjs` + cold published path; evidence suite covers dist/sourcemap via `build-output-leak` |
| Blocks tracked .env | `tracked-env` |
| Clean repo gets GO | `clean-go` |
| Dirty tree blocks | `dirty-tree` |
| Outside git not a dead end | `outside-git-rescue` |
| Vite/React map honest | `client-app-map` |
| Vite+React+Supabase client orientation (**LIVE**) | Integration tests in `tests/run.mjs` §47 + cold packed map; evidence `client-app-map` |
| Express routes mapped | `server-map-coherent` |

If evidence is red, **do not post**.

---

## Feature depth (for technical threads)

| Surface | What it does |
|---------|----------------|
| `check` / `ship` | Dirty tree, secrets, tracked .env, manifest integrity, typecheck (local tsc only — never npx tsc), optional build, schema-bump warn, overview maps |
| `map` | Estate + API surface + integrations + schedules; stack-aware (Next/Express/Flask/FastAPI/client). **LIVE:** Vite/React/Supabase client orientation + `map --json` `clientOrientation` (evidence-only; SPA route mapping does not apply; Supabase SDK ≠ RLS seal) |
| `brief` / `handoff` / `init` / `switch` / `gauge` / `ledger` | Portable brain + session continuity |
| `fan-out` / `fan-in` / `demo` | Parallel lanes + safe conductor |
| `mcp` | tools: get_brief, refresh_brief, get_handoff, save_handoff, check, gauge, **map**, **architecture** |
| `github-action` | CI workflow writer — first-party Action consumer (`uses: …@v1`; exact tags from the [releases page](https://github.com/BellmeJoe/getadvantage-cli/releases)) + SARIF upload path (**live**) |
| `check --sarif` | Write SARIF 2.1 after the gate; redacted; successful write keeps the gate exit (NO-GO stays non-zero); bad path/write failure exits non-zero |
| First-party Action | Root `action.yml` composite: gate + SARIF + PR summary (**live** · `@v1` floating major; multi-finding density) |
| `init --claude-code` | Invisible mode: automatic Claude Code hooks + receipt (**live**). Cursor = detect-and-refuse |
| `feedback` | Print-only GitHub issue URL with redacted metadata (**0.14.0**). Nothing sent; no browser; zero network; always exit 0; not a gate |
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
