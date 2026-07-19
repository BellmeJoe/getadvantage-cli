# Reconcile — parallel Claude + Grok work (2026-07-19)

Two sessions hit the same “Loop 1 + launch visual” ask. Neither should be
blind-deleted. This file is the **decision record**.

| Field | Value |
|--------|--------|
| **Date** | 2026-07-19 |
| **Repo** | `getadvantage-cli` |
| **Live npm** | `getadvantage@0.7.3` (published by Claude session, founder-approved) |

---

## Who built what

| Deliverable | Claude session | Grok session |
|-------------|----------------|--------------|
| 0.7.2 review + publish | Yes | Prior RC code |
| 0.7.3 public-readiness fixes + publish | Yes | Prior SOFT assessment |
| Evidence / Loop 1 **objective** suite | **`ops/evidence-suite.mjs`** + `npm run evidence` (8/8 GREEN) | `ops/loop1/run.mjs` (earlier draft, overlapping) |
| Two-model refute prompt | Memory / workflow | `ops/loop1/REFUTE-PROMPT.md` |
| Launch visual | **Artifact** (animated, hosted) | **`docs/launch/*.html`** (brand-matched static, in git) |

---

## Canonical after reconcile

| Concern | Canonical | Status |
|---------|-----------|--------|
| Unit/integration tests | `npm test` | 40/40 expected |
| Release evidence gate | **`npm run evidence`** → `ops/evidence-suite.mjs` | Committed in `ec670df` |
| Loop1 path | `ops/loop1/run.mjs` = **wrapper** to evidence-suite | Not a second suite |
| Refute prompt | `ops/loop1/REFUTE-PROMPT.md` | Keep |
| In-repo launch HTML | **`docs/launch/`** | Keep (live brand chrome) |
| Animated social visual | Claude Artifact URL in Claude session log | Optional; export GIF if preferred |
| Brand law (product site) | getadvantage `docs/BRAND.md` + `brand:guard` | Separate repo |

---

## Why two sessions collided

Exactly the multi-agent problem: no shared lock on “who owns Loop 1 / launch visual.”

**Mitigation going forward:**

1. One **canonical** path per concern (table above).  
2. Session logs under `docs/sessions/` with **ID + timestamp**.  
3. Before starting a lane: `git status` + read latest session log.  
4. Done: `docs/ACTIVE-LANES.md` (who / what / path) — committed in `ec670df`, founder-owned.

---

## Founder checklist

- [ ] Prefer **`npm run evidence`** over inventing a new suite  
- [x] Commit `ops/evidence-suite.mjs` + `package.json` `evidence` script — done in `ec670df`  
- [ ] Use `docs/launch/` for brand-correct static assets; use Artifact only if you want motion  
- [ ] Publish trigger: **live behavior today is push=publish** — `.github/workflows/publish.yml` auto-publishes any version bump pushed to `main`. Open decision: keep that, or switch to the tag-triggered `docs/publish.yml.proposed`. npm provenance still open.  
- [x] Wire `npm run evidence` into publish workflow — done 2026-07-19 post-review (`npm test` + `npm run evidence` gate publish)  

## Verify

```bash
npm test
npm run evidence
node index.mjs --version   # 0.7.3
npm view getadvantage version
```
