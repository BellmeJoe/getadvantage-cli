# Cold review — Grok deliverables (ec670df) · Claude, 2026-07-19

**Reviewer:** Claude (cold session, per lead prompt in `2026-07-19-GROK-DELIVERABLES-REVIEW.md`)
**Scope:** docs + ops only (CLI 0.7.3 already shipped; not re-reviewed)
**Method:** §5 verification commands run locally, then a 15-agent review across five dimensions (Show HN claims, brand, ops code, owner docs, cross-doc consistency) with every finding adversarially verified against the repo. 10 findings confirmed, 0 refuted.

---

## Verdict

| Label | Verdict |
|---|---|
| **DOCS/OPS** | **SHIP** (already on main; nothing warrants revert) — with 2 fixes recommended, one urgent |
| **MARKETING** | **NOT YET** — 3 honesty/copy fixes in launch assets before posting |
| **SITE BRAND** | **PENDING** — `getadvantage` repo has 51 dirty files on a detached HEAD (f46f385); brand purge uncommitted |

**Nothing was published or pushed by this review.**

---

## §5 verification — all pass

| Check | Expected | Actual |
|---|---|---|
| `git log -1` | ec670df or successor | a926a68 (handoff doc) on top of ec670df, `main == origin/main`, clean tree |
| `npm view getadvantage version` | 0.7.3 | 0.7.3 ✓ |
| `node index.mjs --version` | 0.7.3 | 0.7.3 ✓ |
| `npm test` | 40/40 | 40/40 ✓ |
| `npm run evidence` | 8/8 GREEN, exit 0 | 8/8 GREEN ✓ |
| `npm run owner` | version line + evidence | evidence runs ✓ — but version check is broken on Windows (major finding below) |

§9 checklist: ec670df on origin/main ✓ · evidence 8/8 ✓ · SHOW-HN claims ⊆ evidence (verified claim-by-claim, incl. "nothing leaves your machine" traced to the only `fetch` in the codebase behind `--report`) ✓ · launch HTML gold brand, zero teal hexes ✓ · loop1 is a 17-line spawnSync wrapper, no second suite ✓ · owner docs mostly clear (minors below) · site brand **not** committed → listed open ✓

---

## Major findings (2)

### 1. Docs call push=publish an "open founder decision" — it is the live behavior
`.github/workflows/publish.yml` has been on origin/main since bc10b30: push to main + version bump ⇒ `npm publish --access public`, **with no test or evidence gate**. Handoff §8 and RECONCILE-PARALLEL both frame this as a pending proposal ("`docs/publish.yml.proposed` if present" — it IS present, committed in 5884c58). A cold reviewer who bumps the version for the 0.8 backlog and pushes triggers an ungated npm publish. This also makes §8 item 1 (wire `npm run evidence` into publish CI) the single most urgent open item.

### 2. `npm run owner` version check silently dead on Windows
`ops/owner-status.mjs:18` uses `execFileSync("npm", …)` without a shell; on win32 npm is `npm.cmd`, spawn throws ENOENT (post CVE-2024-27980 Node behavior). Confirmed by execution: it prints `Live npm: getadvantage@(offline?)` then `⚠ differs from live` even though local == live == 0.7.3. The owner-transparency script's headline feature never works on the owner's own platform, and a lookup failure is presented as a version mismatch. Fix: `shell: process.platform === "win32"` (args are static literals) + distinguish "couldn't reach npm" from "differs".

---

## Minor findings (8, all confirmed)

**Launch assets (fix before Show HN/X posting):**
1. `SHOW-HN.md` body/short-version use `**bold**`, ```` ```bash ```` fences, `>` quotes — HN renders none of these; pasted as-is the post shows raw markdown. Add a plain-text variant.
2. `verdict-hero.html` + storyboard beat 05 show "✓ build passes" under bare `$ npx getadvantage`, which runs typecheck only (`--build`/`ship` required). For a tool whose pitch is honest gating, show `ship` or relabel "typecheck passes".
3. Hero subhead is design meta-commentary ("Same card language as getadvantage.app — …") that ships inside the screenshot. Replace with audience copy.

**Smaller:**
4. `docs/launch/README.md` calls the folder "offline" but both HTMLs load 4 faces from Google Fonts — an offline screenshot silently falls back to Georgia/Consolas (off-brand type).
5. `evidence-suite.mjs` `--json`: `process.exit()` right after `stdout.write` can truncate piped JSON on Windows; use `process.exitCode` instead.
6. Owner docs never mention `npm run owner` — the one command purpose-built for the owner is undiscoverable from OWNER-OS.
7. OWNER-OS jargon without translation for a non-coder ("Fan-in" never defined; "vercel --prod = Working Tree").
8. RECONCILE-PARALLEL marks evidence-suite/ACTIVE-LANES as pending/optional, but ec670df — the commit shipping the doc — commits all of them; stale status markers contradict the handoff.

**Nits (not blocking):** X caption narrates the staged fixture first-person as a real "live key" incident (expect "staged screenshot" callouts near HN); `docs/launch/README.md` points to `docs/BRAND.md` which lives in the other repo (say so); ACTIVE-LANES example rows aren't valid markdown table syntax; OWNER-OS "Tests grün?" row has an empty answer cell; WHAT-IT-DOES header tells strangers to run the repo-only `npm run evidence`.

---

## Recommended order of operations

1. **Gate the publish CI** (evidence + tests before `npm publish`) or switch to the tag-triggered proposal — before any 0.8 work touches package.json. Correct the two docs that call this "open".
2. Fix `owner-status.mjs` Windows spawn + wording.
3. Apply the three launch-asset fixes, then MARKETING READY (soft/beta) holds.
4. Commit/deploy the site brand purge (51 dirty files, detached HEAD) or explicitly park it.

---

## Addendum — fixes applied (2026-07-19, same session, founder-requested)

All findings above (both majors, all minors, and the actionable nits) were fixed
in the working tree on founder request; item 4 (site repo) remains open.
Verified after the fixes: `npm test` 40/40 · `npm run evidence` 8/8 GREEN,
`--json` complete with exit 0 · `npm run owner` now reports
"0.7.3 ✓ matches live" on Windows · loop1 wrapper exit codes intact ·
publish.yml parses and gates publish behind `npm test` + `npm run evidence` ·
hero renders with audience copy and honest "typecheck passes" lines.
Version stays 0.7.3 — **no publish is triggered by these changes**.
Committed on founder request same day (see git log).

Dogfood follow-up (founder ran `node index.mjs check` on this repo): the
NO-GO's secret hit was AWS' doc key `AKIAIOSFODNN7EXAMPLE` written out in
ROADMAP.md's own false-positive backlog item — now elided there, secret scan
clean. Remaining NO-GO is the dirty tree (these uncommitted fixes; clears on
commit). The `map` "/items ungated POST" warning is the CLI parsing its own
test-fixture route strings in `tests/run.mjs` / `ops/evidence-suite.mjs` —
candidate 0.8 item: map should label or skip fixture/test paths. `npx
getadvantage` works from a clean dir on Windows (verified against npm at
0.7.3); the local "bin not found" only happens inside this repo, where npx
prefers the unlinked local package.

*Committed with the fixes on founder request (2026-07-19).*
