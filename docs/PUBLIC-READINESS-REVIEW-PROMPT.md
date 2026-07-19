# Cold-start prompt — is getAdvantage CLI ready to advertise publicly?

Paste the block below into a fresh session (any capable coding agent). It is
self-contained — it does not need the chat that produced it.

---

You are assessing whether a CLI product is ready to be **advertised publicly** (Show HN / Product Hunt / X to a founder audience) — a HIGHER bar than "the code passes review." The question is not "are there bugs" but "if 500 strangers run `npx getadvantage` on their own repos this week, does it make the founder look good or bad?"

## What the product is
- **Repo:** `C:\Users\ben\projects\getadvantage-cli` · GitHub `BellmeJoe/getadvantage-cli` (public) · npm package **`getadvantage`**, currently **0.7.2 live**.
- **What it does:** a read-only PRE-DEPLOY GATE for AI-built apps. `npx getadvantage check` (alias `ship`) scans a repo and returns GO / NO-GO: secret scan (committed keys), dirty-tree guard, package-manifest integrity, typecheck, build, schema-bump, plus `map` (route/surface map) and a safe parallel fan-in conductor. It never mutates the repo and fails silently rather than throwing into a user's flow.
- **ICP:** solo founders and "vibe-coders" shipping apps from Lovable, Bolt, v0, Replit, Base44 — non-experts who `git add .` and deploy. They are exactly the people who leak an `.env` or ship a half-finished tree.
- **Sacred principle — HONESTY:** a check that can't run must say warn/skip, never a silent GO ("not checkable ≠ GO"). Copy must never overclaim. The brand is `getadvantage`; **`npx ship-safe` is a DIFFERENT stranger's npm package** and must never be taught as this product.

## Read first (the product's own record — treat as claims, verify them)
`README.md`, `docs/INDEPENDENT-REVIEW-0.7.2.md` (last review + the 4 fixes that shipped), `docs/RELEASE-0.7.2-REVIEW.md`, `docs/SESSION-HANDOFF-0.7.2.md`, `ROADMAP.md`.

## How to assess (evidence over reading — this is the point)
1. **Cold install, real machine.** In a throwaway dir OUTSIDE the repo, `npx getadvantage@0.7.2` and walk the true first-run: `--help`, `check`, `map`, `demo`, a bare typo, running outside a git repo. Capture the ACTUAL terminal output. Is the first screen self-explanatory to a non-expert? Any dead-end, stack trace, or jargon?
2. **Real target repos (most important).** Clone or scaffold 4–6 repos your ICP actually ships — a Next.js app, a Vite+React app, a Lovable/Bolt-style export, an Express API, a Python/FastAPI service, one repo with a (fake) committed secret. Run `check` and `map` on each. Does the verdict make DOMAIN SENSE? False NO-GO on a clean repo = embarrassing; false GO on a leaked key = reputation-ending. Note every wrong or confusing result.
3. **Cross-platform reality.** The tool was authored/tested on Windows. Sanity-check macOS/Linux path handling, Node version floor, and `spawn` behavior by inspection (and by running if you're on another OS).
4. **The honesty audit.** Line up every user-facing CLAIM (README, marketing copy, in-tool output) against actual behavior. Flag anything that overclaims coverage or certainty. Re-verify the known residuals are still honestly bounded, don't just trust the doc:
   - UTF-16 WITHOUT a BOM is skipped as binary (documented, accepted) — is it silent, and does any copy claim otherwise?
   - README "every tracked + staged file" wording vs the real skip list.
   - odd-byte-length oversized-UTF-16 tail misalignment (minor).
5. **Support & failure surface.** What breaks, and what's the blast radius when it does? (Read-only + silent-fail is the design — confirm it holds.) What will the first 10 GitHub issues be?
6. **Name/category collision.** The `ship-safe` bin alias + the stranger's `ship-safe` npm package: is there any path where a user is told to run the wrong thing? Is the category legible in one sentence?

## Deliver (write to `docs/PUBLIC-READINESS-<yourdate>.md`)
- **One verdict: ADVERTISE NOW / ADVERTISE SOFT (limited/beta framing) / NOT YET** — with the single reason.
- **Punch-list, ranked in two buckets:** (A) blocks advertising — would make the founder look bad in public, (B) nice-to-have polish. Each item: file/repro, why it matters to the ICP, and the smallest fix.
- **Truthful advertising claims:** the exact sentences the founder CAN say (e.g. "catches committed secrets before you deploy") and the ones he must NOT (overclaims). Draft a 2-line honest tagline.
- **First-run screenshot/transcript** of the real cold install as evidence.

## Hard rules
- READ-ONLY on the product: do not edit code, do not `npm publish`, do not `git push`/tag/deploy. Reproductions go in a scratch/temp dir only, never against the repo itself.
- No secrets printed. Fake keys in fixtures are fine; real ones are a blocker (report location, not value).
- Verdicts must rest on things you actually ran, not on the docs' say-so. If you only inspected something, label it "by inspection."
