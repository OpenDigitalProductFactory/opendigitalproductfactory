# Restaurant Business-Grade FLOOR Implementation Plan

| Field | Value |
| --- | --- |
| Backlog item | `BI-287AA5F7` |
| Epic | `EP-SPATIAL-OPERATIONAL-VIEWS` |
| Status | Active — source increments merged; installed busy-shift acceptance remains |
| Delivered increments | PR #3825 (`681bb8cd2b69`) and PR #3932 (`f1bc205bffef`) |
| Next delivery branch | New branch from current `origin/main`; both earlier feature branches are merged |
| Foundational dependency | `BI-57F34A00`, merged in PR #3796 at `99d7061d68c8ab2380fea4d1cf4010a15137d498` |
| Parent design | `docs/superpowers/specs/2026-07-21-spatial-operational-views-design.md` |
| Umbrella plan | `docs/superpowers/plans/2026-07-28-business-operations-and-performance-views-plan.md` |
| Operational precedent | `restaurant-floor` (Toast and OpenTable, accessed 2026-07-28) |
| Coverage receipt | `cms89c2jv031001qo7gezoyzm` (`atomic`) |

## Current delivery truth — 2026-08-08

This section is the status authority for resuming the plan. Historical
checkpoints below describe what was true when recorded; they do not override
this reconciliation.

| Capability | Source / merge truth | Canonical-install truth | Disposition |
| --- | --- | --- | --- |
| Shared scene, restaurant projection, table structure, service turns, seating/move commands, and customer-safe availability | Merged in PR #3825 at `681bb8cd2b695cd3cdbabe9170f524a737394f34` | The current install contains the code, but its restaurant records do not exercise the joined busy-shift path | Source delivered; functional acceptance open |
| First-viewport Host stand, ranked queue, floor/list parity, explicit AI recommendation confirmation, turn actions, and server-load panel | Merged in PR #3932 at `f1bc205bffef259fb96b8a0a6624eb042f9b40f4`; merge CI passed policy guards, typecheck, all test shards, production build, and UX route sweep | Preflight `CAN-TEST` on served `60b18de67dfe`; `/workspace` renders the Host stand first | Delivered and live-observed |
| Authored restaurant geometry | Persistence/configuration code exists | Live restaurant falls back to one `Unassigned area` with a generated 3×3 circle grid | Not accepted |
| Business-realistic table and shift data | Busy-shift fixture exists in tests | Live restaurant has nine one-seat, blocked tables; no server assignment and no waiting party | Not accepted; the fixture is not installed/provisioned |
| Host decision happy path | Command and interaction contracts exist and are tested | No compatible waiting party/table/server data exists, so seating, movement, conflict alternatives, and forward-availability reconciliation cannot be exercised | Not accepted |
| Customer-safe availability | Projector and UI merged | Available/limited/unavailable/degraded cases have not been functionally exercised against the same installed shift state | Functional acceptance open |
| Coworker-panel coexistence | Host console remains operable at the observed desktop viewport | The 380px coworker panel compresses the floor and clips the rightmost table content in the current generated layout | UX acceptance open |
| Compatibility/refactor closure | Shared `CartesianSceneCanvas` and reusable selectors are in use | `FloorPlanCanvas` remains as a compatibility adapter | Phase 6 partial |
| Work coordination | `WC-8550281A` records the merged Host-stand effort and its historical evidence | The capsule was stale-WIP reaped as `abandoned` on 2026-08-06 | Provenance only; claim a fresh capsule before remaining implementation |

The remaining delivery is intentionally one acceptance slice, not a new
parallel restaurant feature: provision or configure a credible authored dining
room and busy shift through the canonical install path, close the responsive
coexistence defect, then drive the complete host and customer journeys. Keep
`BI-287AA5F7` in progress until every definition-of-done item below is observed
on the canonical runtime.

## Pressure-mode refinement — 2026-08-01

Operator review of the merged surface found that the architecture was sound but
the first-viewport operating hierarchy was not: the generic attention stack
buried the floor, the 500px canvas plus a second full table report forced page
scrolling, and the operable canvas accepted navigation gestures before the host
understood that tables were the action targets. This follow-on stays inside the
same atomic `BI-287AA5F7` workflow and ships on
`feat/restaurant-host-command-center`.

### Research & Benchmarking

- **Toast Tables** keeps waiting parties beside the live floor and lets the host
  seat, notify, pre-assign, manage reservations, check server rotation/covers,
  and act on table states from the host home. It also demonstrates a failure
  mode DPF will not copy: long-press/drag and a navigable floor can compete with
  the primary seat-party action under pressure.
- **OpenTable** treats floor, waitlist, assignment recommendations, pacing, and
  flexible inventory as the shift command surface. DPF adopts recommendation
  with operator confirmation and explicit constraint explanation.
- **SevenRooms** brings reservations, walk-ins, table availability, and guest
  conversations into one host-stand surface. DPF adopts the one-place operating
  boundary while retaining its own canonical hospitality, staffing, and
  customer-privacy authorities.
- **DPF distinction:** the AI coworker continuously ranks the next party/table
  match and explains server-load or capacity warnings, but never seats, moves,
  releases, or changes a turn without the host's explicit confirmation.

Current primary sources (accessed 2026-08-01):

- https://support.toasttab.com/en/article/Using-Toast-Tables-Waitlist?lang=en_US
- https://www.opentable.com/restaurant-solutions/products/table-management/
- https://sevenrooms.com/platform/table-management/

### UX fit review — restaurant shift console

- **Decision:** `fits-with-guardrails`.
- **Owning area:** Workspace; `/workspace` remains the canonical live-operation
  home and `/storefront/tables` remains configuration.
- **Primary persona:** hostess or shift manager with a line at the door, phone
  demand arriving, reservations due, and tables changing state concurrently.
- **Navigation layer:** local view mode and contextual commands only; no new
  route, global nav item, or second restaurant dashboard.
- **First viewport:** compact shift pulse, ranked party queue, locked floor or
  equivalent table list, AI recommendation/confirmation, turn exceptions, and
  server load must fit inside the available host-stand viewport. Pane contents
  may scroll independently; the operator must not page-scroll to find the
  floor or the next seating action.
- **Progressive disclosure:** floor and accessible table list occupy the same
  center pane rather than stacking. Generic owner decisions and workspace-area
  launchers remain reachable below the shift console through secondary
  disclosures and do not precede the hostess task.
- **Interaction:** operate mode locks pan/zoom/drag by default for this embedded
  floor. Table activation remains a normal button action with text status and a
  visible focus state. Layout navigation and geometry editing stay in
  `/storefront/tables`.
- **AI boundary:** the coworker selects the most urgent waiting party, proposes
  the best compatible table, exposes timing/server warnings, and prepares the
  preview. The primary action remains explicit `Confirm seating`; conflict
  results preserve the queue and return alternatives.
- **Source truth:** the existing restaurant operating projection and versioned
  command adapters remain authoritative. No new dashboard DTO, reservation
  table, status map, or AI-only state is introduced.
- **Empty/failure behavior:** missing scene uses the operable table list in the
  same center pane; missing staffing is stated; no compatible table becomes an
  explicit coworker hold/watch recommendation rather than a disabled mystery.
- **Evidence before merge:** first-viewport component assertions, locked-canvas
  interaction tests, queue/recommendation/confirmation tests, table-list parity,
  theme scan, measured UX-fit manifest, and served desktop/tablet/200% browser
  exercises.
- **Kernel choice:** `DI-8AC53E1793E6` compared compressing the old stack, an
  in-place restaurant shift console, and a new dedicated host route. It chose
  `restaurant-shift-console` with high confidence (composite `3.560`, margin
  `2.303`, strong structured coverage, no commandment conflict). The main
  positive pull was durable reuse of the existing Workspace/scene/command
  contracts; the main rejected cost was the cognitive load of the existing
  vertical stack and the duplicate-home blast radius of a new route.

### Architecture review (advisory)

- **Alignment:** aligned with guardrails. This is a presentation and interaction
  refinement over the merged read model and commands, not a new operating
  substrate.
- **Important:** do not move generic owner attention into a restaurant-only
  data model. The Workspace hero may change hierarchy for a physical-operation
  archetype, but the existing attention projection stays canonical and remains
  reachable through secondary disclosure.
- **Important:** do not fork `CartesianSceneCanvas`. Add a reusable embedded,
  navigation-locked presentation option so other pressure-mode physical twins
  can make activation primary without inheriting accidental canvas movement.
- **Important:** do not fabricate phone-order, no-show, or POS state that the
  restaurant operating projection does not currently carry. Surface only
  canonical demand, turn, table, staffing, and storefront attention facts; add
  new commands only through their existing versioned authorities.
- **Refactor allocation:** extract pure host-priority/summary selectors and the
  reusable embedded-canvas contract, and remove the duplicate always-visible
  table report from the restaurant component. These changes satisfy the
  approximately 20% refactor allocation while reducing rather than growing the
  visual dialect.

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Replace the restaurant's prototype-like inferred table grid with one business-grade host-stand workflow:

- the operator sees the real authored dining-room layout, the waiting and reserved demand, table/order/turn state, assigned server load, and a short forward-availability horizon in one fast decision surface;
- seating or moving a party is an explicit, conflict-aware, versioned command with visible consequences and alternatives;
- keyboard and assistive-technology users can complete the same work through an equivalent table/list surface;
- customers can see an availability explanation derived from the same capacity truth without guest names, staff identity, internal notes, or operational conflict detail;
- `/storefront/tables` remains the internal setup and floor-configuration home, while `/workspace` remains the canonical live-operation home.

The increment is complete only when the seeded busy-shift happy path is driven on the governed runtime and the host can assign a compatible waiting party without a stale, privacy-leaking, or color-only state.

## Grounded substrate

This plan extends the current repository rather than adding a parallel restaurant system:

- `HospitalityResource`, `HospitalityResourceAvailability`, and `HospitalityCapacityAllocation` own physical tables, availability, and capacity consumption.
- `StorefrontBooking` and `BookingHold` own reservation/waitlist demand and short-lived customer holds.
- `StaffingShift`, `StaffingAssignment`, and `StaffingResourceLink` own people-to-shift and shift-to-resource coverage. Restaurant server sections are a projection of those records, not a new roster table.
- `OperationalSceneLayout` owns geometry only. Its `layoutState` references tables by `SceneEntityRef`; no guest, server, order, or live status is persisted in layout JSON.
- `RestaurantCapacitySnapshot` is the existing owner/customer reconciliation seam and will be extended into the richer restaurant operating projection rather than bypassed.
- `CartesianSceneCanvas` owns configure/operate/read-only rendering and versioned geometry saves.
- `operations-command.ts` owns idempotency, expected-version conflict semantics, alternatives, and optimistic reconciliation.
- `TwinView` and the versioned Operations snapshot remain the shared Workspace composition. The restaurant FLOOR becomes its physical operating body; it does not introduce another top-level dashboard or route.

The code graph did not yet return the newly merged scene/resource symbols, so these paths were verified directly in the current `99d7061d68` checkout with `rg` and file inspection.

## Design grounding

Operational-Precedent: restaurant-floor

- **Existing specs/plans reviewed:** `docs/superpowers/specs/2026-07-21-spatial-operational-views-design.md`, `docs/superpowers/plans/2026-07-28-business-operations-and-performance-views-plan.md`, `docs/platform-usability-standards.md`, and `docs/superpowers/plans/2026-05-26-portal-ux-simplification-spine.md`.
- **Current code substrate reviewed:** the `/workspace` and `/storefront/tables` route composition; `TwinView`; `CartesianSceneCanvas`; report-kit status, notice, and table primitives; hospitality resource/capacity repositories; workforce staffing assignments/resource links; `OperationalSceneLayout`; and the versioned operational-command contract.
- **Source of truth:** hospitality resources and allocations own physical capacity, bookings and holds own demand, staffing owns server coverage, `OperationalSceneLayout` owns geometry, and the restaurant operating projection joins those authorities without copying them.
- **Decision:** extend the existing Workspace/Storefront route family and shared scene/report-kit primitives. Do not add a global route, a second floor renderer, a restaurant-only status registry, or live facts in layout JSON.

## Current precedent and DPF adaptation

The maintained precedent corpus is the authority for this build; implementation must include `Operational-Precedent: restaurant-floor` in its delivery handoff.

Operational-Precedent: restaurant-floor

- **Toast:** live floor first, waitlist beside it, server roster and cover counts in context; table states include Available, Seated, Ordered, Paid, Dirty, and Blocked; conflicts require an explicit swap. DPF adopts this state/action grammar but always pairs color with text and never requires long-press.
- **OpenTable:** floor and waitlist are the host command surface; flexible tables, service areas, server sections, recommended assignments, pacing, and explicit constraint explanations. DPF adopts recommendation-with-confirmation and does not silently auto-seat.
- **DPF distinction:** one domain projection powers the operator canvas, the equivalent list, Workspace summary, and privacy-safe customer explanation. Geometry and live state remain separate authorities.

Sources are maintained in `apps/web/data/design-intelligence/operational-precedents.csv`; the corpus recheck date is 2027-01-28.

## UX fit review — restaurant business-grade FLOOR

- **Decision:** `fits-with-guardrails`.
- **Owning area:** Workspace for live operation; internal Storefront management for setup; customer-facing Portal for the redacted availability explanation.
- **Route family:** `/workspace` is canonical for “seat the next party”; `/storefront/tables` configures tables and layout; the existing storefront booking route receives the read-only customer explanation. No new global navigation entry.
- **Primary persona:** host or shift manager under time pressure. The first decision surface answers “who can I seat, where, and what conflict will that create?” without requiring platform vocabulary.
- **Navigation layer touched:** local view mode and contextual actions only. Global and section navigation remain unchanged.
- **Reuse/convergence:** reuse `CartesianSceneCanvas`, `TwinView`, report-kit status/notice/table primitives, the operational command contract, and the current table resource manager. Retire the label-heuristic `FloorPlanCanvas` compatibility path instead of adding a second floor renderer.
- **Source truth:** hospitality resource/allocation/booking/hold records for live state; workforce staffing records for server coverage; `OperationalSceneLayout` for geometry; one restaurant operating projection for all renderers.
- **Empty/failure behavior:** missing authored geometry uses an explicitly labelled generated starter layout and equivalent list, with a configure-layout action. Stale versions preserve the operator's selection, explain that nothing changed, and offer refreshed compatible alternatives. Missing staffing shows “Server not assigned,” not an invented roster. Degraded sources are named without replacing live data with demo data.
- **AI boundary:** recommendations do not mutate state. Seating, moving, combining, or server reassignment always previews party, table(s), server/section, timing impact, and any conflict before explicit confirmation.
- **Required guardrails:** floor-first hierarchy with adjacent demand; no guest/staff identity in customer projection; no color-only state; keyboard and list parity; no live facts in layout JSON; no duplicate status map.
- **Evidence before merge:** route/component tests, busy-shift fixture assertions, theme-token scan, privacy projection tests, stale-version/conflict tests, keyboard/list task completion, desktop and tablet browser exercise, measured UX-budget manifest, and interaction latency measures.
- **Recorded option choice:** kernel interaction `DI-BF8CA951943C` compared progressive disclosure in the existing resource manager, a separate floor-configuration route, and canvas-only editing. It recommended `resource-manager-progressive-disclosure` with high confidence (composite `4.067`, margin `3.221`, strong structured coverage, no commandment conflict). This keeps advanced table configuration with its persisted resource authority while preserving the FLOOR as the live operating surface.
- **Captured in:** this plan and `docs/ux-fit/2026-07-31-restaurant-floor-progressive-disclosure.ux-fit.json`; served viewport and interaction measurements remain completion evidence.

## Architecture review (advisory)

- **Alignment summary:** aligned with concerns once geometry, live capacity, staffing, and customer privacy stay separate authorities.
- **Findings:**
  - `[important]` A restaurant-only live-state table or live fields in `OperationalSceneLayout.layoutState` would duplicate the hospitality and staffing substrates. → Keep layout JSON limited to viewport, zones, placements, shape, and underlay; join live bindings at read time.
  - `[important]` `ServiceProvider` cannot become the server-roster authority because restaurant table creation currently writes a legacy provider compatibility row for slot booking. → Use canonical workforce staffing assignments/resource links for server coverage and treat missing coverage honestly.
  - `[important]` Free-form `HospitalityResource.attributes` needs a validated restaurant table contract if it carries shape and combinability. → Add one pure parser/serializer with closed application-level values and route tests; unknown values degrade safely. Do not scatter JSON casts.
  - `[important]` Seating through client-only optimistic state would bypass booking/allocation concurrency. → Map the generic operational command to one server transaction that rechecks table, party, interval, staffing constraints, and expected versions before changing assignments.
  - `[minor]` Customer availability must not fork the operating projection. → Add an explicit redaction/projector function with allow-listed fields and negative privacy tests.
- **Standards adopted:** DPF spatial operational view design, workforce staffing substrate, versioned operational command contract, Toast/OpenTable maintained precedent, and the portal usability/UX-fit standards.
- **Escalated decisions:** none. Existing canonical ownership resolves the apparent data-model choices.
- **Recommended next step:** implement the phases below with tests defining each contract before UI integration.

### Service-turn authority decision

The substrate sweep found no existing or in-flight authority for the live service turn shared by a party across one or more table allocations:

- `StorefrontBooking.status` owns reservation lifecycle and cannot also own seated, ordered, paid, dirty, and closed execution state without conflating customer intent with service delivery.
- `HospitalityCapacityAllocation` is the append-preserving per-resource consumption ledger. Combined tables create multiple allocation rows, so placing party-level turn state there would duplicate one state across resources.
- `StorefrontOrder.status` owns commerce fulfillment and has no booking/allocation relation; it cannot be the restaurant table-turn authority.
- `StaffingAssignment` remains the server/crew authority and is referenced by the turn rather than copied into it.

The code graph, Prisma/type sweep, live `EP-SPATIAL-OPERATIONAL-VIEWS` backlog, open-PR sweep, and recent `origin/main` history found no exact competing substrate. Kernel consultation `DI-449F9014DADA` compared booking-status reuse, allocation extension, and a dedicated aggregate. It recommended `service-turn-aggregate` with high confidence (composite `4.006`, margin `2.802`, strong structured coverage, no commandment conflict). The strongest positive contributors were Never Assume — Verify, Research and Use Standards, Architecture Over Shortcuts, and Single Source of Truth.

**Decision:** add one `HospitalityServiceTurn` per demand/party, relate one or more capacity allocations to it, and preserve append-only turn transition evidence. Reservation, resource consumption, commerce order, staffing, and geometry remain separate authorities joined by the restaurant operating projection.

## Delivery boundary

This plan is one atomic business workflow under `BI-287AA5F7`. The phases are internal sequencing, not separately releasable user outcomes:

- a configurable layout without live binding remains the existing prototype;
- live binding without transactional seating is observational, not operational;
- seating without the customer-safe projection breaks owner/customer reconciliation;
- the customer projection without the same conflict-aware source truth can advertise unavailable capacity;
- list parity, privacy, and busy-shift evidence are release conditions, not follow-up polish.

The already-completed scene-layout and hospitality-resource BIs are dependencies, not new deliverables in this branch.

## Phase 1 — Define the restaurant operating contract with failing tests

**Deliverable:** a pure, complete restaurant-floor read model and a privacy-safe customer projection.

**Files:**

- extend `apps/web/lib/storefront/restaurant-capacity.ts` and its tests;
- add `apps/web/lib/twin/restaurant-floor-projection.ts` and tests;
- add one validated table-attributes helper under `apps/web/lib/storefront/`;
- extend `apps/web/lib/twin/__fixtures__/restaurant-busy-shift.ts`.

**Contract:**

- structural table facts: service area, capacity, shape, combinability group/compatible table ids;
- live table state: available, held, reserved, seated, ordered, paid, dirty, blocked, and late-turn;
- assignment context: current party, assigned server/section, server cover/table load;
- forward horizon: `availableNow`, `availableAt`, minutes/reason, and the next conflicting demand;
- demand rows: reservation/walk-in, party size, waited/arrival time, compatible tables, recommendation reason, and safe flags such as “dietary note present” without exposing note content in the floor summary;
- customer projection allow-list: capacity/time/availability explanation only.

**Verification:**

- red tests for every busy-shift state and for unknown/missing source data;
- privacy tests prove customer JSON contains no guest name, email, phone, staff identity, VIP label, dietary text, internal note, or conflict-internal detail;
- invariant tests prove the floor/list/customer counts reconcile from one projection.

## Phase 2 — Persist authored table structure and bind the scene

**Deliverable:** `/storefront/tables` edits table shape/combinability and configures the persisted dining-room layout.

**Files:**

- extend the hospitality resource admin routes and `HospitalityResourceManager`;
- add/load the restaurant `OperationalSceneLayout` through the existing repository/actions;
- replace the derived-layout authority in `TablesNowView`/`FloorPlanCanvas` with a restaurant scene adapter over `CartesianSceneCanvas`;
- retain `floor-layout.ts` only as a one-time generated starter/fallback.

**Rules:**

- table shape/combinability is validated structural metadata on `HospitalityResource`;
- service-area geometry is stored as scene zones; table geometry/shape is stored as placements;
- layout save uses `expectedVersion`; stale saves never overwrite another session;
- removing or retiring a table leaves a resolvable missing-placement warning until the operator removes/rebinds it;
- the existing `attributes` field remains sufficient for validated table structure; one fleet-safe migration adds the missing `OperationalSceneLayout` location identity required for race-safe create-or-read. It preserves older duplicate layouts by detaching, not deleting, every duplicate before the unique index lands.

**Verification:**

- add/edit API tests for shape/combinability, authorization, unknown values, and version conflicts;
- layout load/save tests for org scoping, generated starter, authored persistence, missing refs, and concurrent saves;
- keyboard nudge and list-detail tests for configure mode.

## Phase 3 — Build the host-stand operating surface

**Deliverable:** the restaurant Workspace shows floor + waitlist/reservations + server load as one fast decision surface.

**Files:**

- extend the bounded restaurant selectors in `living-business-snapshot.ts` / `operations-loader.ts`;
- add restaurant FLOOR composition under `apps/web/components/twin/`;
- extend `WorkspaceTwinPanel`/`TwinView` through a physical-scene slot rather than a restaurant route fork;
- compose report-kit `StatusBadge`, `Notice`, and `DataTable` for status, conflicts, and list parity.

**Interaction:**

- selecting a party filters/highlights compatible tables and explains rejected choices;
- selecting a table shows party fit, server load, forward availability, and the consequence of the assignment;
- floor and list share selection, filters, command preview, and pending/conflict state;
- default viewport shows floor, adjacent demand, and server load without scrolling at the target desktop host-stand viewport;
- status text and timing remain legible at tablet width and 200% zoom.

**Performance budgets:**

- server projection uses bounded selectors and records query count/payload bytes in existing Operations telemetry;
- decision surface ready: p95 ≤ 1.5 seconds on the governed seeded runtime;
- local selection/filter response: p95 ≤ 100 ms;
- confirmed assignment response: p95 ≤ 750 ms excluding deliberate external-provider calls;
- payload and query-count regressions require explicit evidence, not a larger silent baseline.

**Verification:**

- render and interaction tests for floor-first hierarchy, selection, compatible/rejected tables, server imbalance, text status, list parity, and failure states;
- operations snapshot tests prove the fixture survives the versioned selector path;
- measured UX route sweep against `/workspace`.

## Phase 4 — Add transactional seating, moving, and combination commands

**Deliverable:** explicit host commands safely assign or move parties and combine tables.

**Files:**

- add a restaurant adapter beside `apps/web/lib/twin/operations-command.ts`;
- add server repository/action code over booking + allocation + resource/staffing reads;
- wire the operation closure into the restaurant physical-scene surface.

**Transaction rules:**

- require idempotency key, expected booking/allocation/resource versions, requested interval, party, table ids, and actor;
- recheck capacity, table availability, overlapping allocations/holds/bookings, combinability, current occupancy, and staffing coverage;
- create or advance the authoritative service turn and write/update the booking resource assignment plus append-preserving capacity allocations in one transaction;
- relate every allocation in a combined-table assignment to the same turn; never duplicate turn stage across allocation rows;
- append a versioned turn-transition event for every accepted stage or table-assignment change, retaining actor and before/after state without copying customer notes;
- return `confirmed`, `conflict` with current compatible alternatives, `rejected`, or typed `unsupported`;
- never silently swap servers, split parties, override blocks, or move a locked/active assignment;
- preview names the guest-visible consequence and internal operational consequence before confirmation.

**Verification:**

- repository tests for double-seat races, stale versions, retry idempotency, blocked/dirty tables, invalid combinations, late turns, and rollback on partial failure;
- UI tests prove optimistic pending state reconciles with confirmed/conflict/rejected results;
- audit/activity evidence identifies actor, command, affected entities, before/after versions, and result without copying sensitive notes.

## Phase 5 — Customer-safe read-only availability

**Deliverable:** the existing restaurant booking experience explains near-term availability from the same operating projection.

**Files:**

- expose a server-only redacted restaurant availability DTO through the existing storefront route family;
- compose a read-only `CartesianSceneCanvas` summary only where it improves the customer's choice; otherwise use the same DTO in a compact availability/list explanation;
- add customer route and serialization tests.

**Rules:**

- show only general capacity/time explanations such as “Table for 4 available at 7:10 PM” or “limited availability because the next compatible table is occupied”;
- do not expose exact guest identity, reservation labels, server identity/load, VIP/allergy/dietary content, internal order state, block reason, or operational notes;
- customer output is informational until the existing hold/booking transaction confirms availability;
- stale/degraded state says availability will be confirmed at booking, never fabricates precision.

**Verification:**

- negative serialization/privacy tests;
- owner/list/customer reconciliation test from the same fixture;
- browser exercise of available, limited, unavailable, and degraded cases.

## Phase 6 — Refactor allocation (approximately 20%)

**Deliverable:** remove the prototype seams and leave reusable physical-operation primitives for ROOM, CHAIR_BOOK, YARD, PROPERTY_PORTFOLIO, and DISPATCH_TERRITORY.

- retire `FloorPlanCanvas` as a restaurant-specific renderer once all callers use the generic scene;
- reduce `floor-layout.ts` to a clearly named starter-layout generator or delete it if no fallback remains;
- extract shared scene-binding, selection/command-preview, and floor/list parity primitives without moving restaurant vocabulary into the generic layer;
- centralize restaurant state-to-intent registration in report-kit status metadata;
- remove duplicate presentation adapters and stale comments that still describe the live projection as future/demo.

**Verification:**

- twin-template coverage remains green for all archetypes;
- module-size and no-hardcoded-color guards pass;
- no new restaurant-only scene renderer, status registry, command state machine, or global route exists.

## Phase 7 — Governed completion evidence

## Design grounding

- Existing specs/plans reviewed:
  - this business-grade floor plan, the operational scene persistence plan,
    and the Cartesian scene renderer plan.
- Current code substrate reviewed:
  - `RestaurantFloorOperations`, the restaurant floor
    loader/projection/command seams, `CartesianSceneCanvas`, the canonical demo
    loader, hospitality resources, staffing assignments, service turns, and
    capacity allocations.
- Source of truth:
  - persisted `OperationalScene` geometry plus the existing
    hospitality/staffing aggregates; the reversible demo loader provisions
    those authorities and does not create a fixture-only floor model.
- Decision:
  - converge the restaurant route on the shared Cartesian renderer, repair only
    the exact canonical restaurant demo corpus, retain floor/list task parity,
    and derive responsive columns from the available host-workspace container
    so the coworker panel does not obscure the floor.

### Historical source checkpoint — 2026-07-31 (superseded for current status)

- Phases 1–5 were implemented in source on `feat/restaurant-floor`: authored table
  structure and geometry, the joined live host stand, combined-table seating,
  service-turn lifecycle controls, atomic party movement, actionable conflict
  alternatives, and the public privacy-allowlisted forward-availability view.
- The service-turn aggregate and both fleet-safe migrations format and validate
  under Prisma 7.8. Migration safety and timestamp-collision guards pass.
- Independent Workspace projections now load concurrently; recommendation
  candidates are cached by party size so a busy waitlist does not repeat the
  same bounded table-pair search for every party. The restaurant read model
  reuses the shared Prisma read instrumentation and reports its own elapsed
  time, bounded query count, and exact serialized payload size rather than
  disappearing inside the generic Operations telemetry.
- Source-focused evidence after refreshing to `origin/main@0b29e31bd7` is 26
  Vitest files / 121 tests passing. The customer detail list is bounded while
  retaining the full availability count, and confirmed seating is distinguished
  from a later party move using the status fact rather than resource changes
  alone. A full TypeScript diagnostic pass reports no
  restaurant implementation errors; its remaining diagnostics are limited to
  the source-only worktree's absent `@dpf/storefront-templates` workspace link,
  which must be resolved by canonical sandbox convergence rather than a
  worktree install.
- Phase 6 allocation is materially represented by the shared Cartesian scene,
  central status-intent registry, customer allow-list projector, reusable
  seating/alternative evaluator, and separated service-turn/seat/move command
  modules. Compatibility deletion remains contingent on governed route evidence.
- Subsequent merges closed the source publication gates. The current status and
  remaining functional evidence are listed in `Current delivery truth` above.

1. Provision or configure the canonical restaurant install with an authored,
   recognizable dining-room layout: named service areas, varied table shapes
   and capacities, combinable tables, and complete server sections.
2. Provision the canonical busy-shift acceptance state through its owning seed
   or setup path: reservation, 14-minute walk-in, combined tables, server
   imbalance, dirty and blocked tables, and a late turn. Prove the privacy
   boundary through the absence of sensitive guest notes from the demo and the
   allow-listed customer projection rather than by manufacturing sensitive text.
3. Drive the busy-shift host task on the served candidate:
   - choose the 14-minute walk-in;
   - inspect compatible tables and the server imbalance warning;
   - preview and confirm the recommended assignment;
   - observe the table, waitlist, capacity, and forward-availability update;
   - repeat the task by keyboard through the list alternative;
   - force a stale conflict and confirm that nothing changes and alternatives remain actionable.
4. Drive the customer availability cases and inspect the serialized payload for privacy.
5. Measure desktop and tablet viewports, 200% zoom, touch targets, coworker-panel coexistence, no clipping/overlap, UX-budget axes, decision-ready latency, selection latency, assignment latency, query count, and payload bytes.
6. Retire the restaurant compatibility renderer only after route evidence proves all callers use the shared scene path.
7. Run the governed exact-tree gate for any corrective source change and merge it through the protected queue.
8. Before implementation resumes, claim a fresh capsule for `BI-287AA5F7` and
   the remaining scope. Record final runtime evidence on that capsule and the
   BI; only then mark the BI done and release the new capsule. Keep
   `WC-8550281A` as historical provenance for the merged Host-stand increment.

## Risks and rollback

| Risk | Mitigation | Rollback |
| --- | --- | --- |
| Authored layout and resource inventory drift | Missing-ref diagnostics; table-id entity refs; list remains authoritative and operable | Switch the restaurant scene loader to generated starter layout while preserving saved layout rows |
| Staff/table identity confusion through legacy providers | Never use legacy table providers as server roster; join workforce staffing explicitly | Omit server assignment/load with an honest unavailable label |
| Seat race or double allocation | One transaction, expected versions, overlap checks, idempotency | Reject with alternatives; no partial writes |
| Customer privacy leak | Allow-list projector plus negative serialization tests | Disable the read-only explanation and retain existing slot availability |
| Slow host interaction | Bounded selectors, payload/query telemetry, local selection state | Fall back to list-first interaction using the same projection and commands |
| Refactor destabilizes other twins | Preserve generic contracts and full twin-template coverage | Restore compatibility adapter while keeping the richer domain projection |

No rollback path deletes bookings, allocations, resources, layouts, or staffing history.

## Definition of done

- Persisted authored geometry is the authority after configuration; label heuristics are not.
- The floor displays service areas, table shape/capacity/combinability, server section/load, table/order/turn state, and forward availability with text plus semantic color.
- A host can assign and move parties with preview, explicit confirmation, idempotency, version conflicts, and alternatives.
- The same task is fully operable through the list alternative and keyboard.
- The customer explanation comes from the same projection and passes the privacy allow-list tests.
- Busy-shift data includes reservation, walk-in, combined tables, server imbalance, dirty, blocked, and a late turn; customer and floor projections prove the guest-note privacy boundary without seeded sensitive text.
- Measured performance, accessibility, privacy, UX-fit, exhaustive test, production build, and functional browser evidence are attached to the BI/Work Capsule.
- Approximately 20% of the implementation removes the restaurant compatibility renderer and extracts reusable physical-operation seams.
- The ready PR is merged through the governed queue.

## Backlog coverage

- **Receipt:** `cms89c2jv031001qo7gezoyzm`
- **Parent BI:** `BI-287AA5F7`
- **Decision:** `atomic`
- **Mapped child BIs:** none; the six phases are non-shippable sequencing within the parent BI.
- **Dependency graph:** `operating-contract` → `authored-layout` → `host-surface` → `assignment-commands` → `customer-projection`; `refactor-evidence` closes all preceding phases.
- **Rationale:** authored geometry without live binding remains prototype-only; live binding without transactional assignment is observational; assignment without the same customer-safe availability projection breaks owner/customer reconciliation; accessibility, privacy, busy-shift, and performance evidence are release conditions rather than independent products. Completed scene-layout and hospitality-resource BIs are substrate dependencies, while this BI owns their end-to-end integration.
