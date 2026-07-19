# Independent review — getAdvantage CLI **0.7.1** (trust-critical)

**Review date:** 2026-07-19  
**Scope:** Only the six cold-QA trust fixes claimed in `docs/SESSION-HANDOFF-0.7.1.md`  
**Code under review:** current working tree (0.7.1 + later 0.7.2 layered on top; 0.7.1 logic still present)  
**Package version at cut intent:** was `0.7.1`; tree is now labeled `0.7.2` — **0.7.1 was never published as a separate npm version**

> This document is the missing **dedicated 0.7.1 review**. The combined release pack
> (`docs/RELEASE-0.7.2-REVIEW.md`) bundles both; this file evaluates 0.7.1 on its own
> so trust blockers are not rubber-stamped by the polish sweep.

---

## Verdict

### **SHIP 0.7.1 content** (as part of 0.7.2 or as a standalone tag)

| | |
|---|---|
| **Overall** | **Approve to ship** the six trust fixes |
| **Confidence** | High for the three blockers + two majors that have regression tests |
| **Blockers found in review** | **None** that reopen a false-GO on the original cold-QA repros |
| **Must-fix before publish** | None for 0.7.1 scope |
| **Should-fix (non-blocking)** | See residual gaps §5 — document or ticket for 0.8, not hold 0.7.1 |

**Rationale:** Each cold-QA finding maps to clear code + an integration test that
fails the old behavior. Implementations follow the honesty principle (“not
checkable ≠ GO”, never download unvetted compilers). Residual gaps are
edge cases outside the original repros, not regressions of the claimed fixes.

---

## Finding-by-finding evaluation

### 1. `gate-utf16-false-go` — **PASS (blocker closed)**

| | |
|---|---|
| **Claim** | UTF-16-LE file with secret (PowerShell `>` default) was skipped as binary → GO; now scanned |
| **Code** | `checks.mjs`: `bomEncoding` / `decodeUtf16` / `decodeText`; used in full-file and head+tail partial paths in `checkSecrets` |
| **Mechanism** | Detect BOM `FF FE` / `FE FF` **before** `looksBinary` (NUL heuristic). Decode to UTF-16LE string, then run secret patterns |
| **Test** | Scenario *UTF-16 secret…* — writes BOM + `sk_live_…`, expects exit 1, Secret scan fail, filename reported, key not echoed |
| **Review notes** | Partial-scan path also BOM-aware — good (oversized UTF-16 would still work). BE swap loop looks correct |
| **Residual** | **UTF-16 without BOM** still trips `looksBinary` → skip. PowerShell 5.1 default includes BOM, so the cold-QA repro is fixed. UTF-16-no-BOM is rarer; optional 0.8 heuristic (even-length high NUL density) |
| **Verdict** | **Ship** |

### 2. `gate-nonascii-filename-skipped` — **PASS (blocker closed)**

| | |
|---|---|
| **Claim** | `git ls-files` quotepath drops umlaut paths; keys invisible → GO |
| **Code** | `util.mjs` `gitFilesZ` (`… -z`); `filesToScan` + `checkTrackedEnv` use it |
| **Test** | Scenario *non-ASCII filename…* — `geheime_datei_über_prod.txt` + key → NO-GO |
| **Review notes** | Correct root cause fix. Dirty-tree still uses `status --porcelain` (not `-z`); porcelain can quote paths differently — **out of scope for this finding** (secret scan was the hole) |
| **Residual** | Very long / odd encodings if git version lacks `-z` (ancient git) → empty list fail-open; Node 18+ + modern git is the stated engine |
| **Verdict** | **Ship** |

### 3. `gate-npx-tsc-thirdparty` — **PASS (blocker closed)**

| | |
|---|---|
| **Claim** | `npx --yes tsc` could fetch squatted `tsc` package when TS declared but not installed |
| **Code** | `checkTypecheck`: resolve `node_modules/typescript/bin/tsc`, run via `process.execPath` + `shell: false`; if missing → **warn**, never npx |
| **Test** | Scenario *typecheck: TypeScript declared but not installed…* — warn, no “type errors”, exit 0 |
| **Review notes** | Correct threat model. `shell: false` on Windows for absolute path avoids cmd re-parse. Warn-not-fail is honest: “not installed” ≠ “types are wrong”; GO with warn is intentional |
| **Residual** | (a) GO when compiler missing may surprise CI users who expect fail — mitigated by generated workflow **install step** (#6). (b) Only checks `bin/tsc` path layout; exotic package managers that hoist differently are edge cases |
| **Verdict** | **Ship** |

### 4. `gate-ship-go-on-corrupt-packagejson` — **PASS (major closed)**

| | |
|---|---|
| **Claim** | Corrupt package.json → warn + GO; must NO-GO |
| **Code** | `checkManifest` fail when `packageJsonBroken`; wired in `runChecks` **and** `gateTree` (fan-in combined tree) |
| **Test** | Scenario *broken package.json…* — exit 1, Package manifest fail; build must not pass |
| **Review notes** | Principle “not checkable ≠ GO” correctly applied. Build/typecheck **skip** and defer to manifest — avoids double messaging while still blocking. BOM’d-but-valid still GO via `readJsonFile` (8b test) — good distinction |
| **Residual** | Only `package.json` (not `package-lock` integrity). Fine for stated scope |
| **Verdict** | **Ship** |

### 5. `demo-requires-git-repo` — **PASS (major closed)**

| | |
|---|---|
| **Claim** | `demo` hit global repo gate before dispatch though it scaffolds TEMP repo |
| **Code** | `index.mjs`: `cmd === "demo"` handled **before** `repoRoot()` |
| **Test** | Scenario *demo: runs in a non-git directory…* |
| **Review notes** | Order is correct relative to mcp/login/logout. Demo still expensive (full conductor) — acceptable for showcase |
| **Residual** | None material |
| **Verdict** | **Ship** |

### 6. `ci-workflow-unpinned` + CI vector of #3 — **PASS with test gap**

| | |
|---|---|
| **Claim** | Workflow installs deps (`--ignore-scripts`) before gate; pins `getadvantage@<version>` |
| **Code** | `action.mjs` `WORKFLOW` template: install step + `npx --yes getadvantage@${cliVersion()}` |
| **Test** | **No dedicated scenario** asserting workflow text contains install + pin |
| **Review notes** | Template content is correct by inspection. Pin tracks `cliVersion()` so regenerating after version bump is required for already-committed workflows — documented in 0.7.2 upgrade notes |
| **Residual** | Add a tiny unit/integration test that `runGithubAction` writes install + pin strings (should-fix, not ship-blocker). Existing customer workflows stay stale until `--force` regenerate |
| **Verdict** | **Ship** (test gap is documentation/QA debt, not a logic hole) |

---

## Cross-cutting review

### Honesty principle

| Check | Assessment |
|---|---|
| Skips are labeled skip/warn, not pass-as-secure | Yes (tsc missing = warn; no package.json = skip) |
| Fail blocks GO | Manifest fail, secret fail → exit 1 |
| Gate never downloads unvetted code | tsc path fixed; no other npx compilers found in checks |
| Secrets never fully echoed | Tests assert key not in JSON |

### Fan-in / gateTree parity

`gateTree` runs: secrets, tracked env, **manifest**, typecheck, build, schema-bump.  
Does **not** run dirty-tree (correct for detached worktrees). Manifest inclusion means a corrupt package.json also fails combined-tree merges — good.

### Interaction with 0.7.2 (for reviewers)

0.7.2 **does not undo** 0.7.1. It layers:

- dirty-tree own-artifact exceptions (review separately in 0.7.2 pack)  
- build/typecheck **timeouts** (strengthens 0.7.1 child process hygiene)  
- branding/map/brief polish  

Evaluating 0.7.1 alone: still ship. Combined cut as **0.7.2** is fine; do not require a separate npm `0.7.1` if the changelog sections stay clear (already in RELEASE pack).

### What was *not* re-verified in this review session

- Live `npx getadvantage@0.7.0` repro on the public package (handoff claims prior session did 1:1 repros)  
- Network isolation proof that tsc path never hits registry (test is behavioral: no type-error mislabel + no node_modules created)  
- Full `demo` end-to-end visual beyond exit code / “Demo” banner  

Acceptable for ship given integration suite; optional founder smoke on a clean machine before npm publish.

---

## Test matrix (0.7.1-owned scenarios)

| # | Scenario | Expectation | Status in suite |
|---|---|---|---|
| 8c | broken package.json | NO-GO, manifest fail | Present |
| 21 | UTF-16 secret | NO-GO, secret scan fail | Present |
| 22 | umlaut filename | NO-GO | Present |
| 23 | tsc not installed | warn, exit 0, no type errors | Present |
| 24 | demo outside repo | exit 0, no repo-required | Present |
| 8b | BOM package.json | still GO + build runs | Present (pre-0.7.1, still relevant) |
| — | action.mjs install+pin | — | **Missing** |

Full suite last run: **34/34** (includes 0.7.2 scenarios).

---

## Risk register (0.7.1 only)

| ID | Risk | Sev | Disposition |
|---|---|---|---|
| R1 | UTF-16 without BOM still skipped | Low | Accept; document; optional 0.8 |
| R2 | Missing tsc is warn → overall GO | Medium product | Accept with CI install step; consider 0.8 “strict” policy |
| R3 | No test for generated workflow text | Low | Should-fix before or after publish |
| R4 | `gitFilesZ` empty on failure → scan fewer files | Low | Fail-open on broken git; rare |
| R5 | Never published 0.7.1 alone | Process | Ship as 0.7.2 with dual changelog; fine |

---

## Checklist for the review session (0.7.1)

- [x] Code maps to all six claims  
- [x] Blockers have regression tests  
- [x] Manifest blocks `runChecks` and `gateTree`  
- [x] demo ordered before `repoRoot`  
- [x] action.mjs template has install + pin (by inspection)  
- [ ] Reviewer re-runs `npm test` (expect 34/34 on current tree)  
- [ ] Optional: regenerate workflow fixture test (R3)  
- [ ] Founder: no separate 0.7.1 npm required if 0.7.2 ships with both sections  

---

## Ship / no-ship recommendation

```
SHIP 0.7.1 trust fixes — approve.
No release-blocking defects found on the cold-QA finding set.
Prefer publishing as getadvantage@0.7.2 (includes 0.7.1 + honesty sweep)
with changelog sections preserved. Do not require a standalone 0.7.1 npm
cut unless process wants intermediate provenance.
```

---

## Resume prompt (0.7.1-only review)

> Independently review getAdvantage CLI **0.7.1 trust fixes only**. Read  
> `docs/REVIEW-0.7.1.md` and `docs/SESSION-HANDOFF-0.7.1.md`. Verify each of the  
> six findings in code + tests. Re-run `npm test`. Confirm or challenge the  
> SHIP verdict. Do not conflate with 0.7.2 polish unless a 0.7.2 change  
> regresses a 0.7.1 fix. Do not publish/push/tag without the founder.
