# Sanitized Contributor-Preview Clone Atomicity

**Backlog item:** BI-B7F28A2F
**Related substrate:** BI-7430E579
**Branch:** `codex/sanitized-clone-atomicity`

## Outcome

The contributor-preview PostgreSQL clone either publishes one complete, privacy-safe relational dataset or leaves the disposable destination empty. PostgreSQL-native search/vector representations never pass through Prisma's unsupported-type decoder and never preserve source-derived sensitive terms.

## Grounding

- Existing runtime design reviewed: `docs/superpowers/specs/2026-05-24-portal-topology-consolidation-design.md` and `docs/operations/dpf-production-runtime.md` keep `dev-portal` as an isolated contributor-only runtime.
- Current code substrate reviewed: `packages/db/src/sanitized-clone.ts`, `packages/db/src/table-classification.ts`, `packages/db/src/sanitized-clone.test.ts`, `docker-compose.yml`, and `docs/user-guide/getting-started/dev-container.md`.
- PostgreSQL's `tsvector` is a native full-text-search representation. Derived `tsvector` and `vector` columns will be projected as `NULL`; source-derived search terms and embeddings are never copied into the preview. Normal destination writes may populate derived fields later through their canonical triggers.
- PostgreSQL documents `TRUNCATE` as transaction-safe, but this clone mixes Prisma writes with external `pg_dump`/`psql` processes, so one database transaction cannot cover the whole operation. The supported architecture is therefore explicit self-cleaning: clear the disposable destination before cloning and clear it again on any failure.
- Provider runtime catalog rows are already classified `restricted`; connection rows must not be copied without their restricted provider parent. `AiProviderConnection` therefore joins the restricted classification rather than creating knowingly orphaned preview data.

## Architecture review (advisory)

- Alignment: extends the existing clone and classification sources of truth; no new persistence model or runtime is introduced.
- Important: shell interpolation of database URLs and table names is incompatible with a reliable security gate. Replace it with argument-array child processes, bounded stderr, and `psql` stop-on-error semantics.
- Important: an error swallowed while copying an audit table can still publish partial data. Audit-copy failure must enter the same cleanup path as every other clone failure.
- Important: cleanup must preserve `_prisma_migrations` so the destination remains schema-ready while containing no application rows.
- Rollback: revert the source commit. The destination database is disposable; a retry repopulates it from the unchanged production source.

## Implementation

### 1. Define the privacy-safe native-column projection

- Add catalog-driven select-list construction in `packages/db/src/sanitized-clone.ts`.
- Project `tsvector` and `vector` columns as typed-safe nulls instead of deserializing or copying source-derived content.
- Keep ordinary PostgreSQL, enum, JSON, array, numeric, and date values on the existing path.
- Unit tests prove a populated native search/vector column is excluded while ordinary columns remain selected and identifiers are safely quoted.

### 2. Make clone publication self-cleaning

- Enumerate destination application tables independently from source tables.
- Resolve both PostgreSQL endpoint identities and refuse to proceed if source and destination are the same database.
- Truncate all destination application tables, restart identities, and preserve `_prisma_migrations` before the clone begins.
- On any clone error, restore the session replication role and repeat the destination reset before rethrowing.
- If cleanup itself fails, surface both the clone and cleanup failures rather than claiming the destination is safe.
- Unit tests prove success resets once, failure resets twice, and cleanup failure cannot be hidden.

### 3. Preserve relational consistency and fail honestly

- Classify `AiProviderConnection` as restricted alongside `ModelProvider`; empty provider/connection tables are consistent and do not expose contract or credential linkage.
- Stop swallowing audit-copy failures.
- Replace shell-based `pg_dump | psql` execution with spawned processes using argument arrays, destination-session replication mode, and `ON_ERROR_STOP`, so malformed input cannot become shell syntax, foreign-key triggers cannot observe per-table load order, and either subprocess failure rejects the clone.
- Tests cover the restricted provider/connection pair and child-process failure behavior through exported deterministic helpers.

### 4. Document and verify the contributor contract

- Update `docs/user-guide/getting-started/dev-container.md`: the clone is privacy-safe, resets the disposable destination before use, and leaves application tables empty after failure; retry is the recovery action.
- Run the DB unit suite, DB typecheck, docs checks, secret scan, and exact-SHA merged-code `pnpm run pregate`.
- Exercise the real sanitized-clone path against disposable source/destination PostgreSQL databases containing populated `tsvector` data; verify success and an injected failure leave no provider/connection orphan.
- Before push, fetch current `origin/main`, sweep open PR file overlap, and require the local-integration evidence record for the exact head SHA.

## Completion evidence

- [x] Native-column projection tests pass (targeted Vitest: 24/24).
- [x] Failure cleanup and cleanup-failure tests pass (targeted Vitest: 24/24).
- [x] Provider/connection classification and consistency tests pass (targeted Vitest: 24/24).
- [x] Disposable PostgreSQL success/failure integration verification passes. A populated `tsvector` fixture with a child row loaded before its parent completed with the derived search value omitted; an induced `NOT NULL tsvector` failure exited non-zero, cleared every application table, and preserved `_prisma_migrations`.
- [x] Documentation checks, DB typecheck, diff check, and tree secret scan pass. The source-only full DB suite reached 1,626 passing tests; its 19 database-bound tests could not use the worktree's non-runtime database and are delegated to the canonical merged-code gate.
- [ ] Exact-SHA merged-code gate passes against current `origin/main`.
- [ ] PR health reports every check terminal/passing with zero unresolved reviews.
