# getadvantage

A local, dependency-free **pre-deploy gate + portable project brain** for apps
built with AI — Claude Code, Cursor, Lovable, Bolt, v0, Replit, and friends.

Run it in your repo. It reads your project and gives you:

- **A plain-language GO / NO-GO before you deploy** — no secrets in code, a clean
  working tree, build + typecheck, a schema-version check.
- **A portable project brain** (`PROJECT-BRIEF.md`) — a one-page, model-agnostic
  memory of your project that *any* model, session, or tool reads first, so you
  never re-explain it.
- **A session handoff** (`HANDOFF.md`) — save your place, then start a fresh, fast
  session (or switch models) with zero loss.

Your context lives in your **repo**, not your tool. Switch from Claude to Cursor
to Qwen and keep going — and start a clean, fast session instead of dragging a
slow, bloated one.

## Use it

No install needed:

```bash
npx getadvantage            # run the pre-deploy checks (GO / NO-GO)
npx getadvantage brief      # generate / refresh the project brain
npx getadvantage init       # auto-load the brain at every session start
npx getadvantage handoff    # save your place for the next session
npx getadvantage switch     # move to a new tool/model without losing context
```

Or add it to your project:

```bash
npm install --save-dev getadvantage
```

```jsonc
// package.json
{ "scripts": { "ship-safe": "ship-safe" } }
```

## Commands

`getadvantage` and `ship-safe` are installed as aliases of the same command — use
whichever reads better to you.

| Command | What it does |
|---|---|
| `ship-safe` (default `check`) | Read-only pre-deploy checks → exit `0` on **GO**, `1` on **NO-GO**. Add `--build` for a full build. |
| `ship-safe brief` | Generate / refresh `PROJECT-BRIEF.md` — the **COLD** layer (what the project *is*). `--check` warns if it's stale; it never blocks. |
| `ship-safe handoff` | Refresh the brief **and** write `HANDOFF.md` — the **HOT** layer (where you *left off*). Your notes are preserved across refreshes; it never overwrites a `HANDOFF.md` it didn't create. |
| `ship-safe init` | Wire the brain into your agent's instructions file (`CLAUDE.md` / `AGENTS.md` / `.cursorrules` / `.windsurfrules` / `.clinerules`) so `PROJECT-BRIEF.md` + `HANDOFF.md` load automatically at session start. |
| `ship-safe switch [tool]` | Switch tools/models without losing context — saves your place, wires every AI-tool file, and prints the prompt to start the new session. |
| `ship-safe models` | A plain-language playbook for choosing + switching AI models (principles, not benchmarks). |
| `ship-safe gauge` | A quick "is this session getting heavy?" read (repo activity since your last handoff) that nudges a reset before things slow down — a heuristic, not a token count. |
| `ship-safe ledger` | Show the session ledger — the running log of save-points each `handoff` records. |
| `ship-safe deploy` | _(Advanced)_ Deploy from a clean, detached worktree and confirm the deployment URL's project prefix. Runs a real `vercel --prod`; the project prefix is derived from your linked `.vercel` (or pass `--expect-prefix`). |

## What it is — and isn't

- It **reads and reports** — "here's what I found before you ship." It does **not**
  claim your app is "secure" or "certified."
- It's **dependency-free** (Node built-ins only) and **read-only**, except for the
  explicit `brief` / `handoff` writes (your two repo-resident files) and the
  explicit `deploy` command.
- Nothing leaves your machine.

Requires **Node ≥ 18**. Built by [getAdvantage](https://getadvantage.app).
