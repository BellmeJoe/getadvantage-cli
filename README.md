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
- **An MCP server** (`getadvantage mcp`) — so an AI agent (Claude Code, Cursor)
  can call the brain + checks *mid-session*, without leaving the chat.
- **Fan-out + the safe fan-in conductor** (`getadvantage fan-out <n>` ·
  `fan-in`) — **land a fleet of AI agents safely.** Anyone can run agents in
  parallel (each in its own git worktree, all sharing one brain); the hard part
  is landing what they produce. The conductor reconciles them into ONE verified main: a
  **collision map** (which files >1 lane touched), a **merge-train** (textual
  conflicts up front), and a **combined-tree gate** that re-runs your checks after
  each merge so a "both-green-but-red-together" break is caught and that lane is
  quarantined — never landed. No conflict reaches main un-verified. Try it in one
  command: `getadvantage demo`.

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
npx getadvantage mcp        # run the MCP server (an agent calls the brain mid-session)
npx getadvantage fan-out 3  # 3 parallel lanes sharing one brain (then `fan-in`)
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
| `ship-safe ledger` | Show the session ledger — the running log of save-points each `handoff` records (kept in `.getadvantage/ledger.md`; a legacy `.ship-safe/` dir is still read and migrates forward on the next write). |
| `getadvantage mcp` | Run a dependency-free **MCP server** over stdio so an AI agent (Claude Code, Cursor) can call the brain + checks mid-session. Tools: `get_brief`, `refresh_brief`, `get_handoff`, `save_handoff`, `check`, `gauge`. Same engine as the CLI — no API keys, no network. |
| `getadvantage fan-out <n>` | Open **N parallel lanes** (1–8) as git worktrees off `HEAD`, each with the brain copied in + wired. Add `--task "..."` to print a shared task into each lane's guidance. Open a different model/tool per lane, work in parallel. |
| `getadvantage fan-in` | **The safe fan-in conductor.** Reconcile the lanes into one verified main: a **collision map**, a **merge-train** dry-run (textual conflicts up front), and — with `--apply` — actually merge the clean lanes one at a time, re-running the check gate on the **combined tree** after each so a lane that's green alone but red merged is **quarantined** (rolled back), never landed. Default is a read-only preview; `--apply` to land. |
| `getadvantage demo` | Spin up a throwaway sample repo with 3 pre-made divergent lanes (one clean, one that breaks the build, one that conflicts) and run the **whole conductor** on it — the entire wow in one command, zero setup. |
| `ship-safe deploy` | _(Advanced)_ Deploy from a clean, detached worktree and confirm the deployment URL's project prefix. Runs a real `vercel --prod`; the project prefix is derived from your linked `.vercel` (or pass `--expect-prefix`). |

## Use it as an MCP server (call the brain mid-session)

`getadvantage mcp` runs a dependency-free **Model Context Protocol** server over
stdio. Point your agent at it and it can call the brain + checks *while you're
working* — `get_brief`, `refresh_brief`, `get_handoff`, `save_handoff`, `check`,
`gauge` — instead of you running the CLI by hand. It's the same engine as the
CLI: no API keys, no network, nothing leaves your machine.

**Claude Code** — add it with one command:

```bash
claude mcp add getadvantage -- npx getadvantage mcp
```

or in your MCP config JSON:

```json
{
  "mcpServers": {
    "getadvantage": {
      "command": "npx",
      "args": ["getadvantage", "mcp"]
    }
  }
}
```

**Cursor** — add the same block to `.cursor/mcp.json` (project) or
`~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "getadvantage": {
      "command": "npx",
      "args": ["getadvantage", "mcp"]
    }
  }
}
```

Each tool takes an optional `cwd` (defaults to where the server runs) so you can
point it at any project repo on your machine.

## Land the fleet safely (fan-out / fan-in)

Because your brain lives in the repo, you can run **several models at once** on
the same project — and, the part that actually matters, **land their work safely**:

```bash
npx getadvantage fan-out 3 --task "add a settings page"
```

This refreshes the brain, then creates three git worktrees
(`../<repo>-lane-1 … -lane-3`) — each a fresh branch off `HEAD` with
`PROJECT-BRIEF.md` + `HANDOFF.md` copied in and wired. Open a *different*
model/tool in each lane (ChatGPT, Claude, Gemini, Cursor, Qwen…), let them work,
then:

```bash
npx getadvantage fan-in           # preview: collision map + merge-train dry-run
npx getadvantage fan-in --apply   # land the clean + green lanes, gated
```

`fan-in` is **the safe fan-in conductor**. It first draws a **collision map**
(which files more than one lane touched), then runs a **merge-train** dry-run to
find textual conflicts *before* anything is merged. With `--apply` it merges the
clean lanes one at a time onto your current branch and — the part nobody else
does — **re-runs your check gate on the combined tree after each merge**. Two
branches can each be green and still be red together; when that happens the
offending lane is **quarantined** (its merge rolled back) instead of poisoning
main. It ends on one verdict screen telling you exactly which lanes landed and
which need you.

`--apply` starts only from a **clean working tree** (so a half-merge can never
ship) and is **safe for automation**: it exits `0` only when every landable lane
landed green, and non-zero if a lane needs you *or* the run was refused (e.g. a
dirty tree) — so `fan-in --apply && deploy` never proceeds on a no-op. `fan-out`
commits its own brain refresh for you, so that clean-tree start is the default.
Cleanup is conservative by design: rollbacks only ever undo the in-flight merge —
**a landed lane is never reverted** — and if unexpected working-tree changes
appear after the train, it stops and tells you exactly where you are instead of
resetting anything. If a merge brings **new dependencies** (package.json / a
lockfile changed), the conductor runs your install (`npm ci` with a lockfile,
else `npm install`) before gating, and reports an install failure as exactly
that.

For CI and tooling, both `check` and `fan-in` take **`--json`**: stdout carries
exactly one JSON document — `{ command, verdict, exitCode, checks?/lanes?,
generatedAt }` — with the human rendering routed to stderr:

```bash
npx getadvantage check --json
npx getadvantage fan-in --apply --json
```

Honest by design: we *detect* overlap and *gate* the combined result — we don't
claim to make incompatible work compatible. **No conflict reaches main
un-verified.** It's all git-native: no API keys, no network. You bring the
models; the CLI holds the brain and the orchestration ground.

See the whole thing on a throwaway repo in one command:

```bash
npx getadvantage demo
```

## What it is — and isn't

- It **reads and reports** — "here's what I found before you ship." It does **not**
  claim your app is "secure" or "certified."
- It's **dependency-free** (Node built-ins only) and **read-only**, except for the
  explicit `brief` / `handoff` writes (your two repo-resident files) and the
  explicit `deploy` command.
- Nothing leaves your machine.

Requires **Node ≥ 18**. Built by [getAdvantage](https://getadvantage.app).
