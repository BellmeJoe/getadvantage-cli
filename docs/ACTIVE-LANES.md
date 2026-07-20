# Active lanes (multi-agent lock board)

**Owner fills this before starting an agent session.** One line per open lane.  
Empty board = nobody claims exclusive work — first writer updates this.

| Lane | Owner (tool/person) | Path / concern | Status | Updated |
|------|---------------------|----------------|--------|---------|
| `0.8.3-policy-safety-repair` | Grok Build | `policy.mjs`, `util.mjs`, `checks.mjs` index-blob policy, PEM full-block + incomplete, dirty-tree config carve-out, tests, README, package, social pack | `REVIEW_GO` · **RELEASE_AUTHORIZED** · candidate **0.8.3** · independent re-review cleared all P1/P2 (48/48 tests · 8/8 evidence · incomplete PEM + index-blob policy hostile checks) · **npm still getadvantage@0.8.2** until gated publish + live verification succeed | 2026-07-20 |

### Rules
1. Before starting: add a row.  
2. Same path already open? **Don’t start a parallel suite** — join or wait.  
3. When done: set Status `done` or delete the row + write a `docs/sessions/…-SESSION.md` (kept local — gitignored, not published).  
4. Canonical tools: evidence = `npm run evidence` · launch HTML = `docs/launch/` only.

### Example rows

| Lane | Owner (tool/person) | Path / concern | Status | Updated |
|------|---------------------|----------------|--------|---------|
| launch-visual | Grok | docs/launch/ | done | 2026-07-19 |
| evidence-gate | Claude | ops/evidence-suite.mjs | done | 2026-07-19 |
