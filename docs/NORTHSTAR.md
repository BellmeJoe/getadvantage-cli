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

## Retained-team detector (the north-star measurement method)

`PENDING_B2` — activates the cycle `0.12.x-invisible-mode` ships.

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
   **Status (2026-08-03):** **`REVIEW_GO (lane-scoped)`** at product fingerprint
   **`fe9e2ad`** (`fe9e2add5d9ecc4a4ee59403f8741e4cce51abaf`); 0 open P1, 0 open
   P2; audit evidence 218/218 tests, 8/8 evidence, 34-file pack. Agent-trigger
   profile (`check --agent-trigger`) visibly omits Dirty-tree on hooks only;
   plain `check` / `check --ci` still enforce Dirty-tree. Cursor remains
   **detect-and-refuse**. Same-shape stop-loss **2 of 3**. **Sole open lane**
   (releasing as **0.12.0**). Open P3 post-release: symlink mode `120000`
   hostile regression coverage (runtime protection already confirmed).

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
11. **Agent-native parity** — every stable read-only capability is available
    through the MCP surface with the same result and policy semantics.
    *Split (2026-08-02): the MCP-registry listing of the existing `mcp.mjs`
    surface moves into 16; full parity stays here.*

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
15. **GitLab and audit exports** only after observed buyer or repository demand.
16. **Free-shelf distribution** *(added 2026-08-02)* — GitHub Actions Marketplace
    listing plus MCP registry listing. Verified absent this review: the Action is
    `@v1`-tagged across 13 releases and `github.com/marketplace/actions/…`
    returns 404 at every plausible slug, because bot-created API releases cannot
    set the marketplace-publish flag. The only reach surface in the portfolio
    that requires no outbound message to anyone; needs one founder account action
    (the Marketplace developer agreement) and one release-workflow change.

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
