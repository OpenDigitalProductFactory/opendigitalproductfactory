# Restaurant Capacity Legibility — Design

- **BI:** BI-7C95A586 (Restaurant capacity UX needs coherent tables, staff, and service-readiness model)
- **Epic:** EP-UX-COGLOAD (Live UX cognitive-load audit follow-up)
- **Coordinates with:** BI-57F34A00, BI-287AA5F7, BI-075F731F, BI-36807E68, BI-0E4A1228, BI-A60D53AF, BI-C39DC90C, BI-348766E5, BI-2B2FCB2B (EP-VERTICAL-FOOD-HOSPITALITY, EP-SPATIAL-OPERATIONAL-VIEWS)
- **Date:** 2026-07-22
- **Status:** Ready to implement

## Design grounding

Specs/plans reviewed:
- `docs/superpowers/specs/2026-07-12-operational-twin-framework-design.md` — the FLOOR twin (tables/stations + seats), the `capacityZoneKey`/`resourceNoun`/`queues`/`capacityChips` grammar. **This is the noun SSOT this work renders from.**
- `docs/superpowers/specs/2026-07-21-spatial-operational-views-design.md` — the FLOOR spatial renderer (BI-287AA5F7). This work supplies the **capacity-state contract** that renderer consumes; it does not build the spatial editor (avoids the double-claim collision).
- `docs/superpowers/specs/2026-03-19-storefront-foundation-design.md`, `docs/superpowers/specs/2026-03-20-storefront-booking-calendar-design.md` — the storefront + booking substrate these surfaces run on.
- `docs/platform-usability-standards.md` — plain-language (FK ≤ 9), progressive disclosure, report-kit composition.

Code substrate reviewed (`rg` + reads):
- `packages/storefront-templates/src/twin-profile.ts` — `deriveTwinProfile()`, FLOOR `TEMPLATE_DEFAULTS` (resourceNoun `table/tables`, capacityChips `tables seated / seats filled / parties waiting`, queues `Waitlist / Reservations`).
- `packages/storefront-templates/src/archetypes/food-hospitality.ts` — restaurant archetype (`Table for 2/4/6+`, `Private Dining`, `Set Lunch`; `covers` form field).
- `apps/web/lib/storefront/archetype-vocabulary.ts` — `getVocabulary()` (`teamLabel: "Staff"`, no resource/table label).
- `apps/web/lib/twin/living-business-snapshot.ts` — `resourceUnits()` (lists `ServiceProvider`s as "tables", never invents), `liveCapacityChips()` (archetype-agnostic — Workforce/AI/Open-demand), the `queues[i===0]`-only fill that yields "RESERVATIONS 0 Clear".
- `apps/web/lib/slot-engine/compute-slots.ts` — `computeAvailableSlots()`, `aggregateClass()` (`remainingCapacity`, "spots left"), `resolveBookingConfig()` (`capacity` default 1).
- `apps/web/lib/storefront/seed-booking-defaults.ts` — auto-creates ONE provider named after the org; `apps/web/app/api/storefront/admin/setup/route.ts` passes `providerName: orgName`.
- `apps/web/components/storefront-admin/{TeamManager,ItemsManager,StorefrontInbox}.tsx`, `apps/web/components/storefront/SlotBookingFlow.tsx`.

This work **extends** the twin FLOOR grammar and the vocabulary map. It creates **no new persistent substrate** — the persistence resource-pool engine is the separate large item BI-57F34A00.

## Problem

A Restaurant install's table/capacity signals exist but are split across pages with cross-archetype vocabulary and no coherent service-readiness action (BI-7C95A586 evidence, 2026-07-22):

- `/storefront/team` labels the page `Staff (10)`, offers `+ Add Provider`, and lists physical `Table 1`–`Table 9` as providers with `Active 0 services`. Tables are scarce bookable resources, not staff/providers.
- `/storefront/units` shows `No rental classes yet. Add a rental item…` — cross-archetype rental vocabulary.
- `/storefront/items` models `Table for 2/4/6+` as menu items with `On/Edit/Del` controls, mixing the bookable-offer menu with physical capacity inventory.
- `/workspace` shows `DINING ROOM 8 tables`, tickets, waitlist — but also `RESERVATIONS 0 Clear` and `NEEDS YOU Nothing needs you right now`, so the owner cannot reconcile capacity/readiness with booking demand.
- Public booking shows `Book: Table for 2`, bare calendar numbers, and bare time buttons with no capacity confidence.

Root cause: the storefront is a generic service-business abstraction (`ServiceProvider`/`ProviderService`/`ProviderAvailability`, `ctaType: rental`/`RentableUnit`). The restaurant archetype reuses it, so tables leak out as "providers" and "rental classes," there is no single capacity ledger, and the workspace twin's capacity chips are archetype-agnostic.

## Approach: a shared capacity projection + archetype vocabulary

### 1. Canonical capacity model (`apps/web/lib/storefront/restaurant-capacity.ts`)

A pure, DB-free module — the single source of truth every surface renders from. It is a **projection over existing data**, so it works today with no migration and the large resource-pool engine (BI-57F34A00) can later back it with real persistence behind the same types.

```ts
export type TableCapacityState =
  | "available"     // open, bookable now
  | "occupied"      // a party is seated / a confirmed booking spans now
  | "turning-soon"  // occupied but the sitting ends within the turn window
  | "blocked";      // out of service (maintenance / owner hold)

export interface RestaurantTable {
  key: string;
  label: string;          // "Table 4", "Window 2"
  seats: number | null;   // derived from name / booking-item where available
  state: TableCapacityState;
  freeInMinutes: number | null; // for turning-soon
}

export interface ServicePeriod {
  key: string;            // "lunch" | "dinner"
  label: string;
  startsAt: Date; endsAt: Date;
}

export type ServicePeriodReadiness = "ready" | "attention" | "not-ready" | "closed";

export interface RestaurantCapacitySnapshot {
  tables: RestaurantTable[];
  counts: Record<TableCapacityState, number>;
  totalTables: number;
  seatsTotal: number | null;
  waitlistParties: number;   // parties waiting (walk-in / unrouted)
  ticketsOpen: number;       // in-flight work items consuming capacity
  upcomingReservations: number;
  nextPeriod: ServicePeriod | null;
  readiness: ServicePeriodReadiness;
  nextAction: { label: string; href: string } | null; // the ONE thing to do next
}
```

- `classifyStorefrontResource(row)` — decides whether a `ServiceProvider` row is a **table/capacity resource** or a **person/staff** member. Heuristic today (name matches table/seat/booth patterns, or a `resourceKind` hint if present), centralized so BI-57F34A00 can replace the heuristic with a structured field without touching call sites.
- `deriveRestaurantCapacity({ providers, bookings, holds, items, now, period })` — classifies resources, folds active bookings/holds into per-table state (`occupied`/`turning-soon` from `scheduledAt + durationMinutes`), counts waitlist (walk-in/unrouted) and open tickets, computes `readiness` and the single `nextAction`.
- Nouns come from `deriveTwinProfile(def)` (FLOOR), never re-authored.

Fully unit-tested (pure functions, table-driven).

### 2. Archetype vocabulary (`archetype-vocabulary.ts`)

Extend `ArchetypeVocabulary` with the resource axis so restaurant routes stop saying "provider"/"rental":

```ts
resourceLabel: string;        // "Tables & Capacity"
resourceSingular: string;     // "table"
addResourceButtonLabel: string; // "Add table"
staffLabel: string;           // "Staff" (people only)
```

`food-hospitality` fills these from the FLOOR profile. Existing categories inherit sensible defaults (`resourceLabel` derived from `teamLabel` where a category has no separate resource axis) so nothing else changes.

### 3. Owner surface — Tables & Capacity (`/storefront/tables`)

A new archetype-gated tab (visible only when the twin template is physical/capacity-bearing — FLOOR today). It renders `RestaurantCapacitySnapshot` with report-kit primitives:
- `StatCard` row: total tables, available / occupied / turning-soon / blocked, parties waiting.
- `DataTable` of tables with a `StatusBadge` per `TableCapacityState`.
- A readiness banner answering "are we ready for the next service period?" plus the single `nextAction`.

The `/storefront/team` page is split into **Staff** (people) and a link to **Tables & Capacity** (resources), using `classifyStorefrontResource`, so tables leave the "Staff" list and "+ Add Provider" becomes "Add staff" / "Add table" per section. `/storefront/units` copy is archetype-guarded so a restaurant never sees rental-class vocabulary.

### 4. Workspace readiness reconciliation (`living-business-snapshot.ts`)

- When the twin template is FLOOR (physical capacity), derive the capacity chips from `RestaurantCapacitySnapshot` (tables seated / seats filled / parties waiting) instead of the generic Workforce/AI/Open-demand chips. Non-FLOOR archetypes keep the existing generic chips (gated, additive).
- Surface the service-period readiness answer + one next action as a quest so `NEEDS YOU` reflects real capacity/service-period demand.
- **Not here:** the Reservations-queue reconciliation (fixing `RESERVATIONS 0 Clear` while booking history exists) is owned by **BI-348766E5 / PR #3403**, which edits the same queue construction. To avoid duplicating that work (a sibling session already had a duplicate PR closed), this PR leaves the queue fill alone and reconciles only the capacity chips + readiness.

### 5. Public booking states (`SlotBookingFlow.tsx`)

Render availability in restaurant terms with explicit states: **loading** ("Checking table availability…"), **available** (tables/times bookable), **unavailable** (closed / outside hours), **sold-out** ("Fully booked — join the waitlist"). Replace "with {providerName}" per-provider slot cards with table/time confidence for FLOOR archetypes. (Touch-target/label/selected-slot mobile fixes are BI-2B2FCB2B; this work makes the states legible and removes provider copy.)

### 6. Smoke tests (`apps/web/lib/storefront/restaurant-capacity-legibility.test.ts` + surface tests)

Executable proof (acceptance #8):
- **No provider/rental jargon:** restaurant vocabulary resolution does not yield `provider`/`rental`/`rental class` for resource/add-button labels; `classifyStorefrontResource` puts table-shaped rows in `table`, people in `staff`.
- **Capacity reconciliation:** given a fixture of providers/tables + bookings + holds, `deriveRestaurantCapacity` produces consistent counts; the workspace snapshot's reservations queue is non-empty when bookings exist (no `RESERVATIONS 0` with demand); the same table/capacity numbers reconcile across the tables surface, workspace chips, and booking availability.
- **Booking states:** availability resolves to `available/unavailable/loading/sold-out` deterministically from slot data.

## Non-goals (owned elsewhere)

- Persistent `Table`/`Reservation`/`Capacity` models + covers column, resource pools, conflict detection → **BI-57F34A00** (large). This design keeps the projection contract stable so that work slots in behind it.
- FLOOR spatial editor / auto-grid / geometry → **BI-287AA5F7 / EP-SPATIAL-OPERATIONAL-VIEWS**. This design supplies the capacity-state the renderer draws.
- Full owner cockpit, setup-step recovery, mobile touch-targets, master-data records → BI-075F731F, BI-C39DC90C, BI-2B2FCB2B, BI-A60D53AF (this design leaves clean seams: the vocabulary axis, the projection, the readiness answer).

## Rollout / risk

- Zero migration; all reads are fail-soft (existing `.catch(() => [])` idiom). Capacity chips are gated on FLOOR so no other archetype's workspace changes.
- The `/storefront/tables` tab is additive and archetype-gated.
- New model-facing copy stays FK ≤ 9 per the readability policy.
