# Inventory migration P3018 recovery plan

**Backlog item:** BI-B92CFED7
**Parent incident:** BI-CF4ADDAC / PR #3706 / self-upgrade SUR-B848B86C
**Decision ledger:** DI-C34A1675FF13, DI-29BB02FE8F5C

## Outcome

Every supported migration-history population advances through the governed
self-upgrade path without deleting inventory evidence:

1. the canonical install whose
   `20260728115900_snapshot_inventory_observation_facts` attempt failed with
   SQLSTATE `23505`;
2. installs that already applied the repair as
   `20260728120000_repair_inventory_entity_index_integrity`;
3. installs that applied the merged
   `20260728130000_repair_inventory_entity_index_integrity`; and
4. clean installs.

The canonical portal must remain on its healthy prior image until the complete
forward repair passes migration, health, inventory integrity, and contributor
preview acceptance.

## Evidence

- `SelfUpgradeRun.runId=SUR-B848B86C` failed before the portal swap while
  advancing `7618827d28a2...` to merged PR #3706.
- `_prisma_migrations` records the failed migration as
  `20260728115900_snapshot_inventory_observation_facts`, SQLSTATE `23505`,
  constraint `InventoryEntity_entityKey_key`.
- Forced heap scans show five rows across two duplicate `entityKey` groups;
  the index remains marked unique, valid, ready, and live.
- The failed snapshot statement was atomic: zero rows contain
  `_dpfObservationSnapshot`.
- Shared `:5433` and `:54329` databases record the former `12:00` repair
  checksum `84704a50...`; merged main contains only the renamed `13:00` repair
  checksum `49751a53...`.

## Architecture decision

The kernel consultation strongly favored the forward-history option over a
runtime SQL workaround or rewriting committed migrations. The tool currently
omits option ids in its response, so the auditable basis is the ordered
contribution ledger: the first option scored `5.890`, margin `4.530`, with
`Never Assume - Verify`, `Architecture Over Shortcuts`, `Research and Use
Standards`, and `Single Source of Truth` as the strongest contributors. No
commandment conflict was reported.

The selected design is:

- keep every merged migration immutable;
- reuse the merged `11:58` damaged-index quarantine from PR #3716, which sorts
  before the failing snapshot and is already the source-owned repair boundary;
- restore the former `12:00` migration using its exact applied bytes and
  checksum so already-applied histories remain first-class;
- add a narrowly allowlisted promoter recovery for only the known failed
  `11:59` statement, after proving it has no durable effects; and
- resume ordinary `prisma migrate deploy` after the failed row is marked
  rolled back.

No direct live SQL repair, migration edit, database reset, emergency override,
or ungoverned portal rebuild is permitted.

## Implementation

### Phase 1 - Regression contracts

Touch:

- `apps/web/lib/self-upgrade/promote-script-contract.test.ts`
- `apps/web/lib/self-upgrade/promote-script-functional.test.ts`
- a focused migration-history/recovery test when the existing suites do not
  cover all four populations.

Prove red:

- the merged quarantine guard sorts before the snapshot;
- the former applied `12:00` migration is absent from source;
- the promoter does not recover the exact failed, effect-free snapshot row;
- a different failure or a partially applied snapshot is never auto-resolved.

### Phase 2 - Forward migration history

Touch:

- restored
  `20260728120000_repair_inventory_entity_index_integrity/migration.sql`.

PR #3716 owns the pre-snapshot quarantine and its PostgreSQL damaged-index
fixture. This branch does not duplicate or supersede that work. Restoring the
former migration uses the exact bytes whose SHA-256 is
`84704a50ad127a0a4823074956f8041cd99f647accbcb39ce17c856fa1f13d90`.
The committed `11:58`, `11:59`, and `13:00` migrations remain byte-for-byte
unchanged.

### Phase 3 - Guarded failed-history recovery

Touch:

- `scripts/promote.sh`;
- a small source-owned recovery helper if needed to keep shell orchestration
  legible and testable.

Before normal deploy, inspect the exact `11:59` migration row. Mark it rolled
back only when all of these are true:

- it is failed and unfinished;
- its log names SQLSTATE `23505` and
  `InventoryEntity_entityKey_key`;
- `applied_steps_count=0`;
- no `_dpfObservationSnapshot` effect exists; and
- exactly one unresolved migration exists in the entire Prisma ledger;
- the failed snapshot checksum matches the committed `11:59` bytes; and
- the candidate pre-snapshot quarantine checksum matches its committed bytes.

Any ambiguity fails closed and leaves the prior portal serving.
After Prisma marks the migration rolled back, verify the authorized database
row ID and prove no unresolved row with that migration name remains.

### Phase 4 - Verification and delivery

1. Run schema validation and migration safety/data-impact guards.
2. Run targeted unit and PostgreSQL migration tests.
3. Exercise all four migration-history populations in the governed shared
   local-CI sandbox.
4. Run the full exact-SHA merged-code pregate and production build.
5. Obtain independent architecture/data review.
6. Open a ready PR, pass `pnpm pr:health`, and merge through the queue.
7. Advance the canonical install only through `/ops/self-upgrade`.
8. Re-run live preflight, forced heap/index checks, and contributor-preview
   acceptance.

## Risks and rollback

- **Incorrect automatic resolution:** fail closed on any mismatch; tests include
  unrelated and partially applied failures.
- **Migration-history drift:** preserve committed bytes and restore the exact
  former checksum rather than synthesizing a lookalike.
- **Repeated repair:** the inventory repair already carries a second-execution
  no-data-change contract; prove it across the restored and current identities.
- **Broader Prisma resolution:** inspect every unresolved row, authorize only
  one exact row/checksum, and verify that row ID after `migrate resolve`.
- **Already-advanced histories:** the merged `11:58` quarantine is a no-op once
  the repaired unique index is trustworthy; restoring the exact former `12:00`
  directory prevents Prisma history drift without replaying applied work.
- **Historical timestamp collision:** allow only the exact former `12:00`
  directory and checksum in the collision guard; any byte drift still fails.
- **Live deployment failure:** the promoter applies migrations before swap and
  retains the existing recovery point, so the healthy prior image remains
  active.

Rollback is source-level only before merge. After merge, migrations remain
forward-only; any correction is another additive migration.

## Independent review

Two independent read-only reviews requested changes before the first candidate
completed its gate:

- the operations review identified the timestamp-collision guard, multi-row
  Prisma resolve scope, and missing checksum authorization;
- the data/architecture review identified canonical snapshots retained on
  already-advanced histories.

The first candidate passed its exact-SHA gate and both reviews after those
findings were addressed. PR #3716 then landed a stronger pre-snapshot
quarantine and PostgreSQL fixture on `main`. This final candidate narrows to
the non-overlapping history restoration and exact one-row authorization with
post-resolution verification; clean, multiple-attempt, effect-bearing, and
already-advanced states remain covered.

The final architecture re-review found that snapshot-name filtering could
overlook an unrelated unresolved Prisma migration. The recovery now inspects
the entire unresolved ledger, requires the snapshot to be its sole row, proves
the ledger is globally clear after resolution, and covers both boundaries with
PostgreSQL fixtures.

A focused DB verification then caught that the recovery fixture's original
`.test.mjs` name was outside the package's Vitest discovery pattern. The final
fixture uses `.test.ts`, and acceptance requires it to execute against
PostgreSQL rather than merely exist in source.

## Documentation impact

This changes contributor and operator deployment behavior, not a user-facing
workflow. Update the existing BET-5 self-upgrade recovery runbook and this
plan. No navigation, route map, prompt, archetype, or public positioning change
is required.

## Backlog coverage

Receipt `cms5gy5sm044g01o62s118dl4` records this plan as atomic under
`BI-B92CFED7`.

| Deliverable | BI | Depends on | Independently shippable |
|---|---|---|---|
| `forward-migration-history` | `BI-B92CFED7` | none | no |
| `guarded-failed-history-recovery` | `BI-B92CFED7` | `forward-migration-history` | no |
| `fleet-verification` | `BI-B92CFED7` | both prior deliverables | no |
