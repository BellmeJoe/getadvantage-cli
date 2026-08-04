# Incident 004 — an agent's own summary said "just the auth fix"; the diff said otherwise

**Source:** a public GitHub issue filed by a maintainer against their own production repo, describing why a release agent's self-reported change list could not be trusted on its own. Anonymized here at the maintainer's-consent bar (no consent on file yet, no live touch conversation open on this thread) — no repo, org, or handle named. Reconstructed independently as a generic scope-drift scenario and run through getAdvantage's live gate; not the maintainer's own words beyond the class of failure.

## What happened

A release agent was coordinating a scoped change and reporting back what it had touched. The maintainer's own account is blunt about the limit of that self-report: the agent "does not have access to that project and must not fabricate the list" of what it actually changed. The team could not tell, from the agent's own summary, whether the real diff matched the declared task — they had to go verify by hand.

This is the ordinary shape of a much broader problem: an agent says "I only touched the auth flow," and either it did, or it also picked up an unrelated file along the way — a leftover edit, a convenience refactor, a file it thought was related. Nothing about the agent's own narration tells you which one happened. The only ground truth is the diff.

## Reconstruction: what the gate does with this

Reproduced the shape of the failure locally with getAdvantage's Intent Contract: pinned a baseline commit, declared the real task in writing before any agent work started (`goal: "Add password reset flow"`, `allow: src/auth/**, tests/auth/**`), froze that contract as its own commit, then let the "agent" commit — genuinely scoped work in `src/auth/reset.js`, plus one extra line in an unrelated `src/billing/charge.js`, exactly the kind of drift a self-report narration would describe as "just the password reset." Ran `getadvantage intent check` cold against that history.

```
Intent Contract
  ✗ Intent Contract — NO-GO — 1 scope violation against the Intent Contract.
      goal: Add password reset flow
      contract: sha256:5cb2bd6081852bcecb488e291f93f925d3a2259770a0afd735683a33ed88526a
      receipt: sha256:62573d0408d2393991edd4483bf718ffc481e61dfa9a109443d0f3daf9a1aa8f
      baseline: 484af8991baa
      freeze: 35cb8ea594e0
      src/billing/charge.js — outside allowlist
      Smallest safe next edit — path(s) outside Intent Contract allow list (src/billing/charge.js):
        Preferred: unstage/remove the out-of-scope path(s) so the commit stays inside the frozen envelope at .getadvantage/intent.json.
        Example: git restore --staged --worktree -- src/billing/charge.js
      scope verified; semantic correctness not proven

Verdict
  NO-GO — changes left the authorized scope (or trust failed).
  scope verified; semantic correctness not proven
```

The check doesn't read the agent's summary at all. It diffs everything that actually happened after the declared baseline — committed, staged, unstaged, even untracked — against the envelope a human wrote down before the work started, and names the exact file that fell outside it. No narration to trust or distrust; just the diff against the contract.

## What it would NOT have caught

Being direct about the edges, because a gate that only advertises catches isn't trustworthy:

- **No contract, no verdict.** This only works if a human wrote the Intent Contract down before the agent started. A team that skips that step gets no scope check at all — `getadvantage check` never fakes a "verified" result for a project with no frozen contract.
- **A change that's technically in-scope but wrong.** The gate proves the diff stayed inside `src/auth/**`; it has no opinion on whether the password-reset logic itself is correct. Its own honesty line says it plainly: "scope verified; semantic correctness not proven."
- **A contract written too loosely.** If the human had allowed `src/**` instead of `src/auth/**`, the billing edit would pass cleanly — the gate enforces exactly the envelope it was given, not the envelope that should have been written.
- **Anything outside where it's wired in.** An ad hoc, uninstalled-in-CI run gives zero protection. This is the exact gap [invisible-mode / automatic hook installs](../launch/SOCIAL-MEDIA-PACK.md) is built to close: the check running automatically at commit time instead of depending on someone remembering to call it, or trusting the agent's own summary instead.

## Try it

`npx getadvantage check` on your own repo takes under a minute and reads nothing but your local tree — no network, no account. If it mis-fires on your project, open an issue; fixed within a day.
