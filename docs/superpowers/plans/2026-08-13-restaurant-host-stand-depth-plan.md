# Restaurant Host Stand Depth — Design and Implementation Plan

**Backlog:** BI-178AAB4F
**Epic:** EP-SPATIAL-OPERATIONAL-VIEWS
**Work Capsule:** WC-70414C89
**Branch:** `feat/restaurant-host-stand-depth`
**Depends on / coordinates with:** BI-661BBC66 (public Restaurant booking must use canonical table capacity and hours)

## Outcome

Turn the Restaurant `/workspace` floor from a mostly observational layout into a complete host-stand work loop:

1. capture a named walk-in without inventing contact data;
2. understand booked and open capacity across the immediate service horizon;
3. protect a deliberate portion of table inventory for in-house use while still allowing the host to seat it;
4. pan, zoom, and fit the complete authored floor; and
5. activate a table and take the next likely action beside that table, with equivalent keyboard and list behavior.

The five capabilities are one atomic workflow. Shipping only one would leave the host unable to complete the same guest journey.

## Backlog coverage

- **Decision:** atomic
- **Umbrella / delivery BI:** BI-178AAB4F
- **Governed receipt:** `cmss7e32f0qmt01qhgbdgdr35`
- **Dependency:** BI-661BBC66 supplies the canonical external-booking/table-capacity boundary; this plan does not duplicate it.
- **Mapping:** `canonical-contracts`, `host-projection`, `floor-interaction`, and `admin-delivery` all map to BI-178AAB4F and are marked non-independently-shippable.
- **Rationale:** walk-in intake, capacity visibility/protection, full-floor reachability, and contextual table action are sequencing inside one host-to-seat work loop; none is independently useful or safely shippable without the shared demand, capacity, and interaction contracts.

## Current-state evidence

- `RestaurantFloorOperations` already projects a named waiting queue, seating commands, service turns, and a reservation watch, but exposes no walk-in creation action.
- The floor passes `navigation="locked"` to `CartesianSceneCanvas`; the shared canvas already supports interactive pan, zoom, pinch, and controls.
- Table activation only changes an existing recommendation. With no selected party, activation has no visible result, and confirmation remains in a distant right-hand panel.
- `StorefrontBooking` is already the canonical demand record and owns `demandKind`, `customerName`, covers, schedule, status, optional phone, and optional notes. Its required `customerEmail` currently forces a false contact fact for an uncontacted walk-in.
- `HospitalityResource.attributes` already has one Restaurant table parser for shape and combinations. `HospitalityResourceAvailability` owns only available/blocked time windows; it is not a booking-channel policy.
- Public capacity allocation already resolves a table resource and evaluates availability and allocations. The channel policy must be enforced there, not merely labelled in the UI.
- Existing BI-661BBC66 owns generic-provider bypass and operating-hour authority. This plan consumes that same table-capacity boundary without duplicating its repair.

## Research & benchmarking

### Toast Tables

Toast combines reservations, waitlist, floor-plan seating, real-time table state, and server/cover information in one host workflow. DPF adopts the combined operating surface and immediate table-state legibility. DPF does not add POS order-detail coupling in this slice because the existing service-turn model is the canonical depth available today.

Source: <https://pos.toasttab.com/products/toast-tables>

### OpenTable

OpenTable treats online availability as an operator-controlled subset: booking rules and cover pacing can expose as many or as few seats as the restaurant chooses, while table management recommends assignments for reservations and walk-ins. DPF adopts explicit enforced online versus in-house table access and compact capacity-at-time feedback.

Sources: <https://www.opentable.com/restaurant-solutions/products/features/availability-controls/> and <https://www.opentable.com/restaurant-solutions/products/table-management/>

### ResyOS

Resy distinguishes Online, In-House, and Walk-In inventory; combines waitlist and reservations; and plots turns on a timeline/floor. DPF adopts the core semantic distinction while simplifying the persistent table policy to `online` or `in-house`: online tables remain usable by hosts, while in-house tables are excluded from external availability. Walk-ins remain a demand kind, not a third mutually exclusive table class.

Sources: <https://helpdesk.resy.com/live-day-checklist-r1BVbvXUu>, <https://helpdesk.resy.com/resyos-faq-B1ciD7Uu>, and <https://helpdesk.resy.com/en_us/resyos-app-settings-r1dXii2Gs>

## Architecture decision

Kernel interaction `DI-47863797A6AD` recommends `extend-canonical-contracts` with high confidence (composite 9.435, margin 4.533, autonomy eligible).

- Make `StorefrontBooking.customerEmail` nullable using a forward-only migration. Existing values are preserved; public booking still validates and writes an email, while host-created walk-ins may truthfully have none.
- Extend `RestaurantTableAttributes` with the closed `bookingAccess` contract: `online | in-house`, defaulting old rows to `online`.
- Enforce `bookingAccess` at public hospitality-resource resolution/allocation. `in-house` tables remain valid for authenticated host seating.
- Reuse `StorefrontBooking`, `HospitalityResource`, `HospitalityCapacityAllocation`, `HospitalityServiceTurn`, and `OperationalSceneLayout`; create no parallel waitlist or table-policy models.

## Interaction design

### Owning area and hierarchy

- Owning area: Workspace.
- Route: existing `/workspace`; no global or section navigation change.
- Primary persona: host / front-of-house operator.
- Primary action: `Add walk-in` beside `Waiting now`.
- Contextual action: a table action popover adjacent to the activated table.
- Persistent administration: existing `/storefront/tables` table manager exposes the same booking-access policy.

### Walk-in intake

- Open a compact disclosure/popover from `Add walk-in`.
- Required: guest/party name and party size.
- Optional: phone, note, quoted wait.
- On success, create a `StorefrontBooking` with `demandKind=walk-in`, `status=waiting`, `scheduledAt=now`, no fabricated email, and refresh the queue.
- Keep the form in the first viewport and focus the name field on open. Errors remain beside the form; successful submission announces and closes it.

### Capacity timeline

- Replace the isolated reservation-watch list with a compact near-term timeline (now plus bounded time slots).
- Each slot shows reservations/covers and open table capacity split into `Online` and `In-house`.
- Late/upcoming guest rows remain visible and selectable; the timeline does not become a new scheduling product.
- Compute from current Restaurant tables, channel policy, resource availability, active holds/allocations, and reservations using storefront-local time.

### Floor reachability and table action

- Use the shared interactive canvas behavior and visible fit/zoom controls in operate mode.
- Extend canvas activation metadata with an anchor rectangle or viewport point from the activated semantic button; do not make the host calculate coordinates.
- Open a focus-managed, dismissible popover adjacent to the table and clamp it inside the floor container.
- If a compatible waiting party is selected, put `Seat [name] here` first. Otherwise offer `Choose a waiting party` and the reversible inventory action `Hold for in-house` / `Open online` according to current state.
- The table list exposes the identical action trigger and dialog content. Escape closes, focus returns to the activating control, and pointer activation is not required.

## Delivery phases

### Phase 1 — Canonical contracts (RED → GREEN)

1. Add failing parser/serialization tests for default `online` and explicit `in-house` access.
2. Add failing repository tests proving public allocation rejects an in-house table while authenticated host allocation remains unchanged.
3. Add the nullable-email migration and update strict types/presentations to render missing contact truthfully.
4. Refactor channel checks into one reusable Restaurant table-access predicate.

### Phase 2 — Host demand and capacity projection (RED → GREEN)

1. Add failing server-action tests for authenticated, validated named walk-in creation, idempotency, optional contact, and customer-safe refusal.
2. Add failing loader/projection tests for bounded local-time slots, reservation ordering, allocations, online open tables, and in-house protected tables.
3. Implement the action and projection through the canonical repositories and revalidation paths.
4. Refactor the loader so reservation/timeline calculations are pure, bounded helpers rather than another large inline branch.

### Phase 3 — Floor interaction (RED → GREEN)

1. Add component tests for walk-in form focus/validation/success, timeline labels, interactive navigation, table popover proximity contract, seat-first action, booking-access toggle, Escape/focus return, and list parity.
2. Extend Cartesian activation metadata without changing existing consumers' meaning.
3. Add the compact host controls and popover using shared theme-aware primitives.
4. Refactor `RestaurantFloorOperations` into focused walk-in, timeline, and table-action components so the primary component coordinates state instead of owning every rendering branch.

### Phase 4 — Admin parity, evidence, and delivery

1. Add `bookingAccess` to the existing table-manager API and form, with optimistic version protection.
2. Generate and validate the exact UX-fit manifest.
3. Run focused unit tests, schema checks, migration application in the governed gate, production build, exhaustive tests, and UX route sweep through one exact `pnpm run pregate` after a stable DCO commit and fresh independent semantic review.
4. Open one ready PR, merge through the protected queue, advance only by normal `/ops/self-upgrade`, obtain exact CAN-TEST, and use the signed-in canonical Workspace to prove the complete walk-in → capacity → table action → seating → reload journey with the coworker panel open and at narrow/wide widths.

## Verification matrix

**Research amendment, BI-4CCE50E0 (2026-09-06):** add the host-to-seat portion of
the [restaurant operating-day fixture](../research/2026-09-06-astra-business-verification-review.md#5-human-world-representation-the-restaurant-pilot).
Race two public reservations for the last allocatable table; refresh after a
successful write with a lost response; retry a stale host seating command; cancel
and verify capacity releases once. Public/host/timeline projections must agree after
reload. Capture actual host-role and signed-out public evidence, not administrator
access alone, using the [audit contract](../../architecture/archetype-operating-model-audit.md#outcome-evidence-and-exception-probes).

Keep this plan's atomic host-to-seat scope. Kitchen, stock, POS settlement and
periodic-close expansion belong to later researched slices under the simulator and
Living Business program. BI-178AAB4F and BI-661BBC66 returned `not_found` on the operator development install during this research; reconcile their owning installation before scheduling
implementation. This is additional acceptance design, not a new delivery claim.

| Concern | Source-local proof | Canonical-runtime proof |
|---|---|---|
| Named walk-in | action validation, auth, persistence, nullable contact tests | create named walk-in; verify waiting queue and reload |
| Protected capacity | parser + public allocation refusal + host allowance tests | mark a table in-house; verify timeline split and external slot exclusion |
| Reservation/open slots | deterministic timezone/projection tests | compare visible booked/open slots with created reservations |
| Floor reachability | canvas interaction tests | pan/zoom/fit to every authored zone at desktop and narrow widths |
| Nearby table action | anchor, focus, Escape, action ordering tests | click and keyboard-activate table; verify minimal pointer travel and action result |
| Seating persistence | existing command regressions plus new integration fixture | seat selected party, reload, verify active turn/table state |
| Coworker coexistence | responsive component tests where practical | open coworker panel; verify no overlap or unreachable actions |
| Console quality | build/typecheck/route sweep | zero new browser errors or warnings |

## Documentation impact

No new route or end-user help center is required. This plan and UX-fit evidence are the durable design surfaces; inline owner copy must remain concise enough for prose and text-mass guards. If the booking-access contract changes external API behavior, add the contract to the existing Restaurant capacity documentation rather than creating a second guide.

## Rollback and data safety

- The migration only drops the email `NOT NULL` constraint; it does not rewrite or delete existing contacts.
- Unknown or pre-existing table attributes parse as `bookingAccess=online`, preserving existing external availability until an operator deliberately protects a table.
- Booking-access changes are reversible and version guarded.
- No runtime seed or live database is patched by hand; demo fixtures and source migrations own any required defaults.
