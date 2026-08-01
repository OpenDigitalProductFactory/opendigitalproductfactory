# Shared Scarce-Resource Capacity Implementation Plan

> **DPF-native execution:** Follow `AGENTS.md`, use the isolated
> `feat/scarce-resource-substrate` worktree, define behavior with TDD, and run
> runtime-bound gates through the governed `local-integration-ci` environment.
> This source-only worktree must not install a parallel dependency graph or run
> a worktree Compose runtime.

- **Backlog:** `BI-D1D54D93`
- **Work Capsule:** `WC-2C4CCA14`
- **Design:**
  `docs/superpowers/specs/2026-08-01-shared-scarce-resource-capacity-design.md`
- **Base:** `origin/main@4c47253e646`
- **Decision:** `DI-23BD40A7AA2E` — typed runtime mirror, high confidence
- **Coverage receipt:** `cmsa0ddd60eki01r20z2pfpf1`
- **Coverage decision:** atomic

## Backlog coverage

The work is one medium, independently shippable platform contract. Splitting
profile derivation from the normalized projection would leave either an unused
taxonomy or an ungoverned universal adapter. Concrete vertical loaders remain
separate backlog items and PRs.

| Key | Deliverable | Independently shippable | Depends on |
| --- | --- | --- | --- |
| `capacity-profile` | Archetype-gated pattern/authority derivation | No | — |
| `runtime-contract` | Normalized resource, interval, allocation, conflict, attention, and source-health types | No | profile |
| `registry-projection` | Adapter registry and pure bounded projection | No | runtime contract |
| `fixtures-guards` | Six-pattern matrix, adapter contract fixtures, docs, and exports | No | registry/projection |

## Phase 1 — Contract tests first

1. Add profile tests for representative appointment, dispatch, rental, class,
   venue, and project-resource archetypes.
2. Assert nonphysical board archetypes do not receive physical resource
   authorities merely because a noun exists.
3. Add interval/conflict tests for half-open adjacency, preparation/cleanup,
   travel windows, quantity capacity, released allocations, capability
   mismatch, and utilization.
4. Add registry tests for duplicate authorities, profile gating, unsupported
   adapters, degraded sources, source watermarks, and organization isolation.
5. Add a six-pattern adapter-contract fixture that retains canonical source
   references for drill-through.

## Phase 2 — Archetype capacity profile

1. Add `resource-capacity-profile.ts` to `@dpf/storefront-templates`.
2. Define closed pattern and authority constants plus their union types.
3. Derive the profile from axes, scheduling defaults, field-dispatch profile,
   and `TwinProfile`; add no second hand-authored taxonomy.
4. Export the profile through the package index.
5. Keep the existing `ArchetypeDefinition` public shape stable unless a genuine
   leaf exception is proven by tests; prefer derivation over an override field.

## Phase 3 — Shared runtime contract and projection

1. Add `apps/web/lib/capacity/contracts.ts` for normalized resources,
   allocations, availability, source state, conflicts, and attention signals.
2. Add `intervals.ts` for effective footprints, half-open overlap, capacity
   consumption, utilization, and conflict explanation.
3. Add `adapter-registry.ts` with duplicate-authority rejection and
   archetype-profile gating.
4. Add `project-capacity-snapshot.ts` to load applicable adapters in parallel,
   retain degraded sources, and produce one source-watermarked snapshot.
5. Keep the projection read-only. Its result is advisory until a canonical
   domain command rechecks and commits.

## Phase 4 — Representative adapter descriptors

1. Register typed descriptors for provider calendar, staffing, hospitality,
   care, rental, and field operations.
2. Bind descriptor applicability to the derived profile.
3. Provide fixture-backed adapters for all six required patterns; do not add
   production SQL loaders for verticals whose backlog item has not yet claimed
   source ownership.
4. Document the adapter implementation checklist used by beauty, rental, hotel,
   HOA, HVAC, classes, and venue work.

## Phase 5 — Documentation and handoff

1. Update the operational-twin architecture to point at this mirror as the
   shared resource read contract.
2. Update the salon BOOK plan so `BI-D1D54D93` is an explicit prerequisite of
   the beauty capacity deliverable.
3. Record the decision and verification evidence on `BI-D1D54D93`.
4. Unblock the beauty capacity capsule only after the shared PR merges.

## Refactor allocation

At least 20% of implementation effort is reserved for consolidation:

- one interval/footprint implementation instead of vertical overlap helpers;
- one adapter registry rather than switch statements in every workspace;
- one source-health and watermark shape shared with the operations hot path;
- derived archetype applicability instead of copied category lists;
- explicit canonical source references instead of label/name inference.

## Verification gates

1. Targeted template-profile, interval, registry, and projection tests.
2. Affected-package typecheck and architecture/module-size guards.
3. No migration gate required: Prisma schema and migration directory are
   unchanged.
4. No direct UX gate required: this concern adds no route or controls.
5. Governed exact merged-code local-CI gate after the PostgreSQL watchdog fix
   lands, including exhaustive Vitest and production Docker/Next build.
6. Ready-for-review PR only after exact evidence is recorded; merge through the
   governed squash queue and run `pnpm pr:health` before claiming readiness.

## Rollback

The change is additive and read-only. Rollback removes the new exports and
capacity modules; canonical domain tables and commands are untouched. A
vertical consumer must keep its existing source-specific read path until its
adapter PR has independently passed functional and UX verification.
