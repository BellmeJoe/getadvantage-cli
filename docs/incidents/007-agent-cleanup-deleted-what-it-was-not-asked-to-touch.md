# Incident 007 — a cleanup command that deleted far more than the cleanup

**Source:** a public post containing an AI coding agent's own transcript, in which the agent reports that a command it ran destroyed files it was never asked to touch, including credentials on the developer's machine. Anonymized here at the default bar — no handle, no repo, no employer named, and no consent on file. Reconstructed independently as a generic over-broad-deletion scenario and run through getAdvantage's live gate. The transcript is the evidence for the class of failure; nothing below is presented as that person's own project.

## What happened

The task was small and boring: clean up some stale output. The agent wrote a command with a wrong path in it, and then, trying to tidy up after its own error, ran a recursive delete against a directory far above the one it meant. The agent's own words afterwards are the interesting part. It stopped, said plainly that it had caused damage, and listed what was gone. Among the casualties were private SSH keys and a known_hosts file, which is to say the developer's credentials and the machine's trust store.

Two things make this worth writing down rather than filing under bad luck.

First, the agent disclosed the damage only after it was done. Nothing about the earlier turns signalled that the blast radius had moved from a build directory to a home directory. Second, and more usefully for anyone deciding what to actually install: a large part of that damage is outside what any repository-level gate can see. That is the honest half of this page, and it is below.

## Reconstruction: what the gate does with the part it can see

Reproduced the in-repository half of the failure locally. Pinned a baseline commit on a small service repo, wrote the Intent Contract before any agent work — the real task, in writing, with a deliberately narrow envelope — and froze it as its own commit:

```
getadvantage intent init --goal "Clean up stale build output under dist/" \
  --allow "scripts/**" --allow "dist/**"
git add .getadvantage/intent.json && git commit -m "chore: intent contract"
```

Then let the "agent" run its over-broad delete, which took out tracked source and tests instead of build output, and ran `getadvantage intent check` cold against the result:

```
Intent Contract
  ✗ Intent Contract — NO-GO — 3 scope violations against the Intent Contract.
      goal: Clean up stale build output under dist/
      contract: sha256:2d34e2c00b0e2b86d379758a5bf5f05482463c636e34e78e69d5163310f8d5d6
      receipt: sha256:91206e98b49dfeedb86becc46bfe21227e2f84b53e9d1c76dcc840f3e31d6a70
      baseline: afd30e23e5d5
      freeze: 957b6d3b5cdc
      src/api/auth.js — outside allowlist
      src/api/handler.js — outside allowlist
      tests/api/handler.test.js — outside allowlist
      Smallest safe next edit — path(s) outside Intent Contract allow list (src/api/auth.js, src/api/handler.js, tests/api/handler.test.js):
        Preferred: unstage/remove the out-of-scope path(s) so the commit stays inside the frozen envelope at .getadvantage/intent.json.
        Example: git restore --staged --worktree -- src/api/auth.js
        To authorize a wider envelope: start a branch from a trusted base with NO intent history, then:
          getadvantage intent init --goal "…" --allow "relevant/**" --allow "…"
          git add .getadvantage/intent.json && git commit -m "chore: intent contract"
        Note: editing a frozen .getadvantage/intent.json cannot self-authorize (unsigned local mode: one freeze per clean lineage).
      scope verified; semantic correctness not proven

Verdict
  NO-GO — changes left the authorized scope (or trust failed).
  scope verified; semantic correctness not proven
```

The deletions were never staged and never committed. They were loose changes sitting in a working tree, which is exactly the state a tired developer commits by reflex with `git add -A`. The check counts deletions as changes, names all three by path, and refuses the commit before it becomes history. It does not read the agent's summary of what it did; it diffs what is actually there against what a human authorized in advance.

## What it would NOT have caught

This is the section that matters on this particular incident, because the worst of the real damage falls squarely inside it.

- **Everything outside the repository. This is the big one.** The private keys in the developer's home directory are not in the repo, produce no diff, and are invisible to this check. If the whole incident had happened one directory above the project, getAdvantage would have printed a clean GO on a repo that was fine while the machine around it was not. It is a repository gate, and a repository gate cannot see your home directory.
- **It does not stop the command from running.** It is not a sandbox, a permissions layer, or a shell interceptor. By the time the check runs, the files are already deleted. What it stops is the deletion becoming a commit and a push — the difference between a local mess one `git restore` undoes and a destroyed main branch other people pull.
- **It restores nothing.** There is no undo here. The recovery in the reconstruction is `git restore`, and that only works because the files were still in git. Anything never committed is gone whatever tooling you had installed.
- **No contract, no scope verdict.** The Intent Contract only exists if a human wrote it down before the agent started. Skip that and this check has nothing to compare against, and it will not fake a verdict — a project without a contract keeps its other checks and gets no false "intent verified".
- **An envelope written too wide passes.** Had the contract allowed `src/**`, the deleted source would have been inside the authorized scope and the run would have gone GO. The gate enforces the envelope it was given, not the one that should have been written.
- **A run nobody remembers to make protects nobody.** An occasional manual invocation is not a gate. This is the gap automatic hook installation is built to close: the check firing on every commit, without a human choosing to run it in the moment they are least likely to think of it.

## Try it

`npx getadvantage check` on your own repo takes under a minute and reads nothing but your local tree — no network, no account. If it mis-fires on your project, open an issue; fixed within a day.
