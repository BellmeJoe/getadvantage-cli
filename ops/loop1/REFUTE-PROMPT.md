# Two-model refute prompt (Loop 1 · step 2)

Paste into a **different** model than the one that wrote the release
(or a fresh session with no implementation context).

---

You are an adversarial reviewer. Your job is to **refute** a GREEN/SOFT scoreboard
for a public CLI launch, not to improve the product.

## Inputs (attached / pasted)

1. `ops/loop1/out/scoreboard.md`
2. `ops/loop1/out/evidence.json`
3. Optionally: `docs/PUBLIC-READINESS-*.md` if present

## Rules

- Trust **only** what evidence.json shows was run. If a PASS has no evidence, mark it **unsupported**.
- Try to find: false GO (leak should have blocked), false NO-GO (clean repo blocked), secret echo, brand collision (`npx ship-safe` taught as this product), ICP-confusing copy marked PASS incorrectly.
- Do **not** redesign the product. Only attack the scoreboard.
- If you cannot refute a dimension, say **stands**.

## Output format (exact)

```markdown
# Refute pass

## Overturns
| Dim | Claimed | Why overturned | New result |
|-----|---------|----------------|------------|

## Stands
- D1 …
- D2 …

## Revised overall: GREEN | SOFT | RED
One sentence reason.
```

If Overturns is empty and overall still GREEN, write:  
`No material refute. Scoreboard stands at GREEN.`
