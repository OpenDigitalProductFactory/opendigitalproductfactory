# Business Operations and Performance Views — design

- **Date:** 2026-07-28
- **Status:** ready for phased implementation
- **Umbrella backlog:** `BI-00D276B2`
- **Primary epics:** `EP-LIVING-BUSINESS-EXCELLENCE`, `EP-SPATIAL-OPERATIONAL-VIEWS`, `EP-PLANNING-ANALYTICS`, `EP-NAV-COHERENCE`
- **Kernel decision:** `DI-C1F615336FBD` — explicit global siblings, high confidence

## Executive decision

The owner-facing DPF portal has two primary business jobs:

1. **Operations** — manage what is happening now: capacity, demand, people, places, assignments, conflicts, exceptions, and the next safe action.
2. **Performance** — understand how the business is doing over time: results, trends, targets, constraints, causes, and management decisions.

They will be explicit sibling destinations in the main portal rail. The first implementation keeps `/workspace` as the stable technical route but changes its visible label and purpose to **Operations**. A new, owner/manager-gated `/performance` route becomes the second destination. “Needs you” and “My work” remain subordinate pages under Operations.

This is not two dashboards over the same loader. Operations is a low-latency transactional read-and-command surface. Performance is a historical, pre-aggregated, traceable reporting surface. Performance queries must never delay seating a party, assigning a beautician, allocating a room or rental unit, or dispatching a technician.

## Why this supersedes neither the twin nor reporting work

This design joins existing work at the correct seams:

| Existing substrate | Reuse in this design |
| --- | --- |
| [Operational Twin Framework](2026-07-12-operational-twin-framework-design.md) | The shared grammar and archetype-derived `TwinProfile` remain the Operations visual language. |
| [Spatial Operational Views](2026-07-21-spatial-operational-views-design.md) | `SceneLayout`, `OperationalSceneLayout`, React Flow, and MapLibre remain the geometry/rendering substrate. |
| [Main Portal Workspace Home](2026-06-06-main-portal-workspace-home-redesign-design.md) | `/workspace` remains the current-business home and continues to use real loaders and one attention claim. |
| [Portal Navigation and Archetype IA](2026-06-05-portal-navigation-archetype-ia-design.md) | The typed route registry, worker/operator modes, durable-job global navigation, sibling-only section navigation, and route migration rules remain authoritative. |
| `LivingBusinessSnapshot` | Remains the current-state projection seam. It must be split into bounded selectors/adapters before it grows further. |
| `report-kit` | Remains the only reporting and chart primitive family for Performance. |
| `QueueTelemetryEvent` / `QueueMetricSnapshot` | Provide a precedent for append-only telemetry plus periodic rollups; they are not repurposed as generic business metrics. |
| `BI-PLAN-004` / `BI-PLAN-005` | Own governed analytics ingestion and the Performance dashboard/metric capability. |

The current restaurant floor is explicitly an increment, not the target. It auto-lays out “table-like” `ServiceProvider` rows inferred from names. The persistent Food & Hospitality resource model is already owned by `BI-57F34A00`; business-grade FLOOR remains `BI-287AA5F7`.

The 2026-07-28 overlap sweep found no open PR matching twin, spatial, restaurant, workspace, navigation, performance, planning, analytics, floor, or storefront work. Recent merged evidence incorporated here includes the spatial spec/plan (`#3355`), restaurant capacity reconciliation (`#3402`), restaurant floor increment (`#3408`), attention reconciliation (`#3403`), and owner-first business-domain framing (`#3412`).

## UX and information architecture

### Global navigation

| Destination | Visible label | Initial route | Audience | Purpose |
| --- | --- | --- | --- | --- |
| Current business | **Operations** | `/workspace` | workers, owners, managers | Make safe current-state decisions quickly. |
| Business results | **Performance** | `/performance` | owners and authorized managers | Understand results, trends, causes, and priorities. |

The existing route name is deliberately preserved in phase one. A route rename would add bookmark, test, documentation, and redirect risk without improving the visible mental model. The typed `PORTAL_NAV_ROUTES` registry remains the single source for labels, audience, ownership, active state, and siblings.

Performance is deny-by-default. It requires a dedicated read capability rather than borrowing broad platform administration access. Workers who do not manage business results should not see owner financial, team-comparison, or cross-location metrics.

### Operations first viewport

The first viewport answers, in order:

1. **What is the business state right now?**
2. **What demand is waiting or at risk?**
3. **What valid action can I take next?**
4. **What conflict or consequence should I understand before committing?**

Desktop composition:

```text
Operations — <business>          <current period>  <freshness>  <primary action>
┌ Capacity / readiness ──────────────────────────────────────────────────────┐
│ available · occupied · soon free · blocked · waiting · at-risk            │
└─────────────────────────────────────────────────────────────────────────────┘
┌ Physical/operational surface ─────────────┬ Demand and conflicts ──────────┐
│ floor / chairs / rooms / yard / territory │ reservations / queue / alerts  │
│ select → explain → propose → confirm       │ one prioritized next action    │
└────────────────────────────────────────────┴────────────────────────────────┘
┌ Accessible list parity ────────┬ People/coworkers ─────┬ Activity ─────────┐
└────────────────────────────────┴────────────────────────┴───────────────────┘
```

The visual surface is not the only way to work. Every entity, state, filter, and command has a semantically equivalent list/table path. Color is redundant with text/icon/state labels. High-frequency controls target at least 44×44 CSS pixels; the WCAG 2.2 minimum remains 24×24 or its spacing exception.

### Performance first viewport

The first viewport answers:

1. **How are we doing?**
2. **What changed against a comparable period or target?**
3. **Why did it change?**
4. **What management decision deserves attention?**

```text
Performance — <business>         <period>  <compare to>  <computed at>  Export
┌ Outcome scorecard ──────────────────────────────────────────────────────────┐
│ revenue / demand / capacity use / service quality / labor / cash           │
└─────────────────────────────────────────────────────────────────────────────┘
┌ Trend and variance ─────────────────────┬ Drivers and constraints ─────────┐
│ report-kit charts, streamed separately  │ ranked evidence-backed changes   │
└──────────────────────────────────────────┴──────────────────────────────────┘
┌ Archetype performance ──────────────────┬ Decisions / scenarios ───────────┐
│ bounded vertical metric pack            │ cited coworker recommendation    │
└──────────────────────────────────────────┴──────────────────────────────────┘
```

Every metric displays its period, unit, freshness, definition, and comparison basis. Every headline metric drills to contributing records or explains why source detail is restricted. Charts never fabricate interpolation or substitute a demo fixture for missing data.

## Current industry precedent

The precedent corpus itself is owned by `BI-2480D253`. This section records the design synthesis used for this plan; implementation consumes the durable corpus rather than searching again.

### Operations precedent

| Archetype | Current industry operating surface | DPF contract |
| --- | --- | --- |
| Restaurant | Toast and OpenTable center a status-colored floor, waitlist, table/turn state, server sections/rotation, and drag-to-seat assignment. | FLOOR shows real tables, sections, covers, turn state, server load, waiting parties, assignment recommendations, and conflicts. |
| Salon | Fresha centers a provider/resource calendar, availability, group alignment, waitlist, and automatic resource assignment. | BOOK combines the time grid with physical chairs/rooms, staff capability, processing gaps, and double-booking prevention. |
| Hotel | Cloudbeds separates the live room calendar/housekeeping state from reporting: arrivals, departures, occupancy, availability, clean/dirty/inspected, and room assignment. | ROOMS shows occupancy plus turnover/housekeeping/maintenance state and prevents invalid room assignment. |
| Equipment rental | Booqable centers availability, serialized or bulk stock, pickup/return work, location, and maintenance downtime. | YARD shows custody, location, readiness, booking window, substitutes, overdue returns, and maintenance conflicts. |
| HOA/property | AppFolio and Vantaca organize properties/associations around owned action items, work orders, messages, violations, aging, and priority. | TERRITORY uses property hierarchy plus geographic/condition overlays and a priority-owned action queue. |
| HVAC/field service | ServiceTitan centers an unassigned-demand dispatch board, technician schedules, map/position, capacity, skills, zones, locked work, and route conflicts. | TERRITORY joins queue, schedule, map, skill/capacity fit, travel, locked commitments, and explainable route proposals. |

Primary sources: [Toast Tables](https://support.toasttab.com/en/article/Using-Toast-Tables-Waitlist?lang=en_US), [OpenTable table management](https://www.opentable.com/restaurant-solutions/products/table-management/), [Fresha scheduling](https://www.fresha.com/for-business/features/scheduling), [Cloudbeds housekeeping and room status](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/48389981165083-Managing-Housekeeping-and-Room-Status-from-the-New-Calendar), [Booqable features](https://booqable.com/features/), [Vantaca action items](https://support.vantaca.com/hc/en-us/articles/360002385632-What-is-an-Action-Item), and [ServiceTitan dispatch](https://help.servicetitan.com/docs/dispatch-track-your-technicians).

### Performance precedent

Industry platforms consistently separate “run today” from “analyze the business,” while keeping drill-down to source work:

- Toast reports real-time restaurant sales, guests, turn time, service periods, labor and location/date comparisons through report cards and drill-down reports.
- Fresha provides daily/weekly/monthly Performance Insights across sales, appointments, occupancy, clients, teams, locations, retention, and future demand.
- Cloudbeds separates the current-day PMS dashboard from reporting/Insights for occupancy, ADR, RevPAR, pace, channels, revenue, payments, and multi-property comparison.
- Booqable reports product revenue, usage, ROI, popularity, availability, pickup work, and customer balances.
- ServiceTitan provides customizable owner dashboards for revenue trends, technician and CSR scorecards, job costing, materials, and work in progress.

Primary sources: [Toast Sales Summary](https://central.toasttab.com/articles/Knowledge/Sales-Summary-Report), [Fresha Performance Insights](https://www.fresha.com/help-center/knowledge-base/reports/100652-access-your-performance-insights), [Cloudbeds Reports](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/41695559811611-Cloudbeds-Reports-Hotel-Reporting-for-Operational-Financial-Revenue-Occupancy-Analysis), [Booqable reports](https://help.booqable.com/en/articles/1354239-getting-started-with-reports-and-exports), and [ServiceTitan field reporting](https://www.servicetitan.com/features/field-reporting-software).

DPF should do better in three ways: one shared grammar across archetypes, direct reconciliation between current operations and historical results, and attributed AI coworker recommendations that cite the records and assumptions behind them.

## Archetype contracts

Each archetype contributes two bounded packs:

```ts
interface ArchetypeBusinessViews {
  operations: OperationsViewProfile;
  performance: PerformanceMetricPack;
}

interface OperationsViewProfile {
  twinProfile: TwinProfile;
  sceneAdapter: string;
  currentStateSelector: string;
  commandKinds: readonly string[];
  conflictKinds: readonly string[];
  textAlternative: "list" | "table";
}

interface PerformanceMetricDefinition {
  key: string;
  label: string;
  unit: "count" | "currency" | "percent" | "duration" | "rate";
  sourceOwner: string;
  grain: "day" | "week" | "month";
  aggregation: string;
  comparison: "prior-period" | "prior-year" | "target" | "none";
  drilldownRoute?: string;
  sensitivity: "business" | "financial" | "workforce" | "customer";
}

interface PerformanceMetricPack {
  headline: readonly string[];
  operating: readonly string[];
  financial: readonly string[];
  customer: readonly string[];
  workforce: readonly string[];
}
```

These are derived configuration in `packages/storefront-templates`, not authored page JSON. Domain facts remain in their owning models. Adapters normalize domain rows into the shared view contracts; the renderer does not force restaurants, rentals, hotels, and HVAC into one generic physical-resource table.

Initial performance packs:

| Archetype | Headline metrics |
| --- | --- |
| Restaurant | sales, covers, average check, table utilization, turn time, wait/no-show rate, labor percentage |
| Salon | sales, appointments, occupancy, rebooking/retention, no-shows, staff utilization, retail mix |
| Hotel | occupancy, ADR, RevPAR, pace, channel mix, room-turnaround time, out-of-service nights |
| Rental | utilization, rental revenue, asset ROI, downtime, late-return rate, lost-demand/substitution rate |
| HOA/property | open and aging actions, SLA attainment, work-order cost, vendor cycle time, collections/violations where authorized |
| HVAC | revenue, jobs, conversion, technician utilization, drive time, first-time-fix rate, capacity leakage |

## Data and command architecture

### Operations: current-state projection plus commands

`LivingBusinessSnapshot` remains the compatibility entry point but is decomposed behind focused selectors:

```text
domain tables + operational events + authored geometry
                   │
          archetype/domain adapters
                   │
       VersionedOperationsSnapshot
          ├─ summary/capacity selector
          ├─ scene entity selector
          ├─ queue/conflict selector
          └─ activity/presence selector
                   │
       React Flow / MapLibre / list parity
                   │
        idempotent command service
          └─ transaction + expectedVersion + conflict result
```

The snapshot contract carries `asOf`, `version`, `sourceWatermark`, and explicit degraded-source flags. UI selection is local and immediate. A durable assignment sends `idempotencyKey`, `expectedVersion`, entity IDs, and the intended time interval. The server validates permission, current availability, overlap/exclusion constraints, locks or holds the relevant rows, and returns one of:

- `confirmed` with the new version;
- `conflict` with the changed facts and safe alternatives;
- `rejected` with a permission/business-rule explanation;
- `unsupported` when the active provider/capability cannot perform the operation.

Optimistic feedback never claims confirmed state. It uses a visible “Assigning…” pending state and rolls back/reconciles on conflict. A coworker proposal is not a bypass: pure allocations still require the configured confirmation boundary, while business judgments use the existing WWWD gate.

### Performance: governed rollups and lineage

Performance reads a separate provider contract:

```ts
interface BusinessPerformanceSnapshot {
  organizationId: string;
  period: { start: string; end: string; timezone: string };
  comparedWith?: { start: string; end: string; basis: string };
  computedAt: string;
  sourceWatermark: string;
  definitionVersion: string;
  metrics: PerformanceMetricValue[];
}
```

`BI-PLAN-004` owns the eventual governed analytics substrate. The first slice may use an internal rollup table/materialized projection, but only after the data-architecture review proves no in-flight canonical model fits. It must store organization, metric key, period, dimensions hash, value/unit, definition version, source watermark, and computed-at time; it must not store display copy or chart layout.

Rollups refresh asynchronously from source facts and append-only telemetry. The route serves the last valid snapshot with freshness. A failed or late rollup degrades the affected card and raises an observable refresh condition; it does not block Operations or fabricate a current number.

### Reconciliation rule

Current-day Performance values and Operations counts must resolve from the same source facts and metric definitions even when they have different freshness. Contract tests compare contributing source IDs and watermarks. A manager can move from a performance variance to its source records, then to the relevant Operations context when action is still possible.

## Performance budgets

These are product acceptance budgets, not aspirations:

| Budget | Target | Measurement |
| --- | --- | --- |
| Selection/toggle/drag visible response | ≤100 ms | Browser performance marks on supported desktop/tablet |
| Interaction to Next Paint | p75 ≤200 ms | Field/browser telemetry, split desktop/mobile |
| Current-state read | p95 ≤150 ms in canonical nonprod | Server timing + query telemetry |
| Conflict-checked assignment confirmation | p95 ≤500 ms | End-to-end command telemetry; immediate pending feedback |
| Operations first decision surface | p75 ≤2.5 s remote; target ≤1.5 s local install | Navigation/LCP plus “decision surface ready” mark |
| Performance summary shell | p75 ≤1.5 s | Static/cached shell plus summary rollup |
| Deferred Performance sections | p75 ≤3 s each | Independent Suspense boundaries |

The 100 ms response goal follows the web.dev RAIL model; the p75 200 ms responsiveness threshold follows INP guidance. Next.js streaming and Suspense keep slow Performance sections from blocking its shell. React Flow nodes, handlers, options, and store selectors follow the library’s memoization and narrow-subscription guidance. Sources: [web.dev RAIL](https://web.dev/articles/rail), [web.dev INP](https://web.dev/articles/inp), [Next.js streaming](https://nextjs.org/docs/app/getting-started/linking-and-navigating), and [React Flow performance](https://reactflow.dev/learn/advanced-use/performance).

Performance regressions are release failures for the operational path. The plan adds busy-shift fixtures, query-plan assertions for critical lookups, browser timing marks, and p50/p75/p95 evidence. Historical charts and exports are explicitly absent from the assignment code path and critical JavaScript bundle.

## UX-fit verdict

**Fits with guardrails.**

- **Owning area:** Operations owns current management; Performance owns management analytics. Storefront remains public-site/configuration work, not the operating home.
- **Primary personas:** front-line worker/host/dispatcher for Operations; owner/manager for Performance.
- **Navigation:** global rail changes because both are durable primary jobs. Subordinate queues remain section navigation.
- **Primitives:** operational twin + SceneLayout for space, report-kit for analytics, existing attention and PAR/WWWD contracts for decisions.
- **Guardrails:** no third dashboard, no mixed setup/content controls, no fabricated data, no color-only state, no visual-only commands, no historical query on the transactional hot path.

## Architecture review

### Fit

- Extends the typed route registry instead of hardcoding AppRail items.
- Extends `TwinProfile` and the planned scene contract instead of creating archetype canvases.
- Keeps live state as a projection and authored geometry as durable input.
- Keeps domain facts domain-owned and normalizes through adapters.
- Reuses report-kit and the planned analytics epic for historical reporting.
- Preserves current route compatibility and makes the migration reversible.

### Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| `LivingBusinessSnapshot` becomes a god-loader | Split selectors/adapters before adding vertical depth; preserve a compatibility facade temporarily. |
| Restaurant continues treating tables as staff/providers | `BI-57F34A00` lands a real Food & Hospitality resource model; retire name heuristics through the existing projection seam. |
| Generic resource model flattens archetypes | Domain-owned models plus typed adapters; shared contracts stop at state/scene/command semantics. |
| Performance numbers disagree with Operations | Metric registry, source watermark, definition version, contributing-record drill-down, reconciliation tests. |
| Charts degrade the host stand | Separate route, bundles, loaders, rollups, Suspense boundaries, and explicit budgets. |
| Concurrent assignments double-book | Expected-version/idempotency plus database overlap/hold constraints and deterministic conflict UI. |
| Main rail becomes crowded | Audience gating and Simple/Full mode; only these two business views are promoted, not every twin subroute. |
| External tools become accidental dependencies | Renderer/provider capability flags and schematic/offline fallback; no tool adopted outside the governed evaluation process. |

## Sequencing and backlog ownership

| Deliverable | Owner |
| --- | --- |
| Umbrella coordination and cross-view acceptance | `BI-00D276B2` |
| Main-rail Operations + Performance IA | `BI-E12431C3` |
| Hot-path projection, conflict-safe commands, latency telemetry | `BI-5A855584` |
| Performance route, metric packs, rollups, lineage | `BI-PLAN-005` (with `BI-PLAN-004` dependency for broader analytics substrate) |
| Durable precedent corpus/design gate | `BI-2480D253` |
| Restaurant domain resource/capacity model | `BI-57F34A00` |
| Restaurant business-grade FLOOR | `BI-287AA5F7` |
| Shared geometry and geographic renderer | spatial `P0`/`P2` items, including `BI-8D9A2DE5` |
| Salon BOOK | `BI-9FA3C3A4` |
| Rental YARD | `BI-101255AC` |
| Hotel ROOMS | `BI-CCE939AF` plus lodging domain items |
| HOA/property TERRITORY | `BI-76C1B949` |
| HVAC TERRITORY composition | `BI-49036A4F` |

The [implementation plan](../plans/2026-07-28-business-operations-and-performance-views-plan.md) is deliberately staged. The shared contracts and restaurant proof land first; other physical archetypes consume proven seams rather than building in parallel against unstable primitives.

## Acceptance

1. Operations and authorized Performance are visible as distinct main-rail destinations with correct active state, audience, breadcrumbs, mobile behavior, and route-map tests.
2. Operations renders the active archetype’s real current-state composition and accessible list parity; it does not expose public-site editing, setup recovery, or historical dashboards in its primary flow.
3. Restaurant host can select a valid table with ≤100 ms visible response and p95 ≤500 ms authoritative confirmation in the busy-shift scenario; concurrent assignment returns an understandable conflict without double-booking.
4. Performance displays time-bounded, fresh, definition-backed metrics using report-kit and independent loading boundaries.
5. Current-day metrics reconcile to Operations source records and never run historical aggregation on the assignment hot path.
6. Every physical archetype implementation cites a current precedent pack or an explicit no-precedent rationale.
7. Every graphical operation has equivalent keyboard/list operation and state is never color-only.
8. Each implementation slice spends at least 20% on consolidation/refactoring of shared navigation, projection, scene, command, metric, and telemetry primitives.
9. Unit, production build, migration (when applicable), live UX, accessibility, and performance evidence pass through the governed verification path.
