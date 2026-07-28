# Business Operations and Performance Views — implementation plan

- **Date:** 2026-07-28
- **Design:** [Business Operations and Performance Views](../specs/2026-07-28-business-operations-and-performance-views-design.md)
- **Umbrella backlog:** `BI-00D276B2`
- **Status:** ready for phased execution after coverage receipt

## Objective

Deliver two explicit owner-facing business destinations:

- **Operations** at the stable `/workspace` route for fast current-state work.
- **Performance** at `/performance` for permissioned owner/manager analytics.

Land the shared contracts and restaurant FLOOR proof first. Then move the other physical archetypes through the same precedent, state, command, accessibility, and performance gates.

## Operating rules

- Start every implementation BI in its own fresh worktree/branch.
- Revalidate this plan’s backlog coverage receipt before implementation.
- Query live backlog/build/PR state before claiming a phase.
- Do not create a second navigation registry, twin renderer, status palette, chart family, metric definition store, or generic physical-resource model.
- Performance loaders, bundles, and rollups stay off the Operations command path.
- Every schema change follows fleet-safe migration rules and data-architecture review.
- Reserve **at least 20% of each slice** for refactoring/consolidation. Record the concrete refactor in the PR body.
- Runtime verification uses the shared `local-integration-ci` lease or governed live-install path, never an ad hoc per-worktree runtime.

## Dependency graph

```text
P0 evidence + contracts
 ├─ P1 navigation split
 ├─ P2 operational hot path
 │    └─ P3 restaurant resource model + FLOOR proof
 └─ P4 performance projection + route
      └─ P5 cross-view reconciliation

P0 + P2 + P3 proven seams
 ├─ P6 salon BOOK
 ├─ P7 rental YARD
 ├─ P8 hotel ROOMS
 ├─ P9 HOA TERRITORY
 └─ P10 HVAC TERRITORY

P11 certification + rollout follows every vertical slice
```

## P0 — Freeze the evidence and contracts

**Backlog:** `BI-2480D253`, `BI-00D276B2`
**Goal:** make current precedent and cross-view contracts durable before UI implementation.

### Work

1. Extend the governed design-intelligence corpus with the six official precedent packs listed in the design.
2. Each pack records operator job, information hierarchy, spatial grammar, state vocabulary, conflict behavior, accessibility alternative, Performance metrics, adopt/adapt/reject decision, access date, and recheck date.
3. Add a design-grounding validator that requires a current pack or explicit no-precedent rationale for physical-twin plans.
4. Add `ArchetypeBusinessViews`, `OperationsViewProfile`, `PerformanceMetricDefinition`, and `PerformanceMetricPack` as pure contracts in `packages/storefront-templates`.
5. Derive the initial six packs from existing archetype axes/vocabulary with leaf overrides only for genuine exceptions.
6. Document the compatibility boundary around `LivingBusinessSnapshot`; do not add fields to its loader until P2 splits selectors.

### Likely files

- `packages/storefront-templates/src/twin-profile.ts`
- `packages/storefront-templates/src/business-view-profile.ts` (new)
- `packages/storefront-templates/src/business-view-profile.test.ts` (new)
- governed design-intelligence/precedent corpus paths discovered by `BI-2480D253`
- planning/design-grounding validator and tests

### Refactor allocation

Consolidate duplicate archetype-to-view noun/metric derivations into the storefront-template package. The corpus links to the incumbent/vendor registry rather than duplicating vendor identities.

### Verification

- All seeded archetypes derive exactly one Operations profile and a bounded Performance pack.
- Six physical packs resolve by archetype ID, template/space kind, and operator job.
- No corpus entry copies redistributable vendor assets.

## P1 — Make Operations and Performance first-class navigation siblings

**Backlog:** `BI-E12431C3`
**Depends on:** P0 contracts
**Goal:** establish the visible owner mental model without a risky route rename.

### Work

1. Add a dedicated `view_business_performance` capability to the canonical permission registry and its MCP/schema mirrors in the same change.
2. Update `PORTAL_NAV_ROUTES`:
   - visible `/workspace` shell label → `Operations`;
   - description → current business state and next action;
   - add `/performance` as a `domain-home` in the main business/workspace rail;
   - gate it to owner/manager roles and appropriate audience modes.
3. Keep `/workspace/inbox` and `/workspace/my-queue` as section siblings. Do not make Performance a local tab or a Workspace section sibling with operational queues.
4. Add the `/performance` route shell, metadata, loading skeleton, permission boundary, empty/setup state, and report-kit-only placeholder fed by an empty real provider.
5. Update active-state, route inventory, mobile rail, keyboard, breadcrumb, and authorization tests.
6. Update operator/user documentation to explain Operations vs Performance.

### Likely files

- `apps/web/lib/navigation/portal-navigation-model.ts`
- `apps/web/lib/govern/permissions.ts`
- `apps/web/lib/govern/permissions.test.ts`
- `apps/web/lib/navigation/portal-navigation-model.test.ts`
- `apps/web/components/shell/AppRail.test.tsx`
- `apps/web/app/(shell)/performance/layout.tsx` (new)
- `apps/web/app/(shell)/performance/loading.tsx` (new)
- `apps/web/app/(shell)/performance/page.tsx` (new)
- `docs/user-guide/`

### Refactor allocation

Move any remaining duplicated shell/section labels and route metadata into the typed navigation registry. Do not teach `AppRail` special cases for either route.

### Verification

- Unauthorized worker: Operations visible, Performance absent and server-denied.
- Authorized owner/manager: both visible, labels and active states correct.
- Existing `/workspace` bookmarks remain valid.
- Keyboard and mobile navigation reach both destinations.
- No route exposes a second primary navigation component.

## P2 — Split and instrument the Operations hot path

**Backlog:** `BI-5A855584`
**Depends on:** P0
**Goal:** make the shared current-state path bounded, versioned, measurable, and safe for customer-facing assignments.

### Work

1. Characterize the current `loadLivingBusinessSnapshot` query count, payload, server duration, and client render/interaction cost with restaurant data.
2. Introduce focused pure contracts:
   - `VersionedOperationsSnapshot`;
   - summary/capacity selector;
   - scene-entity selector;
   - queue/conflict selector;
   - activity/presence selector.
3. Keep `loadLivingBusinessSnapshot` as a compatibility facade while callers migrate.
4. Add an idempotent operational command boundary with `expectedVersion`, intended interval, entity references, and typed `confirmed | conflict | rejected | unsupported` results.
5. Reuse database overlap/hold constraints where they own the invariant. Do not implement concurrency only in React state.
6. Add immediate local selection/pending state and deterministic rollback/reconciliation.
7. Add server timing, browser performance marks, command outcome/latency telemetry, and p50/p75/p95 aggregation.
8. Add query indexes only from captured plans/evidence; migration includes fleet-safe remediation/attestation.
9. Apply React Flow performance rules: memoized node/edge types and handlers, narrow store selectors, simple styles, and no full-node subscriptions in unrelated panels.

### Likely files

- `apps/web/lib/twin/living-business-snapshot.ts`
- `apps/web/lib/twin/operations-snapshot.ts` (new)
- `apps/web/lib/twin/operations-command.ts` (new)
- `apps/web/lib/twin/operations-telemetry.ts` (new)
- `apps/web/lib/workspace-home/twin-panel-data.ts`
- `apps/web/components/twin/**`
- `packages/db/prisma/schema.prisma` and migration only if evidence requires them

### Refactor allocation

At least 20% is the `LivingBusinessSnapshot` decomposition and shared selector/command/telemetry extraction. No new vertical fields remain in the compatibility loader after the slice.

### Verification

- Pure selector and command-result tests.
- Concurrent assignment integration test.
- Query-plan and server-timing evidence.
- Operations bundle inspection proves Performance/reporting code is absent.
- Baseline and resulting p50/p75/p95 are attached to the PR.

## P3 — Restaurant resource model and business-grade FLOOR proof

**Backlog:** `BI-57F34A00`, `BI-287AA5F7`
**Depends on:** P0, P2, spatial P0 geometry items
**Goal:** prove the full design at the highest-pressure interaction: seating a party at the host stand.

### Work

1. Land the Food & Hospitality resource/capacity model. Tables are no longer inferred from `ServiceProvider.name`; staff, tables, menu/offers, service periods, and booking demand are distinct.
2. Backfill/quarantine existing “Table N” provider rows idempotently; preserve staff rows and references. Use expand → migrate → contract if a one-release migration cannot be fleet-safe.
3. Bind persisted `OperationalSceneLayout` geometry to real table IDs.
4. Model table label, shape, covers, combinability, service area, blocked reason, current party/booking, server section, and optimistic-concurrency version.
5. Render available, seated/ordered/paid/dirty/blocked/turning-soon states with text + icon + semantic color.
6. Render reservations and waitlist beside the floor; selecting a party highlights valid tables and explains invalid choices.
7. Implement seat/move/combine/reassign commands through P2’s command boundary.
8. Show server rotation, covers/load, table turn estimate, and conflict consequences without leaking guest/private notes.
9. Keep the list/table alternative fully operable.
10. Build the busy-shift fixture:
    - reservation plus walk-in;
    - combined tables;
    - server imbalance;
    - dirty and blocked table;
    - late turn;
    - allergy/VIP privacy boundary;
    - two hosts attempting the same table.

### Likely files

- Food & Hospitality resource models in `packages/db/prisma/schema.prisma`
- `apps/web/lib/storefront/restaurant-capacity.ts`
- `apps/web/lib/storefront/floor-layout.ts`
- `apps/web/components/twin/floor/**`
- `apps/web/components/storefront-admin/TablesNowView.tsx`
- `apps/web/app/(shell)/storefront/tables/page.tsx`
- Operations route composition under `apps/web/app/(shell)/workspace`

### Refactor allocation

Retire table-name heuristics and consolidate floor/list state, status vocabulary, assignment commands, and accessible selection into shared primitives usable by BOOK/ROOMS/YARD.

### Verification

- Visible response to selection/drag ≤100 ms.
- INP p75 ≤200 ms on supported profiles.
- Current-state read p95 ≤150 ms in canonical nonprod.
- Conflict-checked assignment p95 ≤500 ms.
- Double-booking test returns conflict; no inconsistent floor/list state.
- Desktop, tablet/touch, keyboard-only, screen-reader labels, reduced motion, and list parity.
- Customer-facing read-only availability leaks no guest/staff information.

## P4 — Build the governed Performance projection and route

**Backlog:** `BI-PLAN-005`
**Depends on:** P0, P1; coordinate with `BI-PLAN-004`
**Goal:** ship useful owner/manager performance without coupling analytics to Operations.

### Work

1. Inventory existing finance, booking, workforce, queue, marketing, and vertical metrics plus their source owners.
2. Run the data-architecture review against `BI-PLAN-004`. Reuse an in-flight canonical metric/semantic model if present.
3. If no canonical storage exists, add the minimal rollup projection described in the design:
   - organization;
   - metric key;
   - period start/end/timezone;
   - dimensions hash/JSON;
   - value and unit;
   - definition version;
   - source watermark;
   - computed-at timestamp.
4. Add an asynchronous, idempotent rollup job and refresh status. Preserve the last valid snapshot on refresh failure.
5. Implement `BusinessPerformanceSnapshot` provider and the initial restaurant metric pack.
6. Build `/performance` with report-kit `StatCard`/`KpiCard`, `Chart`, `DataTable`, `FilterBar`, `Skeleton`, `Notice`, and `ExportButton`.
7. Stream summary, trends, drivers, and vertical performance independently. One failed section does not blank the route.
8. Add period/comparison filters, target/budget comparison when available, freshness, definition help, source drill-down, and permission-scoped export.
9. Add an evidence-citing coworker management summary only after the deterministic metrics render; it never invents a missing metric.

### Likely files

- `packages/storefront-templates/src/business-view-profile.ts`
- `apps/web/lib/performance/metric-registry.ts` (new)
- `apps/web/lib/performance/performance-snapshot.ts` (new)
- `apps/web/lib/performance/rollup.ts` (new)
- `apps/web/app/(shell)/performance/**`
- `apps/web/components/performance/**`
- `packages/db/prisma/schema.prisma` and migration if required
- Inngest/event registration following existing job conventions

### Refactor allocation

Consolidate metric definitions, formatting, comparison semantics, freshness/lineage, and report-kit composition. Do not leave archetype metrics as page-local query and copy constants.

### Verification

- Metric definition tests and source-owner validation.
- Rollup idempotency, late-data, timezone, comparison, and failure-degradation tests.
- Permission and export-scope tests.
- Summary p75 ≤1.5 s; each deferred section p75 ≤3 s.
- Operations command latency is unchanged with Performance rollups running.

## P5 — Cross-view reconciliation and drill-through

**Backlog:** `BI-00D276B2`
**Depends on:** P3, P4
**Goal:** prove the two views are different lenses over the same business facts.

### Work

1. Add a reconciliation harness that compares current-day performance contributors to Operations source IDs and watermarks.
2. From a metric variance, drill to contributing records and then to relevant Operations context when actionable.
3. Render honest bounded-staleness copy when Performance trails current Operations.
4. Add mismatch telemetry and an owner-readable “data still catching up” state; do not silently reconcile by changing one surface.
5. Add a restaurant acceptance journey from full dining room → late turn → wait increase → table assignment → completed service → changed utilization/turn metric.

### Refactor allocation

Centralize source references, watermarks, metric drill-down routes, and mismatch states. Remove cross-route one-off link construction.

### Verification

- Same fixture produces matching source membership and expected freshness difference.
- Mismatch is observable and does not block Operations.
- Drill-through respects customer/workforce/financial permissions.

## P6–P10 — Roll out the proven physical archetypes

Each vertical is its own BI/branch/PR and must consume P0–P5 contracts.

| Phase | Backlog | Operations proof | Performance proof |
| --- | --- | --- | --- |
| P6 Salon BOOK | `BI-9FA3C3A4` | chairs/rooms × beauticians, services, processing gaps, walk-ins, conflicts | appointments, occupancy, retention, no-shows, team utilization, sales |
| P7 Rental YARD | `BI-101255AC` | serialized/bulk inventory, location, custody, booking window, pickup/return, maintenance | utilization, revenue, ROI, downtime, late returns, lost demand |
| P8 Hotel ROOMS | `BI-CCE939AF` plus lodging domain BIs | room occupancy, arrivals/departures, housekeeping, maintenance, assignment | occupancy, ADR, RevPAR, pace, channels, turnaround, out-of-service |
| P9 HOA TERRITORY | `BI-76C1B949` + `BI-8D9A2DE5` | association/property hierarchy, condition, actions/work orders, vendors, priority | aging/SLA, vendor cycle/cost, collections/violations when authorized |
| P10 HVAC TERRITORY | `BI-49036A4F` + `BI-8D9A2DE5` | unassigned demand, schedule, map, skills, capacity, travel, locked conflicts | revenue/jobs, conversion, utilization, drive time, first-time fix, leakage |

For each:

1. Consume a current `BI-2480D253` precedent pack.
2. Prove domain-owned data and adapter seams before adding schema.
3. Implement accessible visual + list parity.
4. Implement conflict-safe commands and busy-day fixtures.
5. Implement bounded Performance pack and reconciliation.
6. Capture the same latency, accessibility, permission, and live UX evidence as restaurant.
7. Spend at least 20% on shared-primitives refactoring and feed durable learnings to the commons.

## P11 — Certification, rollout, and regression

**Backlog:** `BI-D5EFB4AE`, `BI-1F17FB0D`, plus each vertical BI
**Depends on:** the relevant vertical phase
**Goal:** prevent prototype behavior from returning.

### Work

1. Extend archetype acceptance with two named gates: Operations and Performance.
2. Add route/nav/audience, no-fabricated-data, graphical/list parity, conflict, freshness/lineage, and latency checks.
3. Capture desktop/tablet/mobile visual evidence and the complete high-pressure scenario.
4. Add source/code/performance/live-UX proof artifacts to the owning backlog items.
5. Update user guide, route map, architecture docs, and in-app help.
6. Route confirmed cross-vertical techniques to WSID/platform commons.

## Backlog coverage

This plan is decomposed. Every independently shippable deliverable maps to a live BI:

| Key | Deliverable | Backlog | Depends on |
| --- | --- | --- | --- |
| evidence-contracts | Precedent corpus and derived two-view contracts | `BI-2480D253` | — |
| navigation | Main-rail Operations and Performance destinations | `BI-E12431C3` | evidence-contracts |
| operations-hot-path | Versioned projection, commands, latency telemetry | `BI-5A855584` | evidence-contracts |
| restaurant-resources | Food & Hospitality resource/capacity model | `BI-57F34A00` | operations-hot-path |
| restaurant-floor | Business-grade restaurant FLOOR | `BI-287AA5F7` | restaurant-resources |
| performance | Performance projection, metric packs, route | `BI-PLAN-005` | evidence-contracts, navigation |
| reconciliation | Cross-view lineage, mismatch, drill-through | `BI-00D276B2` | restaurant-floor, performance |
| salon | Salon BOOK | `BI-9FA3C3A4` | reconciliation |
| rental | Rental YARD | `BI-101255AC` | reconciliation |
| hotel | Hotel ROOMS | `BI-CCE939AF` | reconciliation |
| hoa | HOA/property TERRITORY | `BI-76C1B949` | reconciliation |
| hvac | HVAC TERRITORY | `BI-49036A4F` | reconciliation |

The live coverage receipt is recorded on `BI-00D276B2` and must be copied below before implementation.

### Coverage receipt

Recorded by the governed planning tool:

- **Receipt:** `cms4suakr0uf701rurfz4r5f4`
- **Decision:** `decomposed`
- **Mapped items:** `BI-2480D253`, `BI-E12431C3`, `BI-5A855584`, `BI-57F34A00`, `BI-287AA5F7`, `BI-PLAN-005`, `BI-00D276B2`, `BI-9FA3C3A4`, `BI-101255AC`, `BI-CCE939AF`, `BI-76C1B949`, `BI-49036A4F`

Revalidate this receipt with `check_plan_backlog_coverage` before the first implementation slice and whenever the plan is resumed.

## Verification matrix

| Gate | P0/P1 | P2/P3 | P4/P5 | Vertical rollout |
| --- | --- | --- | --- | --- |
| Targeted unit tests | required | required | required | required |
| Typecheck | required | required | required | required |
| Production build | required | required | required | required |
| Migration apply/upgrade | if schema | if schema | if schema | if schema |
| Live UX | nav/audience | busy-shift Operations | owner Performance + reconciliation | archetype busy-day |
| Accessibility | keyboard/mobile | visual/list parity | charts/tables/filters | full |
| Performance | route transition | all hot-path budgets | streaming + no regression | all hot-path budgets |
| Documentation impact | user/route docs | operator workflow | metric definitions/help | archetype guide |

Implementation PRs run the affected package tests, `pnpm --filter web build`, and the DPF governed runtime gates. Before a PR is called ready, run the local merged-code gate and `pnpm pr:health`.
