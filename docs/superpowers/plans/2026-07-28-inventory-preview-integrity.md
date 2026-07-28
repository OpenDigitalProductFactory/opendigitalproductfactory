# InventoryEntity heap/index integrity repair

**Backlog item:** `BI-CF4ADDAC`
**Work capsule:** `WC-A454B00D`
**Branch:** `fix/inventory-preview-integrity`
**Plan status:** implementation-ready; three independent review rounds completed and their P1 findings are incorporated below

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time - one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Goal

Restore one trustworthy, canonical `InventoryEntity` per `entityKey` on every install without deleting discovery history, converge all dependent evidence onto the canonical records, rebuild the corrupted unique index, stop discovery writes if heap-visible duplicates ever recur, and fail contributor-preview publication before cloning from an unhealthy source.

The repair is complete only when the live install passes the existing `amcheck` guard and a governed contributor preview completes migrations, sanitized clone, and portal health.

## Evidence and root cause

The live source has 565 heap rows but 563 distinct `entityKey` values. Forced heap scans expose three rows for `network_interface:iface:eth0:172.18.0.6` and two for `network_interface:iface:Ethernet_2:192.168.0.200`; index-backed reads omit at least part of that state even though `InventoryEntity_entityKey_key` is marked unique, valid, ready, and live.

This is the measured collation-drift incident documented in `docs/runbooks/2026-07-20-collation-drift-index-corruption.md`, not an unexplained application race:

- the database volume was initialized under Alpine/musl and later served by Debian/glibc;
- the text comparator changed beneath existing B-trees;
- an upsert could miss the heap row and insert another row because the same damaged index failed to reject it;
- migration `20260721180000_repair_collation_drift_index_rebuild_reporting` explicitly reported `InventoryEntity_entityKey_key` as duplicate-blocked and deferred this table for domain-specific survivorship.

The five duplicate rows carry real history. Live reference counts include 987 `DiscoveredItem` rows, fingerprint observations, triage decisions, quality issues, and ten active relationship rows. Projecting duplicate entity ids onto canonical ids creates four relationship-tuple collision groups, so a direct FK update would violate `InventoryRelationship_fromEntityId_toEntityId_relationshipT_key`.

The duplicate entity payloads are semantically equal within each live group except for observation timestamps and `lastConfirmedRunId`. That supports stable oldest-row identity with merged observation freshness.

## Decision

WWMD consultation `DI-86820DA28C13` compared:

1. quarantine entity keys only and leave dependent history fragmented;
2. merge dependent history into stable canonical records while retaining inactive tombstones;
3. delete duplicate rows and rebuild the index.

The kernel recommends **merge-and-tombstone** with composite `15.687`, margin `5.637`, high confidence, strong structured coverage, and no commandment conflict. The strongest contributors were **Ship Real Functionality** and **Research and Use Standards**.

## Design

### Canonical entity survivorship

For every heap-visible duplicate `entityKey` group:

- keep the row with the earliest `firstSeenAt`, then lexical `id`, as the stable canonical identity;
- retain the minimum `firstSeenAt`, maximum `lastSeenAt`, and the `lastConfirmedRunId` from the latest observation;
- snapshot each row's `name`, `status`, `providerView`, and `discoveredViaConnectionId` before convergence, then restore the newest coherent observation tuple onto the canonical row;
- keep that snapshot current with a temporary insert/update trigger if the repair migration fails and the old runtime resumes writes before an upgrade retry; the trigger ignores the repair's `superseded` tombstone transition;
- preserve explicit/human-confirmed identity and support fields on the canonical row;
- fill null or `unknown` canonical fields from the latest non-null, non-`unknown` observation;
- merge JSON properties with the latest observation winning only for discovery-owned keys, remove the temporary observation snapshot from the canonical row, and retain each tombstone's original snapshot;
- never move or change a primary key.

Every loser remains as an explicit inactive tombstone:

- rename `entityKey` to a collision-checked `__dpf_quarantined__<id>__<original-key>` value;
- set `status = 'superseded'` and `mergedIntoId = <canonical-id>`;
- retain the complete payload and add bounded repair lineage under `properties._dpfIntegrityRepair` with the BI, original key, canonical id, and repair version.

`InventoryEntity` gains an indexed, self-referential `mergedIntoId` relation, following the existing MDM tombstone pattern used by `CustomerAccount`, `CustomerSite`, `CustomerContact`, `Region`, and `City`. `InventoryRelationship` gains the same lineage so collision losers have an unambiguous survivor.

Add shared canonical-record predicates in `@dpf/db` and use them in default entity and relationship reads across inventory, triage, promotion, enrichment, customer-estate, security-enrichment, and EA projections. Direct by-id owner routes resolve an entity tombstone to its canonical record instead of rendering a ghost. A static completeness test inventories both `InventoryEntity` and `InventoryRelationship` list/count/projection reads so a future consumer cannot silently omit the predicate.

### Dependent evidence convergence

Create transaction-local entity and relationship merge maps from forced heap scans.

Repoint these `InventoryEntity.id` foreign keys to the canonical entity:

- `ChangeItem.inventoryEntityId`
- `DiscoveredItem.inventoryEntityId`
- `DiscoveredSoftwareEvidence.inventoryEntityId`
- `DiscoveryConnection.gatewayEntityId`
- `DiscoveryFingerprintObservation.inventoryEntityId`
- `DiscoveryTriageDecision.inventoryEntityId`
- `IdentityResolutionLog.inventoryEntityId`
- `PortfolioQualityIssue.inventoryEntityId`

Also repoint `RemoteAction.inventoryEntityId`, an intentional soft reference with no Prisma relation or database FK. Maintain a single hard-plus-soft reference registry and a schema-completeness test, following `apps/web/lib/mdm/merge.ts`.

Handle `InventoryRelationship` before entity tombstones:

1. Project each relationship through the entity merge map to its future `(fromEntityId, toEntityId, relationshipType)` tuple.
2. Prefer an existing row already on canonical endpoints, then earliest `firstSeenAt`, then lexical `id`, as the relationship survivor.
3. Merge first/last observation timestamps, current status, confidence, properties, and latest confirmation onto the survivor.
4. Repoint `DiscoveredRelationship.inventoryRelationshipId` and `PortfolioQualityIssue.inventoryRelationshipId` to the survivor.
5. Update only the survivor to canonical endpoints.
6. Keep every relationship loser as `status = 'superseded'`, `mergedIntoId = <survivor-id>` on its superseded entity endpoints, with bounded repair lineage in `properties`.
7. If a relationship projects to a self-loop only because both endpoints merge into the same entity, retain it as a `status = 'superseded'` tombstone with `mergedIntoId = null` and an explicit `self_loop_after_entity_merge` repair reason; do not publish a fabricated active self-relation.

This ordering preserves all rows and provenance while avoiding compound-unique collisions.

### Enforcement and recurrence prevention

- Drop and recreate `InventoryEntity_entityKey_key` from the repaired heap in the same transaction.
- Provision the repository-owned `amcheck` extension in the governed migration so later verification can remain read-only.
- Acquire write-conflicting locks on `InventoryEntity`, `InventoryRelationship`, and every hard/soft-reference table up front in a deterministic order with a bounded `lock_timeout`. Drop the untrustworthy entity-key index before survivor discovery, repair only from forced heap scans, and recreate it atomically.
- Assert forced-heap duplicate counts are zero before index creation and again after repair.
- Assert every entity merge map row has one canonical survivor, every remapped child resolves, and active relationship tuples are unique.
- Add a discovery-transaction invariant in `packages/db/src/discovery-sync.ts`: after entity upserts and before dependent writes, disable all index-scan classes locally and count the incoming `entityKey` values from the heap. Any count other than one aborts the transaction, preventing a damaged index from compounding duplicates.
- Refactor the existing guard into one importable integrity core plus its CLI wrapper. The core supports a require-only mode that never creates an extension or changes source state, fails when the governed migration has not provisioned `amcheck`, and requires `InventoryEntity_entityKey_key` to exist as a unique, valid, ready, live B-tree before heap agreement is accepted.
- Invoke the read-only source check from inside `runWithDestinationCleanup`, after the initial destination reset and before the first source read/copy. This guarantees guard failure also clears the disposable destination.
- Route the canonical preview aliases through `dev-portal-lease.sh refresh`. The wrapper claims `local-integration-ci` before touching Docker, refuses an active holder, stops the shared `dpf` preview before rebuilding its source clone, retains the lease on success, and releases it automatically when startup fails. A failed source guard or clone must leave port `3001` closed so stale data cannot masquerade as current acceptance evidence.
- Keep the pinned Postgres image and existing fleet-wide collation guard as the root-cause prevention layer; do not add a parallel integrity tool.

## Implementation phases

### Phase 1 - Red migration fixture

**Files**

- `packages/db/src/inventory-entity-index-integrity-migration.test.ts`
- `packages/db/src/inventory-entity-merge-references.test.ts`

Build a disposable schema fixture with:

- two duplicate entity groups;
- null/default versus enriched canonical fields;
- all ten inbound entity FK shapes;
- the `RemoteAction.inventoryEntityId` soft reference;
- relationships that collide after entity convergence in both directions;
- a relationship that becomes a self-loop after convergence, with an explicit retained-or-retired assertion;
- `DiscoveredRelationship` and `PortfolioQualityIssue` references to relationship losers;
- a reserved quarantine-key collision;
- conflicting scope/customer/site ownership that must abort the migration rather than silently cross an ownership boundary;
- a healthy unrelated entity and relationship.

The red fixture must require deterministic survivorship, complete hard/soft-reference convergence, inactive retained tombstones with `mergedIntoId`, merged freshness, no row loss, index validity/readiness/liveness, forced heap/index agreement, direct duplicate-insert rejection with SQLSTATE `23505`, and idempotence on a second migration run. An injected unresolved collision must prove transaction rollback leaves every table and index unchanged. A retry fixture must prove snapshot success, repair failure, intervening observation updates, and a later successful repair retain the intervening tuple. A schema-completeness test must fail when a new hard relation or declared soft reference is not covered by the migration registry.

**Verification**

`pnpm --filter @dpf/db exec vitest run src/inventory-entity-index-integrity-migration.test.ts`

### Phase 2 - Fleet-safe repair migration

**Files**

- `packages/db/prisma/migrations/20260728115900_snapshot_inventory_observation_facts/migration.sql`
- `packages/db/prisma/migrations/20260728115930_keep_inventory_observation_snapshot_current/migration.sql`
- `packages/db/prisma/migrations/20260728120000_repair_inventory_entity_index_integrity/migration.sql`
- `packages/db/prisma/migrations/20260728154500_preserve_inventory_identity_tuple/migration.sql`
- `packages/db/prisma/migrations/20260728170000_restore_inventory_observation_facts/migration.sql`
- `packages/db/prisma/migrations/20260728170500_remove_inventory_observation_snapshot_trigger/migration.sql`
- `packages/db/prisma/schema.prisma`
- `packages/db/src/inventory-entity-lifecycle.ts`
- canonical inventory read/projection callers discovered by the completeness test

Implement the repair using ordered forward migrations and materialized, transaction-local merge maps over repository-owned identifiers. The pre-repair migrations snapshot mutable observation facts and install a temporary trigger that refreshes them if a failed repair returns control to the old runtime. The immutable repair migration performs identity and relationship convergence. Forward corrections restore a coherent mastered-identity tuple and the latest mutable observation tuple, then remove the trigger and canonical snapshots. Include fixed lock order, bounded `lock_timeout`, fail-closed assertions, and forward-only recovery notes. Never edit a committed migration.

No row or primary key is deleted. Clean installs and a second execution change no data.

Duplicate rows are not auto-merged when they disagree on `scopeKey`, customer/site ownership, `entityType`, non-null portfolio/product/taxonomy assignment, or a human-confirmed catalog identity. The migration raises and rolls back because crossing an ownership or mastered-identity boundary requires a separately governed rule.

Centralize `mergedIntoId: null` as the canonical-record predicate, apply it to every default list/count/automation/projection read, and resolve by-id owner routes through `mergedIntoId`. Tombstones are queryable only through explicit history/diagnostic paths.

**Verification**

- Phase 1 fixture turns green.
- `pnpm migration:safety`
- `pnpm --filter @dpf/db typecheck`

### Phase 3 - Discovery write invariant

**Files**

- `packages/db/src/discovery-sync.ts`
- `packages/db/src/discovery-sync.test.ts`

Add a small reusable transaction helper that accepts incoming entity keys, runs a parameterized forced-heap count, and throws a typed, owner-readable integrity error when any key resolves to zero or more than one heap row. Call it after entity upserts while the surrounding transaction can still roll back every write.

Focused tests must prove:

- one heap row per incoming key continues;
- a pre-existing duplicate aborts;
- a duplicate introduced by the upsert path aborts;
- the failure rolls back before relationships, discovered evidence, quality issues, and projections;
- repeated logical entities that share one `entityKey` still map their distinct discovered keys to the same canonical row.

Add one PostgreSQL-backed ingestion test that applies the repair, runs `persistBootstrapDiscoveryRun` twice and concurrently for the repaired key, and proves one heap row, no `P2002`, correct created/updated accounting, and retained discovered-item provenance.

**Verification**

`pnpm --filter @dpf/db exec vitest run src/discovery-sync.test.ts`

### Phase 4 - Contributor-preview source guard

**Files**

- `docker-compose.yml`
- `package.json`
- `packages/db/scripts/index-integrity-guard.mjs`
- `packages/db/scripts/index-integrity-core.mjs`
- `packages/db/scripts/index-integrity-guard.test.ts`
- `packages/db/src/sanitized-clone.ts`
- `packages/db/src/sanitized-clone.test.ts`
- `scripts/lib/dev-preview-migrate-converge.test.mjs`
- `tests/release/dev-portal-lease-contract.test.mjs`
- `docs/runbooks/2026-07-20-collation-drift-index-corruption.md`

Refactor the existing index-integrity logic into an importable core and call its read-only, require-existing-`amcheck` path from `sanitized-clone.ts` against `PRODUCTION_DATABASE_URL`, limited to `InventoryEntity` and explicitly requiring its canonical unique index. The call runs inside the destination-cleanup boundary after the initial reset and before source copy. Route preview aliases through the lease-owned refresh subcommand so another holder cannot be interrupted and failed startup releases its claim. Update the package, lease, and existing runbook contracts; do not add a new user-facing page or duplicate runbook.

**Verification**

- clone contract test proves the destination reset precedes the production-source guard and the guard precedes copy;
- guard tests cover table filtering, `heapallindexed`, required-index absence or invalidity, corruption exit `1`, and missing-extension exit `2` without mutation;
- lease tests prove the claim precedes both Docker actions, a conflicting holder prevents any Docker action, and startup failure releases the acquired lease;
- a PostgreSQL-backed negative clone run proves unique failure empties the destination;
- guard or clone failure prevents clone publication, leaves `dev-portal` stopped, and leaves port `3001` closed;
- healthy guard permits clone.

### Phase 5 - Independent review and exact-SHA gates

Run:

- targeted migration, discovery-sync, guard, and preview tests;
- full `@dpf/db` Vitest suite;
- DB typecheck;
- migration safety and data-impact guards;
- production web build;
- `pnpm run pregate` against the exact candidate SHA in the governed `local-integration-ci` sandbox.

Request independent data-architecture and operations/test critique. Resolve all P1 findings before PR handoff.

### Phase 6 - Governed live acceptance

After the ready PR merges:

1. Advance the live install through `/ops/self-upgrade`; do not rebuild the main portal directly.
2. Prove the migration applied and record the exact deployed SHA.
3. Run the existing index-integrity guard with `--table InventoryEntity`; require zero corruption.
4. Compare forced heap and forced index scans; require the repaired canonical keys plus retained inactive tombstones, zero duplicate `entityKey` groups, and identical row identity sets.
5. Verify all former child references resolve to canonical rows and all active relationship tuples are unique.
6. Claim `local-integration-ci` and run the governed contributor preview through migrations, full sanitized clone, and `GET :3001/api/health`.
7. Verify `/inventory`, one canonical `/inventory/entity/[entityId]`, and `/platform/tools/discovery/promotion-audit` at desktop and mobile widths.
8. Record evidence on `BI-CF4ADDAC`, close it only with migration and operational evidence, then resume the blocked AI Coworker browser acceptance.

## Backlog coverage

Decision: **atomic**
Receipt: `cms4ro0mj0sfv01ruffnhwga6`

- `repair-migration` -> `BI-CF4ADDAC`
- `ingestion-invariant` -> `BI-CF4ADDAC`, depends on `repair-migration`
- `preview-source-guard` -> `BI-CF4ADDAC`, depends on `repair-migration`
- `live-acceptance` -> `BI-CF4ADDAC`, depends on all implementation phases

No phase is independently shippable. A guard without the migration blocks affected installs permanently; a migration without the write and preview guards leaves recurrence and publication undetected; implementation without live acceptance does not unblock the UX program.

## Risks and rollback

- **Lock duration:** the migration updates hundreds of child rows and rebuilds one small B-tree. It runs under the self-upgrade quiescence window. The fixture and exact-SHA gate must measure it; no concurrent live discovery write is permitted during migration.
- **Interrupted upgrade:** the snapshot migration can commit before a later ownership conflict stops the repair. A temporary trigger keeps the snapshot coherent while the old runtime remains active; the retry fixture proves an intervening update survives, and the final cleanup removes the trigger only after convergence.
- **Relationship collision:** direct bulk endpoint updates can violate the compound unique. The relationship merge map and survivor-first ordering are mandatory.
- **Human-confirmed data:** latest-row overwrite can erase operator decisions. Hard conflict gates reject incompatible mastered identity/product/taxonomy state; merge rules only fill absent/default values after those gates pass.
- **UI ghosts:** status filters are inconsistent across inventory consumers. `mergedIntoId` is the canonical lifecycle marker, a shared predicate owns default exclusion, and a completeness test covers list/count/projection reads.
- **Guard cost:** `amcheck` is intentionally limited to `InventoryEntity` on every contributor preview; the fleet-wide sweep remains a CI/operations action.
- **Verification authority:** preview checks use a source role with read-only transaction authority after the migration provisions `amcheck`; the guard never mutates the live source.
- **Stale publication:** dependency failure alone does not stop an already-running preview. The canonical preview refresh command first acquires the shared lease, then stops `dev-portal`, and releases the lease on every failed refresh.
- **Forward-only rollback:** the transaction is fully reversible before commit. After commit, this one-time fleet repair is explicitly **non-compensable** because it does not persist every moved child id required for a truthful unmerge. Tombstones preserve source evidence and lineage but are not an undo receipt. Any future reversal requires a separately governed forward migration based on retained evidence; the committed migration is never edited.

## Documentation impact

No customer or public-positioning workflow changes. Update the existing collation-drift runbook and contributor-runtime guide because Contributor preview gains a lease-owned refresh command and a new fail-closed source check. The implementation plan and PR evidence carry the architecture impact.

## Completion checklist

- [x] Backlog coverage receipt recorded.
- [x] Backlog coverage receipt revalidated before source implementation.
- [x] Independent architecture and test/operations reviews completed; P1 corrections folded into the plan.
- [ ] Migration fixture passes, including idempotence and no row loss.
- [ ] Discovery transaction aborts on forced-heap duplicates.
- [ ] Contributor preview runs the existing source index guard before clone.
- [ ] Targeted and full DB gates pass.
- [ ] Production web build and exact-SHA pregate pass.
- [ ] Ready PR merges through the queue.
- [ ] Governed self-upgrade applies the repair.
- [ ] Live `amcheck`, heap/index comparison, and reference checks pass.
- [ ] Governed contributor preview reaches healthy.
- [ ] `BI-CF4ADDAC` carries evidence and is done.
- [ ] Blocked AI Coworker browser acceptance resumes.
