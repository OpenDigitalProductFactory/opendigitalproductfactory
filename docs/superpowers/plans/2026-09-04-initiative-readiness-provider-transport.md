---
status: active
---

# Initiative-readiness provider transport isolation plan

**Backlog item:** `BI-362FD051`  
**Workroom:** `WC-D1FB5C79`  
**Design:** `docs/superpowers/specs/2026-09-04-initiative-readiness-provider-transport-design.md`

## Atomic deliverable

One small defect repair introduces the stable GitHub read transport and moves
both initiative-readiness provider consumers onto it. The factory, consumers,
tests, and live replay are not independently shippable: landing only one
consumer would let later immutable-artifact verification fail in the same
framework context that blocked discovery.

| Contract | Implementation | Verification |
|---|---|---|
| `OBJ-IRPT-CONTEXT`, `AC-IRPT-001`, `AC-IRPT-003` | shared transport factory; default-vs-injected selection and cleanup | focused RED/GREEN lifecycle tests |
| `OBJ-IRPT-FAIL-CLOSED`, `AC-IRPT-002` | preserve existing response/error mapping | canonical discovery and repository artifact suites |
| `AC-IRPT-004` | protected merge, release, exact live claim replay | live readiness decision and reviewer route packet |

## Phase 1 — RED lifecycle fixtures

- Add a transport-factory injection seam that is private to tests.
- Assert default discovery creates and closes one transport on success and
  failure.
- Assert an explicit `fetchImpl` neither creates nor closes a production
  transport.
- Add equivalent repository-artifact coverage around its provider read scope.
- Run only the touched tests and retain the expected RED result.

## Phase 2 — GREEN and bounded refactor

- Implement `createGithubReadTransport()` beside the existing repository
  identity and credential helpers using `undici.Agent` and `undici.fetch`.
- Wrap the full discovery and immutable-artifact provider operations in
  `try/finally` ownership scopes.
- Remove repeated default selection from readiness modules; keep injected Fetch
  compatibility and all existing refusal codes.
- Keep at least one fifth of the implementation effort on consolidating the
  duplicated default-client and cleanup logic at this shared boundary.

## Phase 3 — verification and protected delivery

- Run focused and graph-related tests, docs checks, typecheck, production build,
  semantic review, and local merged-code CI.
- Commit with DCO, push, open the protected PR, wait for required checks, merge,
  and publish through the governed release path.
- Verify the live install serves the exact merge commit.
- Replay `BI-7C1F43E3` implementation claim. Success means executable reviewer
  routes are returned; it does not mean any review gate has passed.

## Explicit classifications

- UX: not applicable; no route or rendered surface changes.
- Migration: not applicable; no schema or persisted payload changes.
- Compatibility: existing injected-fetch callers and response types remain.
- Rollback: revert the code commit; no data rollback.
