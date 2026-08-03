# Asset Rental Resource and Capacity Implementation Plan

> **DPF-native execution:** Follow `AGENTS.md`, work only in the isolated
> `feat/asset-rental-resource-capacity` worktree, define behavior with TDD, and
> run runtime-bound verification through the governed `local-integration-ci`
> sandbox. This source-only worktree must not host a parallel runtime.

- **Backlog item:** `BI-B1C4A514`
- **Epic:** `EP-VERTICAL-ASSET-RENTAL`
- **Work Capsule:** `WC-07293A28`
- **Shared design:**
  `docs/superpowers/specs/2026-08-01-shared-scarce-resource-capacity-design.md`
- **Operations design:**
  `docs/superpowers/specs/2026-07-28-business-operations-and-performance-views-design.md`
- **Base:** `origin/main@e43f4222d19c46e6860177a5b7ce634246eebd73`
- **Decision:** extend the existing rental bounded context through a typed
  runtime mirror; do not add a universal resource table.
- **Coverage decision:** atomic vertical adapter; the separate YARD cockpit is
  already owned by `BI-E0209CFC`.
- **Coverage receipt:** `cmsbhsm910tf301tcvrvbts20`

## Industry precedent incorporated

- [Booqable availability](https://help.booqable.com/en/articles/1209981-how-to-view-product-availability)
  makes the rental period primary and shows downtime in the availability
  calendar.
- [Booqable locations](https://help.booqable.com/en/articles/4605231-how-to-set-up-locations)
  assigns inventory to a store or warehouse and makes pickup/return location
  part of availability.
- [Booqable inventory management](https://booqable.com/inventory-management/)
  distinguishes trackable units from bulk stock, prevents double booking, and
  treats maintenance downtime, bundles, barcodes, and pickup/return accuracy as
  core operating facts.
- [Quipli inventory management](https://www.quipli.com/solutions/equipment-inventory-management-software/)
  centers a dynamic availability calendar, class/product/unit hierarchy,
  multi-location transfers, unit-level utilization, and ready-to-rent status.
- [Quipli service and repair](https://www.quipli.com/solutions/equipment-rental-maintenance-software/)
  ties soft/hard downtime, repair type, work period, meter readings, history,
  cost, and current location to each unit and blocks hard-down periods from
  booking.
- [Stora facility maps](https://stora.co/uk/self-storage-facility-maps)
  use a live spatial map for vacancies, occupancy, unit assignment, tenant
  history, and point-and-click status changes.
- [Stora management](https://stora.co/features/self-storage-management-software)
  treats automatic unit allocation/deallocation, move-in access, occupancy,
  failed-payment overlocks, and move-in/out exceptions as the self-storage
  operating loop.

These products establish two presentations, not one generic inventory list:
equipment/production rentals use a yard plus forward availability; self-storage
uses a facility map plus occupancy and tenant state. This PR builds the trusted
resource projection and management data needed by both. `BI-E0209CFC` will own
the later visual YARD/facility-map cockpit.

## Backlog coverage

- Decision: atomic
- Parent: `BI-B1C4A514`
- Receipt: `cmsbhsm910tf301tcvrvbts20`
- Dependencies: `physical-profile` -> `rental-adapter` and `unit-management`; both -> `operations-handoff`; visual cockpit remains external `BI-E0209CFC`
- Rationale: Typed metadata, organization-scoped projection, lifecycle attention,
  and the bounded management handoff are not useful or safe independently;
  splitting them would expose untrusted JSON, an unusable adapter, or controls
  without authoritative availability. The independently shippable visual YARD
  is already represented by `BI-E0209CFC`.

The adapter is independently shippable only when physical unit metadata,
allocation projection, lifecycle attention, and organization isolation land
together. Splitting those pieces would expose either untrusted JSON or a
resource snapshot that cannot answer where an asset is or whether it is ready.
The full operations cockpit remains a separate backlog item and PR.

| Key | Deliverable | Independently shippable | Depends on |
| --- | --- | --- | --- |
| `physical-profile` | Typed equipment, production-kit, and self-storage unit metadata | No | existing `RentableUnit.attributes` |
| `rental-adapter` | Org-scoped resources, allocations, availability, watermark, and lifecycle attention | No | physical profile + shared capacity contract |
| `unit-management` | Business-grade location, readiness, maintenance, kit, and occupancy inputs | No | physical profile |
| `operations-handoff` | Rental Desk consumes the projection and exposes the highest-priority exception/action | No | adapter + unit management |

The governed coverage receipt records all four deliverables against umbrella
`BI-B1C4A514` with the dependency graph above and no child BI mappings. In the
receipt, `operations-handoff` is internal atomic sequencing rather than a
second cockpit: `BI-E0209CFC` remains the independently shippable visual YARD
surface.

## Phase 1 — Contract tests first

1. Specify a versioned `RentableUnit.attributes` parser that accepts known
   equipment, production-kit, and self-storage fields, normalizes malformed or
   legacy JSON safely, and never trusts a raw cast.
2. Specify status mapping, location/capability projection, half-open agreement
   allocations, maintenance unavailability, and source watermark behavior.
3. Specify attention for overdue return, return inspection, maintenance hold,
   deposit/verification gap, incomplete kit, re-pool readiness, idle fleet,
   storage vacancy/occupancy opportunity, waitlist demand, and move-in/out.
4. Prove organization isolation and archetype-profile gating in adapter tests.
5. Prove the first-viewport selector returns one highest-priority exception and
   one concrete recommended action with rental-specific language.

## Phase 2 — Typed physical-resource profile

1. Add a rental-owned parser/serializer beside the existing rental enum and
   availability helpers.
2. Model shared physical placement (`site`, `zone`, `position`) and readiness,
   then discriminated variants for equipment, production kits, and storage
   units. Keep customer/tenant and agreement facts in `RentalAgreement`; do not
   duplicate them into unit JSON.
3. Represent maintenance holds as dated unavailability with severity and
   reason. Preserve unknown keys when editing so an older/newer install does not
   destructively rewrite metadata it does not understand.
4. Keep `RentableUnit.status` authoritative for lifecycle; attributes enrich
   the physical operating view and never create a second status machine.

## Phase 3 — Production rental capacity adapter

1. Add a concrete `rental` adapter behind the shared `CapacityAdapterRegistry`.
2. Resolve the requested organization to its storefront(s); query only those
   units, items, and agreements.
3. Project serialized units and quantity pools without double-counting.
4. Project agreement windows as allocations and dated hard-down maintenance as
   unavailability; retain canonical row references for drill-through.
5. Emit a source watermark and honest `unsupported`/`degraded` state when the
   organization has no rental authority or source data cannot be read.
6. Extend the shared attention union only with durable cross-rental lifecycle
   kinds; keep presentation copy and recommended commands in the rental layer.

## Phase 4 — Unit management and first-viewport handoff

1. Refactor `UnitsManager` away from one generic inline-styled list into rental
   management primitives with status chips, location hierarchy, readiness,
   maintenance hold, and variant-specific detail.
2. Equipment mode captures serial/plate, site/yard/bay, pickup readiness,
   inspection, meter, and maintenance. Production-kit mode additionally shows
   completeness. Self-storage mode captures size, facility/floor/position,
   vacancy/occupancy, move-in/out, access state, and waitlist count.
3. Harden collection and item APIs to resolve the intended storefront and
   refuse cross-storefront unit reads or mutations.
4. Feed the Rental Desk a bounded operations summary. Above the fold shows the
   live availability/occupancy chips and exactly one most important exception
   with one recommended action; the full visual cockpit remains `BI-E0209CFC`.
5. Keep mutations authoritative through existing rental commands/API writes;
   the capacity projection remains read-only and advisory.

## Phase 5 — Documentation and handoff

1. Update the rental value-stream/operator guide with the physical metadata,
   attention meanings, and the division between unit management and YARD.
2. Add a source-backed corpus page for equipment-rental and self-storage
   operating practices rather than leaving precedent only in this plan.
3. Record implementation and verification evidence on `BI-B1C4A514` and point
   `BI-E0209CFC` at the adapter and view contract.
4. Route confirmed design learnings to the shared commons.

## Refactor allocation

At least 20% of implementation effort is reserved for consolidation:

- one versioned physical-profile parser instead of raw `attributes` casts;
- one rental adapter instead of page-specific availability queries;
- one status/attention mapping reused by Rental Desk and the future YARD;
- reusable form/status primitives instead of hand-authored inline styles;
- one organization/storefront resolver for rental pages and APIs;
- removal of duplicated occupancy and live-agreement derivation after the
  adapter becomes authoritative.

## Performance budget

- The operations loader uses bounded windows, explicit selects, indexed
  storefront/status/time predicates, and parallel independent reads.
- It must not load media blobs or historical closed agreements for the first
  viewport.
- The adapter projection target is under 150 ms at the loader boundary for a
  representative 1,000-unit / 10,000-window fixture; the UI must render useful
  current state without waiting for owner-performance rollups.
- Historical utilization and ROI remain `/performance` concerns and cannot sit
  on the customer-facing allocation hot path.

## UX fit review - rental physical capacity

- **Decision:** fits-with-guardrails
- **Owning area:** Storefront management, with a bounded current-operations
  handoff to Business `/rental`
- **Route family:** `/storefront/units` is the management source; `/rental` is
  the current-state operating surface; the main `/workspace` YARD remains
  `BI-E0209CFC`
- **Primary persona:** rental counter/yard or storage-site operator who needs to
  answer “where is it, is it ready, and what blocks the next commitment?”
- **Navigation layer touched:** local page controls only; no global or section
  navigation is added
- **Reuse/convergence:** shared capacity adapter, report-kit status/data
  primitives where applicable, shared form and save-state contracts, and
  progressive disclosure for maintenance detail
- **Source truth:** `RentableUnit`, `RentalAgreement`, `BookingHold`, and typed
  `RentableUnit.attributes.rentalPhysical`; the UI does not create a second
  status machine
- **Empty/failure behavior:** an empty class offers one choice—add serialized
  units or set pool stock; ambiguous multi-organization state fails closed;
  failed saves remain visible and retryable
- **AI boundary:** no prompt send; the recommendation is read-only copy and any
  future allocation command retains its confirmation boundary
- **Required guardrails:** first viewport stays summary plus one exception and
  one action; detailed physical/maintenance fields are progressively disclosed;
  the full spatial cockpit stays in its existing BI
- **Evidence before merge:** targeted contract tests, exact full suite,
  production build, route UX budget sweep, tablet/desktop interaction, and
  theme/accessibility review
- **Captured in:** this plan and
  `docs/ux-fit/2026-08-02-rental-physical-capacity.ux-fit.json`
- **Decision interaction:** `DI-3D8FAF2F5720` recommended
  `progressive-physical-editor` with high confidence over generic inline fields
  and building the full YARD prematurely

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/specs/2026-08-01-shared-scarce-resource-capacity-design.md`
  - `docs/superpowers/specs/2026-07-28-business-operations-and-performance-views-design.md`
  - `docs/superpowers/specs/2026-07-12-operational-twin-framework-design.md`
  - `docs/superpowers/plans/2026-05-26-portal-ux-simplification-spine.md`
  - `docs/platform-usability-standards.md`
- Current code substrate reviewed:
  - `RentableUnit`, `RentalAgreement`, `BookingHold`, and rental actions/helpers
  - shared `apps/web/lib/capacity` contracts and adapter registry
  - existing Rental Desk and Units Manager routes/components
  - report-kit, shared form primitives, and owner-visible save-state contract
- Source of truth: rental domain rows own lifecycle and commitments; the typed
  physical profile enriches placement/readiness; the capacity adapter is the
  read-only normalized projection.
- Decision: extend the rental authority with a progressive physical editor and
  bounded operations handoff; do not add a universal resource table or build
  the separate YARD cockpit in this prerequisite.

## Verification gates

1. Targeted profile, adapter, API authorization/isolation, attention, and UI
   tests, including malformed JSON and multi-organization refusal fixtures.
2. Affected-package typecheck, architecture/module-size guards, and an explicit
   projection benchmark fixture.
3. No migration is planned. If implementation proves a schema constraint is
   required, stop and amend this plan before creating it.
4. UX-fit review and live interaction of equipment, production-kit, and
   self-storage management plus Rental Desk at desktop and tablet widths.
5. Governed exact merged-code local-CI gate: migrations, exhaustive Vitest,
   typecheck, and production Docker/Next build.
6. Ready-for-review PR only after exact evidence; merge through the governed
   squash queue and run `pnpm pr:health` before claiming readiness.

## Rollback

The data change is additive inside the existing optional `attributes` JSON and
the projection is read-only. Rollback removes the adapter, form fields, and new
attention mappings; existing unit labels, statuses, agreements, and unknown
attribute keys remain intact. No rental lifecycle transition or historical row
is deleted or rewritten.
