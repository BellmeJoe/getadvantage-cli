# getAdvantage product north star

This is the product portfolio and anti-idle contract for Grok Build. `ROADMAP.md`
contains the technical evidence trail; this file decides what enters the single
implementation lane next.

## The destination

**Make getAdvantage the default pre-merge proof layer for AI-built software,
measured by one number: retained external teams — teams still running the gate
in week two.**

The product loop must become:

`one command -> catches a real ship risk -> gives a usable fix -> lives in every PR -> emits shareable proof -> earns the next install`

The only leading indicators are **evaluator conversations** and **named
installs**. Retention means public repositories, known teams, or opted-in
installations that run getAdvantage again after the first week. No hidden
telemetry and no manufactured downloads.

> **Retired 2026-08-02, permanently** (`DEC-WEEK-PLAN-2026-07-30`, THE STOP
> DECISION; mirrored here 2026-08-02): the 1,000,000-download north star, all
> download-delta reporting, weekly-download targets, and every audience-follower
> floor. Evidence that closed it, `agent-ops\DOWNLOAD-ATTRIBUTION-LEDGER.md`:
> 2026-08-01 had no release, no CI and no agent cycle of any kind, and the
> counter still read 18; 69.7% of that week's downloads fell on the two release
> days. **Downloads are a labelled context footnote only.** They never appear
> near the word progress, are never a leading indicator, and never raise a score.
> Release counts, test counts, and engineering quality are hygiene, reported
> separately, and likewise never raise a goal grade.

## Starting line and milestone ladder

| Metric | Baseline (2026-08-02) | 30-day target | 90-day target | 12-month target |
|---|---:|---:|---:|---:|
| **retained external teams (NORTH STAR)** | 0 | 0-2 | 10 | 100 |
| evaluator conversations (leading) | 0 | 1-3 | 15 | 150 |
| named installs (leading) | 0 | 1-3 | 20 | 200 |
| cold path: install -> useful result | **4.14s** (measured 2026-08-02, `npx getadvantage@0.11.1 check`, fresh repo, isolated npm cache, exit 0) | hold < 60s | hold < 60s | hold < 60s |

These are trajectory targets, not claims. Every weekly review records the actual
number, delta, source, and uncertainty. The 30-day figures are the honest
expectation adopted in the week plan, not an ambition.

**Cold path is met and held, not optimized.** At 4.14s it is 14x inside the
12-month target; further latency work is not fundable without profiling evidence
that real CI time improves.

> **Re-measured 2026-09-05 at `0.14.2`** (weekly review; fresh `git init`,
> isolated `npm_config_cache`): **1.96s** to a GO verdict, exit 0. The **full
> activation path** — cold `npx` → `init --claude-code` → first gate → receipt on
> disk — is **4.14s** (check 1.96s + init 2.18s), receipt verified present. **The
> fastest reading ever recorded, and it is not an engineering win:** `0.14.2`
> published ten days earlier, so registry/CDN warmth explains the gain over the
> 08-29 reading, exactly as tarball-fetch cost explained the loss that week.
> Target is *hold* < 60s; held with ~14x margin on the whole adoption path. **No
> latency work is fundable.**

> **Re-measured 2026-08-29 at `0.14.2`** (weekly review; fresh `git init`,
> isolated `npm_config_cache`): **4.42s** to a GO verdict, exit 0. The **full
> activation path** — cold `npx` → `init --claude-code` → first gate → receipt on
> disk — is **7.97s** (check 4.42s + init 3.55s), receipt verified present.
> Slower than the 08-22 reading only because `0.14.2` published three days
> earlier, so the tarball fetch dominates; `grok-build` independently measured
> **4.97s** cold on the same published version the same morning. Target is *hold*
> < 60s; held with ~7.5x margin on the whole adoption path. **No latency work is
> fundable.**

> **Re-measured 2026-08-22 at `0.14.0`** (weekly review; fresh `git init`,
> isolated `npm_config_cache`): **2.85s** to a GO verdict, exit 0. The **full
> activation path** — cold `npx` → `init --claude-code` → first gate → receipt on
> disk — is **5.41s** (check 2.85s + init 2.56s), receipt verified present. Target
> is *hold* < 60s; held with ~11x margin on the whole adoption path. **No latency
> work is fundable.**

> **Re-measured 2026-08-15 at `0.13.1`** (weekly review; fresh `git init`,
> isolated `npm_config_cache`): **2.03s** and **4.98s** across two runs, exit 0,
> GO. The **full activation path** — cold `npx` → `init --claude-code` → first
> gate → receipt on disk — is **4.63s** (init 2.11s + gate 2.53s). The 2026-08-02
> baseline row stands; the target is *hold*, and it is held with ~13x margin on
> the whole adoption path. No further latency work is fundable.

## Retained-team detector (the north-star measurement method)

**Train tip for 0.14.0** (minor on 0.13.1) — invisible mode from `0.12.0`;
legibility + Action summary density through `0.12.2`; `--report-dry-run`
transparency mode from `0.13.0`; **0.13.1** presentation/correctness repairs;
**0.14.0** adds the user-facing `getadvantage feedback` command (print-only
GitHub issue URL; nothing sent, no browser, zero network, always exit 0, not a
gate). Ops retained-team detector remains ops-only (not packed). **No new check.
Adoption metrics unchanged (all 0).** Live npm remains **0.13.1** until this
train publishes.

Retention is counted with **zero telemetry**, from public data only. Invisible
mode writes an in-repo receipt (`.getadvantage/INVISIBLE-MODE.md`) whose stable
header is publicly searchable.

- Query: GitHub code search for the receipt header string, excluding `BellmeJoe/*`.
- First run vs retained: a repository counts as **retained** only when its
  receipt carries entries in **two distinct calendar weeks**.
- Every weekly review runs the identical query and records the result.
- Validity control: a positive-control code search must return hits in the same
  session, otherwise a zero is a broken query and not an observed absence.
  Validated 2026-08-02 — control returned 3 real third-party repositories while
  the receipt header returned 0.
- Never infer attribution beyond what the query shows, and never count
  agent-generated verification traffic as adoption.

> **DETECTOR SHIPPED 2026-08-15** — `ops/retained-team-detector.mjs`, ops tooling
> only (absent from `package.json` `files`; ships to nobody; no product surface,
> no telemetry, no CLI/flag/verdict). Classifies **install** (one ISO week) vs
> **retained** (≥2 distinct ISO weeks); rate-limit/auth/network/`incomplete_results`
> → `UNKNOWN` + non-zero exit, never a silent `0`. Control-first world-fact query
> shipped in the incomplete-results repair (`d97a9fc`). **First live run,
> 2026-08-15 weekly review: exit 0, `retained-external-teams: 0`**, observed
> absence under a passing control. **Re-run 2026-08-22 weekly review:
> `retained-external-teams: 0` with `# positive-control-total-count: 2044`** —
> observed absence, not a broken query. The `UNKNOWN` path was verified the same
> cycle: with `GITHUB_TOKEN` unset the detector prints `UNKNOWN`, refuses to
> report a `0`, and **exits 1**. **P3 closed in lane
> `0.14.x-stderr-and-control-transparency` (REVIEW_PENDING):** success reports
> now print `# positive-control-total-count: N` so the report evidences its own
> control. **Re-run 2026-08-29 weekly review: `retained-external-teams: 0`,
> `status: ok — zero code-search hits`, `# positive-control-total-count: 131`** —
> observed absence; the `UNKNOWN` path was re-verified the same session (no
> `GITHUB_TOKEN` → prints `UNKNOWN`, refuses to report a `0`, **exits 1**). *The
> control fell from 2,048 to 131 between two consecutive reads. Recorded, not
> explained: the control asserts **reachability**, not magnitude.* **Re-run 2026-09-05 weekly
> review: `retained-external-teams: 0`, `status: ok — zero code-search hits`,
> `# positive-control-total-count: 2040`** — observed absence, and the control has
> recovered from 131 to 2,040 between two weekly reads with no explanation on
> either side. Recorded, not explained; the recovery corroborates that 131 was a
> magnitude fluctuation and not a degrading query. The `UNKNOWN` path was
> re-verified the same session (no `GITHUB_TOKEN` → prints `UNKNOWN`, refuses to
> report a `0`, **exits 1**).

## Portfolio order

Grok pulls the highest-scoring eligible bet from this list whenever the active
lane ships or is killed. Only one implementation lane may be open.

### P0 — become native to the pull-request workflow

1. **GitHub-native SARIF path** — dependency-free SARIF 2.1 output plus a
   generated, pinned workflow that uploads results to GitHub code scanning.
   Honest scope: public-repository support first; do not imply that getAdvantage
   replaces GitHub security products.
2. **First-party GitHub Action and concise PR summary** — one copy/paste install,
   stable major tag, deterministic GO/NO-GO, no duplicate comments.
   **Status (2026-07-21):** **LIVE 0.9.0** — first-party Action + PR summary on
   npm/`@v1`/`@v0.9.0` after publish self-gate fixture repair
   (`fixtures/publish-self-gate` + `uses: ./` working-directory). Rollback:
   **0.8.4** / `v0.8.4`.
3. **One-command CI bootstrap** — detect the repository, write or update the
   workflow safely, show the exact diff, and refuse destructive overwrite.
   **Status (2026-08-15): KILLED on duplication.** Bet 1 (LIVE 0.8.4) already
   generates a pinned workflow, and `init --claude-code` (LIVE 0.12.0) installs
   the gate in **2.11s** measured this review. The residual delta is safe-update
   diffing plus destructive-overwrite refusal. It fails the eligibility rule
   "does not duplicate an existing capability", carries **zero demand evidence**
   across ~40 market-signal-ledger entries and zero dogfood friction, and its
   activation premise is dead at a 4.63s measured activation path. **Reopen only
   if a real external repository reports friction installing the workflow** —
   which requires an external repository to exist first.

### P1 — own the AI-built-app failure modes

4. **Client-bundle secret exposure** — built `dist/` and `.next/static` output,
   with honest handling of intentionally public prefixes such as `VITE_` and
   `NEXT_PUBLIC_`.
   **Status (2026-07-22):** **LIVE 0.9.1** — secret scan covers committed
   `.next/static/**` (other `.next` still skipped honestly); public prefixes
   are not exemptions. npm/`@v1`/`@v0.9.1`. Rollback: **0.9.0** / `v0.9.0`
   and **0.8.4** / `v0.8.4`.
4b. **Intent Contract (change-scope trust)** — human goal bound to an enforceable
   path envelope; freeze blob authorizes; receiptHash; nested-git/gitlink fail-closed.
   **Status (2026-07-23):** **LIVE 0.10.0** — npm/`@v1`/`@v0.10.0`; registry
   `gitHead` `705986c`; cold published Intent path verified. Rollback:
   **0.9.1** / `v0.9.1`. Limitation always: *scope verified; semantic correctness
   not proven.*
5. **Vite + React + Supabase understanding** — useful map and check output on the
   dominant AI-app export path rather than a blank or backend-centric result.
   **Status (2026-07-25):** **LIVE 0.10.1** — map emits evidence-only `clientOrientation`
   (vite/react/supabase statuses + paths, build entry, nextCheck, honesty notes);
   SPA empty lane says route mapping does not apply; dogfood reliability (quiet
   missing Intent; no fixture/string-literal routes as live map routes).
   Rollback: **0.10.0** / `v0.10.0`. Not an RLS/auth seal.
6. **Supabase RLS and ungated mutation checks** — static checks over migrations,
   policies, and edge functions; distinguish proven failure, warning, and
   uncheckable state.
   **Status (2026-07-30):** **`PARKED_INSUFFICIENT`** at product fingerprint
   **`d246171`**; `checkSupabaseRls` **unexposed** from `runChecks` /
   `gateTree` at **`cef3491`** (1 open P1 + 1 open P2). Never live; never
   advertised. Not an end-to-end auth seal.
7. **Paste-ready deterministic remediation** — what failed, exact location, why
   it matters, and the smallest safe next edit for every wedge finding.
   **Status (2026-07-31):** **LIVE 0.11.1** — every blocking secret finding names
   the smallest safe next edit and emits a pattern-aware `secrets.ignore`
   snippet; suppression always disclosed. Additive only, no verdict change.
   Registry `gitHead` `66ffb9b`. Rollback: **0.11.0** / `v0.11.0`.
7b. **Invisible mode** — `init --claude-code` installs the gate as an automatic
   hook so every agent session is gated by default; the hook writes the in-repo
   proof receipt that makes week-two reuse publicly countable with zero telemetry.
   **Status (2026-08-19):** rides **0.14.0** train (tip fingerprint `3afc50b` +
   version bump) — invisible-mode product fingerprint **`fe9e2ad`** (0.12.0);
   train/legibility stack through **0.12.2**; `--report-dry-run` product
   fingerprint **`cdb923c`**; **0.13.1** presentation/correctness fingerprints
   **`ce5c182`** + **`ec92722`**; **0.14.0** adds `getadvantage feedback`
   (product `8eb494b` + redaction catalogue `ec58b49` + narrowing repair
   `53339ff`/`f19797b`). Agent-trigger profile (`check --agent-trigger`) visibly
   omits Dirty-tree on hooks only; plain `check` / `check --ci` still enforce
   Dirty-tree. Cursor remains **detect-and-refuse**. `--report-dry-run` is
   transparency only (preview exact report body; zero network; never print API
   key value; live `--report` still sends the key as `Authorization` bearer
   only). Rollback after publish: **0.13.1** / `v0.13.1` / `e5b06f3` (with
   **0.13.0** / `v0.13.0` / `bdc8b04` and **0.12.2** / `v0.12.2` / `1e451ac`
   intact). Live npm remains **0.13.1** until the train publishes.

7c. **Separator-adjacency false-positive class in the shipped secret scan** — *added
   2026-08-29 weekly review, score **2.75** at effort 1 (reach 2 · activation 3 ·
   retention 3 · trust 4 · sharing 1).* The `0.14.2` anchor hotfix closed a live
   false-clean defect (`0.14.1` found **1 of 5** underscore-glued credentials, `0.14.2`
   finds **5 of 5**), and the `2026-08-26` audit **narrowed** the accompanying "zero new
   false positives" claim: constructed fixtures show the widening extends a
   **pre-existing** separator-adjacency false-positive class along the underscore axis —
   a CSS class `btn_sk-fade-…`, an `.env.example` KV/Redis template. A security gate that
   NO-GOs on a template file on an evaluator's **first** run fails activation at the
   moment that matters most. **Evidence class, stated honestly: constructed, not
   observed** — zero new false positives were measured on the two real corpora available
   (this repo, the site repo), so the mechanism is proven and the real-world rate is
   unquantified. That is why it scores 2.75 and not higher, and it is still the only
   product candidate in weeks with measured rather than speculative evidence.
   **DO NOT OPEN BEFORE 2026-09-04:** it touches `checks.mjs` `SECRET_PATTERNS`, and the
   deferred `0.15.0` train asserts `scan.SECRET_PATTERNS === checks.SECRET_PATTERNS` as a
   single corpus. **First eligible product lane after the train lands.**

### P2 — make proof portable and shareable

8. **Gate proof receipt** — commit, tool version, policy identity, checks,
   verdicts, and hashes in a stable local record.
   **Status (2026-08-02):** **SUBSUMED by 7b** — invisible mode already writes
   `.getadvantage/INVISIBLE-MODE.md`. A standalone bet would duplicate an
   existing capability, which is an explicit ineligibility criterion below. What
   survives of it is the retained-team detector that *counts* those receipts.
9. **CI attestation recipe** — bind proof receipts to the workflow/repository/
   commit using GitHub artifact attestations; keep the CLI local-first.
   *Deprioritized (2026-07-26, held 2026-08-02): zero demand evidence, zero
   dogfood friction, and it depends on the receipt existing first.*
10. **Shareable verified summary** — honest Markdown/JSON output for PRs,
    handoffs, and badges. Never turn a partial check into a security seal.
    *Re-scored 2026-08-22 to **1.03** at effort 2 (reach 2 · activation 1 ·
    retention 2 · trust 2 · sharing 5), down from 1.25. Downgraded on a new
    competitive finding: four teams in the 08-15..08-22 window found, filed and
    fixed their own committed-secret defect within a day, and `Resolvr-io/apogee#104`
    credits the find verbatim to "2026-08 security scan (GLM 5.3, z.ai) — PR #90".
    Shareable proof differentiates less when generic AI reviewers already run inside
    these repos. Still deprioritized, justification below unchanged.*
    *Deprioritized 2026-08-15: **zero demand evidence** in ~40 ledger entries.
    Written justification, as the rule requires — it is the only bet whose growth
    mechanism is user-to-user propagation, the one channel depending on neither
    the send gate nor a founder click; but propagation from a base of zero users
    cannot start. Held in queue below both distribution bets until a first
    external user exists.*
11. **Agent-native parity** — every stable read-only capability is available
    through the MCP surface with the same result and policy semantics.
    *Split (2026-08-02): the MCP-registry listing of the existing `mcp.mjs`
    surface moves into 16; full parity stays here.*
    *Deprioritized 2026-08-15: zero demand evidence, zero dogfood friction, and a
    capability lane for a zero-user population is exactly what
    `WEEK-PLAN-2026-07-30:101` closed. Bet 16b delivers most of its realistic
    near-term value — discoverability of the surface that already ships — at a
    third of the effort.*

### P3 — retention and ecosystem

12. **Framework policy packs** selected by detected stack, with safe defaults and
    explicit overrides. *Deprioritized: zero demand evidence.*
13. **Fast repeat runs** using deterministic caching only after profiling proves
    it improves real CI time.
    **Status (2026-08-02): KILLED on measured evidence.** True cold path is
    **4.14s** against a 60-second 12-month target. There is no CI time to
    recover, so this bet's own admission condition can never be met. Reopen only
    if a real consumer repository profiles a slow run.
14. **Evaluator feedback loop** — generated issue/discussion link containing
    redacted environment and result metadata, never secrets.
    **Status (2026-08-22): LIVE 0.14.0 — DELIVERED, removed from the bet queue.**
    Published 2026-08-20, registry `gitHead` `cc9d39a`, re-verified live by the
    2026-08-22 weekly review. Shipped in 0.14.0 — — product fingerprint
    **`8eb494b`** (`feedback.mjs` + `index.mjs` wire); redaction catalogue
    unification **`ec58b49`**; narrowing repair **`53339ff`/`f19797b`**.
    `getadvantage feedback` prints a copy-pasteable GitHub issue URL pre-filled
    with redacted metadata. **Nothing is sent** — no browser open, no network
    request, always exits 0, not a gate, not telemetry. Lane-scoped
    `REVIEW_GO` only until the release-scoped audit of this train.
15. **GitLab and audit exports** only after observed buyer or repository demand.
16. **Free-shelf distribution** *(added 2026-08-02; **SPLIT 2026-08-15** into 16a
    and 16b — they have different blockers and do not belong in one queue slot)*.

16a. **GitHub Actions Marketplace listing** — **residual maintenance, re-scored
    0.48 at effort 1 (2026-08-19).** The 3.55 top-of-portfolio score rested on
    "listing absence + one founder click unlocks the only no-send reach
    surface." **That premise does not hold.** Re-probed 2026-08-19T14:11:04Z
    (`Invoke-WebRequest -Method Head`): primary slug
    `https://github.com/marketplace/actions/getadvantage-check` returns
    **200** — real listing, owner `BellmeJoe`, source `BellmeJoe/getadvantage-cli`,
    install `BellmeJoe/getadvantage-cli@v1`, categories *Continuous integration*
    + *Code quality*, version shown `v0.13.1`. The other three plausible slugs
    (`/getadvantage`, `/get-advantage-check`, `/getadvantage-cli`) correctly
    return **404**. The Marketplace Developer Agreement and the initial publish
    checkbox for the live listing have **already been taken**. Readiness lane
    `0.13.x-marketplace-listing-readiness` closed `done` at `9efe0c3`.
    **Residual state only:** every *future* Release still needs the founder to
    tick "Publish this Action to the GitHub Marketplace" (REST/API automation
    still cannot set that flag) — documented in
    `docs/launch/MARKETPLACE-LISTING.md`. Score components for the residual
    (effort 1): reach 1 · activation 0.5 · retention 0 · trust 0 · sharing 1 →
    `(0.25+0.125+0+0+0.1)/1 = 0.48`. **No longer top of the portfolio; not a
    dispatchable product lane.** Listing = shelf visibility only — never
    adoption, installs, evaluators, or retained teams.

16b. **MCP registry listing** — score **2.45** at effort 1 (re-scored 2026-08-19
    12:45: reach 4 · activation 3 · retention 1 · trust 1 · sharing 3 →
    `(1.0+0.75+0.2+0.2+0.3)/1 = 2.45`; NORTHSTAR previously carried the stale
    **2.85** figure from 2026-08-15). Lists the **already-shipped** `mcp.mjs`
    surface in the MCP registry and established awesome-lists; no product code.
    Verified gap: account-wide `gh search prs --author=@me` returns 8 lifetime
    PRs, **every one on a `BellmeJoe/*` repo — zero third-party shelf PRs ever
    opened.** *Honest distinction from 16a:* a registry listing requires a **PR
    to someone else's repository**, which is a send-class action and sits inside
    the send gate. It is not click-free.
    **Status (2026-08-22): HALF-EXECUTED, and the send-gate question is settled in
    practice.** On 2026-08-21 the accelerator opened the account's first two
    third-party shelf PRs — `punkpeye/awesome-mcp-servers#12582` and
    `devsecops/awesome-devsecops#175` — both verified **open** by the weekly review.
    **One named blocker on `#12582`:** its listing bot requires the server to be
    submitted to and passing checks on `glama.ai/mcp/servers` (Dockerfile added
    there) plus a Glama score badge in the PR body. Agent-executable, needs no
    founder click, unactioned. Score stays **2.45**; the evidence under it improved. With 16a residual at 0.48, **16b is now
    the higher-ranked free-shelf half** — still blocked on the send gate.
    **Re-scored 2026-08-29 to `1.23` at effort 2, down from 2.45. One correction, and it
    is a downgrade:** the 08-22 note called the Glama step *"agent-executable, needs no
    founder click."* That is wrong — the accelerator record of **2026-08-28** states the
    Glama score badge required by `#12582` **needs a founder-only account**. Components
    unchanged (reach 4 · activation 3 · retention 1 · trust 1 · sharing 3); **effort
    raised 1 → 2** because the remaining half is not fleet-executable at all. Both shelf
    PRs re-verified live 2026-08-29: `punkpeye/awesome-mcp-servers#12582` **open, 1
    comment (the listing bot), last updated 2026-08-21T08:08:45Z**;
    `devsecops/awesome-devsecops#175` **open, 0 comments, unchanged since creation** —
    eight days of no movement on either, consistent with the corrected blocker. Carried
    rather than killed: the PRs are already open and cost nothing per cycle. *Demand
    evidence: still **zero** ledger entries ask for an MCP listing.*

> **PORTFOLIO ORDER NOTE, 2026-08-29 weekly review — SUPERSEDES the 08-22 note
> below.** The top of the portfolio moves again, and one layer further out of this
> file: the highest item is now **harness-level send pre-authorization, 3.70 at
> effort 1** (reach 5 · activation 5 · retention 3 · trust 2 · sharing 2). It is an
> operating-system unblock, not a product bet or a targeting instrument, and **no
> agent can close it — the effort is the founder's.** It ranks first because
> **every unattended cycle in the fleet has declined every send-class action since
> 2026-08-15**: 0 outbound actions from 10 unattended cycles on 08-28 against 4
> applications from one attended sitting, Move 1 at **0/20 for the week and 3
> lifetime, all 2026-07-27**, and the only candidate that ever passed the ICP
> (`Resolvr-io/apogee#104`) lost to this gate rather than to targeting.
> **Consequence for the 08-22 note below:** its verdict on the query battery still
> stands on its evidence, but the battery inversion it ranked first **was never
> run** — grep over every growth/accelerator/orchestrator record 08-23 → 08-29
> finds no code-search-over-repository-state pass and no agent-usage cross-filter,
> so its 08-31 falsification read is void. It keeps its **3.65** unchanged, because
> nothing was learned, and drops to second on dependency: a better candidate list
> is inert against a gate that permits no touch. **Consequence for this file,
> unchanged:** when a lane closes, do not promote another product code lane. The
> queue's top three product items are founder-sequenced by
> `DEC-FOUNDER-CORE-ACCESS-2026-08-27` and none is eligible before **2026-09-04**;
> an empty product board in `REFILLING` is not a fault. Full reasoning:
> `agent-ops/reviews/2026-08-29-getadvantage-northstar-weekly.md`.

> **PORTFOLIO ORDER NOTE, 2026-08-22 weekly review.** The highest-scoring item in
> the portfolio is no longer in this file. **Move 1 query-battery inversion scores
> 3.65 at effort 1** (reach 5 · activation 4 · retention 3 · trust 3 · sharing 2)
> and is a *targeting instrument* owned by the growth/accelerator lanes, not product
> code. It ranks first because the portfolio scores by outcome link, not by which
> lane owns the work: three consecutive weeks of **0/20 in-ICP Move 1 touches** now
> have a diagnosed structural cause, and Move 1 is the north star's only live path
> to a retained external team. Evidence and the one-variable change are in
> `agent-ops
eviews6-08-22-getadvantage-northstar-weekly.md` §4 — in short,
> the battery searches **issue text**, so every hit is by construction a defect the
> team already found; only 5 of 21 candidates failed on the 2-10 contributor floor,
> so **the floor is right and the query is wrong**. **Consequence for this file:
> when the open implementation lane closes, do not promote another product code
> lane.** The top two portfolio items are distribution, and an empty product board
> in `REFILLING` is not a fault.

## Selection score

Score each candidate from 0–5, then rank it:

`(reach 25% + activation 25% + retention 20% + trust differentiation 20% + sharing 10%) / effort`

A candidate is eligible only when it:

- has a measurable user or distribution outcome;
- has a cold-path acceptance test and hostile fixtures;
- preserves local-first behavior and truthful claims;
- does not duplicate an existing capability;
- leaves `npm test` green and `npm run evidence` at 8/8;
- has no unresolved P1/P2 review finding in its dependency path.

Kill or split a lane when it cannot show a useful cold path, has no measurable
link to activation/retention/distribution, needs an unsupported marketing claim,
or remains too broad for hostile independent review.

## Dogfood self-check on this product repository (disclosed)

The getadvantage-cli product tree **intentionally ships adversarial secret
fixtures** in `tests/run.mjs` so the integration suite can prove blocking
behavior. Running the gate on **this repository's product root** is therefore
**expected to NO-GO**. That expectation is **narrow and disclosed**: it applies
only to this product repo’s own test fixtures. It is never a reason to suppress
findings, dilute the secret scan, or treat a customer-repository NO-GO as a
false block. Publish CI dogfoods a clean nested fixture
(`fixtures/publish-self-gate`), not the product root. See README:
“Dogfood on this repository (expected NO-GO — disclosed)”.

## Anti-idle protocol

Every Grok product cycle must end in exactly one of these states:

1. **IMPLEMENTING** — one registered lane is actively moving.
2. **REVIEW_PENDING** — candidate, tests, 8/8 evidence, pack and cold-path proof
   are ready for Claude's independent audit.
3. **RELEASING** — a later Grok cycle is publishing after objective `REVIEW_GO`.
4. **REFILLING** — while waiting for review, Grok performs read-only cold-path
   research, scores the next five bets, and prepares the next bounded brief. It
   must not open a second code lane.
5. **TECHNICALLY_BLOCKED** — exact external failure, evidence, retry condition,
   and the best unaffected next task are recorded.

An empty lane board with an eligible queue is a fault. After a release or killed
lane, the same cycle promotes the next eligible bet and writes the task brief;
the following scheduled cycle dispatches it if no implementation process is
already running.

## Weekly portfolio review

Once per week `getadvantage-northstar-weekly` (Claude since 2026-07-26)
reconciles retained external teams, evaluator conversations, named installs, the
retained-team detector query, public/known recurring CI uses, GitHub
stars/issues/discussions, cold-path time, releases, and review escapes. Downloads
appear only as a labelled context footnote. It may reorder or kill bets, and it
scores every bet against the harvested market-signal ledger: a bet supported by
repeated verbatim external pain evidence outranks an equal-scoring bet without
it, and a bet with zero demand and zero dogfood-friction evidence must carry an
explicit written justification or be deprioritized. Grok owns implementation and
product truth; the audit lane owns independent review; the weekly review owns
portfolio priority and outcome accounting. Benjamin receives the result but is
not a routine gate.
