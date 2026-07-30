# Food & Hospitality Resource and Capacity Design

- **Backlog:** `BI-57F34A00`
- **Depends on:** `BI-5A855584`, `BI-EA4B8638`, `BI-CD99DC3F`, `BI-E75AF714`
- **Unblocks:** `BI-287AA5F7`
- **Plan:** `docs/superpowers/plans/2026-07-30-food-hospitality-resource-capacity.md`
- **Existing UX contract:** `docs/superpowers/specs/2026-07-22-restaurant-capacity-legibility-design.md`
- **Umbrella plan:** `docs/superpowers/plans/2026-07-28-business-operations-and-performance-views-plan.md`

## Decision

Food & Hospitality owns a dedicated resource and capacity substrate. It does
not extend `ServiceProvider` to represent furniture and it does not introduce a
universal `OperationalResource` above existing vertical owners.

The governed kernel compared three options on 2026-07-30:

| Option | Composite | Result |
| --- | ---: | --- |
| Extend `ServiceProvider` | -0.567 | Rejected: preserves the staff/table category error |
| Food & Hospitality domain model | **4.653** | **Selected: high confidence** |
| Universal operational resource | 1.774 | Rejected: premature abstraction and large blast radius |

The selected option won by 2.879 with strong structured coverage and no
commandment conflict. It best satisfies architecture over shortcuts, grounding
in existing platform work, single source of truth, and fleet-safe evolution.

## Problem

Restaurant tables are currently stored as `ServiceProvider` rows and discovered
with name matching. That makes physical furniture appear in the Staff UI,
forces reservations to use a person-shaped foreign key, and leaves kitchen,
bake, delivery, and event capacity without an owning ledger.

The existing pieces remain valid in their proper domains:

- `ServiceProvider`, `ProviderAvailability`, and `ProviderService` own people
  and human-delivered services.
- `StaffingDemand`, `StaffingShift`, `StaffingAssignment`, and
  `StaffingResourceLink` own event staffing.
- `OperationalSceneLayout` owns operator-authored geometry and only references
  live entities.
- `StorefrontItem` owns what the customer buys or reserves.
- `StorefrontBooking` and `BookingHold` own customer reservation intent.
- `RentableUnit` and `CareResource` remain the asset-rental and healthcare
  sources of truth.

## Domain model

### `HospitalityResource`

A discrete Food & Hospitality operating resource:

- stable `resourceId`;
- organization and storefront ownership;
- `kind`: `table`, `kitchen-station`, `oven`, `delivery-vehicle`, or
  `service-area`;
- operator label;
- lifecycle `status`: `active`, `blocked`, or `retired`;
- integer `capacity` and typed `capacityUnit`;
- optional service area, block reason, and structured attributes;
- optimistic-concurrency `version`;
- optional unique `legacyServiceProviderId` used only for expand/migrate
  compatibility.

For restaurant tables, `capacityUnit` is `seats`. The resource ID—not a parsed
label—is the identity bound into `OperationalSceneLayout`.

### `HospitalityResourceAvailability`

The authoritative repeating schedule and dated-exception ledger for a discrete
hospitality resource:

- organization, storefront, and resource ownership;
- weekly day sets or one explicit local date;
- start and end time;
- `available` or `blocked` kind plus an operator-readable reason;
- indexed resource/date and storefront/date lookup paths.

Availability is relational rather than embedded JSON because one resource owns
many independently queryable windows and exceptions. Slot selection must filter
these rows by interval, the migration must backfill them from
`ProviderAvailability`, and schedule replacement must enforce cross-organization
ownership through a composite foreign key. `ProviderAvailability` remains a
rolling-upgrade compatibility projection for legacy slot code; it is not the
new source of truth.

### `HospitalityCapacityPool`

An aggregate, time-bounded capacity supply:

- stable `poolId`;
- organization and storefront ownership;
- `kind`: `kitchen`, `bake`, `delivery-window`, or `event-service`;
- operator label, capacity, capacity unit, optional interval size;
- lifecycle status and optimistic-concurrency version.

Pools represent quantities such as covers per service period, bake batches per
hour, or delivery stops in a window. Event people do not become pool rows:
staffing demand and assignments remain authoritative and can be linked through
the demand reference.

### `HospitalityCapacityAllocation`

The append-preserving consumption ledger:

- stable `allocationId`;
- exactly one discrete resource or aggregate pool;
- time interval and positive quantity;
- lifecycle `reserved`, `active`, `released`, `cancelled`, or `quarantined`;
- typed demand reference (`booking`, `hold`, `event`, `production-order`,
  `delivery`, or `manual`);
- optional booking and hold links for referential integrity;
- optimistic-concurrency version and release metadata.

Lifecycle changes release capacity by moving an allocation to a terminal state;
rows are not deleted as the normal release path.

### Reservation bridge

`StorefrontBooking` and `BookingHold` gain an optional
`hospitalityResourceId`. During expand/migrate, Food & Hospitality bookings and
live holds are backfilled through each table resource's
`legacyServiceProviderId`. Existing `providerId` values remain in phase one so
old application binaries can run during rolling upgrade. New code reads and
writes the structured hospitality FK for FLOOR archetypes and treats
`providerId` as compatibility-only.

## Integrity rules

1. Every row is scoped to one organization and storefront.
2. Composite foreign keys prevent cross-organization resource, pool, booking,
   and allocation references.
3. Capacity and quantity are positive.
4. An allocation targets exactly one of resource or pool.
5. Active allocations for one discrete resource cannot overlap. PostgreSQL
   `EXCLUDE USING gist` is the database concurrency boundary.
6. Aggregate-pool allocation locks the pool row, sums live overlapping
   allocations, and rejects demand above capacity inside one transaction.
7. Allocation and release commands require expected versions and idempotency
   keys.
8. Existing conflicting rows are quarantined, not deleted or silently
   cancelled.
9. Projection code never infers a table from `ServiceProvider.name` after the
   structured cutover.

## Fleet-safe migration

The migration is expand → backfill → guard:

1. Create the four new tables and nullable compatibility FKs.
2. Create structured table resources only for table-like provider rows in
   Food & Hospitality storefronts.
3. Preserve the legacy provider row and write the explicit compatibility link.
4. Backfill booking and non-expired hold resource FKs.
5. Backfill allocation rows for active bookings and holds.
6. Quarantine later-created overlapping allocations before adding the exclusion
   constraint.
7. Add indexes and constraints only after remediation.

The migration is idempotent and does not delete customer, booking, hold, staff,
or provider data. Removing the legacy provider bridge is a later contract
migration after fleet convergence proves no old writer remains.

## Substrate budget

The four-model increase is intentional and bounded:

- `HospitalityResource` owns independently addressable physical-resource
  identity and lifecycle.
- `HospitalityResourceAvailability` owns its one-to-many repeating windows and
  dated exceptions.
- `HospitalityCapacityPool` owns aggregate supply that has no discrete physical
  identity.
- `HospitalityCapacityAllocation` is the append-preserving demand ledger shared
  by discrete resources and pools.

Combining these into JSON would remove foreign-key ownership, indexed interval
queries, atomic conflict enforcement, and append-preserving release history.
Reusing `ServiceProvider`, `ProviderAvailability`, staffing, rental, care, or
scene-layout records would cross their existing bounded contexts and preserve
the category errors this BI removes. The governed static measurement therefore
ratchets only `prismaModelCount` from `554` to `558`; all other non-increasing
substrate metrics remain unchanged. The baseline is regenerated through
`measure-platform-substrate.mjs --update`, never hand-edited.

## Read and command boundaries

- `restaurant-capacity-loader.ts` reads `HospitalityResource` and
  `HospitalityCapacityAllocation`, not `ServiceProvider`.
- `restaurant-capacity.ts` remains the pure projection and changes its inputs
  from provider-shaped names to structured resource and allocation facts.
- `scene-entity-resolver.server.ts` resolves `table` entities from
  `HospitalityResource`.
- Public hold/booking creation dual-writes the structured resource reference and
  allocation in the same transaction for Food & Hospitality storefronts.
- A dedicated capacity service owns allocate, activate, release, and conflict
  translation. Routes do not reproduce locking or lifecycle logic.

## Archetype behavior

- **Restaurant:** tables, covers, reservations, waitlist, current party, and
  service-period capacity.
- **Catering:** event date, guest count, menu readiness, kitchen prep, staffing,
  delivery/setup window, and deposit; no table-turning metaphor.
- **Bakery:** bake capacity, custom-order production queue, pickup/delivery,
  allergens, and balance; no dining-room assumptions.

The shared schema supports all three, while projections and UI vocabulary remain
archetype-specific.

## Verification

- migration applies to clean and dirty fixtures;
- provider-to-resource backfill is idempotent and preserves staff/provider rows;
- overlapping legacy reservations quarantine deterministically;
- discrete resource conflicts fail atomically;
- aggregate pool over-capacity fails under concurrent demand;
- release restores availability without deleting history;
- restaurant projection, scene resolver, and booking flow use structured IDs;
- catering and bakery fixtures do not emit restaurant table vocabulary;
- all affected unit tests, exhaustive Vitest, typecheck, production build,
  migration deploy, and archetype/route UX guards pass.
