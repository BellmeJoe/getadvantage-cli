# getAdvantage CLI — Roadmap

The plan of record for the CLI, grounded in the Cold-QA of the live published
`getadvantage@0.7.0` package (2026-07-17) and a needs-analysis of what a
skeptical senior engineer / sovereign-AI buyer expects from a "Ship Gate for
AI-built apps".

Every item carries the QA **finding id** (or a source) it came from, so the
evidence trail is never lost. Fix repros for each blocker/major were
independently reproduced 1:1 against the live npm package.

**Ground rules**
- `docs/NORTHSTAR.md` is the portfolio priority and anti-idle contract. This file
  remains the technical evidence trail and backlog.
- Founder approval is not a routine release gate. A version ships only after the
  objective release contract passes: one intentional lane, current full tests,
  8/8 evidence, packed-package and cold-path verification, independent
  `REVIEW_GO`, no open P1/P2, clean intentional repository state, and rollback.
- The honesty principle stays: the gate reads and reports, it never calls an app
  secure; skips are honest, not fake passes; "not checkable ≠ GO".
- Node built-ins only, zero dependencies, local-by-default (one opt-in network
  callsite in `report.mjs`).

---

## Status board

| Version | Theme | State |
|---|---|---|
| 0.7.0 | Route-map (Express/Fastify/Flask/FastAPI) + prior cold-QA fixes | **Released** (npm) |
| 0.7.1 + 0.7.2 | Trust-critical correctness + honesty/branding sweep | **Released** (npm, 2026-07-19) |
| 0.7.3 | Public-readiness: gate-value banner, honest secret-scan coverage (lockfiles + sourcemaps), outside-git next steps, de-jargoned client-app map | **Released** (npm, 2026-07-19) |
| **0.8.0** | Launch polish: demo-ready output (real plurals, prefix-aware fingerprints), truthful `switch`/fan-in wording, per-command fan help, architecture signal band, owner ops + test+evidence-gated publish CI | **Released** (npm, 2026-07-19) |
| **0.8.1** | MCP parity for the read-only lenses: `map` + `architecture` as MCP tools (one shared `renderMap` implementation, live-protocol test) | **Released** (npm, 2026-07-20) |
| **0.8.2** | Policy config + secret allowlist (built-in AWS EXAMPLE + `.getadvantage/config.json`) — false-positive escape hatch | **Released** (npm, 2026-07-20; later independent review found false-GO risks) |
| **0.8.3** | Policy-safety repair: index-blob auth only, sha256 auth ids (not display fingerprints), full-block + incomplete PEM, config ship-risk | **Released** (npm + tag v0.8.3, 2026-07-20) |
| **0.8.4** | GitHub-native SARIF 2.1 export + generated workflow upload path | **Released** (npm + tag v0.8.4, 2026-07-20) |
| **0.9.0** | First-party GitHub Action + update-in-place PR summary | **Candidate** — REVIEW_PENDING (local 0.9.0; live npm remains 0.8.4) |
| 0.8.x / 0.9.x | Remaining table stakes: client-bundle keys | Planned |
| 0.9+ | ICP stack-fit: Vite+React+Supabase + the AI-app failure modes (the wedge) | Planned |
| Later | Proof-records → signing → audit export (demand-gated, SaaS-linked) | Backlog |

---

## 0.7.1 — Trust-critical correctness (IN PROGRESS)

The release that makes the GO promise trustworthy again. Everything here is a
reproducible way the gate lies or dead-ends on the most likely first-run path.

- [x] **UTF-16 secret false-GO** — `gate-utf16-false-go` (blocker). A committed
  `sk_live_…` key in a UTF-16-LE file (the PowerShell `>` / `Out-File` default)
  is invisible to the scanner → `GO`, exit 0. Root cause: UTF-16 bytes trip the
  null-byte "looks binary" skip. Fix: BOM-detect UTF-16 LE/BE and decode before
  the binary check. `checks.mjs`. **Done — shipped + regression-tested (test 21).
  Residual (0.8.x): BOM-less UTF-16 heuristic (BOM covers the PowerShell default).**
- [x] **Non-ASCII filenames silently skipped** — `gate-nonascii-filename-skipped`
  (blocker). `git ls-files` octal-escapes non-ASCII paths (`core.quotepath` on
  by default), so `geheime Datei über prod.txt` never gets read — a committed
  key in it passes. Daily reality for the DACH ICP. Fix: list files with `-z`
  (NUL-terminated, unquoted). `util.mjs` + `checks.mjs`. **Done — shipped +
  regression-tested (umlaut-filename test).**
- [ ] **Gate downloads + runs third-party code** — `gate-npx-tsc-thirdparty`
  (blocker). The typecheck calls `npx --yes tsc`; with TypeScript declared but
  not installed (a fresh clone, and exactly the state in the CLI's own generated
  CI workflow), npx fetches and executes the **squatted** third-party `tsc`
  package and mislabels its output as type errors. A trust gate must never run
  unvetted code. Fix: resolve `node_modules/typescript/bin/tsc` via `node`;
  honest skip/warn if not installed — never `npx --yes tsc`. `checks.mjs`.
- [ ] **`ship` GO on unparseable package.json** — `gate-ship-go-on-corrupt-packagejson`
  (major). A corrupt manifest yields a warning + `GO`, exit 0 — a guaranteed-
  broken deploy gets green light. The BOM lesson ("not checkable ≠ GO") was
  patched as a special case, not a principle. Fix: an always-on manifest-integrity
  check that NO-GOs on a package.json that exists but won't parse; build/typecheck
  defer to it. `checks.mjs` + `checks-runner.mjs`.
- [ ] **`demo` dead-ends outside a git repo** — `demo-requires-git-repo` (major).
  The "zero setup, the entire wow in one command" showcase refuses to start in a
  non-repo dir (the most likely evaluation spot) — the global repo guard fires
  before dispatch, though demo scaffolds its own throwaway repo in TEMP. Fix:
  dispatch `demo` before the repo-root gate. `index.mjs`.
- [ ] **Generated CI workflow installs deps + pins the version** —
  `ci-workflow-unpinned` + the CI vector of `gate-npx-tsc-thirdparty`. Add a
  dependency-install step (`--ignore-scripts`) before the gate so the real
  compiler is present, and pin `npx getadvantage@<version>` for reproducible
  runs. `action.mjs`.

**Not in 0.7.1 (deliberate):** provenance publishing and the GitHub tag/source
sync (`no-npm-provenance`, `github-source-lag`) are release-process changes — see
"Later / demand-gated". Source/tag sync is now enforced by the release routine.

---

## 0.7.2 — Honesty + branding sweep

The residue that a skeptical buyer notices. None break the gate, all cost trust.

- [x] **`brief` eats manual edits** — `brief-eats-manual-edits` (major).
  PROJECT-BRIEF.md ("Project Brain") is fully regenerated each run; hand-added
  lines vanish with no warning, while HANDOFF.md correctly preserves notes. Fix:
  a protected notes block (as HANDOFF.md has) or at least a warning.
  **Done:** `<!-- ship-safe:brief:notes -->` … `<!-- /ship-safe:brief:notes -->`
  preserved across regenerations; foreign briefs without the banner refuse
  overwrite (same rule as handoff). Test: scenario 25 in `tests/run.mjs`.
- [x] **"Ship-Safe" branding residue** — `shipsafe-brand-residue` /
  `shipsafe-codename-in-artifacts`. The `deploy` header still says "Ship-Safe";
  generated PROJECT-BRIEF.md/HANDOFF.md/AGENTS.md carry `ship_safe_*` frontmatter
  + `<!-- ship-safe:* -->` markers that customers commit and read. Rename to
  `getadvantage_*` with back-compat reads of the old marker.
  **Done:** writes `getadvantage_*` / `<!-- getadvantage:* -->`; reads legacy
  `ship-safe` banners/notes/init/ledger; deploy header is "getAdvantage — safe deploy".
- [x] **`ship-safe` bin-name collision** — `shipsafe-name-collision` /
  `ship-safe-name-collision`. A foreign, actively-maintained `ship-safe` package
  exists on npm (with SLSA provenance). The README teaches 9 commands under the
  bare `ship-safe` name right after an npx section; `npx ship-safe` runs the
  stranger's package. Fix: teach only `getadvantage`; either drop the alias or
  warn explicitly that `npx ship-safe` is a different package.
  **Done (docs):** README teaches only `getadvantage`; explicit warning that
  `npx ship-safe` is a different package. Compat bin alias still installed for
  local installs that already use it (founder can drop later).
- [x] **`map` vs `check` disagree** — `map-vs-check-routes` (major).
  **Done:** both use `scanRoutes(cwd, detectRepoStack(cwd))`; Next also scans
  `src/app/api/**`; brief uses the same scanner. Test scenario 26.
- [x] **`switch cursor` claims a `.cursorrules` it never writes** —
  `switch-cursorrules-claim`. **Done:** tip explains init only updates existing
  files / creates AGENTS.md.
- [x] **Missing-vs-stale brief wording** — `missing-brief-called-stale`.
  **Done:** missing → "create one"; stale → "refresh".
- [x] **Over-claim copy** — `fanout-wont-collide-overclaim`.
  **Done:** "share the brain, not the working tree — fan-in catches collisions".
- [x] **Deploy token via argv** — `deploy-token-in-argv`.
  **Done:** token via child `VERCEL_TOKEN` env, not `--token` argv.
- [x] **MCP doesn't enforce its own inputSchemas** — `mcp-schema-not-enforced`.
  **Done:** `validateToolArgs` + -32602; missing tool name no longer prints `undefined`.
- [x] **Gate distrusts its own brain files** — `self-artifacts-trip-dirty-guard`.
  **Done:** PROJECT-BRIEF/HANDOFF/.getadvantage/… classified as own artifacts.
- [x] **First-run polish** — `zerocommit-git-fatal-leak` (gitSafe swallows stderr),
  `typo-dumps-full-help` (did-you-mean), `login-abort-exit0` (abort → exit 1),
  `map --json` (honoured), untracked-label wording, build 10-min timeout,
  demo help arithmetic, MCP unknown-tool message, author → hello@getadvantage.app.
- [x] **Docs sync (CLI-side)** — README teaches only `getadvantage`; homepage no
  longer points at /ship-safe. (Site-side sample/manifest items live outside this repo.)

---

## 0.8.x — CI table stakes + the False-Positive escape hatch

*(0.8.0 shipped 2026-07-19 as the launch-polish release; the items below
continue in 0.8.x patch/minor releases.)*

What every serious gate tool has, and what makes the gate adoptable in an
existing repo. Also closes the `gate-placeholder-false-positive` major.

- [x] **Policy config + baseline/hash-ignore** (`.getadvantage/config.json`)
  — fixes `gate-placeholder-false-positive`. Built-in: AWS public doc keys
  (`AKIAIOSFODNN7EXAMPLE` and any `AKIA…EXAMPLE`). User rules: `secrets.ignore`
  with `values`, `hashes` (sha256 auth ids; legacy `fingerprints` field only when
  the entry is a full 64-hex digest — display masks never authorize), `paths`
  (simple globs), `patternIds`. Authorization reads the **git index** blob only
  (0.8.3). Every allowlisted hit is **disclosed** on the Secret scan result
  (never silent GO). Severity thresholds deferred. `policy.mjs` + `checkSecrets`
  filter; tests 9e/9f. **Done in 0.8.2; safety hardened in 0.8.3.**
- [x] **SARIF 2.1.0 export (`--sarif <path>`)** — add #5. Dependency-free
  serializer; redacted messages (fingerprints + auth ids only); stable rule ids
  (`secret/<patternId>`, `check/<slug>`); regions when line data is defensible;
  security vs quality classification (`security-severity` only for secret/
  tracked-env; `problem.severity` for other gate checks). Generated
  `github-action` workflow runs the gate, uploads via
  `github/codeql-action/upload-sarif@v4` with `always()` so NO-GO still reaches
  code scanning, then fails the job on gate failure. Pins `checkout@v6` +
  `setup-node@v6`; permissions `contents: read`, `security-events: write`,
  `actions: read` (private workflows). Honest scope: public-repo code scanning;
  private needs Code Security entitlement. **Done in 0.8.4** (shipped npm +
  tag v0.8.4; independent REVIEW_GO; cold published path verified).
- [x] **Published GitHub Action + PR comment** — add #6. Root `action.yml`
  composite Action consumable as `uses: BellmeJoe/getadvantage-cli@v1`; generated
  workflow is one-copy; deterministic GO/NO-GO with SARIF upload on `always()`
  when written; update-in-place PR summary (`<!-- getadvantage:pr-summary -->`)
  with job-summary fallback; honest fork path (no `pull_request_target`, no
  secret claims); minimal permissions; 0.8.4 redaction carried forward; cold
  install vs `--force` migration for pre-0.9.0 workflows. **Done in 0.9.0
  candidate** (not published until independent REVIEW_GO).
- [ ] **Client-bundle key exposure check** (built `dist/`, `.next/static`,
  `VITE_`/`NEXT_PUBLIC_` misuse) — add #1. The most common real damage in
  AI-built apps (~1.5M keys exposed across documented 2025/26 incidents; 98% of
  1,072 scanned vibe-apps had ≥1 flaw). Extends the existing secret scanner. **S**

---

## 0.9 — ICP stack-fit + the AI-app failure modes (the wedge)

The differentiator: the first gate that understands the failure modes of
AI-*built* apps — and finally runs on what the ICP actually ships.

- [ ] **Vite+React(+Supabase) stack support for the estate/route map** — add #2.
  The ICP mostly ships Vite+React+Supabase (Lovable/Bolt), not Next.js; today
  the map returns nothing for a Lovable export → dead funnel. SvelteKit/Nuxt/
  Astro after; Django/Rails/Go deliberately not (no ICP evidence). **L**
- [ ] **Supabase RLS + ungated-endpoint check** (static: migrations SQL + edge
  functions) — add #3. The documented killer failure mode: CVE-2025-48757 (RLS
  misconfig in 170+ Lovable apps), 172/1,072 apps allowed unauthenticated
  deletes. Statically checkable, honestly labelled. **M** (needs Vite/Supabase
  detection)
- [ ] **Paste-ready fix per finding** (what/where/why/next) — add #7. The core
  wedge vs. gitleaks/trufflehog/semgrep: they report for security pros; nobody
  explains the patch to a non-security founder. This is getAdvantage DNA
  (recommend.ts), deterministic, no LLM. **M**
- [ ] **Opt-in live secret verification (`--verify`)** — add #9. TruffleHog's
  differentiator: verified/unverified triage ("which key must I rotate NOW").
  Strictly opt-in (network), 5–6 ICP providers. **M**

---

## Later / demand-gated (backlog)

Real for the sovereign buyer, but either release-process decisions or premature
until a paying compliance use-case is in the pipeline.

- [ ] **npm provenance publish** — `no-npm-provenance`. Publish with
  `npm publish --provenance` from GitHub Actions (repo is public). The colliding
  `ship-safe` package already has SLSA provenance; a trust product should too.
  Objective release-process change; no founder click required. **S**
- [x] **GitHub source/tag sync** — `github-source-lag`. Every npm version has a
  tag/release with matching source. Verified for 0.8.4: source commit `cd2a34d`,
  `v0.8.4`, GitHub Release, npm package, and cold published path agree.
  **Done 2026-07-20** (also verified for 0.8.3 earlier same day).
- [ ] **Gate-run proof record** (in-toto-shaped statement per check: commit SHA,
  tool + policy version, checks + verdicts, hashes) + `--report` to the run
  ledger — add #8. The bridge from free CLI to Ship-Gate SaaS. Start UNSIGNED
  (a local dependency-free CLI can't keyless-sign). **M** (needs 0.8 policy)
- [ ] **Signing path as a CI recipe** (cosign / GitHub Artifact Attestations over
  the statement) — add #10. Keyless signing belongs in the CI job, not the CLI;
  Sigstore's public Rekor log is itself a concern for the sovereignty persona.
  **S–M** (needs proof-record)
- [ ] **Audit-packet export with honest mapping** (NIS2 secure-development /
  ISO-42001 records — never "EU-AI-Act compliant": the Act regulates AI systems,
  not AI-generated code) — add #11. Build only when a regulated buyer is in the
  pipeline. **L**
- [ ] **GitLab SAST format** — add #12. Only if GitLab buyers appear; SARIF
  covers most of it. **S**
- [ ] **Fleet-governance in the CLI** — add #13. Narrow buyer base today; the
  dirty-tree guard + fan-in cover the single case. Small worthwhile step: an
  "another session has uncommitted work in this tree" check. **XL** — wait for
  demand.
- [ ] **Model-router** — add #14. No value for a CLI buyer now — a read-only gate
  routes no LLM calls. Belongs in the Trust-Control-Plane SaaS (Model Policy
  Center), not here. The CLI's honest contribution: the integrations map already
  shows which LLM SDKs are wired. *Do not build in the CLI.*

---

## The wedge, in one line

Not "a better secret scanner" — the first gate that understands the failure
modes of AI-*built* apps (client-exposed keys in the build output, missing
Supabase RLS, ungated mutating endpoints), explains each in founder language
with a paste-ready fix, and emits a proof-record per run. SARIF / Action /
baseline are table stakes to be evaluated at all; Vite+Supabase support is the
precondition for everything, because the ICP ships that, not Next.js.

*Sources for the needs-analysis: GitHub/GitLab SARIF docs, gitleaks/trufflehog/
semgrep/socket CI patterns, sigstore/SLSA/in-toto, NIS2/ISO-42001/EU-AI-Act
analyses, and vibe-coding incident reports (symbioticsec, vibeappscanner, wiz,
getautonoma). Full list in the QA session transcript.*
