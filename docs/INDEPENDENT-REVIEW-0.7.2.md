# Independent review — getAdvantage CLI 0.7.2 RC

**Review date:** 2026-07-19 (second, independent session — did NOT write the code)
**Method:** 14-dimension parallel review of the uncommitted working tree vs HEAD `8c7cf23`, each serious finding adversarially re-checked by a second reviewer with live reproductions in throwaway repos. `npm test` reconfirmed **34/34**, `--version` **0.7.2**.
**Rule honored:** nothing committed, pushed, tagged, or published.

## Verdict: **the six trust fixes SHIP — but the RC is NO-GO for an npm cut until 4 issues are addressed.**

The 0.7.1 trust fixes are real and independently reproduced (UTF-16 BOM secret → NO-GO, umlaut filename → NO-GO, local-tsc-only, corrupt manifest → NO-GO, demo outside a repo, CI pin). The author's own `REVIEW-0.7.1.md` SHIP verdict holds up. What its self-review missed are 5 major findings (0 refuted on re-check), 4 of which should be resolved before publishing.

## Must-address before publish

| # | Finding | Why it matters | Fix |
|---|---------|----------------|-----|
| 1 | **`auto-publish-on-push-undisclosed`** (`.github/workflows/publish.yml`) | Verified live: triggers on push to `main`, publishes when local ≠ npm. npm=0.7.0, local=0.7.2, `NPM_TOKEN` armed (5 prior auto-publishes). The release pack's §6 orders `git push … --tags` **before** `npm publish` — so following it publishes 0.7.2 as a side effect of the push, without a separate decision and **without `--provenance`**. Collides with the "don't publish without me" rule. | Reorder the pack (publish before push, or note push=publish), or gate the workflow to `workflow_dispatch`/tag-only. |
| 2 | **`brief-foreign-guard-bypassed-over-200kb`** (`brief.mjs:704-713`) | `brief`'s local `readTextSafe` caps at 200 KB and returns `""` above it, so the "never clobber a foreign PROJECT-BRIEF.md" guard is skipped for large files — **silent user-data loss with exit 0 + success message**. `handoff.mjs`'s helper has no cap; the brief reused the wrong one. | Read with no/large cap at line 706, or fail-closed when the existing file is unreadable/oversized. Trivial. |
| 3 | **`dirty-own-artifact-tracked-mod-pass` / `dirty-guard-own-artifact-overreach`** (`checks.mjs:26-69`) | `isOwnArtifact()` is classified before the porcelain XY status, so **tracked modifications and deletions** of 9 whitelisted paths (incl. `CLAUDE.md`, `AGENTS.md`, `.github/workflows/getadvantage.yml`) yield "pass — Working tree clean of ship-risk (expected after brief/handoff)" and GO — even when no brief/handoff ran and the file is hand-edited or tampered. The module header still promises "BLOCK on tracked changes." Honesty-principle violation in the gate copy itself; untested. | Apply the carve-out to `??` (untracked) status only; tracked-modified/deleted own artifacts should warn. |
| 4 | **`F1-buildpath-secret-skip`** (`checks.mjs:225,326`) | Secret scan **silently** skips any tracked file with a `build/`/`dist/`/`coverage/` path segment (or `.map`/`.svg`), returning GO with no disclosure — exactly the "committed build output with a leaked key" case the product exists to catch. Not counted, not named. **Pre-existing at 0.7.0 (not an RC regression),** so it doesn't make current users worse, but it undercuts the core promise. | Remove the dir-skip for committed files, or disclose skipped files in the scan summary (as the oversized-file path already does). |

## Verified clean (PASS)

utf16 · nonascii · npx-tsc · manifest · demo-gate · ci-workflow · brief (small-file path) · map/check unification · deploy token-via-env + MCP schema · brand sweep (README teaches only `getadvantage`; no founder PII; author `hello@getadvantage.app`; `files` whitelist keeps docs/ROADMAP out of the tarball). Residuals are documented and low-risk (UTF-16-without-BOM skip; one odd-byte-length oversized-UTF-16 tail-misalignment, minor).

## Recommendation

Fix #2 and #3 (both trivial, high-honesty-value), decide #4 (fix or disclose), and correct the release-pack ordering for #1 so a push can't publish behind you. Then it's a clean `getadvantage@0.7.2` cut. None of the four reopens a false-GO on the original cold-QA set — the trust story is intact; these are honesty-of-copy, one edge-case data-loss bug, and a release-process trap.

---

## Fixes applied (2026-07-19, same session — working tree, uncommitted)

| # | Finding | Fix | Verified |
|---|---------|-----|----------|
| 2 | brief >200 KB clobber | `brief.mjs`: read existing brief with an 8 MB cap and **fail closed** — if a file exists on disk but can't be read as text, refuse rather than overwrite. | Live repro: 260 KB foreign brief → exit 1, preserved. Test 31. |
| 3 | dirty-tree waves through tracked seed-file edits/deletions | `checks.mjs`: new `isRegeneratedArtifact()` — only untracked-new own files, or in-place rewrites of files the CLI regenerates every run (PROJECT-BRIEF/HANDOFF/marker dirs), stay informational. Tracked edits to CLAUDE.md/AGENTS.md/rules/workflow, and **any deletion**, now go through the normal tracked gate → NO-GO. | Live repro: tampered tracked CLAUDE.md → NO-GO; regenerated-brief churn still passes. Test 30. |
| 4 | secret scan silently skips `build/`/`dist/`/`coverage/` | `checks.mjs`: removed those dirs from `SKIP_DIR` (same reasoning already applied to `.env` — git ls-files means they only reach the scan when committed, i.e. the dangerous case). | Live repro: committed key in `frontend/build/…` → NO-GO, full key not echoed. Test 32. |
| 1 | push = publish, undisclosed | **Docs only** (`RELEASE-0.7.2-REVIEW.md` §5/§6): disclosed that a push to `main` auto-publishes via `publish.yml`, reordered the commands, flagged the missing `--provenance`. `publish.yml` itself left unchanged — the trigger is a founder decision. | n/a (process) |

**Test suite: 37/37** (34 + 3 new regression scenarios). `--version` still `0.7.2`. Nothing committed, pushed, tagged, or published.

**Still open for the founder before/at publish:** decide the publish trigger (accept push=publish, or switch `publish.yml` to `workflow_dispatch`/tag-only + add `--provenance`); the two minor UTF-16 residuals (odd-byte oversized tail-misalignment; README "every tracked file" wording) — non-blocking, ticket for 0.8.
