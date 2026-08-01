# Value Stream P1 (Measure) - Operator Value Stream Headline: Implementation Plan

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Recovery note (2026-08-01):** this plan was written 2026-06-13 and stranded uncommitted in a deleted thread's worktree. Only the preamble above was rewritten on recovery — it originally invoked the `superpowers:*` skills, which have since been retired. The plan body is unchanged from 2026-06-13 and predates two months of platform change; re-verify against current `main` before executing.

## Goal

Surface each organization's operational value stream on `/workspace` in a form that works for both architects and non-technical operators:

1. A compact **operator value-stream strip** that visually organizes the business's primary value delivery flow separately from supporting/trust functions.
2. A first **load-bearing headline KPI** that measures the stage most likely to break the archetype's business model.
3. An **operational summary of the whole business**: immediate needs, active work, pending needs, and developing situations, assembled from data the platform already defines.
4. Honest metric maturity: direct measures when the platform has the data; clearly labelled proxies when it does not.

This is still a P1 measure slice: no new route, no new table, no generic dashboard builder. It derives from the OVSM that P0 persists and reuses the existing workspace command-center surface plus report-kit `StatCard`.

## Review Corrections Folded Into This Plan

The original plan was directionally sound, but too narrow around "one headline metric." The hard product problem is that a business operator needs to see **what part of the business is being measured and why it matters**, not just a tile with a number.

This revision applies three lenses:

| Lens | Correction folded into the plan |
|------|---------------------------------|
| Enterprise architecture | Keep the canonical OVSM as the single source of truth. The workspace renders a projection of it; it does not create a second business-process model. |
| Operations | The surface is organized by operating urgency first: what needs attention now, what work is in motion, what is pending, and what situation is forming. Measures are then grouped by canonical axes: process time, queue size/WIP, quality, throughput/capacity, value, and trust/compliance. |
| Archetype context | The same six stages exist across archetypes, but the load-bearing question differs: a salon worries about slot load; a bakery worries about captured demand and perishability; an MSP worries about service load and estate separation; a bank or public body worries about trust gates first. |

The workspace visual follows the useful part of Porter's value chain: separate the **main value delivery/income flow** from **supporting functions**. DPF does not copy Porter's generic labels into the UI. Operators see archetype language; architects can drill into canonical stage keys and capability bindings.

### Second Review Guardrails

This review keeps the plan viable for non-technical operations and aligned to the current codebase:

- `StatCard` already supports `hint`, `intent`, `delta`, and `href`. This plan extends the workspace `SnapshotItem` contract and passes those existing report-kit props through; it does not build another card primitive.
- `STATUS_INTENT` currently has `readiness` and `severity`, but not the exact good/concern/acute/in-motion/unknown operating vocabulary. Add an explicit `operationalStatus` domain and test it.
- Loader code must accept `now` and avoid hidden global dates so the 30-day, upcoming, overdue, and revenue windows are deterministic in tests.
- A missing direct measure is not success. If the archetype and OVSM are known but the measure cannot be safely computed, show an `unknown`/neutral headline such as "Not measured" with proxy/unavailable wording, rather than omitting the operating context or turning it green.
- P1 reads the current single primary `StorefrontConfig.archetype`. Do not bake "exactly one business line forever" into copy or types; use language like "primary business flow" so the view can later become one service-line panel inside the multi-archetype composition model.

## Standards Grounding

| Standard / reference | What this plan adopts |
|----------------------|-----------------------|
| Lean Enterprise Institute value-stream mapping | Stage measures must include operational signals such as cycle/process time, lead time, and percent complete and accurate; queue/WIP and availability are valid stage-health signals. See [Value Stream Mapping](https://www.lean.org/lexicon-terms/value-stream-mapping/). |
| Business Architecture Guild value-stream guidance | Value streams express stakeholder value and stages realize value items; capabilities are cross-mapped to the stages that enable value. See the Guild's [value streams and business processes paper](https://cdn.ymaws.com/www.businessarchitectureguild.org/resource/resmgr/public_resources/bpm_paper_final_dec2019.pdf). |
| ArchiMate value-stream element | The architecture view keeps value streams as ordered activities that create an overall result for a customer, stakeholder, or end user. See the [ArchiMate 3.2 reference card](https://www.opengroup.org/sites/default/files/docs/downloads/n221p.pdf). |
| Porter value chain | The operator view borrows the separation between primary value activities and support activities, but substitutes DPF's archetype-specific operational stages for generic Porter labels. See HBS Online's overview of [primary and support activities](https://online.hbs.edu/blog/post/what-is-value-chain-analysis). |

## Scope & Non-Scope

**In scope (this PR):**

- Derive an operator-readable workspace value-stream view from `deriveOperationalValueStream()`.
- Show the primary flow (`Attract -> Capture -> Qualify -> Deliver -> Settle -> Retain`, plus `Return & Inspect` for rental/shared-asset archetypes) separately from support/trust stages (`Trust & Compliance`, `Operate & Improve`).
- Promote the load-bearing stage's best available P1 measure into the first workspace `StatCard`.
- Keep the workspace home as an operational surface by preserving and summarizing current operational data already defined across the platform: command strip, snapshot, work in motion, calendar agenda, activity feed, sections, finance, compliance, customer, people, and AI/coworker signals.
- Extend the existing command-center snapshot contract just enough for `hint`, `intent`, and `delta` to reach `StatCard`.
- Test every archetype in `ALL_ARCHETYPES`; do not hard-code the seeded count.

**Deferred (later P1.x/P2 slices, called out so they are not silently dropped):**

- Full per-stage KPI overlays on `/finance`, `/customer`, `/storefront`, and `/compliance`.
- True stage process-time and `% complete-and-accurate` metrics where the current data model lacks enter/exit timestamps or validation outcomes.
- S1 Attract analytics (portal-view capture is not present today).
- True S3 utilization (`booked capacity / available capacity`); this slice uses an upcoming-demand proxy and labels it honestly.
- Rental/shared-asset engine metrics: asset utilization, turnaround time, reservation conflicts, overdue returns, and damage/deposit exposure.
- The full optimization loop (`measure -> propose lever -> WWWD gate -> human decision -> track effect`).

## Source Context

- Design: `docs/superpowers/specs/2026-06-12-value-stream-architecture-platform-design.md` Section 5 (measurement), Section 6 (surface reuse), Section 11 (P1).
- Source artefact: `docs/architecture/archetype-business-value-streams.md` Sections 6-8 (load-bearing stage, demand/capacity, EA/workspace presentation).
- Workspace design: `docs/superpowers/specs/2026-05-31-archetype-aware-workspace-design.md` (operator-first, archetype-aware workspace; no dashboard-builder substrate).
- Report-kit contract: `apps/web/components/ui/report-kit/README.md` (`StatCard`, `StatusBadge`, `DataTable`, `FilterBar`, `Chart`, token-backed intents).
- P0 substrate: `deriveOperationalValueStream()` in `packages/storefront-templates/src/operational-value-stream.ts` returns `{ stages[], loadBearingStageKeys[], capacityUnit, demandSignature, trustGates[] }`. Current tests assert `ALL_ARCHETYPES.length >= 56`, so this plan must iterate `ALL_ARCHETYPES` rather than saying "53" in implementation logic.
- Verified integration points:
  - `apps/web/lib/workspace-home/platform-loader.ts` loads `storefrontConfig.archetype { archetypeId, category, name, activationProfile }` and `workspaceCommandCenter`.
  - `apps/web/lib/workspace/command-center.ts` currently defines `SnapshotItem` as `{ id, label, value, href }` and builds the snapshot.
  - `apps/web/lib/workspace/command-center.ts` already classifies immediate operational signals through `commandStrip`, `snapshot`, `workInMotion`, `attentionItems`, and the platform-readiness matrix.
  - `apps/web/lib/workspace-home/platform-loader.ts` already returns `calendarEvents`, `feedItems`, and permission-derived `workspaceSections`.
  - `apps/web/components/workspace/BusinessCommandCenter.tsx` currently renders `snapshot[]` as `StatCard`s but only passes `label`, `value`, and `href`.
  - `apps/web/components/ui/report-kit/StatCard.tsx` already accepts `hint`, `intent`, `delta`, `href`, and `className`. The required work is a pass-through contract from command-center data to this existing primitive.
  - `apps/web/components/ui/report-kit/statusColors.ts` already contains `readiness` and `severity`, but not the exact operating status vocabulary in this plan.
  - `apps/web/app/(shell)/workspace/calendar/page.tsx`, `/storefront/inbox`, `/customer`, `/finance`, and `/compliance` exist as drill destinations.
  - Template resolution precedent: `apps/web/lib/storefront/project-operational-value-stream.ts` resolves templates by `ALL_ARCHETYPES.find(a => a.archetypeId === id)`.

## Refactoring Reserve

Spend the first ~20 percent of implementation on the command-center seam before adding new value-stream-specific logic:

- Extend `SnapshotItem` with optional `hint`, `intent`, and `delta` so the existing `StatCard` capability reaches the workspace.
- Add an optional `valueStream` property to `WorkspaceCommandCenterView` rather than creating a parallel workspace dashboard model.
- Add an optional `operationalSummary` property to `WorkspaceCommandCenterView` if the existing `commandStrip` / `workInMotion` / `attentionItems` cannot express immediate, pending, and situational groupings cleanly. This is a view projection only, not persistence.
- Update `BusinessCommandCenter` to pass all `StatCard` props and render the compact value-stream strip from the same view object.
- Keep data loaders behind narrow structural interfaces. Do not type hot paths as the full Prisma client type unless unavoidable.
- Keep existing workspace tile status color APIs out of scope unless they are directly touched. New value-stream/status rendering must use report-kit status semantics instead of copying tile color conventions.

This is the useful refactor: it removes the awkwardness that would otherwise force the headline metric to be a visually disconnected number.

## Workspace Visual Contract

The first viewport must make the business shape legible without architecture training.

```text
TRUST & COMPLIANCE        (support / constraint band, visible when relevant)

Attract -> Capture -> Qualify -> Deliver -> Settle -> Retain
                      ^ load-bearing stage highlighted

OPERATE & IMPROVE        (support / feedback band)
```

Rules:

- Operator language first: "Bookings needing a slot" beats `S3 Qualify`.
- Canonical stage keys may exist in data/test IDs and admin drill-downs, but should not be the main worker-facing copy.
- Highlight exactly the OVSM load-bearing stage(s); regulated archetypes may highlight trust first.
- The first `StatCard` must read as the measured headline for the highlighted stage, with a hint that names the capacity unit, demand signature, and whether the measure is a proxy.
- The strip and cards use DPF tokens and report-kit primitives; no local color maps.
- On mobile, the strip becomes an ordered, wrap-safe list. No clipping, overlapping text, or card-inside-card layout.

## Visual Activity Layer

The value-stream view must be visually meaningful before it is textually explained. A non-technical operator should be able to glance at the workspace and recognize the business situation: who/what is waiting, what is occupied, what is moving, what is blocked, and what is likely to need attention next.

This is not a decorative image requirement. For an operational surface, useful visuals are structured, data-backed views: map pins, schedules, occupancy boards, floor/room grids, queue lanes, asset pools, stock/reorder boards, inspection/turnover boards, and trust-gate boards. Use real source geometry or records when available; otherwise use a schematic visual with honest labels. Do not use stock imagery or invented photos as a substitute for operating data.

| Archetype or situation | Visual primitive | At-a-glance operator meaning | Supporting streams shown nearby |
|------------------------|------------------|------------------------------|---------------------------------|
| Field service, trades, mobile care | Map dispatch + schedule lane | Crews/jobs by location, route window, arrival risk, unassigned work. | Supplies, invoicing, permits, follow-up, customer contact. |
| Barber, salon, spa, clinic slots | Chair/room/provider slot board | Which spaces are occupied, next free slot, late/no-show risk, for-rent booth state where applicable. | Cleaning/reset, supplies, payments, retention. |
| Hotel, rental property, cleaning turnover | Unit/room turnover board | Occupied, checkout due, clean, inspect, ready, blocked. | Housekeeping, maintenance, replenishment, guest/customer issue follow-up. |
| Equipment rental, self-storage, shared assets | Asset pool board | Available, reserved, out, due back, inspect/repair, ready to re-pool. | Deposit/payment, maintenance, customer pickup/return. |
| Retail, bakery, florist, food service | Stock/reorder and freshness board | Demand, low stock, spoilage/perishable risk, reorder needed after job/order. | Purchasing, supplier lead time, sales/orders. |
| Vet, healthcare, legal, MSP, case-heavy services | Case/account queue | Waiting, in progress, blocked for information, escalation, follow-up due. | Compliance, customer communication, billing, staff capacity. |
| Bank, municipality, charity, regulated/public work | Trust-gate board | Open obligation, review, approval, submitted, acknowledged, breached. | Service queue, stakeholder/customer communication, audit trail. |

Implementation rules:

- Select the visual primitive from OVSM context (`capacityUnit`, `demandSignature`, load-bearing stage, supporting stages) plus archetype metadata. Do not scatter archetype-specific visual logic inside page components.
- Represent icons as stable icon names in the view model and render with the existing icon library, preferring lucide icons where available.
- Every visual item must have a short label, status, intent, icon, optional href, and accessible name. Color is never the only meaning.
- Maps, schedules, floor/slot boards, and asset grids must be compact and operational. They should answer "what do I act on?" before they explain "what is this architecture stage?"
- Supporting streams may appear as small overlay markers or adjacent lanes, but they must remain derived from the same OVSM and existing operational signals.

## Operational Status Semantics

Standardize status language across the value-stream strip, operational summary, visual activity layer, headline metric, maps/boards, and support streams:

| Operator status | Meaning | Report-kit intent | Example labels |
|-----------------|---------|-------------------|----------------|
| `good` | Ready, healthy, complete, available, on track. | `success` | Ready, paid, staffed, clean, available, complete. |
| `concern` | Needs attention soon, nearing limit, incomplete, at risk, waiting too long. | `warning` | Low stock, due soon, needs review, capacity tight, delayed. |
| `acute` | Blocking value delivery, overdue, breached, failed, unsafe, unavailable when needed. | `danger` | Blocked, overdue, failed, breached, no coverage, cannot dispatch. |
| `in-motion` | Normal active work that is neither good nor bad yet. | `info` or `accent` | In progress, en route, occupied, scheduled, assigned. |
| `unknown` | Not configured, unavailable, not measured, or insufficient data. | `neutral` | Not measured, no data, unavailable, setup needed. |

Implementation rules:

- Extend `apps/web/components/ui/report-kit/statusColors.ts` with an explicit `operationalStatus` domain. Do not reuse `readiness` or `severity` for this vocabulary; those domains are adjacent but not exact enough for operating states such as `in-motion` and `unknown`.
- Add or extend `apps/web/components/ui/report-kit/statusColors.test.ts` so `good`, `concern`, `acute`, `in-motion`, and `unknown` resolve to the intended report-kit intents.
- Use `resolveIntent(domain, status)` and `intentStyle(intent)` or report-kit primitives for all status color application. Raw hex, raw Tailwind palette colors, and per-page status maps are out of scope.
- Pair every status color with an icon and visible text. For compact markers, the visible text can be short, but the accessible name must carry the full meaning.
- Treat "no data" as `unknown`, not `good`. Green means evidence of readiness or health, not absence of evidence.
- Keep severity and lifecycle distinct. Example: "occupied" is `in-motion`; "occupied past checkout" is `concern` or `acute` based on business rules.

### Composition Readiness Constraint

The current workspace resolves one active storefront archetype from `StorefrontConfig.archetype`. This P1 slice should stay scoped to that current reality, but avoid making the UI or types hostile to later multi-archetype composition:

- Use copy such as "Primary business flow" rather than "the only business flow."
- Keep `WorkspaceValueStreamView` pure and serializable so it can later be repeated per service line or operating unit.
- Do not persist UI-only process stages or service-line names in this slice.
- Tests should prove today's single-archetype view remains stable; they do not need to implement the later composition engine.

## Operational Surface Contract

The `/workspace` home is the operating desk for the business. Its first job is not to explain architecture or show analytics breadth; its first job is to answer the operator's live questions:

| Operating question | Existing signal family | First-viewport treatment |
|--------------------|------------------------|--------------------------|
| What needs attention now? | `commandStrip`, `attentionItems`, overdue finance/compliance/cadence/task-run signals | Top "Needs attention" strip, ordered by severity and actionability. |
| What is happening right now? | `workInMotion`, active task runs, pending action proposals, scheduled coworker cadence, calendar events | "Work in motion" and agenda, with actor/status/href. |
| What is pending or forming? | upcoming bookings/events, pending alerts, open obligations, unpaid bills, overdue actions, low-confidence coworker assessments, open capability needs | Short "Pending needs" / "situations forming" summaries. Avoid burying these below generic counts. |
| How does this map to the business model? | OVSM value-stream strip, load-bearing stage, capacity unit, demand signature, trust gates | Value-stream strip plus headline metric. This gives the operational facts their business context. |
| Where do I act? | Existing route hrefs (`/storefront/inbox`, `/workspace/calendar`, `/customer`, `/finance`, `/compliance`, `/platform/ai`, `/ops`) | Every item drills into an existing route; no new screen or dead-end card. |

The surface should feel like the daily operating view into the entire organization: customers and delivery, schedule/capacity, finance, compliance, people, AI coworkers, and platform delivery. It should not show the full platform-readiness matrix on the business home. Readiness can still be summarized when it creates an operational need, but the detailed 6x6 maturity view stays on the platform surface.

### Current Data To Reuse Before Adding Any New Signal

| Data already loaded or cheaply available | Operational meaning |
|------------------------------------------|---------------------|
| `commandStrip` | Immediate exceptions and warnings already ranked by severity. |
| `snapshot` | Current scale/health facts; now gains the load-bearing headline first. |
| `workInMotion` | Active AI/human work, pending approvals, scheduled cadences. |
| `attentionItems` | Actionable follow-up list behind workspace tiles. |
| `calendarEvents` | Near-term scheduled work and capacity pressure. |
| `feedItems` | Recent business activity and changes worth scanning. |
| `workspaceSections` | Permission-safe navigation into available operating areas. |
| Finance metrics | Overdue invoices, outstanding receivables, unpaid bills, P&L revenue. |
| Compliance metrics | Open incidents, active obligations, overdue actions, pending alerts, implemented controls. |
| Customer/delivery metrics | Customer accounts, delivery/build counts, in-flight work. |
| People metrics | Active team members and employee profile state. |
| AI/coworker metrics | Active coworkers, broken providers, failed task runs, pending proposals, recent receipts, low-confidence assessments. |

If a proposed value-stream summary cannot be built from these sources, it is deferred or labelled unavailable. Do not add a new signal just to make the first viewport look complete.

## Canonical Measure Taxonomy

P1 only computes the headline measure, but the model must name the measure axis now so later overlays converge instead of inventing local KPI language.

| Axis | Operator question | P1 status |
|------|-------------------|-----------|
| `queue-size` | "How much demand/work is waiting or in flight?" | Direct or proxy from bookings, inquiries, orders, donations, obligations, alerts, customer accounts. |
| `process-time` | "How long does demand take to move through the stage?" | Mostly deferred until stage enter/exit timestamps exist. |
| `quality` | "Did the handoff arrive complete and accurate the first time?" | Deferred except where existing statuses make a safe proxy possible. |
| `throughput` | "How much work/value moved through the stage in the window?" | Direct/proxy from counts and finance reports. |
| `capacity-utilization` | "Are we over- or under-using the constrained unit?" | Proxy in P1; true utilization requires available-capacity denominator. |
| `value` | "What income, receipt, or settlement did this stage create?" | Direct where finance data exists. |
| `trust` | "What trust/compliance work is open before value can safely move?" | Direct/proxy from obligations, incidents, corrective actions, and regulatory alerts. |

Every metric spec returns a `measureAxis` and `measureMaturity`:

```ts
export type CanonicalMeasureAxis =
  | "queue-size"
  | "process-time"
  | "quality"
  | "throughput"
  | "capacity-utilization"
  | "value"
  | "trust";

export type MeasureMaturity = "direct" | "proxy" | "unavailable";
```

## Archetype Measurement Lens

| Archetype family | Load-bearing reality | P1 headline kind | Canonical axis |
|------------------|----------------------|------------------|----------------|
| Appointment and slot-bound services (salon, barber, spa, trainer, tutoring, pet services) | The calendar/capacity unit is the business promise. | `schedule-load` | `queue-size` / `capacity-utilization` proxy |
| Retail, bakery, florist, donation, and order-led businesses | Lost capture is lost value; perishables make late demand expensive. | `capture-volume` | `throughput` / `queue-size` |
| Trades and quote-led services | Capture quality matters more than raw volume: urgency, property, scope, and contactability. | `capture-volume` with quality limitation in the hint | `queue-size` now, `quality` later |
| Encounter/care and estate-led services (vet, dental, MSP, facilities) | Delivery needs the right record/account/asset context. | `delivery-load` | `queue-size` / `throughput` |
| Subscription and member models (gym, yoga, clubs) | Renewal/retention is the business, not the first sign-up. | `retention` | `throughput` now, `quality`/churn later |
| Regulated, public-body, and statutory services | Trust gates and universal-service obligations precede normal flow. | `trust-status` | `trust` |
| Rental/shared-asset archetypes | A reusable pooled asset must be reserved, returned, inspected, and re-pooled. | `asset-reservation-load` | `capacity-utilization` proxy |
| Settle-led archetypes, where OVSM resolves `settle` as load-bearing | The money/receipt/accounting stage carries the model. | `revenue` | `value` |

## File Map

- Create: `apps/web/lib/value-stream/workspace-value-stream-view.ts` - pure OVSM -> operator workspace strip view.
- Create: `apps/web/lib/value-stream/workspace-value-stream-view.test.ts` - covers all archetypes and primary/support separation.
- Create: `apps/web/lib/value-stream/workspace-operational-summary.ts` - pure existing workspace data -> immediate / active / pending / situation summaries, if the current command-center shape needs a thin projection.
- Create: `apps/web/lib/value-stream/workspace-operational-summary.test.ts` - verifies no new data dependency is required and summaries are ordered by urgency.
- Create: `apps/web/lib/value-stream/workspace-visual-activity.ts` - pure OVSM + existing operational summary -> visual primitive, icon names, status domain/status, and supporting overlays.
- Create: `apps/web/lib/value-stream/workspace-visual-activity.test.ts` - verifies representative archetypes select map/slot/turnover/asset/stock/case/trust primitives and never rely on color alone.
- Create: `apps/web/lib/value-stream/headline-metric-spec.ts` - pure OVSM -> headline metric spec (`kind`, `measureAxis`, `measureMaturity`, labels, hint, drill href).
- Create: `apps/web/lib/value-stream/headline-metric-spec.test.ts` - covers every archetype and each metric kind, including rental/shared-asset.
- Create: `apps/web/lib/value-stream/load-headline-metric.ts` - loads the stage value from existing data and returns a `SnapshotItem | null` plus value-stream context. `null` is reserved for no storefront/archetype/template; known-but-unmeasured cases return a neutral `unknown` snapshot.
- Create: `apps/web/lib/value-stream/load-headline-metric.test.ts` - mocked DB + reused loaders; asserts values and graceful fallback.
- Modify: `apps/web/components/ui/report-kit/statusColors.ts` - add an `operationalStatus` domain for good/concern/acute/in-motion/unknown.
- Modify/add: `apps/web/components/ui/report-kit/statusColors.test.ts` - assert the new domain maps to token-backed report-kit intents.
- Modify: `apps/web/lib/workspace/command-center.ts` - extend `SnapshotItem`; add optional `valueStream` to `WorkspaceCommandCenterView`; expose a helper to prepend the headline without mutating unrelated snapshot construction.
- Modify: `apps/web/components/workspace/BusinessCommandCenter.tsx` - render the value-stream strip and pass `hint`, `intent`, `delta` through to `StatCard`.
- Modify: `apps/web/lib/workspace-home/platform-loader.ts` - resolve/load value-stream context after storefront config, then prepend the headline metric. Thread `now` into value-stream loaders for deterministic tests.
- Modify/add tests: `apps/web/components/workspace/BusinessCommandCenter.test.tsx` and `apps/web/lib/workspace-home/platform-loader.test.ts` where practical.

---

## Chunk 1: Pure Workspace Value-Stream View

### Task 1: Derive the operator strip from OVSM

**Files:** create `workspace-value-stream-view.ts` + `.test.ts`.

- [ ] **Step 1: Write failing tests**:
  - Every archetype in `ALL_ARCHETYPES` yields a non-null `WorkspaceValueStreamView`.
  - Primary stages render in OVSM order and exclude `trust-compliance` / `operate-improve`.
  - Support stages render as separate bands.
  - Rental/shared-asset archetypes include `Return & Inspect` in the primary flow.
  - Load-bearing stages are marked, and the first selected stage follows the regulated-first priority.
  - Worker-facing labels are business-readable and do not rely only on raw stage codes.
  - Copy and types identify the current flow as the primary business flow, not as the only possible business line forever.
  - The resulting view can be displayed alongside the existing command-center summary without requiring new persistence or a new route.

  Run: `pnpm --filter web exec vitest run lib/value-stream/workspace-value-stream-view.test.ts` -> FAIL (module missing).

- [ ] **Step 2: Implement**:

  ```ts
  export type ValueStreamStageRole = "primary-delivery" | "supporting-function";

  export interface WorkspaceValueStreamStageView {
    stageKey: OperationalValueStreamStageKey;
    stageLabel: string;
    operatorLabel: string;
    role: ValueStreamStageRole;
    loadBearing: boolean;
    href: string;
    measureAxis: CanonicalMeasureAxis;
    whatToWatch: string;
  }

  export interface WorkspaceValueStreamView {
    archetypeId: string;
    archetypeName: string;
    operatorHeadline: string;
    capacityUnit: CapacityUnitType;
    demandSignature: DemandSignature;
    primaryStages: WorkspaceValueStreamStageView[];
    supportStages: WorkspaceValueStreamStageView[];
    selectedStageKey: OperationalValueStreamStageKey;
  }
  ```

  - Use the OVSM stage list; do not parse prose docs.
  - Operator labels should explain the work ("Capture demand", "Schedule capacity", "Deliver service", "Settle money", "Retain relationship") while preserving `stageKey` for tests and architecture drill-downs.
  - `operatorHeadline` should be phrased for the primary flow, e.g. "Primary business flow", with archetype-specific words in supporting labels.
  - `selectedStageKey` priority: `trust-compliance` -> `return-inspect` -> `capture` -> `qualify` -> `deliver` -> `settle` -> `retain` -> first load-bearing key.
  - `href` must point to existing routes only.

- [ ] **Step 3: Verify**:
  - `pnpm --filter web exec vitest run lib/value-stream/workspace-value-stream-view.test.ts`
  - `pnpm --filter web typecheck` (source-local if available; otherwise CI/shared lease per verification section).

- [ ] **Step 4: Commit** `feat(value-stream): derive the workspace value-stream view`.

### Task 1b: Summarize existing operational signals by urgency

**Files:** create `workspace-operational-summary.ts` + `.test.ts` if the current command-center shape is not enough.

- [ ] **Step 1: Write failing tests**:
  - Existing `commandStrip` items become `immediateNeeds`.
  - Existing `workInMotion` items become `activeWork`.
  - Existing `attentionItems`, upcoming calendar events, pending alerts, overdue actions, unpaid bills, and pending proposals become `pendingNeeds` or `situationsForming`.
  - Empty inputs render honest empty states rather than fabricated green status.
  - The helper accepts plain view objects; it does not import Prisma or call data loaders.

- [ ] **Step 2: Implement** a pure projection:

  ```ts
  export interface WorkspaceOperationalSummary {
    immediateNeeds: OperationalSummaryItem[];
    activeWork: OperationalSummaryItem[];
    pendingNeeds: OperationalSummaryItem[];
    situationsForming: OperationalSummaryItem[];
  }
  ```

  - Keep labels operational: "3 overdue invoices", "2 bookings this week", "1 compliance alert pending", "AI work blocked".
  - Preserve existing `href`s.
  - Use severity/urgency ordering already present in the command center where available.
  - Do not show the platform-readiness matrix on the business home; only project readiness issues that create immediate/pending operating needs.

- [ ] **Step 3: Verify**:
  - `pnpm --filter web exec vitest run lib/value-stream/workspace-operational-summary.test.ts`
  - `pnpm --filter web typecheck`

- [ ] **Step 4: Commit** `feat(value-stream): summarize workspace operational signals by urgency`.

### Task 1c: Derive the visual activity layer and status semantics

**Files:** create `workspace-visual-activity.ts` + `.test.ts`; modify `statusColors.ts` and its tests to add the `operationalStatus` domain.

- [ ] **Step 1: Write failing tests**:
  - Representative archetypes select the expected visual primitive:
    - field/trades -> `map-dispatch`.
    - hair salon / appointment services -> `slot-board`.
    - hotel/rental/cleaning turnover -> `turnover-board`.
    - equipment rental / self-storage / shared assets -> `asset-pool-board`.
    - retail/bakery/florist/field supplies -> `stock-reorder-board`.
    - vet/legal/MSP/case-heavy services -> `case-queue`.
    - bank/municipality/charity/regulated work -> `trust-gate-board`.
  - Every visual item has `label`, `iconName`, `statusDomain`, `status`, `intent`, and accessible text.
  - `good`, `concern`, `acute`, `in-motion`, and `unknown` resolve through report-kit status semantics, not a local color map.
  - Empty or unavailable signals map to `unknown`, not `good`.
  - Supporting streams attach as overlays or adjacent lanes without creating a second process model.

- [ ] **Step 2: Implement** a pure projection:

  ```ts
  export type OperationalStatusLevel =
    | "good"
    | "concern"
    | "acute"
    | "in-motion"
    | "unknown";

  export type OperationalVisualPatternKind =
    | "map-dispatch"
    | "slot-board"
    | "turnover-board"
    | "asset-pool-board"
    | "stock-reorder-board"
    | "case-queue"
    | "trust-gate-board"
    | "standard-flow";

  export interface OperationalVisualItem {
    id: string;
    label: string;
    iconName: string;
    statusDomain: "operationalStatus";
    status: OperationalStatusLevel;
    intent: SnapshotItem["intent"];
    href?: string;
    accessibleName: string;
  }

  export interface WorkspaceVisualActivity {
    patternKind: OperationalVisualPatternKind;
    title: string;
    items: OperationalVisualItem[];
    supportingStreams: OperationalVisualItem[];
  }
  ```

  - Prefer visual pattern selection from `capacityUnit`, `demandSignature`, and load-bearing stage. Use archetype IDs only as a final tie-breaker where the template metadata cannot distinguish the situation.
  - Add `operationalStatus` to `STATUS_INTENT`:
    - `good -> success`
    - `concern -> warning`
    - `acute -> danger`
    - `in-motion -> info`
    - `unknown -> neutral`
  - Add or extend `statusColors.test.ts` so the mapping is enforced by the shared report-kit contract.
  - Use lucide icon names where available (`MapPin`, `CalendarDays`, `Armchair`, `Building2`, `PackageCheck`, `ClipboardList`, `ShieldCheck`, `AlertTriangle`, `CheckCircle2`, `Clock`, `HelpCircle` are examples, not a required closed set).
  - Keep text short enough for compact boards. Long explanations belong in hints/tooltips or drill-in routes, not visible paragraphs.

- [ ] **Step 3: Verify**:
  - `pnpm --filter web exec vitest run lib/value-stream/workspace-visual-activity.test.ts`
  - `pnpm --filter web exec vitest run components/ui/report-kit/statusColors.test.ts`
  - `pnpm --filter web typecheck`

- [ ] **Step 4: Commit** `feat(value-stream): derive operational visual activity semantics`.

---

## Chunk 2: Pure Headline Metric Spec

### Task 2: Map load-bearing stage -> metric spec

**Files:** create `headline-metric-spec.ts` + `.test.ts`.

- [ ] **Step 1: Write failing tests** for the spec across archetypes loaded from `ALL_ARCHETYPES` + `deriveOperationalValueStream`:
  - `hair-salon` (load-bearing `qualify`) -> `metricKind: "schedule-load"`, `measureAxis: "queue-size"` or `capacity-utilization` proxy, label mentions bookings/appointments, hint carries `slot-hours`.
  - `bakery` / `charity` / `plumber` capture-led cases -> `metricKind: "capture-volume"`.
  - `gym` -> `metricKind: "retention"`.
  - `veterinary-clinic` / `it-managed-services` -> `metricKind: "delivery-load"`.
  - `community-bank` / `small-town-municipality` -> `metricKind: "trust-status"` and trust wins over normal flow.
  - `equipment-rental`, `self-storage`, and `agricultural-cooperative` -> `metricKind: "asset-reservation-load"` and the hint names the reusable pooled asset limitation.
  - Any archetype whose selected load-bearing stage resolves to `settle` -> `metricKind: "revenue"`.
  - Every archetype yields a non-null spec with a stable `metricKind`, `measureAxis`, `measureMaturity`, human label, operator hint, and existing-route drill `href`.

  Run: `pnpm --filter web exec vitest run lib/value-stream/headline-metric-spec.test.ts` -> FAIL (module missing).

- [ ] **Step 2: Implement**:

  ```ts
  export type HeadlineMetricKind =
    | "capture-volume"
    | "schedule-load"
    | "asset-reservation-load"
    | "delivery-load"
    | "revenue"
    | "retention"
    | "trust-status";

  export interface HeadlineMetricSpec {
    stageKey: OperationalValueStreamStageKey;
    metricKind: HeadlineMetricKind;
    measureAxis: CanonicalMeasureAxis;
    measureMaturity: MeasureMaturity;
    label: string;
    hint: string;
    href: string;
  }
  ```

  - Map stage + capacity context, not raw archetype IDs:
    - `trust-compliance` -> `trust-status`, `trust`, `/compliance`.
    - `capture` -> `capture-volume`, `throughput` or `queue-size`, `/storefront/inbox`.
    - `qualify` + `capacityUnit === "reusable-pooled-asset"` -> `asset-reservation-load`, `capacity-utilization` proxy, `/workspace/calendar`.
    - `qualify` otherwise -> `schedule-load`, `queue-size` proxy, `/workspace/calendar`.
    - `deliver` -> `delivery-load`, `queue-size` / `throughput`, `/customer`.
    - `settle` -> `revenue`, `value`, `/finance`.
    - `retain` -> `retention`, `throughput`, `/customer`.
  - Compose `hint` from capacity unit, demand signature, measure maturity, and proxy limitation. Example: `Capacity: slot-hours; demand pattern: weekly; proxy: upcoming bookings, not true utilization.`
  - Keep business language in `label`; keep architecture keys in data/test IDs only.

- [ ] **Step 3: Verify**:
  - `pnpm --filter web exec vitest run lib/value-stream/headline-metric-spec.test.ts`
  - `pnpm --filter web typecheck`

- [ ] **Step 4: Commit** `feat(value-stream): map load-bearing stages to headline metric specs`.

---

## Chunk 3: Load the Headline Metric Value

### Task 3: Per-kind data loaders -> SnapshotItem

**Files:** create `load-headline-metric.ts` + `.test.ts`.

- [ ] **Step 1: Write failing tests** with a mocked narrow DB interface + stubbed finance loader:
  - For each `metricKind`, assert the loader returns a `SnapshotItem` whose `label`, `value`, `hint`, `href`, and `intent` match the spec.
  - Returns `null` when no `StorefrontConfig` or archetype exists.
  - Returns a neutral `unknown` snapshot such as "Not measured" when the archetype and OVSM are known but the existing data cannot safely compute the selected measure.
  - `trust-status` reuses obligation/alert counts.
  - `revenue` reuses `getProfitAndLoss`.
  - Proxy metrics include proxy wording in the hint so the UI does not imply false precision.
  - Date-window tests pass a fixed `now` and do not depend on the system clock.

- [ ] **Step 2: Implement** `loadHeadlineMetric({ db, now }): Promise<SnapshotItem | null>`:
  - Resolve `StorefrontConfig -> StorefrontArchetype.archetypeId`; if none -> `null`.
  - Resolve template with `ALL_ARCHETYPES.find(...)`; if none -> `null` and log once.
  - `ovsm = deriveOperationalValueStream(template)`.
  - `spec = headlineMetricSpec(ovsm)`.
  - Compute value by `spec.metricKind` from existing data:
    - `capture-volume`: count `StorefrontBooking + StorefrontOrder + StorefrontInquiry + StorefrontDonation` created in the last 30 days.
    - `schedule-load`: count upcoming `confirmed`/`pending` `StorefrontBooking`; hint says this is upcoming demand, not utilization.
    - `asset-reservation-load`: count upcoming rental/reservation demand from available booking/order/inquiry data; hint says the asset-pool engine is deferred.
    - `delivery-load`: count active customer accounts or in-flight delivery records that already exist cheaply for the archetype family.
    - `revenue`: use `getProfitAndLoss(windowStart, now).revenue`.
    - `retention`: count repeat customers from paid invoices where safe; otherwise return an honest proxy.
    - `trust-status`: open obligations + pending regulatory alerts.
  - If a known spec cannot be safely measured or proxied from existing data, return a `SnapshotItem` with `value: "Not measured"`, `intent: "neutral"`, `href: spec.href`, and a hint that names the missing direct measure.
  - Build a `SnapshotItem` with optional `hint`, `intent`, and `delta` only when the data supports them.
  - Type `db` as a narrow structural interface, not `PrismaClient` / `Prisma.TransactionClient` across the module boundary. P0 already exposed typecheck heap risk from inferred Prisma query types.

- [ ] **Step 3: Verify**:
  - `pnpm --filter web exec vitest run lib/value-stream/load-headline-metric.test.ts`
  - `pnpm --filter web typecheck`

- [ ] **Step 4: Commit** `feat(value-stream): load the workspace headline metric value`.

---

## Chunk 4: Wire Into the Workspace Home

### Task 4: Render the value-stream strip and prepend the headline

**Files:** modify `command-center.ts`, `BusinessCommandCenter.tsx`, `platform-loader.ts`, tests.

- [ ] **Step 1: Write/extend failing tests**:
  - `SnapshotItem` optional `hint` / `intent` / `delta` pass through to `StatCard`.
  - `BusinessCommandCenter` renders the value-stream strip when `view.valueStream` exists.
  - `BusinessCommandCenter` renders immediate, active, pending, and situation summaries when `view.operationalSummary` exists, or preserves the current sections when it does not.
  - `BusinessCommandCenter` renders the visual activity layer when `view.visualActivity` exists, with icon + label + status intent for each marker.
  - Good/concern/acute/in-motion/unknown statuses use `statusColors.ts` semantics and never appear as color-only markers.
  - The load-bearing stage has a stable marker (`aria-current`, data attribute, or equivalent) for testability.
  - Given a storefront archetype, `loadPlatformWorkspaceHomeData` returns `workspaceCommandCenter.commandCenter.snapshot[0]` as the value-stream headline.
  - Given a known archetype with an unavailable measure, the first snapshot card renders a neutral `unknown`/not-measured state rather than disappearing or showing green.
  - When the headline loader throws, `/workspace` data still returns the normal command center and logs the failure once.
  - `loadPlatformWorkspaceHomeData` threads its `now` value into value-stream helpers so calendar and metric windows are deterministic.

- [ ] **Step 2: Refactor command-center types**:
  - Extend `SnapshotItem`:
    ```ts
    export type SnapshotItem = {
      id: string;
      label: string;
      value: string | number;
      href: string;
      hint?: string;
      intent?: "success" | "warning" | "danger" | "info" | "neutral" | "accent";
      delta?: { label: string; direction: "up" | "down" | "flat"; intent?: SnapshotItem["intent"] };
    };
  ```
  - Add `valueStream?: WorkspaceValueStreamView` to `WorkspaceCommandCenterView`.
  - Add `operationalSummary?: WorkspaceOperationalSummary` only if needed for the urgency grouping. Keep it derived from existing loaded data.
  - Add `visualActivity?: WorkspaceVisualActivity` only if the visual layer cannot be expressed cleanly from `valueStream` and `operationalSummary` at render time.
  - Add a small pure helper, e.g. `withHeadlineSnapshot(view, headline, valueStream)`, rather than mutating the object inline in the loader.
  - The helper should preserve existing `commandStrip`, `workInMotion`, `readiness`, and snapshot order after the new headline.

- [ ] **Step 3: Update `BusinessCommandCenter`**:
  - Render the strip above the snapshot and below "Needs attention".
  - Keep "Needs attention" as the first operating band. Follow with the value-stream strip/headline, then active work and pending/situation summaries.
  - Render the visual activity layer as a compact operational board, not a marketing hero or decorative image. Pattern examples: map dispatch, slot board, turnover board, asset pool board, stock/reorder board, case queue, trust-gate board.
  - Use a non-card layout: one compact band for primary stages, one smaller support row when support stages exist.
  - Use token-backed borders/text/backgrounds only.
  - Resolve status colors through report-kit intent semantics. Pair every good/concern/acute/in-motion/unknown status with an icon and visible label.
  - Use `aria-current` or `aria-label` so the highlighted load-bearing stage is accessible.
  - Pass `hint`, `intent`, and `delta` to `StatCard`.

- [ ] **Step 4: Update `platform-loader.ts`**:
  - After loading `workspaceCommandCenter` and `storefrontConfig`, call the headline loader.
  - If non-null, prepend it and attach the `WorkspaceValueStreamView`.
  - Build the operational summary from already-loaded command-center summary (`commandCenter`, `attentionItems`), calendar, feed, and section data; do not introduce another DB fan-out for this slice unless a missing signal is proven necessary.
  - Build the visual activity layer from OVSM context plus the operational summary. Do not query new data just to fill a visual board in P1.
  - Pass the loader's `now` argument into the headline metric loader and any visual/summary helper that computes time windows.
  - Wrap value-stream loading in a non-fatal `try/catch`. Workspace home is load-bearing UX; it must degrade gracefully.

- [ ] **Step 5: Verify**:
  - `pnpm --filter web exec vitest run lib/value-stream/workspace-value-stream-view.test.ts lib/value-stream/workspace-operational-summary.test.ts lib/value-stream/workspace-visual-activity.test.ts lib/value-stream/headline-metric-spec.test.ts lib/value-stream/load-headline-metric.test.ts components/ui/report-kit/statusColors.test.ts components/workspace/BusinessCommandCenter.test.tsx lib/workspace-home/platform-loader.test.ts`
  - `pnpm --filter web typecheck`

- [ ] **Step 6: Commit** `feat(value-stream): show the operator value-stream headline on workspace`.

---

## Chunk 5: Verification & Evidence

- [ ] **Source-local unit tests**: the value-stream view, metric spec, loader, command-center helper, and BusinessCommandCenter tests pass in the worktree or source-local toolchain.
- [ ] **Typecheck**: `pnpm --filter web typecheck` passes. If local dependencies are unavailable, record that the gate is unrun locally and run it through CI/shared lease per AGENTS.md.
- [ ] **Production build**: `pnpm --filter web build` passes on the canonical runtime or shared local-CI convergence sandbox, not a stale worktree-local harness.
- [ ] **UX verification**: on a running install, open `/workspace` for representative archetypes:
  - `hair-salon`: stage strip highlights schedule/capacity; first card is schedule load.
  - `hair-salon`: visual layer shows a slot/chair/provider-style board, including occupied/free/next-needed states where data exists.
  - `community-bank`: trust/compliance is visible and first card is trust status.
  - `bakery`: capture demand is highlighted and first card is capture volume.
  - `bakery` or `florist`: visual layer shows stock/order/reorder style operational cues where data exists.
  - `equipment-rental` or `self-storage`: reusable-asset context is visible and proxy wording is explicit.
  - `field-service` or equivalent trades archetype when available: visual layer uses dispatch/map/schedule semantics rather than generic cards.
- [ ] **Operations verification**: confirm the first viewport answers: what needs attention now, what is in motion, what is pending/forming, and which value-stream stage explains the priority.
- [ ] **Status semantics verification**: scan the implemented files for local color maps and raw palette colors; good/concern/acute/in-motion/unknown statuses must resolve through report-kit and include icon + text/aria, not color alone.
- [ ] **Status registry verification**: `STATUS_INTENT.operationalStatus` exists and maps `good`, `concern`, `acute`, `in-motion`, and `unknown` to the expected token-backed intents.
- [ ] **Mobile UX**: verify `/workspace` at a narrow viewport. The strip wraps/scrolls cleanly and text does not overlap.
- [ ] **PR**: when CI is green and UX evidence is captured, open a ready PR (not draft) and include the measured archetypes plus any proxy limitations in the body.

## Acceptance Criteria

- [ ] `/workspace` shows a compact value-stream strip derived from the active org's OVSM, with primary value stages separated from trust/support stages.
- [ ] `/workspace` remains an operational surface: immediate needs, active work, pending needs, and developing situations are visible from existing platform-defined data.
- [ ] `/workspace` includes an archetype-appropriate visual activity layer where existing data supports one: map dispatch, slot board, turnover board, asset pool board, stock/reorder board, case queue, trust-gate board, or standard flow.
- [ ] The load-bearing stage is visibly and accessibly highlighted, in operator language.
- [ ] The first snapshot card is the load-bearing headline metric, rendered through report-kit `StatCard` with `label`, `value`, `hint`, `href`, and token-backed `intent`.
- [ ] Good, concern, acute, in-motion, and unknown states are standardized across value streams, operational summaries, visual markers, and headline metrics through `STATUS_INTENT.operationalStatus`.
- [ ] Every operational status marker has iconography plus visible or accessible text. Color alone is never the signal.
- [ ] Every archetype in `ALL_ARCHETYPES` yields a stable view and metric spec; implementation does not hard-code the archetype count.
- [ ] The current single-archetype workspace is described as the primary business flow and remains adaptable to later multi-archetype/service-line composition.
- [ ] Rental/shared-asset archetypes are handled explicitly and do not collapse into generic booking language.
- [ ] Proxy measures are labelled as proxies. Unavailable measures render as `unknown` / not measured, not as green or as silent omission. The UI does not imply true utilization, process time, or quality where the platform lacks the data.
- [ ] No new Prisma table, no new top-level route, no generic dashboard/widget substrate.
- [ ] No new data signal is added unless the plan first proves the existing command-center, calendar, feed, finance, compliance, customer, people, and coworker signals cannot answer the operating question.
- [ ] No local status color maps or hardcoded UI colors; reporting/data-display UI composes report-kit.
- [ ] Failure to compute the headline metric degrades gracefully and does not block `/workspace`.
- [ ] CI typecheck and production build pass without a Prisma type-inference heap regression.

## Risks

| Risk | Mitigation |
|------|------------|
| The feature becomes a generic architecture diagram that operators do not understand. | Operator labels first; stage keys hidden behind data/test/admin details; business examples covered in tests. |
| A single metric tile feels disconnected from the value stream. | Render the value-stream strip and headline metric from one `WorkspaceCommandCenterView` object. |
| The page becomes analytics-first instead of operations-first. | Organize by urgency: immediate needs, active work, pending needs, situations forming, then supporting metrics. |
| The visual layer turns into decoration instead of operations. | Only render structured, data-backed visuals: maps, schedules, occupancy/turnover/asset/stock/case/trust boards. No stock-image substitutes. |
| Per-archetype visual logic becomes a new dialect per page. | Derive visual pattern from OVSM context and shared `WorkspaceVisualActivity`; use archetype IDs only as tested tie-breakers. |
| Color becomes the only status signal. | Standardize good/concern/acute/in-motion/unknown through report-kit, and require icon + label + accessible name for every marker. |
| Proxy data creates false confidence. | `measureMaturity` and hint text are mandatory; direct vs proxy vs unavailable is tested. |
| Workspace first viewport becomes cluttered. | Compact band, no nested cards, no extra route, mobile wrap/scroll test. |
| The plan bakes in today's single-archetype assumption and blocks future composition. | Use primary-flow copy and pure serializable view models; do not persist UI-only process stages. |
| Archetype count drifts. | Iterate `ALL_ARCHETYPES`; never write "53" into tests or implementation. |
| Typecheck/build OOM from Prisma generics. | Narrow structural DB types and explicit return interfaces. |
| Supporting-function view becomes a second source of truth. | Derive every stage and support band from OVSM; no persisted UI-only process model. |
