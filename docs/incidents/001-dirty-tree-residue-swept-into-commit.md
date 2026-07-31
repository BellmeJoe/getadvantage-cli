# Incident 001 — prior-cycle residue swept into a live commit by an agent's fallback path

**Source:** a public GitHub issue filed by a maintainer against their own AI-agent-driven commit pipeline, describing a real shipped defect. Anonymized here at the maintainer's-consent bar (no consent on file yet) — no repo, org, or handle named. Reconstructed independently and run through getAdvantage's live gate; not the maintainer's own words beyond the class of failure.

## What happened

An agent-driven pipeline runs a multi-step cycle: plan, implement, then commit. A prior cycle had been aborted partway through — it left the working tree dirty: a test file gutted from hundreds of lines down to a handful, and an unrelated view edit that was never finished or reverted.

The next cycle started on top of that dirty tree. Its own changes were in scope and correct — a later transcript audit confirmed the cycle's own diff touched only the files it was supposed to touch. But the automated commit step hit a conflict ("patch does not apply") against the leftover residue and fell back to a broad `git add -A`-style commit. That swept the gutted test file and the unrelated broken edit into the same commit as the cycle's real work.

CI ran green — the reduced test file still passed, it just tested less. The commit merged. The unrelated broken edit shipped as a live regression that caused data loss, and was only caught and hand-fixed after the fact.

The maintainer's own root-cause note: an older, human-driven version of this pipeline used to abort outright on a dirty working tree. That doctrine did not carry over when the pipeline was mechanized — nothing re-asserted it, so nothing stopped the fallback from running on a dirty tree.

## Reconstruction: what the gate does with this

Reproduced the shape of the failure locally: a clean initial commit, then a file modified in place without being committed or staged for review (standing in for the prior cycle's residue), then ran `getadvantage check` cold, exactly as it would run in CI or a pre-commit hook.

```
✗ Dirty-tree guard — 1 tracked file modified/staged — a 'vercel --prod' would ship this unintended work.
    M test/sample.test.js
    Commit, stash, or revert before shipping. Deploy from a clean detached worktree of the intended commit.

Verdict
  ✓ 6   ⚠ 1   ✗ 1   – 2 skipped

  NO-GO — 1 blocking issue. Do not ship until these are clear.
```

Wired into the commit-pr entry point (the exact point this incident's fallback ran), this is a hard halt: NO-GO, before the sweep, before CI, before merge. It names the modified file directly, so the operator sees the residue instead of a green check hiding it.

## What it would NOT have caught

Being direct about the edges, because a gate that only advertises catches isn't trustworthy:

- **A residue file that gets legitimately committed first.** If the leftover edit had landed in its own small commit before the next cycle started, the tree reads clean at the next check — the guard checks working-tree hygiene at the moment it runs, not the history of how a file got there.
- **A logic bug inside a file that was always meant to change.** The guard flags *unexpected* modifications; it has no opinion on whether an intended, cleanly-committed change is correct. The dirty-tree class and a bad-logic class are different failures — this incident happened to be the first, not the second.
- **Anything outside where it's wired in.** The gate only stops a ship if something actually calls it — ad hoc, uninstalled-in-CI runs give zero protection. This is the exact gap [invisible-mode / hook installs](../launch/SOCIAL-MEDIA-PACK.md) closes: the check runs automatically on every agent session instead of depending on someone remembering to call it.
- **A deliberate, reviewed override.** getAdvantage supports a tracked ignore path for a specific finding — that is a feature (disclosed, reviewable, never silent), but it also means a rushed or careless override can wave through the exact thing the guard was built to stop. The gate makes the override visible; it doesn't prevent someone from clicking past it.

## Try it

`npx getadvantage check` on your own repo takes under a minute and reads nothing but your local tree — no network, no account. If it mis-fires on your project, open an issue; fixed within a day.
