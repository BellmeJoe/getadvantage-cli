# Social / advertising pack — getadvantage **0.8.2 live** / **0.8.3 REVIEW_GO**

> **Owner:** Grok Build. This is the sole CLI advertising-truth source. Maintain
> it in one assigned lane and keep all 8 evidence checks GREEN. Growth may
> distribute this truth autonomously after its factual, voice, duplication,
> platform, and rate preflight. Grok may release only after the objective product
> gate and independent audit have no open P1/P2.

> **Current release caveat:** npm still reports **getadvantage@0.8.2** until
> gated publish + live verification succeed. Local candidate **0.8.3** has
> independent **REVIEW_GO** (no open P1/P2): repairs untracked/display-fingerprint
> false-GO, private-key full-block auth ids, index-blob-only policy authorization,
> incomplete/truncated PEM stay NO-GO. Do **not** advertise 0.8.3 as live or lead
> with the policy/allowlist surface until `npm view getadvantage version` is
> `0.8.3` and cold `npx getadvantage@0.8.3` is verified. The eight mapped core
> claims below remain the advertising scope.

**For any session that posts, ads, or briefs creators.**  
Do not invent features. The eight claims in the Evidence map are proven by
`npm run evidence`; that result does not automatically prove every client,
workflow, or market statement elsewhere in this pack. Other feature claims need
their named current test or source. Anything marked *roadmap* is not live.

| Field | Value |
|--------|--------|
| **npm (live)** | `getadvantage@0.8.2` (not 0.8.3 until publish + live verify) |
| **Local candidate** | `0.8.3` — independent **REVIEW_GO** · `RELEASE_AUTHORIZED` (tests 48/48, evidence 8/8, pack + cold path green) |
| **Install** | `npx getadvantage` (no signup) — pin `@0.8.3` only after live verify |
| **GitHub** | https://github.com/BellmeJoe/getadvantage-cli |
| **Site** | https://getadvantage.app |
| **Owner truth** | `npm run evidence` → **8/8 GREEN** (2026-07-20, candidate 0.8.3, REVIEW_GO) |
| **Tone** | Soft/beta, demo-led. Not “gitleaks killer.” Not “enterprise control plane day one.” |

---

## One sentence (memorize this)

**AI agents write the code. getAdvantage is the outside checker that says GO or NO-GO before it ships.**

---

## The product in three beats (customer story)

1. **Problem** — AI ships fast. Secrets, `.env`, and dirty trees still ship with them.  
2. **Action** — `npx getadvantage check`  
3. **Outcome** — Plain **GO** or **NO-GO**. Blocked until the leak is gone.

**Visual:** `docs/launch/verdict-hero.html` — sourcemap key → NO-GO → fix → GO.

---

## Feature catalog (what to advertise)

### A. Core — advertise hard (this is why millions *could* care)

| Feature | User-facing line | Command / surface | Proof |
|---------|------------------|-------------------|--------|
| **Pre-deploy GO/NO-GO** | Safe to ship? Yes or no. Exit 0 / 1. | `npx getadvantage check` · alias `ship` (+build) | Evidence: clean-go, catches-the-leak, … |
| **Secret scan** | Catches committed keys — including inside **sourcemaps/dist**. Never prints the full secret. | part of `check` | Evidence: catches-the-leak, build-output-leak |
| **Tracked `.env`** | A committed `.env` is a leak by itself. | part of `check` | Evidence: tracked-env |
| **Dirty-tree guard** | Stops “I deployed my uncommitted mess” (vercel --prod ships the working tree). | part of `check` | Evidence: dirty-tree |
| **Honest skips** | No TypeScript? No fake typecheck fail. Not checkable ≠ silent GO on manifests. | part of `check` | Honesty principle + tests |
| **First-run rescue** | Outside a git repo: points to `demo` / `git init`, not a brick wall. | any command outside repo | Evidence: outside-git-rescue |

### B. Orientation — advertise as “also”

| Feature | User-facing line | Command |
|---------|------------------|---------|
| **Map** | What does this app have? Routes, integrations, schedules — orientation, not a verdict. Client apps get plain language (no Express jargon on a Vite SPA). | `npx getadvantage map` · MCP tool `map` |
| **Architecture** | Where is the code accreting? Advisory only — never blocks ship. | `npx getadvantage architecture` · MCP tool `architecture` |

### C. Agent / multi-model workflow — advertise to builders (demo-led)

| Feature | User-facing line | Command |
|---------|------------------|---------|
| **MCP server** | Exposes the gate to agent clients over MCP; registration examples are documented for Claude, Codex, and Grok Build. Do not say a named client is confirmed without a current end-to-end client test. | `npx getadvantage mcp` · 8 tools; evidence proves protocol list + call |
| **Project brain** | `PROJECT-BRIEF.md` — any model starts cold. Notes preserved across refresh. | `brief` · `init` · `handoff` · `switch` |
| **Safe fan-in** | Parallel agent lanes; land only what stays green **together**. Quarantine “green alone, red together.” | `fan-out` · `fan-in` · **`demo`** (wow) |
| **CI** | Same gate on every PR. | `github-action` · publish pipeline runs tests + evidence |

### D. Do **not** lead with (true but wrong first sentence)

- Full “enterprise control plane” / SaaS cockpit  
- “We make ChatGPT recommend you” (**Get Found** — secondary service / plus×plus DE)  
- “Conflict-free multi-agent coding” (fan-in is honest quarantine, not magic)  
- `npx ship-safe` (different npm package)  
- “Replaces gitleaks / every security scanner”
- Policy/allowlist surface (0.8.3 has REVIEW_GO on repairs; still do not lead ads with allowlist until live 0.8.3 is verified)

---

## Ready-to-post copy

### X / LinkedIn (primary)

```
AI agents write the code.
Who checks it before it ships?

npx getadvantage check
→ GO or NO-GO

Catches live keys (even in sourcemaps), committed .env, dirty deploys.
Local. Open source. No signup.

getadvantage.app
```

### X (with verdict visual)

```
Committed a live key in a sourcemap.
Gate said NO-GO. Fixed. GO.

npx getadvantage check
```

### Show HN title

```
Show HN: getAdvantage – GO/NO-GO before you deploy an AI-built app
```

### Show HN body — use `docs/launch/SHOW-HN.md` (keep claims tight)

### MCP one-liners (builders)

```
claude mcp add getadvantage -- npx getadvantage mcp
```

(Codex / Grok Build: see README registration blocks.)

### Demo hook (power users)

```
npx getadvantage demo
```

One command: collision map → merge train → quarantine the lane that breaks the combined tree.

---

## Positioning vs “millions of users”

| Path to scale | Why |
|---------------|-----|
| **Default step in agent workflows** (MCP + CI) | Millions of AI-built deploys; gate becomes habit |
| **One memorable outcome** (GO/NO-GO) | Shareable, screenshotable, no security degree |
| **Dogfood proof** | Gate caught AWS example keys in its own docs — story sells honesty |
| **Not** “another scan dashboard” | Crowded; we sell **ship decision** |

Cool product for millions = **invisible infrastructure habit**, not a flashy dashboard.  
Roadmap 0.9 (Vite/Supabase ICP failure modes) is the **wedge expansion**; 0.8.x is **table stakes + false-positive hatch**.

---

## Evidence map (for honesty)

| Claim in ads | Must stay GREEN in `npm run evidence` |
|--------------|----------------------------------------|
| Catches committed keys | `catches-the-leak` |
| Catches keys in build/sourcemap | `build-output-leak` |
| Blocks tracked .env | `tracked-env` |
| Clean repo gets GO | `clean-go` |
| Dirty tree blocks | `dirty-tree` |
| Outside git not a dead end | `outside-git-rescue` |
| Vite/React map honest | `client-app-map` |
| Express routes mapped | `server-map-coherent` |

If evidence is red, **do not post**.

---

## Feature depth (for technical threads)

| Surface | What it does |
|---------|----------------|
| `check` / `ship` | Dirty tree, secrets, tracked .env, manifest integrity, typecheck (local tsc only — never npx tsc), optional build, schema-bump warn, overview maps |
| `map` | Estate + API surface + integrations + schedules; stack-aware (Next/Express/Flask/FastAPI/client) |
| `brief` / `handoff` / `init` / `switch` / `gauge` / `ledger` | Portable brain + session continuity |
| `fan-out` / `fan-in` / `demo` | Parallel lanes + safe conductor |
| `mcp` | tools: get_brief, refresh_brief, get_handoff, save_handoff, check, gauge, **map**, **architecture** |
| `github-action` | CI workflow writer |
| `deploy` | Advanced: clean worktree vercel deploy (opt-in) |

Zero runtime dependencies. Node ≥18. Local-by-default.

---

## Brand (visual posts)

- **Live site chrome:** gold signal `#d4a853`, geometric mark, serif “getAdvantage”  
- **Not:** teal rounded A-chip (retired)  
- Assets: `docs/launch/verdict-hero.html`, `gif-storyboard-15s.html`

---

## Sibling products (don’t mix in ads for this CLI)

| Product | Story |
|---------|--------|
| **getAdvantage CLI** (this package) | GO/NO-GO ship gate |
| **getAdvantage site** | Trust / ship / control plane; Get Found secondary |
| **plus×plus** | German market Get Found / sales-led — other repo |

---

*Update this pack only when evidence suite or npm version changes.*
