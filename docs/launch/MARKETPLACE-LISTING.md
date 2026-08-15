# GitHub Marketplace listing — founder click path

**Lane:** `0.13.x-marketplace-listing-readiness` (bet 16, free-shelf distribution).  
**What this is:** a discovery surface so people can find the Action.  
**What this is not:** adoption, installs, evaluators, retained teams, or week-two reuse. Never report a listing as any of those.

Live product remains **getadvantage@0.13.1** / `e5b06f3`. This doc does not publish, tag, or bump.

---

## Why a human must click

The release pipeline creates a GitHub **Release** for each version (exact tag `vX.Y.Z` + floating Action major `v1`). Publishing that Release to the **GitHub Marketplace** is a separate flag.

The GitHub REST API **cannot** set the marketplace-publish flag on Releases created by bots / `GITHUB_TOKEN` automation. So every automated release leaves the listing unpublished until a founder completes the path below once per Release (or confirms the checkbox when editing).

Root `action.yml` already carries valid Marketplace metadata (`name`, `description` under GitHub’s **125-character** hard limit, `branding.icon: shield`, `branding.color: yellow`, `runs.using: composite`). Contract tests under `TEST_FILTER=marketplace` guard that so the click can succeed first time and stay succeeding. `ops/action-release.mjs` emits a non-fatal notice after each successful Release apply so the gap stays visible in Actions logs and the job summary.

---

## Live evidence (this cycle — 2026-08-15)

All three candidate Marketplace slugs returned **404** (not listed):

| Slug | URL | Result |
|------|-----|--------|
| `getadvantage-check` | https://github.com/marketplace/actions/getadvantage-check | **404** |
| `getadvantage` | https://github.com/marketplace/actions/getadvantage | **404** |
| `get-advantage-check` | https://github.com/marketplace/actions/get-advantage-check | **404** |

Repo is public; listing absence is the distribution gap this lane makes clickable, not a product defect in the Action itself.

---

## Exact founder click path (plain language)

Do this on a machine where you are signed into GitHub as a publisher for **BellmeJoe/getadvantage-cli**.

1. **Open the Release**  
   Go to https://github.com/BellmeJoe/getadvantage-cli/releases and open the exact tag you just shipped (e.g. `v0.13.1`).  
   Or open `https://github.com/BellmeJoe/getadvantage-cli/releases/tag/vX.Y.Z`.

2. **Edit the Release**  
   Click **Edit release** (pencil) on that Release page.

3. **Marketplace Developer Agreement (once per publisher account)**  
   If GitHub shows the **Marketplace Developer Agreement**, read and **accept** it.  
   You only do this the first time you publish any Action for the account.

4. **Publish checkbox**  
   Find the control labeled roughly:  
   **Publish this Action to the GitHub Marketplace**  
   Check it. GitHub may ask you to confirm the Action’s primary category and that `action.yml` branding looks right (`getAdvantage check`, shield / yellow).

5. **Update the Release**  
   Save / **Update release**.  
   Wait a minute, then open the Marketplace URL GitHub shows (slug is derived from the Action `name`, often kebab-case such as `getadvantage-check`).

6. **Confirm listing is live**  
   The Marketplace page should load (not 404).  
   Still: this is **discovery only** — do not count it as an install, evaluator, or retained team.

If the checkbox is missing, the Release was almost always created without a root `action.yml` at the tagged commit, or the publisher has not finished account verification. Fix metadata on a new Release rather than inventing a nested action path.

---

## What agents already automated

| Piece | Owner | Notes |
|-------|--------|--------|
| Valid `action.yml` branding + name + description | product (read-only this lane) | Guarded by `TEST_FILTER=marketplace` |
| Exact tag + `v1` + GitHub Release | `ops/action-release.mjs` | Apply path after npm publish |
| Non-fatal “listing not published” notice | `ops/action-release.mjs` | stdout + `GITHUB_STEP_SUMMARY` |
| This click path | founder only | No agent may accept the agreement or tick the box |

---

## Honest scope (do not blur)

- **Marketplace listing** = shelf space / discovery.
- **Adoption** = retained external teams / week-two reuse (north-star metric; still measured separately; currently a validated zero).
- **Cold install** = `npx getadvantage@0.13.1` (npm), not the Marketplace badge.
- Never claim Cursor support. Never re-expose parked Supabase RLS. Never treat a listing publish as a product release train.
