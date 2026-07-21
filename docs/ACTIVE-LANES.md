# Active lanes (multi-agent lock board)

**Owner fills this before starting an agent session.** One line per open lane.  
Empty board = nobody claims exclusive work — first writer updates this.

| Lane | Owner (tool/person) | Path / concern | Status | Updated |
|------|---------------------|----------------|--------|---------|
| `0.8.3-policy-safety-repair` | Grok Build | `policy.mjs`, `util.mjs`, `checks.mjs` index-blob policy, PEM full-block + incomplete, dirty-tree config carve-out, tests, README, package, social pack | **LIVE 0.8.3** · `done` · commit `4b8fc76` · Actions [29754507154](https://github.com/BellmeJoe/getadvantage-cli/actions/runs/29754507154) success · `npm view` **0.8.3** · cold `npx getadvantage@0.8.3 --version` 0.8.3 · clean GO · secret NO-GO · tag `v0.8.3` · [GitHub Release](https://github.com/BellmeJoe/getadvantage-cli/releases/tag/v0.8.3) | 2026-07-20 |
| `0.8.4-github-native-sarif` | Grok Build | `sarif.mjs`, `action.mjs`, `checks.mjs` findings, `index.mjs` `--sarif`, tests, README, ROADMAP, social pack, NORTHSTAR | **LIVE 0.8.4** · `done` · commit `cd2a34d` · Actions [29761922904](https://github.com/BellmeJoe/getadvantage-cli/actions/runs/29761922904) success · `npm view` **0.8.4** · cold published tarball: version 0.8.4 · clean GO + SARIF · secret NO-GO · fixture secret absent · workflow pins v4/v6 · tag `v0.8.4` · [GitHub Release](https://github.com/BellmeJoe/getadvantage-cli/releases/tag/v0.8.4) · P3 carry: fork-PR upload verify; SARIF leftover nag; `--sarif` overwrite; `--report` path-credential | 2026-07-20 |
| `0.9.0-first-party-action-pr-summary` | Grok Build | root `action.yml`, `action/{main,summary,enforce,install}.mjs`, scrubbed install, eligible-skip red, token ownership, SARIF nonce, `uses: ./` publish gate, published-source identity (npm gitHead), annotated tag peel, hostile tests | **REVIEW_PENDING** · YAML one-line quote repair on `publish.yml` name (`Gate — Action composite (uses: ./)`); gates green locally (65/65, 8/8, pack/cold). Not released. Prior REVIEW_GO fingerprint superseded. Live npm **0.8.4**; social pack 0.8.4 LIVE. Next: independent fingerprint-specific Claude audit | 2026-07-21 |

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
