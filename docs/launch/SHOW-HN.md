# Show HN — copy pack (getadvantage@0.8.1)

Use with `docs/launch/verdict-hero.html` (screenshot) and/or a 15s GIF from
`gif-storyboard-15s.html`. Soft/beta framing — not “we own the category.”

> **Formatting note:** HN renders no markdown bold, fences, or quotes — only
> *single-asterisk italics* and code indented by spaces. The Body and Short
> version below are already written that way: **paste them as-is**.

---

## Title (Show HN)

**Show HN: getAdvantage – GO/NO-GO before you deploy an AI-built app**

Alternatives (pick one):

- Show HN: `npx getadvantage check` – block secrets and dirty deploys before ship  
- Show HN: A local pre-deploy gate for vibe-coded apps (open source)

---

## Body (Show HN) — HN-safe, paste as-is

AI can scaffold an app in an afternoon. Deploying it is still a good way to
ship a live API key in a sourcemap, a committed .env, or whatever was sitting
uncommitted when vercel --prod ran.

getAdvantage is a small, dependency-free CLI that answers one question in
plain language: is this safe to ship? *GO* or *NO-GO*.

    npx getadvantage check

What it actually blocks (we re-check these on every release with an evidence suite):

- committed secret-shaped keys (including inside sourcemaps / dist)
- a tracked .env
- a dirty working tree (because many hosts deploy the working tree, not a clean commit)
- and it still returns GO on a clean repo (no false panic)

Also: map for "what does this app have?" without calling a React SPA an Express
app; demo if you want the safe multi-lane fan-in story on a throwaway sample.

Local by default. Nothing leaves your machine unless you opt into reporting.

We're early. The pitch is narrow on purpose: not "rank in ChatGPT," not
"enterprise control plane on day one" — check before you ship.

npm: https://www.npmjs.com/package/getadvantage  
GitHub: https://github.com/BellmeJoe/getadvantage-cli  
Site: https://getadvantage.app

Happy to take feedback on false positives, missing patterns, and whatever
broke on *your* stack.

---

## Short version (if the form is tight) — HN-safe, paste as-is

AI ships apps fast; secrets and dirty trees still ship with them.

npx getadvantage check → plain GO / NO-GO before deploy. Blocks committed
keys (incl. sourcemaps), tracked .env, dirty working trees. Local, open source.

https://www.npmjs.com/package/getadvantage

---

## X / LinkedIn caption (with image or GIF)

*(X renders no markdown either — these are plain text. The card image is a
staged demo, so the caption frames it as one — don’t narrate it as a real
incident.)*

**Primary (with verdict-hero screenshot):**

> Commit a live-style key in a sourcemap → gate says NO-GO.  
> Fix it, re-run → GO.  
>
> npx getadvantage check  
> Local pre-deploy gate for AI-built apps — open source.  
> getadvantage.app

**Even shorter:**

> Don’t ship the .env.  
> npx getadvantage check → GO or NO-GO.  
> #buildinpublic

**If you attach the 15s GIF:**

> 15 seconds: leak in the map → blocked → fix → green.  
> That’s the whole product.  
> npx getadvantage check

---

## Image alt text (accessibility / HN)

> Two terminal cards: left NO-GO because a Stripe key fingerprint was found in
> dist/assets/index.js.map; right GO after the map was removed and the key rotated.

---

## What not to claim in the post

- “We get you named in ChatGPT” (Get Found / other product story)  
- “Conflict-free multi-agent fleets” as the hero  
- “Scans every file perfectly forever”  
- `npx ship-safe` (different package on npm)

---

## Pre-post checklist

```bash
npm view getadvantage version   # expect 0.8.1
npm run evidence                # expect 8/8 GREEN
```

Open `docs/launch/verdict-hero.html` **while online** (fonts load from Google
Fonts; offline falls back to system faces) → screenshot. Paste the HN-safe
sections above without reformatting. Soft language: early / feedback welcome.
