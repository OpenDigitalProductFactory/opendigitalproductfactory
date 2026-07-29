# PlatformIssueReport index-integrity repair

**Backlog item:** `BI-854A9A5C`
**Branch:** `fix/platform-issue-report-index-integrity`
**Work Capsule:** `WC-99E24F85`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time - one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Goal

Restore trustworthy `PlatformIssueReport.dedupeKey` uniqueness on every install without deleting issue evidence or breaking public `PIR-*` references. The same release must teach the contributor sanitized-clone preflight to reject physical or semantic source corruption before it starts copying 553 tables.

## Measured failure

- The live heap contains six active duplicate `dedupeKey` groups, 12 rows total. A forced-heap scan found occurrence totals from 2 to 376.
- `PlatformIssueReport_dedupeKey_open_key` is marked unique, valid, ready, and live, but `bt_index_parent_check` reports `XX002: down-link lower bound invariant violated`.
- `20260721180000_repair_collation_drift_index_rebuild_reporting` already named this exact partial index as duplicate-blocked.
- Historical backlog linkage is embedded through public report IDs in `BacklogItem.body`. One duplicate pair has a deferred BI on the older report and the only open BI on the newer report.
- The contributor clone correctly failed while copying `PlatformIssueReport`; filtering the clone would conceal source corruption and leave the live writer unsafe.

## Decisions

- `DI-1E67EDBA1253`: merge compatible recurrence evidence and suppress retained duplicates; do not delete rows, clear identity keys, or filter the preview.
- `DI-5FE9191AADBD`: store retained lineage in typed `mergedIntoId` and `suppressionReason` fields, following existing merge-tombstone substrate on customer, geography, and inventory models.
- `DI-5B6BC9A24BBA`: an incompatible group must not wedge the forward-only fleet chain. Retain and suppress its noncanonical rows without aggregating their fields; preserve every diagnostic payload for later review.
- Application writer serialization, alias-aware reads, and terminal-status single-sourcing are follow-on `BI-83446A46`, not hidden scope in this recovery PR.

## Data contract

Add to `PlatformIssueReport`:

- `mergedIntoId`: nullable indexed self-reference to the canonical row, `onDelete: SetNull`.
- `suppressionReason`: nullable bounded reason. This migration writes only `index-repair-duplicate` or `index-repair-incompatible-duplicate`.

The survivor is the newest `createdAt`, then lexical `id`. This matches the existing P2002 recovery read, which selects the newest active report.

For a compatible group, require identical values for issue identity and ownership fields: `type`, `source`, `status`, `digitalProductId`, `portfolioId`, `agentId`, `featureBuildId`, `triggerKind`, `supportSessionId`, and `upstreamIssueNumber`. Then update only the canonical row:

- `occurrenceCount = SUM(occurrenceCount)`
- `firstSeenAt = MIN(COALESCE(firstSeenAt, createdAt))`
- `lastSeenAt = MAX(COALESCE(lastSeenAt, createdAt))`
- `severity =` highest observed severity (`critical`, `high`, `medium`, `low`)
- `stagedUntilPromoted = bool_and(stagedUntilPromoted)`

For an incompatible group, or a structurally compatible group whose recurrence total cannot fit the existing PostgreSQL `integer` field, do not aggregate. Set only the noncanonical rows to `status='suppressed'`, point `mergedIntoId` at the survivor, and record the incompatible reason. In both paths, IDs, `reportId`, title, description, stack, responder decision, timestamps, upstream fields, and all other diagnostic payloads remain on the retained rows, so an overflowed total remains derivable from the retained individual counters.

## Implementation

### Phase 1 - Dirty-state migration test

Add `packages/db/src/platform-issue-report-index-integrity-migration.test.ts`.

The disposable PostgreSQL fixture must reproduce:

- multiple duplicate groups, one three-row group, and an integer-overflow group;
- compatible and incompatible ownership/lifecycle data;
- null time fields, mixed severity, large occurrence counts, and existing terminal duplicates;
- a non-unique/corrupted-index stand-in that allowed active duplicates;
- existing `mergedIntoId` and reason columns/index/FK to prove a second execution is harmless.

Expected assertions:

- deterministic newest-row survivorship;
- exact structured aggregation for compatible groups;
- no aggregation for incompatible groups;
- every loser retained with unchanged public/diagnostic payload and explicit lineage;
- terminal duplicates remain allowed;
- zero active heap duplicate groups;
- exact lookup and partial-unique index definitions plus self-FK actions;
- index catalog flags plus targeted `amcheck`;
- a direct second active insert fails with `23505`;
- running the migration a second time produces identical rows.

### Phase 2 - Fleet-safe forward migration

Modify `packages/db/prisma/schema.prisma` and add:

`packages/db/prisma/migrations/20260729143000_repair_platform_issue_report_index_integrity/migration.sql`

In one transaction:

1. Add the nullable lineage fields, self-FK, and lineage index idempotently.
2. Take the write-blocking table lock after the governed promoter has quiesced producers, so no producer can race the repair. Do not add a migration-local lock timeout: a timeout would turn transient contention into an unresolved Prisma migration.
3. Drop both dedupe indexes before reading, then force heap-only planning.
4. Build a repair map for every active duplicate group, classify compatibility, and choose the deterministic survivor.
5. Aggregate only compatible survivors; suppress and lineage-link every noncanonical row.
6. Assert zero active heap duplicates.
7. Recreate `PlatformIssueReport_dedupeKey_idx` and the exact partial-unique predicate from committed definitions.
8. Assert catalog readiness and run targeted `bt_index_parent_check` with text-cast results.
9. Abort the transaction if physical or semantic integrity is still unproven.

The migration contains inline remediation before recreating `UNIQUE`, satisfying the fleet-safety guard. It never deletes rows or rewrites public identifiers.

### Phase 3 - One closed preview source-integrity registry

Refactor `packages/db/src/sanitized-clone-source-integrity.ts`; do not create a parallel guard.

- Replace the Inventory-specific entry point with a closed registry of critical source contracts.
- Keep the existing `InventoryEntity_entityKey_key` physical/heap check.
- Add `PlatformIssueReport_dedupeKey_open_key` physical/heap checking through the shared `checkIndexIntegrity`.
- Add a forced-heap semantic query that rejects any duplicate active `dedupeKey`.
- Name the table and index in the thrown error before the clone callback runs.

Add `packages/db/src/sanitized-clone-source-integrity.test.ts` and extend `packages/db/src/sanitized-clone.postgres.test.ts` to prove:

- missing/corrupt PlatformIssueReport index blocks publication;
- semantic duplicates block publication even when catalog flags look healthy;
- a failed source guard leaves the destination empty;
- clean PlatformIssueReport and existing InventoryEntity paths both pass.

### Phase 4 - Documentation and data impact

- Add `docs/data-impact/2026-07-29-platform-issue-report-index-integrity.data-impact.json`.
- Update `docs/user-guide/contributing/dev-container.md` so a source-integrity stop is distinguished from destination clone or disposable preview-volume failure.
- Preserve this plan as the implementation and rollback record.

## Verification

1. Red-green the migration fixture and source-integrity tests.
2. Run targeted DB tests, Prisma validation/generation, DB and web typechecks, migration-safety guard, data-impact guard, and docs guards.
3. Run the exact-SHA merged-code pregate with migrations against the governed `local-integration-ci` slot.
4. After merge and governed self-upgrade, query the live heap with all index scan classes disabled; require zero active duplicate groups.
5. Require both dedupe indexes to be unique/valid/ready/live as applicable and pass targeted `amcheck`.
6. Under an `active-candidate` lease, run `dev-init` to completion, start `dev-portal`, and require `GET :3001/api/health` to succeed.
7. Resume the Marketing coworker desktop/mobile acceptance only after that source proof is green.

## Risks and rollback

- **Fleet wedge:** bounded locking plus total-group remediation prevents a duplicate from aborting index creation. Incompatible groups use retained suppression instead of raising.
- **Evidence loss:** no row or public identifier is deleted; payload fields are untouched on losers.
- **Wrong survivor:** newest-row selection matches the existing runtime recovery rule and preserves the latest projected work.
- **Partial repair:** heap assertions, exact index recreation, `amcheck`, and preview preflight all fail closed.
- **Rollback:** schema additions are backward-compatible and nullable. Data recovery is forward-only: unsuppress a retained row only after deliberately resolving its canonical conflict, then rebuild the partial index. Never edit the committed migration.

## Backlog coverage

- Decision: atomic
- Parent: `BI-854A9A5C`
- Receipt: `cms66j2og02i101o6le71wvc9`
- Rationale: the migration and guard are one recovery contract. Shipping the guard first blocks affected installs; shipping the repair without the invariant leaves recurrence undetected. Typed lineage, data repair, index recreation, and preflight verification must become true in the same release and roll back together.
- Dependencies: none
- Follow-on: `BI-83446A46` owns writer serialization, alias-aware application reads, and terminal-status single-sourcing.
