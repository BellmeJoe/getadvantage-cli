# Incident 006 — two admin POST routes shipped with no auth check, and nothing failed the build

**Source:** a widely-documented public pattern, not one repo's incident — the recurring "vibe-coded app shipped without an auth check on a mutating route" class that shows up repeatedly across AI-coding-tool postmortems and security write-ups (open admin endpoints, unauthenticated refund/role-change actions, exposed write routes reachable by anyone who finds the URL). No individual, repo, or company is named; this is a composite reconstruction of that documented pattern, not a specific maintainer's account. Reconstructed independently and run through getAdvantage's live gate.

## What happened

The shape, seen again and again: an agent scaffolds an API with one route properly gated (say, creating a product requires a logged-in session), then later sessions add more routes — an admin refund action, a role-change action — copying the surrounding style but not the auth middleware. Nothing about the new routes looks wrong in isolation: they parse JSON, they return a response, they follow the same file layout as the gated route next to them. Code review, if it happens at all, is scanning for logic bugs, not silently absent middleware. CI has no reason to fail — the routes work exactly as written, they just work for anyone.

The gap survives because nothing in the normal ship path asks the question "does this route check who's calling it" as a distinct check from "does this route do what it says." A passing test suite and a green CI run both say nothing about that.

## Reconstruction: what the gate does with this

Built a throwaway four-route Express app: a read-only product listing, a properly auth-gated product-creation route, and two admin mutating routes (a refund action, a role-change action) added afterward with no auth middleware wired in — the exact "copied the neighbor's shape, not its guard" gap. Ran `getadvantage map` cold against it.

```
Map — what your app has (read-only)
  Detected: Express project — the map reads your server's route definitions (best-effort).
  ✓ Project estate — 1 top-level module · 3 files · languages: JavaScript (2)
  ⚠ API surface map — 4 routes · 1 look gated (session or cron secret) · 3 mutate (write) · 2 mutate without any obvious gate.
      ⚠ /api/admin/refund [POST] — mutates but no auth/session check found
      ⚠ /api/admin/users/:id/role [POST] — mutates but no auth/session check found
      — full map —
      /api/admin/refund  [POST]  PUBLIC + mutates ⚠
      /api/admin/users/:id/role  [POST]  PUBLIC + mutates ⚠
      /api/products  [GET]  public (read-only)
      /api/products  [POST]  auth-gated
```

Both unguarded mutating routes are named directly, with method and path, not buried in a summary count. Also ran `getadvantage check` (the full gate) on the same fixture: the API surface warning appears there too, but the overall verdict still came back **GO — with 2 warnings to eyeball first**, because right now the route-auth check is advisory, not a blocking gate on its own — see the honest limit below.

## What it would NOT have caught

- **It never blocks the ship on its own.** This is the important edge: two unauthenticated mutating admin routes produced warnings, not a NO-GO. `getadvantage check` returned a clean **GO** on this exact fixture. If a team is relying on the gate to hard-stop this class of bug the way it hard-stops a committed secret or a dirty tree, it currently does not — a human has to actually read the warning and decide, same as `map`'s own accretion scan in incident 005.
- **A route framework it doesn't parse.** Detection is best-effort regex over Next.js App Router, Express/Fastify, and Flask/FastAPI. A route defined through a less common router, a dynamically generated route table, or a non-standard middleware pattern can sit outside what the parser recognizes — and the tool says so plainly (client SPAs get an honest "route mapping does not apply" line instead of a guess).
- **Auth middleware it can't recognize as auth.** The check looks for an "obvious gate" — a session check, a known auth middleware name, a cron secret. A custom, oddly-named, or indirectly-wired auth check can read as ungated even when the route is actually protected — a false positive in the safe direction, but still a human has to confirm it, not the tool.
- **Whether the route *should* be public.** Some mutating routes legitimately have no auth — a rate-limited public contact-form submission, for instance. The map flags every unguarded mutating route the same way; it does not know your product's intent, which is exactly why the output says "confirm each warning route is meant to be public" instead of asserting a verdict.

## Try it

`npx getadvantage map` on your own repo takes under a minute, reads nothing but your local route definitions, and never blocks or writes anything. If it mis-fires on your project, open an issue; fixed within a day.
