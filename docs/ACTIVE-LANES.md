# Active lanes (multi-agent lock board)

**Owner fills this before starting an agent session.** One line per open lane.  
Empty board = nobody claims exclusive work — first writer updates this.

| Lane | Owner (tool/person) | Path / concern | Status | Updated |
|------|---------------------|----------------|--------|---------|
| — | — | — | idle | 2026-07-19 |

### Rules
1. Before starting: add a row.  
2. Same path already open? **Don’t start a parallel suite** — join or wait.  
3. When done: set Status `done` or delete the row + write a `docs/sessions/…-SESSION.md`.  
4. Canonical tools: evidence = `npm run evidence` · launch HTML = `docs/launch/` only.

### Example rows

| Lane | Owner (tool/person) | Path / concern | Status | Updated |
|------|---------------------|----------------|--------|---------|
| launch-visual | Grok | docs/launch/ | done | 2026-07-19 |
| evidence-gate | Claude | ops/evidence-suite.mjs | done | 2026-07-19 |
