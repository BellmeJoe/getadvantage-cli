# GROK AUDIT REQUEST — L2 proof record v2 repair

State: **REVIEW_PENDING**
Date: 2026-09-09
Branch: `lane/L1-approval-agent`
Product fingerprint: **`d8f7c7c`** (`fix(proof): close Astra P1s on nested secrets, deleted links, and junctions`)
Candidate repaired: `0adc6e9` (board commits sit on top of the product commit)

Do not release. Do not bump the version. Do not push `main`. `origin/main` stays at `1bd5dce`.

## Gates (measured after the product commit)

- `node tests/run.mjs` → **439/439**, `SUITE_EXIT:0`
- Arithmetic: entry was **425**; this repair added **14** scenarios (`425 + 14 = 439`). The `scenarios.length` pin was remasured to 439 for that reason. No other self-referential pin moved.
- `npm run evidence` → **8/8 GREEN**, `EVIDENCE_EXIT:0`
- Porcelain after the product commit: `M docs/NORTHSTAR.md`, `?? docs/PRODUCT-DIRECTION-2026-09-07.md` only. Both preserved. Never reset.

## Changed files (product commit `d8f7c7c`)

- `approve.mjs`
- `tests/run.mjs`
- `README.md`

Untouched (verified with `git diff --name-only` before commit): `checks.mjs`, `scan.mjs`, `sarif.mjs`, `action.mjs`, `gate.mjs`, `policy.mjs`, `mcp.mjs`, `index.mjs`, `package.json`, `.github/workflows/*`, `docs/launch/SOCIAL-MEDIA-PACK.md`, `docs/NORTHSTAR.md`, `docs/ACTIVE-LANES.md`. No version bump. No tag. No publish.

## HEAVY panel

Leader plus four read-only specialists. **All four returned.** No contract deviation.

| Role | Returned |
|---|---|
| product/architecture | yes |
| hostile security | yes |
| test/cold-path | yes |
| adoption/owner-truth | yes |

One line of work. No competing candidates.

## Decisions

**P1(a) nested types — recurse, then refuse remaining nested values.** The complete record is walked with the existing lookaround anchors (`CREDENTIAL_FIELD_RE`). Nested arrays/objects that contain a credential-shaped string are a secret refusal naming the top-level field only. Nested values that are not credential-shaped are then refused as “not a name string.” Diagnostics never interpolate an unvalidated value (including `version`). Field names in errors are allowlisted to `[A-Za-z0-9._-]{1,80}` and themselves scanned.

A caller who legitimately passes an array (`model: ["claude-opus-5"]`) sees exit 1: *The model value is not a name string, so it was not exported.* If that array contains a credential-shaped string, they see the secret-shaped-field refusal instead. The key is not copied into stderr, stdout, packet, or HTML. CLI flags and `--action-file` still only copy strings; MCP `ownString` is unchanged.

**P1(b) chain — missing link after the chain starts is a failure.** Unbound `prevDigest` is legal only as a v1 prefix. After the first well-formed `prevDigest`, every later line must carry a 64-hex digest that matches the previous raw line bytes. Missing, empty, wrong type, or malformed is refuse, not `unboundCount++`.

Three published states:

| `chain.status` | `chain.ok` | CLI / HTML `Chain:` |
|---|---|---|
| `unverified` | `false` | `unverified` |
| `partial` | `false` | `partial` |
| `verified` | `true` | `intact` |

Broken files are not exported. `Chain: intact` and `chain.ok: true` only when every line is bound.

**Write-time checkpoint.** Append writes `<id>.jsonl.tip` `{ lineCount, tipDigest }` under the same exclusive lock. Export refuses a present checkpoint that does not match. A missing tip is allowed (0.15.3 files and planted v1/v2 fixtures never had one). Residual, disclosed in `packet.limitations`: an attacker who rewrites both the ledger and the checkpoint consistently is outside this check. Export-time hashing alone cannot authenticate the terminal digest. The tip does catch a flipped terminal line on a CLI-written file.

**P1(c) containment.** Filesystem-level: `lstat` refuses symlinks/reparse points (Node reports junctions as symlinks on this host); `realpath` of the parent must stay under `.getadvantage/approvals/`. Confirmed live with `mklink /J` (directory symlink `mklink /D` still EPERM here). An approvals-dir junction that redirects writes outside the marker is refused; nothing is written to the junction target.

## Closed list

### P1s

| ID | Verdict | Evidence |
|---|---|---|
| P1(a) nested credential | **fixed** | Array-wrapped live-shaped key refused; secret absent from stderr/stdout/packet/HTML independently of the error phrase. Extra nested key with clean named fields also refused. Unsupported `version` is not interpolated. Mutation: see below. |
| P1(b) deleted link | **fixed** | Two-line CLI ledger; flip line 1 and delete line 2 `prevDigest` → exit 1, not `Chain: intact`. Malformed `prevDigest` after chain start → exit 1. Tip mismatch on a flipped terminal line → exit 1. Mutation: see below. |
| P1(c) lexical containment | **fixed** (not refuted) | `mklink /J` of `.getadvantage/approvals` to an outside folder: export exit 1, no packet/html in the target. `/D` still EPERM; `/J` is the evidence this host can produce. |

### P2s (Astra’s eight; the size/hash pair is one numbered item with two defects)

| ID | Verdict | Evidence |
|---|---|---|
| P2.1 v1 `chain.ok: true` / HTML “intact” | **fixed** | Wholly v1 → `status: unverified`, `ok: false`, CLI and HTML `Chain: unverified`. Mixed v1+bound suffix → `partial`, `ok: false`. CLI-built two-line file → `verified` / `intact`. |
| P2.2 unbounded record + 256 KiB hash tail | **fixed** | One cap `PROOF_RECORD_MAX_BYTES = 256 KiB` on read and write. Oversize line refused on export and `appendProofRecord`. `lastJsonlLine` hashes the complete preceding line or refuses; it no longer hashes a 256 KiB tail. |
| P2.3 UTF-8 64 KiB chunk boundary | **fixed** | Newlines split on bytes; complete lines decoded with `TextDecoder({ fatal: true })`; hash is the original line bytes. A 2-byte character starting at offset 65535 still exports with `lineDigest` equal to `sha256(raw bytes)`. |
| P2.4 concurrent resolve | **fixed** | Exclusive `wx` lock around read-tail / hash / append / tip. Two overlapping `--resolve` processes both exit 0; export is 3 bound lines, `verified`. |
| P2.5 `source.sha256` TOCTOU | **fixed** | File hash is updated on the same fd as the line walk. Packet `source.sha256` equals `sha256` of the bytes that were parsed. |
| P2.6 JSON ok / HTML fail | **fixed** | Both outputs staged to `.tmp`, published together, backups kept until both succeed. HTML dest as a directory: export fails, prior packet preserved, no new pair. `Nothing was written.` only when nothing new was published; partial is named if rollback fails. |
| P2.7 `latest` after resolve | **fixed** | After `approve` (model + data class) then `--resolve --allow --by`, `latest.model` / `latest.dataClass` come from the decision; outcome, approver, and timestamp stay the resolution’s. Copied onto the resolution line at write as well. |

### P3

**fixed.** Secret-absence is asserted independently of the error phrase (the `|| /looks like a secret/` hatch is gone). Nested array and extra nested key fixtures exercise arbitrary keys. Cap is tested at **10,001** lines (the 10,000-success fixture remains a throughput test, not the cap).

## Mutations proved (throwaway worktree)

Worktree at `%TEMP%\ga-l2-mut-*`, detached from `HEAD`, new tests copied in, product file taken from `0adc6e9`, then the fix restored. Worktree removed.

| Mutation | Broken product | Restored fix |
|---|---|---|
| **P1(a)** `0adc6e9:approve.mjs` (string-only `asString` / no nested walk) against `proof: nested array credential is refused…` | **RED** (`null !== 'model'`) exit 1 | **GREEN** exit 0 |
| **P1(b)** `0adc6e9:approve.mjs` (missing `prevDigest` → `unboundCount++`, `chain.ok` hardcoded true) against `proof: deleting prevDigest after the chain starts is a failure…` | **RED** (`0 !== 1`, export still exit 0) | **GREEN** exit 0 |

A test that passed against the broken code was not used as coverage for these two P1s.

## Residual (disclosed, not claimed closed)

An attacker who rewrites every `prevDigest` consistently **and** the `.jsonl.tip` sidecar can still present a verified chain. Same directory, same writer. This is tamper evidence, not a signature. Named in `packet.limitations`.

## Both reviews run again against `d8f7c7c`.
