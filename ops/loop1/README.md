# Loop 1 — release ritual (canonical pointers)

**Do not maintain two suites.** This folder is a **thin compatibility layer**.

| Piece | Canonical path | Role |
|-------|----------------|------|
| **Objective gate** (LLM-free) | `ops/evidence-suite.mjs` · `npm run evidence` | 8 capabilities · GREEN/RED · exit 1 if any red |
| **Subjective half** | `ops/loop1/REFUTE-PROMPT.md` | Paste scoreboard into a **second** model |
| **Launch visuals (in-repo)** | `docs/launch/` | Brand-matched HTML (live getadvantage.app chrome) |
| **Launch visual (Claude artifact)** | See Claude handoff session log | Animated web artifact — optional; not in git |

```bash
npm test                 # 40/40 unit/integration
npm run evidence         # 8/8 GREEN — required before advertise/publish
# then: two-model refute with REFUTE-PROMPT.md (per minor)
```

`node ops/loop1/run.mjs` → forwards to `evidence-suite.mjs`.
