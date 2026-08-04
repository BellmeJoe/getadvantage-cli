# Incident 005 — three copies of the same validator, none of them caught in review

**Source:** a widely-documented public pattern, not one repo's incident — engineering commentators independently describing the same shape of failure: PR volume from AI-assisted coding rising 3-5x, review queues backing up, and experienced engineers openly admitting they've stopped reviewing every agent-generated change because doing so by hand no longer scales. No individual or repo is named; this is a composite reconstruction of that documented pattern, not a specific maintainer's account. Reconstructed independently and run through getAdvantage's live gate.

## What happened

The pattern, stated plainly by the people living it: review load is exploding under AI-assisted output, the queue backs up, and at some point a reviewer decides it's "pointless" to keep reviewing everything an agent produces — so they stop, except for what they judge to be the important parts. That judgment call is where this incident lives.

Reconstructed the shape: an agent adds order-validation logic on the checkout path. A future session, working on the admin panel, needs the same validation — instead of finding and reusing the existing function, it writes its own copy. A third session does the same for a different flow. None of the three sessions saw the other two; each one's diff looked small and reasonable in isolation, which is exactly why a tired reviewer waves each one through. Nobody was looking at the codebase as a whole.

## Reconstruction: what the gate does with this

Built the shape locally: one validation function, copied near-verbatim into three files over several commits, with one of the three copies re-touched repeatedly (the checkout path kept changing) while the other two sat untouched. Ran `getadvantage architecture` — the accretion scanner — cold against that history.

```
Architecture — accretion scan (advisory, read-only)
  scanned: 3 source files · 54 lines
  oversized: 0 files >600 lines (0 >1000 · 0 >1800)
  duplication: 3 repeated blocks — >=15 similar lines appearing >=3x (exact/near-exact repetition, approximate)
  churn window: last 16 commits

Collapse candidates (top 3)
  1. src/checkoutValidate.js
       18 lines * changed in 14 of the last 16 commits * 1 duplicated block, e.g. lines 1-18 (shared with src/adminValidate.js, src/validate.js) * approx. complexity: 163 branches/100 lines
       -> Repeated block: the same code lives in several places -- consider collapsing the copies into one shared helper before they drift apart.
  2. src/adminValidate.js
       18 lines * changed in 2 of the last 16 commits * 1 duplicated block, e.g. lines 1-18 (shared with src/checkoutValidate.js, src/validate.js)
  3. src/validate.js
       18 lines * changed in 2 of the last 16 commits * 1 duplicated block, e.g. lines 1-18 (shared with src/adminValidate.js, src/checkoutValidate.js)

Verdict
  Signal band: NOTABLE
  Accretion surfaced in 3 files. This is a measurement, not a
  judgment -- a human (or your agent, now informed) decides what to collapse.
  Advisory only -- accretion never blocks a ship (exit 0).
```

This is the signal a per-PR reviewer structurally cannot see: no single diff looked wrong. What the scan surfaces is the *codebase*, not the changeset — three near-identical copies and which one is the hot spot actively drifting away from the other two, ranked by size, churn, and duplication together, not by which PR is on screen right now.

## What it would NOT have caught

Being direct about the edges, because a gate that only advertises catches isn't trustworthy:

- **It never blocks anything.** Architecture is advisory only and always exits 0, on purpose — it is a measurement, not a gate. A team that wants this to stop a ship has to wire that decision themselves; getAdvantage will not make it for them.
- **Small-scale duplication under the window.** The duplication pass only counts a repeated block once it reaches 15 normalized lines appearing at least 3 times. Two short, nearly-identical 8-line helpers copied into two files would not register at all — this scanner is tuned for the accreted, drifted-apart case, not every instance of copy-paste.
- **Whether the duplicated logic is even correct.** The scan says three copies of the same shape exist and one is hot; it has no opinion on whether that validation logic is right, complete, or safe. It found the copies, not a bug in them.
- **A first scan on a fresh clone with no history.** Churn is read from git log; a shallow clone or a repo checked out without its commit history gives a churn signal of zero, and the "hot" ranking loses one of its three inputs. Size and duplication still work; churn does not.
- **Anything outside where it's wired in.** An ad hoc, uninstalled-in-CI run gives zero protection. This is the exact gap [invisible-mode / automatic hook installs](../launch/SOCIAL-MEDIA-PACK.md) is built to close: the check running automatically instead of depending on someone remembering to call it.

## Try it

`npx getadvantage architecture` on your own repo takes under a minute and reads nothing but your local tree and git history — no network, no account. If it mis-fires on your project, open an issue; fixed within a day.
