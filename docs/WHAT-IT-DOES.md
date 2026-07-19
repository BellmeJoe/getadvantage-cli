# What getAdvantage CLI does (market one-pager)

**Live:** `npx getadvantage@0.8.1` · **Owner proof (repo checkout only):** `npm run evidence`

---

## The promise (one line)

**Check before you ship** — plain **GO** or **NO-GO** so AI-built apps don’t deploy with secrets, committed `.env`, or accidental dirty tree.

---

## Outcomes a stranger understands

| If this is true… | The gate says… |
|------------------|----------------|
| A live API key is committed (even inside a **sourcemap**) | **NO-GO** (key fingerprint only, never full secret) |
| A `.env` is tracked by git | **NO-GO** |
| You have uncommitted tracked changes (`vercel --prod` ships the working tree) | **NO-GO** |
| Repo is clean and no leak patterns fire | **GO** |
| You’re on Vite/React with no API | Map speaks **client-side**, not Express jargon |
| You have Express/Next routes | Map lists them and flags risky open POSTs |

---

## What you type

```bash
npx getadvantage check     # GO / NO-GO
npx getadvantage map       # what the app has (orientation, not a verdict)
npx getadvantage demo      # safe fan-in on a throwaway sample (advanced wow)
```

Local by default. Nothing leaves the machine unless you opt into reporting.

---

## What we do **not** claim in the first sentence

- “We make you rank in ChatGPT” (that’s **Get Found**, secondary / other product story)  
- “Conflict-free multi-agent fleets” as the hero (fan-in is real, not the pitch)  
- “Scans every byte of every file forever” (honest skips exist; evidence suite guards the cases that sell trust)

---

## Visual for humans (not code)

Open `docs/launch/verdict-hero.html` — **NO-GO → GO** after a sourcemap leak.  
That *is* the product story on one screen.

---

## For the owner (not the customer)

```bash
npm run evidence   # 8 outcomes must stay GREEN
```

If evidence is red, marketing is a lie. Fix first.
