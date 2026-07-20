# Active lanes (multi-agent lock board)

**Owner fills this before starting an agent session.** One line per open lane.  
Empty board = nobody claims exclusive work — first writer updates this.

| Lane | Owner (tool/person) | Path / concern | Status | Updated |
|------|---------------------|----------------|--------|---------|
| `0.8.3-policy-safety-repair` | Grok Build | `policy.mjs`, `util.mjs`, `checks.mjs` index-blob policy, PEM full-block + incomplete, dirty-tree config carve-out, tests, README, package, social pack | **LIVE 0.8.3** · `done` · commit `4b8fc76` · Actions [29754507154](https://github.com/BellmeJoe/getadvantage-cli/actions/runs/29754507154) success · `npm view` **0.8.3** · cold `npx getadvantage@0.8.3 --version` 0.8.3 · clean GO · secret NO-GO · tag `v0.8.3` · [GitHub Release](https://github.com/BellmeJoe/getadvantage-cli/releases/tag/v0.8.3) | 2026-07-20 |
| `0.8.4-github-native-sarif` | Grok Build | `sarif.mjs`, `action.mjs`, `checks.mjs` findings, `index.mjs` `--sarif`, tests, README, ROADMAP, social pack, session | **RELEASING · REVIEW_GO** · candidate **0.8.4** · final Fable recheck: 0 P1/P2, tests **57/57**, evidence **8/8**, pack/cold green, diff-check clean · gated CI publish and live verification in progress | 2026-07-20 |

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
