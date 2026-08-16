# Equipment Rental YARD Operations Implementation Plan

> **DPF-native execution:** Follow `AGENTS.md`, work only in the isolated
> `feat/equipment-yard-operations` worktree, define projection behavior with
> tests first, and run runtime-bound verification through the governed
> `local-integration-ci` environment. This source-only worktree must not host a
> parallel runtime or dependency graph.

- **Backlog:** `BI-101255AC`
- **Work Capsule:** `WC-8325F847`
- **Epic:** `EP-SPATIAL-OPERATIONAL-VIEWS`
- **Umbrella design:**

> **Rescue note (2026-08-16).** This design was recovered from a branch that was pushed and never proposed as a PR, found in the 2026-08-15 never-proposed-branch sweep. **The design landed; the implementation did not.**
>
> - Tracking item: `BI-3391BE2C`
> - Preserved implementation: `feat/equipment-yard-operations` @ `93c3f0904b5b6d328a9306636f39356470fe1471`, pinned locally at `refs/salvage/2026-08-15/feat/equipment-yard-operations` and recorded in `~/dpf-deleted-remote-branch-tips-2026-08-15.txt`. Restore with `git push origin 93c3f0904b5b6d328a9306636f39356470fe1471:refs/heads/feat/equipment-yard-operations`.
> - Merge state as measured on 2026-08-16: one conflict, `apps/web/data/design-intelligence/operational-precedents.csv` (data, not logic).
> - The original backlog anchors in this document did **not** resolve in this install, so it could not pass `check_plan_backlog_coverage`. Coverage is rebound to `BI-3391BE2C`.
>
> - **Coverage is intentionally not recorded yet.** The stale delivery anchors (backlog-item and
>   coverage-receipt metadata lines) were removed because their ids do not resolve here, and a
>   receipt bound to work nobody has started would be fiction. This plan is therefore outside
>   the plan-backlog-coverage gate by design — that gate skips any plan carrying no
>   backlog-item metadata line. **When the implementation thread starts:** restore the backlog-item metadata line naming BI-3391BE2C, call
>   `record_plan_backlog_coverage`, and copy its Receipt, Decision, Parent, Rationale and
>   Dependencies into a `## Backlog coverage` section. Recording a receipt requires an active
>   Workroom claim on BI-3391BE2C — the repository-artifact resolver needs a claim-backed subject.
>
> Implementation is deliberately deferred to its own thread: this work needs an install/seed cycle to verify honestly, and a rebase alone would not prove it works. Read `BI-3391BE2C` for the current dependency state before starting.

  `docs/superpowers/specs/2026-07-28-business-operations-and-performance-views-design.md`
- **Rental domain design:**
  `docs/superpowers/specs/2026-05-29-vehicle-equipment-rental-archetype-design.md`
- **Base:** `origin/main@a8ee85b1f97`
- **Coverage receipt:** `cmsai1tvk023u01qkav8o3wzc`
- **Coverage decision:** atomic

## Outcome

Replace the generic YARD demo on `/workspace` for `equipment-rental` and
`production-equipment-rental` with an industry-grounded, live operational
projection that answers, without opening several pages:

1. what exact serialized equipment or bulk stock is available for a selected
   near-term window;
2. where each asset is now (branch, yard zone or bay, customer custody, or
   maintenance);
3. which pickups, checkouts, returns, inspections, and overdue items need work;
4. which late return, maintenance hold, buffer, or branch mismatch threatens a
   reservation; and
5. which substitute is available, including when a transfer is required.

The existing `/rental` Rental Desk remains the canonical command surface for
verification, checkout, return, inspection evidence, and cancellation. The
YARD view links there rather than duplicating write authority.

## Grounding and precedent

### Existing DPF substrate to extend

- `RentableUnit` owns serialized identity, unit reference, status, meter,
  optional typed attributes, and catalog SKU.
- `RentalAgreement` owns the dated reservation/custody lifecycle and the
  database-enforced serialized-unit overlap invariant.
- `RentalConditionRecord` owns checkout/return evidence.
- `StorefrontItem` remains the rentable class; its `bookingConfig` can carry a
  bounded quantity-pool configuration until a separate stock authority is
  proven necessary.
- `OperationalSceneLayout` owns geometry only and already resolves
  `rentable-unit` references with organization scope.
- the merged shared capacity mirror (`BI-D1D54D93`, PR #3861) owns common
  interval, conflict, attention, and source-health semantics.
- `TwinProfile` and `BusinessViewProfile` already select `YARD`,
  `inventory-location-horizon`, and the rental command/conflict vocabulary.

No new canonical geography, inventory, customer, or agreement model is
introduced. Off-premises geographic rendering will consume the separately
governed geo-map substrate (`BI-3B07C332`) after its tool evaluations approve
the renderer dependencies; this PR fails honestly to textual branch/customer
location in the meantime.

### Current primary-source precedent

- **Booqable:** real-time availability for trackable and bulk stock,
  availability calendar, buffers, barcode/QR handoff, per-location stock,
  history, and scheduled downtime.
- **Rentman:** equipment timeline, shelf/stock locations, serialized QR/RFID
  tracking, packing/dispatch/on-location/return states, repair, shortages,
  alternatives, transfers, subrentals, and multi-warehouse availability.
- **Point of Rental:** day-at-a-glance deliveries, will-call, service,
  inspections, and collections; inspection and maintenance state participates
  in availability; dispatch handles delivery/pickup and load constraints.

DPF adopts the proven availability/custody/location hierarchy, adds explicit
conflict explanations and accessible parity, and uses a spatial yard only when
real placement data exists.

## Design grounding

- **Existing specs/plans reviewed:**
  `2026-07-28-business-operations-and-performance-views-design.md`,
  `2026-05-29-vehicle-equipment-rental-archetype-design.md`, and the Workspace
  placement plan named in the existing twin-panel implementation.
- **Current code substrate reviewed:** `RentableUnit`, `RentalAgreement`,
  `RentalConditionRecord`, `StorefrontItem.bookingConfig`, `TwinProfile`,
  `BusinessViewProfile`, `OperationalSceneLayout`, `CartesianSceneCanvas`, the
  FLOOR/ROOMS domain renderers, and report-kit status/table primitives.
- **Source of truth:** rental identity and custody remain in the rental domain;
  geometry remains in `OperationalSceneLayout`; the operational renderer reads
  both through one bounded pure YARD projection.
- **Decision:** extend the existing Workspace contribution seam with a YARD
  renderer and preserve `/rental` as command authority. Use a synchronized
  progressive presentation selected by recorded decision `DI-9D89ECC5B5B0`;
  do not add a route, schema, parallel inventory owner, or premature geographic
  map dependency.

Operational-Precedent: equipment-rental-yard

## Backlog coverage

This is one large but atomic vertical slice. A projection without its loader
cannot show live state; a spatial scene without the dated availability and
accessible table would be misleading; and a component without `/workspace`
wiring does not deliver the operator outcome. The geographic-map dependency
and new rental commands remain separately governed work.

| Key | Deliverable | Independently shippable | Depends on |
| --- | --- | ---: | --- |
| `yard-contract` | Typed asset, pool, horizon, custody, conflict, location, and source-health contract | No | — |
| `yard-projection` | Pure bounded projection with late-return, maintenance, branch, substitute, and availability reasoning | No | `yard-contract` |
| `yard-loader-scene` | Organization-scoped rental loader plus persisted starter yard layout | No | `yard-projection` |
| `yard-workspace` | Responsive visual yard, work queue, horizon, accessible table, and Rental Desk handoff on `/workspace` | No | `yard-loader-scene` |
| `fixtures-docs` | Two-branch serialized/bulk fixture, tests, user guide, and operational precedent refresh | No | `yard-workspace` |

## Phase 1 — Contract and projection tests

1. Define a bounded YARD view contract independent of Prisma and React.
2. Build a two-branch fixture containing one serialized asset, one bulk pool, a
   late return threatening the next booking, a maintenance hold, and a
   substitute at another branch.
3. Prove half-open date semantics, current custody classification, overdue and
   next-reservation conflicts, maintenance unavailability, per-branch quantity,
   transfer-required substitutes, and deterministic priority ordering.
4. Prove no customer email, phone, deposit value, raw JSON attribute, or other
   private field reaches the first-viewport projection.

## Phase 2 — Live rental projection

1. Add a typed parser for the small rental attributes used by the view:
   `branchRef`, `branchLabel`, `zone`, `bay`, and `customerLocationLabel`.
   Invalid or missing fields become explicit `Unassigned`/`Location unknown`
   states rather than inferred facts.
2. Load only the configured storefront, active rental classes, at most 500
   units, and agreements intersecting a bounded 31-day window plus currently
   active/overdue agreements.
3. Project serialized units and configured quantity pools into one view while
   retaining canonical IDs and source timestamps.
4. Use shared interval semantics and return typed degraded-source diagnostics
   when a source or optional location fact is unavailable.

## Phase 3 — Physical yard layout

1. Add a YARD-specific starter-scene adapter over the existing cartesian scene
   and optimistic-concurrency repository.
2. Group starter placements by branch and operational zone: Ready line,
   Returns & inspection, Maintenance, and Out/on location.
3. Persist geometry in `OperationalSceneLayout` using `rentable-unit` entity
   references; never copy live status into geometry.
4. Reconcile newly added units into an explicit “new assets” area without
   moving operator-authored placements.
5. Extract/reuse the scene reconciliation helpers where doing so removes
   restaurant/YARD duplication without changing restaurant behavior.

## Phase 4 — `/workspace` operator surface

1. Add a dedicated `YardOperations` renderer selected only for the YARD
   template and supported rental archetypes.
2. First viewport: urgent conflict/next safe action, custody counts, immediate
   pickup/return queue, and the physical branch yard.
3. Short forward horizon: asset or pool rows across a bounded day range with
   text and pattern in addition to color.
4. Always render an accessible sortable-equivalent table containing asset,
   class, branch/location, custody, next pickup/return, availability, downtime,
   and conflict reason.
5. Link lifecycle actions to `/rental`; do not duplicate canonical commands.
6. On small screens, prioritize attention and work queue, then render the yard
   as a scroll-safe region and the table as the complete alternative.

## Phase 5 — Corpus, documentation, and handoff

1. Refresh the operational precedent row with current Booqable, Rentman, and
   Point of Rental evidence and retain source/recheck dates.
2. Update the user guide to distinguish Operations (`/workspace`) from Rental
   Desk (`/rental`) and Performance.
3. Record implementation and UX evidence on `BI-101255AC`.
4. Keep corpus/vector tuning as a later exercised-data activity: do not tune
   embeddings against synthetic fixtures and call it production evidence.

## Refactor allocation

At least 20% of implementation effort is reserved for consolidation:

- one rental attribute parser instead of component-level JSON probing;
- one pure YARD projection reused by visual, queue, horizon, and table views;
- shared cartesian starter/reconciliation helpers where proven reusable;
- one date/status vocabulary mapping rather than conditionals in every card;
- bounded loader query plans and one source watermark rather than per-widget
  database reads.

## UX fit review — Equipment Rental YARD Operations

- **Decision:** fits-with-guardrails
- **Owning area:** Workspace
- **Route family:** `/workspace` is canonical Operations; `/rental` is the
  contextual transaction handoff. No new global or section route is added.
- **Primary persona:** yard supervisor or rental-counter operator deciding what
  can leave, what must return, and which reservation is at risk without
  remembering database status names or opening several reports.
- **Navigation layer touched:** local page view switch plus the contextual
  **Open Rental Desk** action.
- **Reuse/convergence:** existing Workspace archetype contribution resolver,
  cartesian scene canvas, save-state indicator, report-kit `StatusBadge`,
  `DataTable`, semantic intent registry, and `LocalTime`. The new YARD component
  is justified as one domain renderer parallel to the existing FLOOR and ROOMS
  renderers; it replaces the generic YARD card twin rather than creating a
  second dashboard.
- **Source truth:** `RentableUnit`, `RentalAgreement`,
  `RentalConditionRecord`, bounded `StorefrontItem.bookingConfig` pool
  configuration, and `OperationalSceneLayout` geometry through one pure YARD
  projection.
- **Empty/failure behavior:** empty live data names the setup action; unknown
  location and bounded/ambiguous pool source data are explicit, not inferred;
  a projection/loader failure retains the labeled demonstration view.
- **AI boundary:** no click starts coworker work. Suggestions and substitutes
  are read-only explanations; lifecycle commands remain in Rental Desk.
- **Required guardrails folded into implementation:** keep the priority
  exception and next safe action before dense detail; use text with every color;
  make the complete inventory/custody list available through report-kit; keep
  layout movement separate from rental commands; measure desktop and narrow
  mobile served DOM before merge.
- **Evidence before merge:** projection and source-scope tests, component and
  route-selection tests, theme/style guards, measured UX-fit manifest, served
  `/workspace` desktop/mobile exercise against the two-branch fixture, keyboard
  use, no horizontal page overflow, and Rental Desk link verification.
- **Captured in:** this plan and the measured manifest at
  `docs/ux-fit/2026-08-01-equipment-rental-yard-operations.ux-fit.json`.

## Verification gates

1. Targeted projection, scene, loader, component, and workspace-selection tests.
2. Affected-package typecheck, module-size, architecture, UX-fit, and secret
   guards.
3. Migration: not applicable unless implementation proves a canonical field
   cannot be represented by existing rental/configuration owners; any such
   change requires a plan amendment before editing Prisma.
4. Governed exact merged-code local-CI gate: exhaustive Vitest, migration
   deploy, typecheck, and bounded production Docker/Next build.
5. UX verification at desktop and narrow-mobile widths on a served
   equipment-rental fixture, including latency, keyboard access, text-only
   status parity, and the Rental Desk handoff.
6. Open a ready-for-review PR only after exact evidence exists; merge via the
   protected squash queue and verify with `pnpm pr:health`.

## Rollback

The source change is additive and read-only. Rollback removes the YARD
projection/renderer and returns YARD archetypes to the generic twin. Rental
agreements, units, condition records, commands, and operator-authored geometry
remain intact.
