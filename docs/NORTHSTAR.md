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
> absence under a passing control. **P3 ships disclosed on the 0.14.0 train:**
> the detector does not print the positive control's `total_count` (staged as
> `0.14.x-stderr-and-control-transparency`).

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
    **Status (2026-08-19):** **ships in 0.14.0** — product fingerprint
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

16b. **MCP registry listing** — score 2.85 at effort 1 (2026-08-15). Lists the
    **already-shipped** `mcp.mjs` surface in the MCP registry and established
    awesome-lists; no product code. Verified gap: account-wide
    `gh search prs --author=@me` returns 8 lifetime PRs, **every one on a
    `BellmeJoe/*` repo — zero third-party shelf PRs ever opened.** *Honest
    distinction from 16a:* a registry listing requires a **PR to someone else's
    repository**, which is a send-class action and sits inside the send gate. It
    is not click-free. With 16a residual at 0.48, **16b is now the higher-ranked
    free-shelf half** — still blocked on the send gate.

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
