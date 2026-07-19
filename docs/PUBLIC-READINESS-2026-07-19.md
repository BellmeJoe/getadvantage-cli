# Public readiness assessment: getadvantage@0.7.2

| Field | Evidence |
|---|---|
| Date | 2026-07-19 |
| Package assessed | Live npm package `getadvantage@0.7.2` |
| Repository | `BellmeJoe/getadvantage-cli` |
| Runtime used | Windows 11 Home, Node 20.20.2, npm 10.8.2, git 2.54 |
| Additional runtime | Published tarball executed under Node 18.20.8 |
| Scratch directory | `C:\Users\ben\AppData\Local\Temp\ga-public-readiness-codex-20260719-164953` |
| Product changes | None. Only this assessment document was written. |

**Assessment bar:** if about 500 strangers run the advertised command on their
own repositories this week, does the result make the founder look trustworthy?

## Verdict

# NOT YET

## Single reason

**`GO` is not yet a trustworthy public contract.** The default command can print
`GO ... Safe to ship` without running the repository's production build, and the
published secret scanner can silently return GO for a committed key in skipped
text assets or unsupported encodings. A public pre-deploy safety product cannot
ask non-experts to understand those hidden boundaries after it has told them they
are safe to ship.

This is a higher bar than the internal test suite. The suite passed 37/37, and
the main gate behavior is promising. The public promise is nevertheless wider
than the behavior a stranger receives.

## Most important reproductions

### 1. Default GO did not run a broken build

A clean throwaway Node repo had a valid manifest and this build script:

```json
{ "scripts": { "build": "node -e \"process.exit(7)\"" } }
```

Actual result:

| Command | Exit | Verdict | Build |
|---|---:|---|---|
| `npx getadvantage@0.7.2` / `check` | 0 | **GO** | Not present in the checks |
| `npx getadvantage@0.7.2 ship` | 1 | **NO-GO** | `The build failed` |

The implementation intentionally makes `ship` equivalent to `check --build`
(`index.mjs:317-320`). The problem is the default result text: `check` still ends
with `Safe to ship` (`checks-runner.mjs:165`) even though the production build was
not attempted. The supplied product description also called `check` and `ship`
aliases and included build in both; that claim is false.

### 2. Committed fake credentials produced silent GO results

All fixtures contained the same synthetic Stripe-shaped value. The report below
never includes that value; observed hits were masked as `sk_liv...xxxx`.

| Fixture | Actual verdict | Disclosure |
|---|---|---|
| Normal tracked text file | **NO-GO** | File + masked fingerprint |
| `dist/bundle.js` | **NO-GO** | File + masked fingerprint |
| Tracked `.env` containing no secret | **NO-GO** | Correctly blocks the tracked env itself |
| `app.js.map` | **GO** | Silent extension skip |
| `logo.svg` | **GO** | Silent extension skip |
| UTF-16 LE text without BOM | **GO** | Silent binary skip |
| Oversized BOM UTF-16 file with odd-byte tail alignment | **GO** | Partial scan disclosed, missed key not disclosed |

The extension skips are explicit in `checks.mjs:259-264`; binary/encoding skips
occur around `checks.mjs:269-305` and `checks.mjs:352-379`. This contradicts the
README claim that secret patterns are checked over "every tracked + staged
file" (`README.md:98`). It also makes the summary misleading: the `.map`, `.svg`,
and BOM-less UTF-16 fixtures each reported only the package manifest as scanned,
without naming the skipped tracked file.

### 3. The core safety paths that did work

These are important and should be preserved:

- A committed fake Stripe-shaped key in a normal text file returned **NO-GO**,
  exit 1, and never printed the full value.
- A committed key inside `dist/bundle.js` returned **NO-GO**. The prior silent
  build-directory skip is fixed in the published package.
- A tracked `.env` returned **NO-GO** even when its content was harmless.
- A dirty tracked file returned **NO-GO**.
- A corrupt `package.json` returned **NO-GO**.
- Clean Next, Vite, Lovable-style, Express, and FastAPI fixtures did not receive
  a false blocking verdict.
- `ship` successfully ran real builds for Next, Vite, Lovable-style Vite, and
  Express fixtures.
- `check` and `map` left all six target repositories clean.

## Cold first-run evidence

The npm cache was fresh for the first command.

```text
$ npx getadvantage@0.7.2 --version
npm warn exec The following package was not found and will be installed: getadvantage@0.7.2
0.7.2

$ npx getadvantage@0.7.2              # outside a git repo
x Not inside a git repository. getAdvantage must run in your project's repo.
exit 1

$ npx getadvantage@0.7.2 chekc        # outside a git repo
x Not inside a git repository. getAdvantage must run in your project's repo.
exit 1

$ npx getadvantage@0.7.2 demo         # outside a git repo
Demo - the safe fan-in conductor, end to end
...
lane 1 landed
lane 2 quarantined after the combined build failed
lane 3 stopped on a textual conflict
exit 0
```

Observations actually run:

- The outside-repo error has no next step: no `cd into your project` example and
  no invitation to run `demo`.
- The typo suggestion works inside a repo, but the repo gate masks it outside.
- Help is 125 lines and opens with `land the fleet safely`, while the simplest
  buyer value is pre-deploy GO/NO-GO.
- `demo` is the strongest cold experience, but its dry run says all three lanes
  merge cleanly; the apply pass then finds lane 3's conflict. The dry-run copy
  says it "proves" conflicts, so the showcase overstates its preview.

### First useful run in a Vite/React repo

```text
$ npx getadvantage@0.7.2
getAdvantage - land the fleet safely

Checks
  detected: TypeScript project
  pass Dirty-tree guard
  pass Secret scan
  pass Package manifest
  pass Typecheck
  skip Schema-bump check

Overview
  pass API surface map - No Express/Fastify routes found ... React project.
  pass Agents & integrations map
  pass Schedules & jobs map
  warn Project brief - no project brief yet

Verdict
  GO - with 1 warning to eyeball first.
```

There is no build line. The Vite/Lovable ICP is greeted with Express/Fastify
language even though a client-only SPA legitimately has no server routes.

## Target-repository matrix

All rows are from live `0.7.2`, using `check --json --no-brief-check` and
`map --json`. `ship` was additionally run where a build script existed.

| Target | Check | Ship/build | Map quality | Public-readiness reading |
|---|---|---|---|---|
| Next App Router | GO; ungated POST warned | GO; `next build` passed | Correct route/mutation warning | Strong |
| Vite + React + TS | GO | GO; Vite build passed | Says no Express/Fastify routes | Weak for advertised ICP |
| Lovable-style Vite + React + Supabase | GO; Supabase integration found | GO; Vite build passed | Same irrelevant route copy | Mechanically useful, not native-feeling |
| Express | GO; ungated POST warned | GO; build passed | Correct GET/POST map | Strong |
| FastAPI | GO; ungated POST warned | No build script | Routes correct; typecheck says `generic repo` | Useful map, muddled check copy |
| Repo with committed fake key | **NO-GO** | Not needed | Key masked | Core reputation-saving case passed |

No false NO-GO was observed on the five clean target shapes. A false GO was
observed on the deliberately broken build when using the default command, and
on the skipped secret locations listed above.

## Cross-platform and runtime assessment

### Actually run

- Windows 11, Node 20.20.2: cold npx, all fixture checks/maps, and builds.
- Node 18.20.8: the published tarball reported 0.7.2 and completed a Vite
  typecheck/check with GO. The declared Node floor is therefore supported by
  one real Windows run.
- Local integration suite: **37/37 passed**.

### By inspection only

- Path construction generally uses `node:path`; displayed paths normalize via
  `path.sep`.
- Git is invoked with `execFileSync`, avoiding shell quoting on normal paths.
- Build/install spawning enables `shell` only on Windows so `.cmd` shims work;
  POSIX uses direct executables. This is a sensible split.
- WSL and Docker are unavailable on this machine. macOS/Linux were not run.
- The only GitHub workflow runs on Ubuntu/Node 22 to publish, but it does **not**
  run `npm test`. There is no Windows/macOS/Linux test matrix.

Conclusion: no cross-platform defect was found by inspection, but public
cross-platform readiness is unproven.

## Honesty audit

| User-facing claim | Evidence | Assessment |
|---|---|---|
| Bare `npx getadvantage` runs pre-deploy checks | True, but excludes build | Incomplete for the meaning of `Safe to ship` |
| `check` and `ship` are aliases including build | False | `ship` adds build; `check` does not |
| Secret patterns over every tracked + staged file | False | Silent extension and binary skips |
| Oversized files are partially scanned and disclosed | Mostly true | Disclosure worked; known odd-byte UTF-16 tail can still miss |
| Not checkable is not silently GO | False at the product boundary | Skipped credential-bearing assets still contribute no warning |
| `check`/`map` are read-only | True in the six fixture repos | Repositories stayed clean |
| The CLI as a whole is read-only | False | `brief`, `handoff`, `init`, `fan-out`, `github-action`, and `deploy` intentionally write/act |
| Local by default without `--report` | Consistent by inspection | Safe to say, bounded to CLI behavior after npx installation |
| Fan-in dry-run proves textual conflicts | False in the bundled demo | Lane 3 was called clean in preview, then conflicted during apply |
| `npx ship-safe` is this product | Explicitly denied | README/help correctly teach `getadvantage`; foreign package is live at 9.5.2 |

## Punch-list

### A. Blocks public advertising

| Priority | File/repro | Why it matters to the ICP | Smallest credible fix |
|---|---|---|---|
| A1 | `index.mjs:317-320`, `checks-runner.mjs:165`; broken-build fixture: default GO, `ship` NO-GO | Non-experts will run the bare README command and treat `Safe to ship` literally | Make bare `npx getadvantage` run the full build gate. If fast `check` remains, its verdict must say `CHECK COMPLETE - production build not run`, never `Safe to ship`. Lead every quick-start with `ship`. Add a regression test. |
| A2 | `checks.mjs:259-305,352-379`; `.map`, `.svg`, BOM-less UTF-16 false-GO fixtures | The product's core trust claim fails silently on committed files; one public leak invalidates the brand | Scan text-capable `.map`/`.svg`; detect common BOM-less UTF-16; count and name every skipped file. If any tracked file cannot be scanned, emit a warning and remove the absolute README claim. Add all four fixtures to tests. |
| A3 | `index.mjs:384-388`; cold run outside git | The most likely curious first run is a dead end | Say exactly: `Run this inside your project folder`, show `cd path/to/app`, and offer `npx getadvantage demo` as the 60-second tour. Resolve help/version/demo/typos before the repo gate. |
| A4 | `detect.mjs:173-205`, `overviews.mjs:655`; Vite and Lovable-style fixtures | The named ICP sees an irrelevant Express message and assumes the product does not understand its app | Detect Vite/Lovable-style SPA explicitly. Render `No server API routes in this client app; route mapping does not apply` and make the useful lanes prominent. Do not imply deep Lovable/Bolt support until it exists. |
| A5 | `.github/workflows/publish.yml`; no test job/matrix | Five hundred strangers include macOS/Linux users; current confidence is Windows plus inspection | Add a test workflow for Node 18/20/22 on Ubuntu, Windows, and macOS. Make publish depend on tests. Re-run the public fixture matrix on at least Ubuntu before launch. |

### B. Nice-to-have after the trust blockers

| Item | Evidence / impact | Smallest fix |
|---|---|---|
| Fan-in preview accuracy | Demo dry-run calls lane 3 clean; apply finds conflict | Simulate the same sequential merge order in preview, or explicitly say per-lane-against-base preview cannot predict later train conflicts |
| False-positive workflow | A key-shaped documentation example returned NO-GO | Provide a documented, narrow ignore/allow mechanism with loud disclosure; never silently suppress |
| Missing dependencies | Declared TypeScript without `node_modules` warns but overall verdict is GO | For `ship`, block or require explicit acknowledgement when an applicable compiler cannot run |
| FastAPI wording | Typecheck says `generic repo` although map detects FastAPI | Share stack detection across all check copy |
| Vercel-specific dirty copy | Every dirty repo says a `vercel --prod` would ship it | Say `your deploy command` unless Vercel is actually detected |
| Category focus | 125-line help and `land the fleet safely` lead with advanced orchestration | Lead with `pre-deploy GO/NO-GO`; move brain/MCP/fan-in under advanced commands |
| `ship-safe` alias | Package still installs a local `ship-safe` binary while the public npm name belongs to someone else | Remove in the next breaking release; until then keep the current explicit warning |
| Read-only wording | Only gate/map are read-only; several commands write or deploy | Say `the gate is read-only`, not `the CLI never mutates` |

## Likely first ten GitHub issues

1. "It said GO, but `npm run build` fails."
2. "I ran it from Desktop/home and it only says not a git repo."
3. "Why is my Vite/Lovable app being checked for Express routes?"
4. "Why did a key-shaped example in my README block shipping?"
5. "Does GO still count when TypeScript could not run?"
6. "My secret was in a source map/SVG and the scanner missed it."
7. "Does this support macOS/Linux? There is no test matrix."
8. "The fan-in preview said clean, then apply conflicted."
9. "Why does a FastAPI repo say generic repo?"
10. "Is `ship-safe` the same tool? Which npm package should I install?"

## Claims the founder can say today

Use these only in a limited technical beta or direct conversation, not a broad
launch until A1 and A2 are fixed:

- "`npx getadvantage ship` runs a local GO/NO-GO gate, including your own
  production build."
- "It catches common committed-secret patterns and tracked `.env` files, and
  masks any credential-shaped value it reports."
- "It blocks dirty tracked work and invalid `package.json` files."
- "Route mapping is best-effort for Next App Router, Express/Fastify, and
  Flask/FastAPI."
- "The gate is read-only and local by default; run reporting is opt-in."
- "Use `getadvantage`. `npx ship-safe` is a different npm package."

## Claims the founder must not say

- "Run `npx getadvantage` and know you are safe to ship."
- "`check` and `ship` are the same full gate."
- "Scans every tracked and staged file."
- "Never misses leaked secrets" or "secures/certifies your app."
- "Built for Lovable/Bolt/v0/Replit end-to-end" without a precise scope limit.
- "Fan-in preview proves all conflicts before touching main."
- "Cross-platform verified."
- "The entire CLI never writes to your repo."

## Honest two-line tagline

> **A local pre-deploy gate for AI-built apps.**  
> Run `npx getadvantage ship` to check common committed-secret patterns, dirty work, type errors, and your production build before you deploy.

## Channel recommendation

| Channel | Recommendation |
|---|---|
| Private users / direct founder calls | Continue learning, with explicit limitations |
| X beta thread | Wait for A1 and A2; then use beta framing |
| Show HN | Wait for A1-A4 plus Ubuntu evidence |
| Product Hunt | Wait for all A items and one clean cold-user walkthrough |

## Evidence inventory

Actual artifacts are retained in the scratch directory named at the top:

- Cold command transcripts: `cold-*.clean.txt`, `06-demo-outside-git.txt`
- Target matrix JSON/stderr: `matrix/`
- Adversarial secret fixtures/results: `adversarial/`, `adversarial-results/`
- Failure-surface fixtures/results: `failure-surface/`, `failure-results/`
- Published npm tarball: `published-package/`
- Node 18 check: `node18-check.json`
- Full local suite output: `local-test-suite.txt` (`37/37 scenarios passed`)

Anything described as cross-platform behavior beyond Windows and the Node 18
runtime check is explicitly by inspection, not a claimed live result.
