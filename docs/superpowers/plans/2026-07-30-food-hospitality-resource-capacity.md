# Food & Hospitality Resource and Capacity Implementation Plan

> **DPF-native execution:** Follow `AGENTS.md`, use the isolated
> `feat/restaurant-resource-capacity` worktree, define behavior with TDD, and
> verify runtime-bound gates through the governed `local-integration-ci`
> environment. No worktree Compose runtime or dependency install.

- **Backlog:** `BI-57F34A00`
- **Work Capsule:** `WC-C3444A9D`
- **Design:** `docs/superpowers/specs/2026-07-30-food-hospitality-resource-capacity-design.md`
- **Base:** `origin/main@9deed2964f203102a539702bfddd145f3112704d`
- **Coverage receipt:** `cms7ez9xz0cn701poi3ylem7f`
- **Coverage decision:** atomic

## Backlog coverage

The following phases are one deployable unit. Schema without consumers leaves
the category error in place; consumers cannot precede the migration; a migration
without command/projection cutover creates dual sources of truth. The separately
shippable spatial FLOOR is already mapped to `BI-287AA5F7`.

| Key | Deliverable | Independently shippable | Depends on |
| --- | --- | --- | --- |
| `domain-schema` | Resource, capacity-pool, availability, and allocation schema | No | — |
| `fleet-migration` | Provider backfill and booking/hold bridge | No | `domain-schema` |
| `capacity-service` | Conflict-safe lifecycle allocation/release | No | schema, migration |
| `projection-cutover` | Structured restaurant projection and scene resolution | No | capacity service |
| `fixtures-guards` | Archetype seeds, guards, tests, and docs | No | projection cutover |

## Phase 1 — Contract tests first

1. Add schema-contract tests for the four Food & Hospitality models, composite
   ownership, lifecycle fields, versions, and booking/hold bridge.
2. Add migration tests for:
   - clean application;
   - idempotent provider-to-resource backfill;
   - staff preservation;
   - booking/hold linkage;
   - deterministic overlap quarantine;
   - exclusion constraint behavior.
3. Add service tests for discrete overlap, aggregate-pool capacity,
   idempotency, expected-version conflict, activate, release, and cancellation.
4. Rewrite projection and scene-resolver tests to require structured resource
   IDs and to reject name inference.

## Phase 2 — Schema and fleet-safe migration

1. Add `HospitalityResource`, `HospitalityResourceAvailability`,
   `HospitalityCapacityPool`, and `HospitalityCapacityAllocation` to Prisma.
2. Add organization/storefront relations and nullable hospitality-resource
   relations to booking and hold.
3. Create migration
   `20260730120000_food_hospitality_resource_capacity`.
4. Backfill table-like provider rows only where the storefront archetype is in
   Food & Hospitality and the row has no employee identity.
5. Preserve every provider row; attach it through
   `legacyServiceProviderId`.
6. Backfill structured booking/hold references and active allocation rows.
7. Quarantine conflicting later rows before adding the GIST exclusion
   constraint.
8. Add explicit checks, composite FKs, and read-path indexes.

## Phase 3 — Capacity lifecycle service

1. Add closed string-enum constants and validators for resource kind/status,
   pool kind/unit, allocation lifecycle, and demand type.
2. Implement one transactional service for:
   - resource allocation;
   - pool allocation with `FOR UPDATE`;
   - activation;
   - release/cancel;
   - idempotent retries;
   - expected-version conflicts.
3. Translate PostgreSQL overlap errors into the existing typed operational
   conflict response.
4. Emit owner-visible exceptions for quarantined or over-capacity demand.

## Phase 4 — Cut over reads and writes

1. Change `restaurant-capacity-loader.ts` to load structured resources and live
   allocations.
2. Refactor `restaurant-capacity.ts` around resource/allocation facts while
   keeping its public snapshot stable for existing UI consumers.
3. Resolve `table` scene entities through `HospitalityResource`.
4. Update hold and booking creation so FLOOR archetypes allocate structured
   capacity in the same transaction.
5. Keep compatibility writes to `providerId` only when a resource has a legacy
   link; never use the provider label to classify a new row.
6. Remove table rows from Staff management and route table creation to the
   structured resource command.

## Phase 5 — Archetype fixtures, attention, and documentation

1. Seed or migrate structured restaurant table resources.
2. Add restaurant busy-shift, catering-event, and bakery-production fixtures.
3. Assert catering foregrounds event/kitchen/staff/delivery readiness and bakery
   foregrounds production/pickup/allergen readiness.
4. Surface blocked, quarantined, idle, and over-capacity exceptions through the
   existing attention substrate.
5. Update operator and architecture documentation.

## Refactor allocation

At least 20% of the implementation is reserved for consolidation:

- delete name-based table classification from live reads;
- centralize capacity lifecycle and conflict handling;
- reuse one projection across owner, workspace, and spatial consumers;
- keep staffing, geometry, booking intent, and capacity ownership in their
  existing bounded contexts;
- remove duplicated provider-shaped adapters after the structured bridge is in
  place.

## Verification gates

1. Targeted schema, migration, service, projection, resolver, booking, and
   archetype tests.
2. Prisma format/generate and migration-safety/schema-regression guards.
3. Full affected-package typecheck.
4. Governed merged-code exhaustive Vitest and all policy guards.
5. Production Docker/Next build and migration deploy.
6. UX verification of restaurant Tables & Capacity, Staff separation, public
   booking, and structured table entity resolution.
7. `pnpm pr:health` with every check terminal green and zero unresolved review
   threads before merge queue.

## Documentation disposition

This changes the persisted architecture, operator resource-management workflow,
external-agent model vocabulary, and public booking behavior. Architecture and
operator documentation are required in the same branch. The migration and
runtime behavior must be cited in the PR evidence; no “docs later” follow-up is
acceptable.
