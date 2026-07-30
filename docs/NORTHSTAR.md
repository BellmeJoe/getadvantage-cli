# getAdvantage product north star

This is the product portfolio and anti-idle contract for Grok Build. `ROADMAP.md`
contains the technical evidence trail; this file decides what enters the single
implementation lane next.

## The destination

**Make getAdvantage the default pre-merge proof layer for AI-built software and
reach 1,000,000 cumulative npm downloads without fake traffic or founder labor.**

The product loop must become:

`one command -> catches a real ship risk -> gives a usable fix -> lives in every PR -> emits shareable proof -> earns the next install`

Downloads are the north-star reach metric. They are not sufficient proof alone.
The companion metric is **retained automation**: public repositories, known
teams, or opted-in installations that run getAdvantage again after the first
week. No hidden telemetry and no manufactured downloads.

## Starting line and milestone ladder

Registry baseline captured 2026-07-20:

| Metric | Baseline | 30-day target | 90-day target | 12-month target |
|---|---:|---:|---:|---:|
| npm downloads / trailing 7 days | 780 | 2,500 | 10,000 | 50,000 |
| cumulative npm downloads | measure daily | increasing | increasing | 1,000,000 |
| retained public/known automated repos | establish baseline | 25 | 250 | 1,000 |
| cold path: install -> useful result | measure | < 2 minutes | < 90 seconds | < 60 seconds |

These are trajectory targets, not claims. Every weekly review records the actual
number, delta, source, and uncertainty.

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

### P2 — make proof portable and shareable

8. **Gate proof receipt** — commit, tool version, policy identity, checks,
   verdicts, and hashes in a stable local record.
9. **CI attestation recipe** — bind proof receipts to the workflow/repository/
   commit using GitHub artifact attestations; keep the CLI local-first.
10. **Shareable verified summary** — honest Markdown/JSON output for PRs,
    handoffs, and badges. Never turn a partial check into a security seal.
11. **Agent-native parity** — every stable read-only capability is available
    through the MCP surface with the same result and policy semantics.

### P3 — retention and ecosystem

12. **Framework policy packs** selected by detected stack, with safe defaults and
    explicit overrides.
13. **Fast repeat runs** using deterministic caching only after profiling proves
    it improves real CI time.
14. **Evaluator feedback loop** — generated issue/discussion link containing
    redacted environment and result metadata, never secrets.
15. **GitLab and audit exports** only after observed buyer or repository demand.

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

Once per week Codex reconciles registry downloads, public/known recurring CI
uses, GitHub stars/issues/discussions, cold-path time, releases, review escapes,
and user feedback. It may reorder or kill bets. Grok owns implementation and
product truth; Claude owns independent review; Codex owns portfolio priority and
outcome accounting. Benjamin receives the result but is not a routine gate.
