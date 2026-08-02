# Incident 002 — an agent's git integration force-pushed unconditionally; only git's own refusal on a dirty tree stopped data loss

**Source:** a public GitHub issue filed by a maintainer against their own AI-agent framework's git integration, describing a real incident the maintainer traced by transcript. Anonymized here at the maintainer's-consent bar (no consent on file yet, no live touch conversation open on this thread) — no repo, org, or handle named. Reconstructed independently and run through getAdvantage's live gate; not the maintainer's own words beyond the class of failure.

## What happened

An agent framework's git integration resets and force-pushes a working tree as part of its normal session lifecycle, with no read-only or dry-run mode and no check for local uncommitted work before doing it. The maintainer's own transcript-verified account: this ran three times in one session. Each time, the only thing that stopped it from actually destroying data was git's own built-in refusal to `checkout` over a dirty working tree — a safety net that belongs to git, not to the agent tool. A directory that happened to have a clean tree, or committed state instead of loose local edits, would not have been protected at all.

## Reconstruction: what the gate does with this

Reproduced the shape of the failure locally: a clean initial commit, then a local edit made and never committed (standing in for the loose session work that was one force-push away from being gone), then ran `getadvantage check` cold — exactly as it would run before an agent's git step, if wired into a pre-flight hook.

```
✗ Dirty-tree guard — 1 tracked file modified/staged — a 'vercel --prod' would ship this unintended work.
    M work.js
    Commit, stash, or revert before shipping. Deploy from a clean detached worktree of the intended commit.

Verdict
  ✓ 2   ⚠ 1   ✗ 1   – 3 skipped

  NO-GO — 1 blocking issue. Do not ship until these are clear.
```

Run before the agent's git step instead of after, this turns "silently protected by luck, this one time" into a named, visible halt: NO-GO, the modified file listed by name, before any reset or force-push runs.

## What it would NOT have caught

Being direct about the edges, because a gate that only advertises catches isn't trustworthy:

- **A tree that happens to be clean when the destructive command runs.** The maintainer's own account says the tree was dirty each of the three times this ran — that is what git's own refusal caught. If the same force-push had run against a directory with no loose edits (work already committed, or nothing pending), the dirty-tree guard has nothing to flag and would not stop it. The gate protects uncommitted local work specifically; it does not make a force-push or reset itself safe in general.
- **The destructive git command running before anyone calls the gate.** getAdvantage is a pre-flight check, not a runtime interceptor of git commands — it does not sit in the path of `git push --force` or `git reset --hard` and block them directly. It only helps if something calls `getadvantage check` before that step executes. An agent tool that force-pushes as its very first action, with no gate wired into that entry point, gets zero protection from installing getAdvantage elsewhere in the repo.
- **Anything outside where it's wired in.** Ad hoc, uninstalled-in-the-agent's-own-lifecycle runs give no protection at all. This is the exact gap [invisible-mode / automatic hook installs](../launch/SOCIAL-MEDIA-PACK.md) is built to close: the check running automatically on every agent session, including right before a git step, instead of depending on the tool's own authors remembering to call it.
- **Whether the force-push target was the right one.** The gate reads working-tree hygiene, not intent — it has no opinion on whether resetting or pushing to a given branch was the correct operation in the first place. A clean-tree force-push to the wrong branch is a different failure this class of check was never built to catch.

## Try it

`npx getadvantage check` on your own repo takes under a minute and reads nothing but your local tree — no network, no account. If it mis-fires on your project, open an issue; fixed within a day.
