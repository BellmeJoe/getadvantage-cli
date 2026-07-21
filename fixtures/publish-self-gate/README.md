# Publish self-gate fixture

**Purpose:** A minimal, committed, credential-free project tree used only by the
release workflow’s real composite Action self-test (`uses: ./` with
`working-directory: fixtures/publish-self-gate`).

**Why it exists:** The product repository intentionally contains secret-shaped
strings under `tests/` (hostile fixtures for unit and contract tests). Running
`uses: ./` against the product root correctly yields **NO-GO**. That is
honest product behaviour and must stay red. The publish gate therefore dogfoods
the Action against **this** clean tree so release can prove a real runner GO
without weakening consumer secret scanning, without path-suppressing `tests/`,
and without an allowlist for product fixtures.

**Runtime materialization:** The fixture sources are versioned here without a
nested `.git`. `.github/workflows/publish.yml` initializes a nested git
repository in this directory on the runner and commits only these files before
`uses: ./`. The nested repo is ephemeral (runner only) and is never published
as part of the release identity.

**Contract:**

- No credential-shaped content (no live payment-key prefixes, no private-key
  PEM material, no password-bearing database URLs, no cloud tokens).
- Clean `package.json` + tiny app source only.
- Local and CI: materialize nested git → `getadvantage check` / Action → **GO**.
- Product tree (repo root) must still **NO-GO** on intentional test fixtures.

Do not put hostile credentials here. Do not treat this directory as a customer
allowlist or as part of the Action security model.
