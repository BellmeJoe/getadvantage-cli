# Session log — 2026-07-19 · CLI review → 0.7.2 + 0.7.3 → launch visual + Loop 1

| Field | Value |
|---|---|
| Repo | `C:\Users\ben\projects\getadvantage-cli` · npm `getadvantage` |
| Tool | Claude Code (Opus) |
| Outcome | **0.7.2 AND 0.7.3 published to npm** (latest = 0.7.3); evidence suite + launch visual added |
| Hard rule honored | Nothing published/pushed without the founder's explicit "yes" (given for both 0.7.2 and 0.7.3) |

**Lead the next session with:**
```
Read docs/sessions/2026-07-19-review-073-loop1-SESSION.md
and docs/sessions/2026-07-19-RECONCILE-PARALLEL.md (canonical paths decided).
Then: npm test (40/40), npm run evidence (8/8 GREEN), node index.mjs --version (0.7.3).
```

> **Reconciled 2026-07-19 (Grok):** `npm run evidence` / `ops/evidence-suite.mjs` =
> objective Loop 1. `ops/loop1/run.mjs` = thin wrapper. `docs/launch/` = in-repo
> brand-matched visuals. Claude Artifact = optional animated social asset.

---

## 1. What happened, in order

1. **Independent review of the 0.7.2 RC** (the prior Grok session wrote 0.7.1+0.7.2 and self-reviewed it). A 14-dimension workflow with adversarial refute found **5 major findings** (0 refuted). Fixed 4:
   - `brief` silently clobbered a >200 KB hand-written brief → fail-closed read (`brief.mjs`).
   - dirty-tree waved through tracked edits/deletions of seed files (CLAUDE.md/AGENTS.md/workflow) → `isRegeneratedArtifact()`; only untracked-new or regenerated brief/handoff/marker stay informational (`checks.mjs`).
   - secret scan silently skipped `build/`/`dist/`/`coverage/` dirs → removed from `SKIP_DIR`.
   - "push = publish" trap: `.github/workflows/publish.yml` auto-publishes on push to main; release pack ordering fixed to disclose it (docs only, workflow left as founder's choice).
   - Wrote `docs/INDEPENDENT-REVIEW-0.7.2.md`. **Published 0.7.2** (commit `5884c58`).
2. **Public-readiness assessment.** Wrote `docs/PUBLIC-READINESS-REVIEW-PROMPT.md`. Two independent evals — an external session (`docs/PUBLIC-READINESS-2026-07-19.md`) + my 2nd workflow eval — both returned **ADVERTISE SOFT**. Secret gate confirmed airtight on live. Findings A1–A4.
3. **Cut 0.7.3** to close A1–A4 (see §2). Tests 40/40. **Published 0.7.3** (commit `e6dd910`).
4. **Loop 1 (owner transparency) — the release ritual.** Built `ops/evidence-suite.mjs` (`npm run evidence`): deterministic, LLM-free, 8 trust-critical capabilities → GREEN/RED scoreboard, exit 1 gates. **8/8 GREEN on 0.7.3.** Layer 2 = the two-model refute workflow (run per minor). Memory: `getadvantage-cli-release-ritual-loop1`.
5. **Customer launch visual.** Published Artifact (animated NO-GO→GO terminal + 15s storyboard): https://claude.ai/code/artifact/f23a9526-535b-44e9-82dc-c9ca3ec8ccbe · source in scratchpad `getadvantage-verdict-moment.html`.

## 2. What's in 0.7.3 (published)

| Finding | Fix | File |
|---|---|---|
| A3 | banner "land the fleet safely" → "check before you ship" (drops fleet framing) | `index.mjs` |
| A4 | secret scan now covers lockfiles + `.map` sourcemaps + `.svg` (only true binaries skipped); README reworded + skips disclosed | `checks.mjs`, `README.md` |
| A2 | outside-git error now offers `demo` + `git init` instead of a dead-end | `index.mjs` |
| A1 | de-jargoned map for client-only apps (`frontend` flag; no Express/Fastify wording on a React screen) | `detect.mjs`, `overviews.mjs`, `index.mjs` |

## 3. Current state

- npm: **getadvantage@0.7.3** (latest). git `main` == origin/main (0.7.3 pushed).
- **Uncommitted (mine):** `ops/evidence-suite.mjs` + the `evidence` npm script in `package.json`. Dev tool, not in the npm `files` whitelist → won't ship. Founder-gated to commit.
- **⚠ Uncommitted (NOT mine — a parallel session):** `docs/launch/` (`verdict-hero.html`, `gif-storyboard-15s.html`, `README.md`) and `ops/loop1/`, created ~22:00. Another session built its own launch visual / loop-1 in parallel. **Do NOT blind-delete — reconcile with the published Artifact first.**

## 4. What to review / open items

- **Reconcile the two launch visuals:** my published Artifact vs the parallel `docs/launch/*.html`. Pick one, don't duplicate.
- **Decide:** commit `ops/evidence-suite.mjs`? (recommended — it's the release gate.)
- **Publish trigger:** still push-to-main = publish, no `--provenance`. `docs/publish.yml.proposed` offers `workflow_dispatch`/tag-only + provenance. Founder's call.
- **Wire the gate:** next step is to run `npm run evidence` in `publish.yml` before publish, so a release can't go out red.
- **0.8 backlog** (from the 2nd eval, non-blocking): UTF-16-without-BOM detection heuristic (currently disclosed-but-skipped); `demo` dry-run says "3/3 clean" then `--apply` hits a README conflict (copy/logic); FastAPI gate-header says "generic repo" while map detects it; the false-positive escape hatch (already on ROADMAP 0.8).

## 5. Verify (cold start)
```
npm test                       # 40/40
npm run evidence               # 8/8 GREEN, exit 0
node index.mjs --version       # 0.7.3
npm view getadvantage version  # 0.7.3
```

## 6. Other lanes touched this session (not CLI — context only)
- `getadvantage` repo (separate): worktree hygiene — 21 merged worktrees + 24 merged branches removed; uncommitted leftovers rescued to `C:\Users\ben\projects\_rescue-getadvantage-2026-07-18\`. Main is 2 ahead / behind origin — reconcile before shipping getadvantage.
- KSA outreach: `docs/KSA-SEND-SHEET.md` in the getadvantage repo (added George Nazi to the Sales-Nav check list).
- Product-comms: plus×plus / getAdvantage two-sentence positioning (operator vs trust) — not yet written to positioning docs.
