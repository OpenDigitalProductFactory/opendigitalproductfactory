---
status: draft
---

# W19 vertical clone collapse — data-migration plan (OPERATOR REVIEW REQUIRED)

**Status: plan only — nothing in this document is executed by the W19 PR.**
BI-99C76A90 · Simplify & Strengthen W19 · architecture pass 2026-08-16 §3.2-c ·
expand step shipped as migration `20260818090000_w19_unified_resource_scheduling_expand`.

## Where the expand step left the schema

- The unified family exists and is EMPTY:
  `Resource` / `ResourceAvailability` / `ResourceCapacityPool` /
  `ResourceCapacityAllocation` in
  `packages/db/prisma/schema/resource-scheduling.prisma`, discriminated by the
  `ResourceDomain` enum (`beauty | hospitality | care | provider | workforce`),
  born on the W20 `RecordLifecycle` convention, each row carrying a unique
  `sourceRef` provenance key (`<CloneModel>:<cloneRowId>`).
- The clone families remain **authoritative**: `BeautyResource`,
  `BeautyResourceService`, `BeautyResourceAvailability`,
  `BeautyCapacityAllocation`, `HospitalityResource`, `HospitalityCapacityPool`,
  `HospitalityResourceAvailability`, `HospitalityCapacityAllocation`,
  `ProviderAvailability`. Nothing reads the unified tables in production yet.
- Row-level mapping contract + dual-read merge:
  `apps/web/lib/resource-scheduling/` (`clone-adapters.ts`, `dual-read.ts`) —
  deterministic, unit-tested, unmappable legacy values reported as warnings,
  never coerced silently.
- `RecurringSchedule` (finance billing) gained a nullable, all-NULL
  `recurrenceScheduleId` FK to the canonical `RecurrenceSchedule`;
  `RecurringSchedule.frequency` remains authoritative.
- Ratchet: `scripts/check-no-new-resource-clone-models.mjs` blocks NEW
  clone-shaped model names; the 8 existing clones live in a shrink-only owned
  baseline (`scripts/resource-clone-models-baseline.json`).

## Why the migration is an operator boundary

The backfill rewrites live booking-adjacent capacity data (double-booking
protection depends on the allocation ledgers), and the clone drop is
irreversible on every fleet install. Per the Batch-1 house rule, forward-only
migrations must apply against ANY existing data state; the value-inventory
step below is what makes that provable install-by-install.

## Ordered migration plan

Each wave stops and reports on any inventory surprise rather than forcing the
mapping.

### Wave A — value inventory (read-only, per install)

For each clone table, inventory the live vocabulary the adapters must map:
`BeautyResource.status` / `HospitalityResource.status` /
`HospitalityCapacityPool.status`, `*ResourceAvailability.kind`,
`*CapacityAllocation.lifecycle`, `*CapacityAllocation.demandType`. The
adapters' known sets: status `active|retired|archived`; window kind
`available|blocked`; allocation state
`reserved|held|confirmed|active|released|quarantined`. Any value outside these
sets gets an explicit operator-approved mapping added to
`apps/web/lib/resource-scheduling/clone-adapters.ts` **before** Wave B (the
adapter otherwise records it as `quarantined`/`archived` + `lifecycleReason`,
which is safe but must be a deliberate choice, not a surprise).

### Wave B — backfill (forward-only migration, inline SQL, idempotent)

1. `Resource` ← `BeautyResource` (domain `beauty`) and `HospitalityResource`
   (domain `hospitality`; `legacyServiceProviderId` → `subjectRef`), keyed by
   `sourceRef` with `ON CONFLICT ("sourceRef") DO NOTHING`.
2. `Resource` (domain `provider`) minted per `ServiceProvider` that has
   `ProviderAvailability` rows: `sourceRef = 'ServiceProvider:<id>'`,
   `subjectRef` likewise, `kindSlug = 'provider'`, capacity 1. The
   ServiceProvider row itself is NOT retired — it stays the identity home
   (people are not resources; the resource row is the scheduling shadow).
3. `ResourceCapacityPool` ← `HospitalityCapacityPool`.
4. `ResourceAvailability` ← `BeautyResourceAvailability`,
   `HospitalityResourceAvailability` (timezone from the owning
   `StorefrontConfig.timezone`), and `ProviderAvailability` (via the step-2
   provider resources).
5. `ResourceCapacityAllocation` ← `BeautyCapacityAllocation`,
   `HospitalityCapacityAllocation` (resource/pool ids resolved via
   `sourceRef`; `conflictQuarantinedAt` folds to
   `lifecycle='quarantined'` + `lifecycleAt` per the adapter contract).
6. Reconciliation queries (counts per table + per-vocabulary-value counts)
   run in the same migration and RAISE on any mismatch.

### Wave C — dual-write + dual-read flip (code PR, reversible)

Clone repositories (`apps/web/lib/beauty/*.server.ts`,
`apps/web/lib/storefront/hospitality-capacity-repository.server.ts`, provider
availability writers) write BOTH families (clone row + mirrored unified row by
`sourceRef`) and read through `mergeDualRead`. Characterization suites must
stay green; the unified row wins on any mirrored read.

### Wave D — convention flip + clone drop (operator-gated, one clone family at a time)

Readers move to the unified repository; clone writes stop; after a soak
window with zero dual-read divergence, a forward-only migration drops the
clone tables and the baseline in
`scripts/resource-clone-models-baseline.json` is retightened (shrink-only) in
the same PR. `BeautyResourceService` (service eligibility) moves to a typed
join against `Resource` in this wave — it is deliberately NOT part of the
expand family because its item FK is storefront-shaped.

### RecurrenceSchedule / RecurringSchedule fold

- Expand (shipped): nullable `RecurringSchedule.recurrenceScheduleId`.
- Backfill (operator-gated): mint one `RecurrenceSchedule` per
  `RecurringSchedule` from `frequency` + `startDate` (+ `endDate` → `until`)
  with an explicit frequency→RRULE mapping table reviewed against live
  vocabulary; set the FK; keep `frequency` as a generated read-model until
  every invoice-minting reader consumes the RRULE; then drop `frequency`.
- `RecurrenceSchedule` remains the ONE canonical recurrence primitive; the
  ratchet blocks any new `*RecurrenceSchedule`/`*RecurringSchedule` model.

## Documented exceptions

- **`EmployeeAvailabilityWindow` stays in the workforce domain** (not folded).
  Substrate evidence: it carries consent/confirmation semantics
  (`confirmationState`, `supersededById`, `effectiveFrom/To`,
  employee-vs-hr `source`) consumed by the staffing solver
  (`StaffingConstraintRule` / `StaffingProposalRun`, spec §5.1.5), not by
  storefront capacity. Folding it would smuggle HR consent state into a
  booking substrate. It IS baselined by the clone ratchet so the exception
  stays visible and deliberate, and the W20 plan handles its `supersededById`.
- **`CareResource` is not migrated yet** (domain value `care` is reserved).
  Care appointments carry HIPAA-adjacent participants/consent; that fold gets
  its own operator review after the beauty/hospitality soak proves the family.
- **`StaffingShift`/`StaffingAssignment`** remain the people-scheduling
  authority (capacity adapter descriptor `staffing`) — they are demand on
  people, not resource supply, and are out of W19 scope.

## Rollback posture

Waves B and C are additive and reversible (unified rows are keyed by
`sourceRef`; deleting them restores the pre-backfill state; dual-read falls
back to clones automatically). Wave D is the only irreversible step and is
gated on the soak evidence above.
