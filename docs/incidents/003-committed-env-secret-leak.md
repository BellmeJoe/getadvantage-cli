# Incident 003 — a committed .env ships a live key, and the scanner only catches the one it recognizes

**Source:** composite, built from a public industry statistic, not a single maintainer's incident. GitGuardian's *State of Secrets Sprawl 2026* report (cited via Docker's engineering blog, published 2026-07-28) found that code written with an AI coding agent leaks credentials at roughly double the rate of code written without one. No team or repo is named here; this is a reconstruction of the failure class the statistic describes, run through getAdvantage's own gate.

## What happened

The pattern behind that 2x number is simple and repeats across teams: an agent scaffolds a project, drops a working `.env` next to the code so the app runs locally, and either forgets the `.gitignore` line or adds it one commit too late. `git init && git add -A` on cycle one sweeps the file in before anyone thinks to check. The repo now ships a live database URL and one or more provider keys to every clone, and stays in git history even if someone deletes the file later — `.gitignore` only stops new untracked files, it has no effect on what git already tracked.

## Reconstruction: what the gate does with this

Built a minimal repo with a `.env` holding three realistic fixture values — a Postgres connection string, a Stripe live-shaped secret key, and an AWS-shaped access key — committed it on a clean tree, then ran `npx getadvantage check` cold.

```
✗ Secret scan — 2 possible secrets in committed/staged files — remove + rotate before shipping.
    .env:2 → Stripe live secret key: sk_live_…0000 (35 chars) · auth 7d3e4150553791318e1e3e917d32ad59a594f02bd50cb162fe0379133766baa4
    .env:3 → AWS access key id: AKIAIO…0000 (20 chars) · auth 7b6e44c8d529c15d5de3f17dc7d7d6933d35fb2a1b68e91b1a25060f073ffd11
    Smallest safe next edit — 2 blocking secret findings (same remedy for each; every finding named above with its own auth id):
      remove the value from the tree, rotate the credential at the provider, commit the removal, then re-run check.

✗ Tracked .env file — 1 .env file tracked by git — a committed .env is a leak by itself, whatever it contains.
    .env
    Remove it from git (git rm --cached <file>), add it to .gitignore, and ROTATE every key that file ever held — git history keeps old values.

Verdict
  ✓ 4   ⚠ 1   ✗ 2   – 3 skipped
  NO-GO — 2 blocking issues. Do not ship until these are clear.
```

Two independent checks catch this, which matters because they fail differently: the secret scanner looks for known credential shapes, the tracked-.env check does not care what is inside the file at all — a committed `.env` is a leak by itself, full stop. Wired into a commit hook or CI, this is a hard NO-GO before the file reaches a second clone.

## What it would NOT have caught

- **The pattern-matched secret scanner missed one of the three fixture values.** Of the Postgres URL, Stripe key, and AWS-shaped key committed in this reconstruction, the Stripe key and the AWS-shaped access key were both recognized and named by the secret scanner. The plain database URL — no password embedded in the connection string — was not flagged by that check on its own; the same URL **with** a password embedded in it is recognized as a separate finding ("Database URL with embedded password"). The tracked-.env-file check still caught the whole file regardless of what patterns it contains — that check is what actually saves you here for anything the pattern list doesn't recognize. A secret shape the scanner doesn't recognize, committed somewhere other than a file named `.env` (a config.json, a shell script, a docker-compose override), would not be caught by either check in this run.
- **A key rotated after commit but left in history.** The gate reads the current tracked state, not git history. Removing the file and rotating the credential is the fix; the gate cannot detect an old, already-rotated key sitting in a prior commit and will not warn that history still holds it — that part is on the operator to know and do.
- **Anything outside where it's wired in.** Same limit as every check in this series: this only stops a ship if something actually calls it on the commit or in CI. That is the exact gap [invisible mode](../launch/SOCIAL-MEDIA-PACK.md) closes — the check runs automatically on every agent session instead of depending on someone remembering to call it.

## Try it

`npx getadvantage check` on your own repo takes under a minute and reads nothing but your local tree — no network, no account. If it mis-fires on your project, open an issue; fixed within a day.
