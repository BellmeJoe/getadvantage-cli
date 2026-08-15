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

**Re-verify before trusting this table.** Marketplace HTTP status is live infrastructure, not a frozen doc fact. An earlier writeup in this same cycle claimed all three slugs were 404; within roughly ninety minutes the primary slug was already returning 200. Re-probe with the method below (or equivalent) before citing these codes in any other doc, PR, or status note.

Probe method (PowerShell, `Invoke-WebRequest -Method Head -MaximumRedirection 5 -UseBasicParsing`):  
Timestamp: **2026-08-15 13:57:24 UTC**.

| Slug | URL | Result |
|------|-----|--------|
| `getadvantage-check` | https://github.com/marketplace/actions/getadvantage-check | **200** (live listing page) |
| `getadvantage` | https://github.com/marketplace/actions/getadvantage | **404** |
| `get-advantage-check` | https://github.com/marketplace/actions/get-advantage-check | **404** |

Primary slug **`getadvantage-check`** is on the shelf: https://github.com/marketplace/actions/getadvantage-check  
That is **discovery / shelf visibility only** — not installs, not evaluators, not retained teams. Retained external teams remain a **validated zero**. The other two candidate slugs stay 404; that is non-blocking for this lane (they are alternate name guesses, not required mirrors).

Repo is public. For the primary slug the distribution gap this lane made clickable is **no longer “listing absence”** — the page is live. What remains for founders is the **per-Release publish checkbox** on every future Release (automation still cannot set that flag). Alternate-slug 404s are not a product defect in the Action itself.

---

## Exact founder click path (for each future Release)

**Current status (this cycle):** the Marketplace listing **is live** for primary slug `getadvantage-check`. The Marketplace Developer Agreement has **evidently already been accepted** for the publisher account (otherwise the listing page would not be live). Do **not** repeat a “first publish for `v0.13.1`” path as if it were still pending — that step has already succeeded for this release.

The path below is **not obsolete**. Every **new** Release still needs the human publish checkbox. Use it for the next tag after `v0.13.1`, and for every automated Release after that.

Do this on a machine where you are signed into GitHub as a publisher for **BellmeJoe/getadvantage-cli**.

1. **Open the new Release**  
   Go to https://github.com/BellmeJoe/getadvantage-cli/releases and open the exact tag you just shipped (e.g. `v0.13.2` or later — not a re-do of already-published `v0.13.1`).  
   Or open `https://github.com/BellmeJoe/getadvantage-cli/releases/tag/vX.Y.Z`.

2. **Edit the Release**  
   Click **Edit release** (pencil) on that Release page.

3. **Marketplace Developer Agreement (only if shown again)**  
   If GitHub shows the **Marketplace Developer Agreement**, read and **accept** it.  
   For this account that gate is already cleared for the current live listing; you only see it again if GitHub re-prompts or the publisher identity changes.

4. **Publish checkbox (required on every new Release)**  
   Find the control labeled roughly:  
   **Publish this Action to the GitHub Marketplace**  
   Check it. GitHub may ask you to confirm the Action’s primary category and that `action.yml` branding looks right (`getAdvantage check`, shield / yellow).

5. **Update the Release**  
   Save / **Update release**.  
   Wait a minute, then open the Marketplace URL GitHub shows (primary slug today: `getadvantage-check`).

6. **Confirm listing still loads**  
   The Marketplace page should load (not 404), e.g. https://github.com/marketplace/actions/getadvantage-check  
   Still: this is **discovery only** — do not count it as an install, evaluator, or retained team. A 200 page is shelf visibility only.

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
