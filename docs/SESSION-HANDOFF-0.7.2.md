# Session handoff — getAdvantage CLI 0.7.2

**Date:** 2026-07-19 · **Repo:** `C:\Users\ben\projects\getadvantage-cli`  
**Read this + `ROADMAP.md` first.** Self-contained cold start.

## TL;DR

- **0.7.1 + 0.7.2 are code-complete in the working tree, fully tested (34/34), UNPUBLISHED + largely UNCOMMITTED.**
- Version bumped to **0.7.2** in `package.json`.
- **Do not publish, push, tag, or deploy without the founder.**

## What landed this session

### From 0.7.1 (prior, still uncommitted)
Trust-critical: UTF-16 secrets, non-ASCII filenames (`git -z`), no `npx tsc`, corrupt package.json NO-GO, demo outside repo, CI workflow pin.

### 0.7.2 honesty + branding + polish

| Finding | Fix |
|---|---|
| `brief-eats-manual-edits` | Protected notes block + foreign-file refuse |
| `shipsafe-brand-residue` | `getadvantage_*` markers; legacy ship-safe reads |
| `shipsafe-name-collision` | README teaches only `getadvantage` |
| `map-vs-check-routes` | Shared `scanRoutes` + `detectRepoStack`; `src/app/api` |
| `switch-cursorrules-claim` | Honest Cursor tip |
| `missing-brief-called-stale` | missing vs stale wording |
| `fanout-wont-collide-overclaim` | Share brain / fan-in catches collisions |
| `deploy-token-in-argv` | Token via child env |
| `mcp-schema-not-enforced` | validateToolArgs → -32602 |
| `self-artifacts-trip-dirty-guard` | Brain/marker files recognized |
| polish batch | gitSafe stderr, did-you-mean, login abort, map --json, build timeout, author email, demo help |

## Verify

```bash
npm test   # 34/34
```

## Next

- **Review pack (commit msg + release notes + checklist):** `docs/RELEASE-0.7.2-REVIEW.md`
- **Founder:** review → commit → tag → publish 0.7.2 (ideally with provenance).
- **0.8:** policy/baseline, SARIF, GitHub Action productization, client-bundle keys.
- **0.9:** Vite+Supabase stack-fit + paste-ready fixes.

## Resume prompt (engineering)

> Continue the getAdvantage CLI. Read `docs/SESSION-HANDOFF-0.7.2.md` and `ROADMAP.md`. Confirm `npm test` is green. Start 0.8 or cut the 0.7.2 release with me. Do not publish/push/tag/deploy without me.

## Resume prompt (release review)

> Review the getAdvantage CLI 0.7.2 release candidate. **First** independently
> review 0.7.1 trust fixes via `docs/REVIEW-0.7.1.md` (do not skip — 0.7.1 was
> never separately reviewed). Then read `docs/RELEASE-0.7.2-REVIEW.md`,
> `docs/SESSION-HANDOFF-0.7.2.md`, and `ROADMAP.md`. Run `npm test` (expect 34/34).
> Walk both checklists. Produce ship / no-ship for (a) 0.7.1 trust set and
> (b) 0.7.2 polish / combined release. Do not commit, push, tag, or publish
> unless the founder explicitly asks after the verdict.
