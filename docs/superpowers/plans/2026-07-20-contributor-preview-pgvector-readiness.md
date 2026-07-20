# Contributor-preview pgvector readiness

**Backlog item:** BI-7430E579
**Epic:** EP-5410E8EA
**Work capsule:** WC-1283613B
**Branch:** `codex/dev-postgres-pgvector`

## Outcome

The isolated Contributor preview cannot start its migration/clone initializer against a PostgreSQL service that is merely reachable but lacks the required `vector` extension. The checked-in Compose contract keeps the pgvector-capable image, readiness proves the extension is available before `dev-init` runs, and the real sanitized-clone path reaches a healthy preview portal.

## Grounding

- `docker-compose.yml` already selects `pgvector/pgvector:pg16` for `dev-postgres`; that image landed with the BET-5 PostgreSQL consolidation. This work preserves that source of truth instead of adding another database service or migration.
- Migration `20260714110000_bet5_pgvector_foundation` correctly owns `CREATE EXTENSION IF NOT EXISTS vector`; committed migrations remain immutable.
- `dev-init` already waits for `dev-postgres` with `condition: service_healthy`, but the current health check proves only TCP/database readiness with `pg_isready`. That allowed Prisma to discover missing extension support too late as P3018.
- The smallest durable boundary is to make `dev-postgres` health mean both database reachability and required-extension availability, then lock that contract with a source test.
- The sanitized-clone atomicity and privacy behavior is already delivered by BI-B7F28A2F. This item verifies that path on the corrected database substrate rather than duplicating clone logic.

## Backlog coverage

- Decision: atomic
- Parent: `BI-7430E579`
- Rationale: the image selection, extension-aware readiness check, regression test, contributor contract update, and end-to-end preview evidence form one independently deployable runtime invariant. Splitting them could leave either an unguarded configuration or an unverified guard.
- pgvector-capable contributor database, extension-aware readiness, documentation, and preview verification -> `BI-7430E579`
- Dependencies: `BI-B7F28A2F` (complete)
- Receipt: `cmrt65kun03da01o9gpo880ld`

The deployed MCP surface does not expose `record_plan_backlog_coverage`, so the receipt uses the governed `record_execution_evidence` compatibility path.

## TDD implementation

1. Add a failing source contract test that proves `dev-postgres` uses the pgvector image, readiness queries `pg_available_extensions` for `vector`, and `dev-init` waits for that health verdict.
2. Change only the `dev-postgres` health check needed to satisfy the contract; keep the migration and service topology unchanged.
3. Update the contributor environment design and setup guide so readiness and recovery expectations match the runtime.
4. Run the targeted contract test, affected script tests, documentation checks, secret scan, and exact-SHA merged-code pregate.
5. Under the governed shared lease, start the isolated `dev-postgres`/`dev-init`/`dev-portal` path and prove the extension exists, migrations and sanitized clone complete, and `/api/health` on the Contributor preview succeeds. Release the lease immediately afterward.

## Architecture and documentation impact

- No schema, migration, route, persistence model, customer-install service, or AI-coworker behavior changes.
- The change strengthens the existing Contributor preview dependency edge and remains behind the `dev` profile.
- Update `docs/superpowers/specs/2026-03-22-dev-container-platform-development-design.md` because its image and health-check statements are stale, and `docs/user-guide/getting-started/dev-container.md` because contributors need the actionable readiness/recovery contract.
- No public-site, operator, provider-onboarding, or platform watchlist change is needed: this is a host-neutral correction to a contributor-only Compose profile.

## Completion evidence

- [ ] Regression test observed failing for the missing extension-aware health check.
- [ ] Targeted and affected source tests pass.
- [ ] Contributor database reports `vector` available and installed after migrations.
- [ ] `dev-init` sanitized clone completes and Contributor preview health succeeds.
- [ ] Exact-SHA merged-code pregate passes.
- [ ] PR health is terminal/passing with zero unresolved review threads.
