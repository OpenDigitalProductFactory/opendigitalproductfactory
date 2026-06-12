---
title: Rental / shared-asset utilization value stream
epic: EP-ARCH-8D4F2A
backlog: [BI-EEA24A34, BI-2754B64E, BI-4C3CFC35, BI-D7FCD029]
status: implemented
date: 2026-06-11
supersedes_research: docs/superpowers/specs/2026-05-29-vehicle-equipment-rental-archetype-design.md
value_stream_ref: docs/architecture/archetype-business-value-streams.md §10.1
---

# Rental / shared-asset utilization value stream

## Why

None of the existing 53 archetypes / 8 commercial models could express the
**rental / shared-asset utilization** value stream: the time-bounded loan of a
stocked, returnable asset. Its defining shape — `reserve → checkout → return &
inspect → re-pool` — adds an `S4b Return & Inspect → re-pool` stage and a
*reusable pooled asset* capacity unit that "services sold" (booking) and "goods
sold" (one-way purchase) archetypes do not have. Verified against the seed
before building (no `reservation-and-return` provisioning value, no rental
ctaType, no pooled-asset capacity); the gap is real but **not greenfield** —
spec #1265 already designed the `RentableUnit`/`RentalAgreement` model (Option
B) and the value-stream doc §10.1 corroborates the candidate split exactly.

## Decisions

- **Archetype vs sub-type.** Rental is a *cross-cutting value stream*, not one
  archetype. The clean signal is a new **provisioning axis value**
  `reservation-and-return` (axis-derived capability, not per-archetype-id) — it
  distinguishes a returnable pool from a usage-metered utility (`usage-based` +
  `account-with-billing`). Three candidate archetypes instantiate it.
- **Category placement.** New `asset-rental` `ArchetypeCategory` ("Rental &
  Shared Assets") for the commercial leaves (equipment rental, self-storage);
  the **agricultural shared-machinery co-op** stays under `nonprofit-community`
  because it derives **both** the member-owned governance set and the rental
  set — the intersection is the point.
- **Substrate reuse (Option B, spec #1265).** `StorefrontItem` stays the
  rate-card *class*; `BookingHold` carries reservation concurrency;
  `RentalAgreement` is the rental analog of `StorefrontBooking`. No parallel
  "renter" identity — renter resolves to a `CustomerContact` (principal
  convergence). `InventoryEntity` reuse explicitly rejected (CMDB semantics).
- **Equitable rationing (co-op).** A member-OWNED pool cannot allocate contended
  capacity first-come-first-served; allocation is patronage-balanced
  (least-served first, per-member concurrency cap, deterministic tiebreaks).

## Delivery (shipped)

| Phase | Content | PR |
|---|---|---|
| 1 — substrate | `reservation-and-return` provisioning, `rental` ctaType, `asset-rental` category, `rental-fleet`/`rental-agreements` modules, 3 capabilities + applicability rule | #1725 |
| 2 — leaves | equipment-rental, self-storage, agricultural-cooperative | #1725 |
| 3 — domain model | `RentableUnit`/`RentalAgreement`/`RentalConditionRecord` + migration + pure capacity engine (`rental.ts`) | #1725 |
| 4 — runtime | reservation→return lifecycle server actions, capability-gated Rental Desk daily board, equitable-rationing scheduler (`rental-rationing.ts`) | this PR |

## Capacity engine (pure, unit-tested)

`apps/web/lib/storefront/rental.ts` — `availableCapacity` (pool = stock −
overlapping occupying agreements; serialized = available-unit count),
`countOverlappingAgreements` (half-open overlap, occupying statuses only),
`utilizationRate` (point-in-time pool fraction), `occupancyPercent`
(self-storage standing-inventory KPI), `hasUnitConflict` (serialized
double-booking guard), `rentalDays`.

`apps/web/lib/storefront/rental-rationing.ts` — `rationReservations` (greedy
over a stable fairness ranking) + `wouldGrant`.

## Lifecycle

`reserve` (BookingHold + agreement `reserved`) → `verify` (deposit gate) →
`checkout` (checkout `RentalConditionRecord`, unit `out`, agreement `active`) →
`return` (return condition record, meter delta, unit `available`|`maintenance`,
deposit release/hold note, agreement `closed`). Cancellation re-pools the unit;
an active rental cannot be cancelled (must be returned).

## Follow-ups (not in scope)

- Real Stripe deposit auth/capture (extends `billing-readiness`).
- Public storefront rental booking form with date pickers (Phase 2 CTAs route
  to `/inquire`, which carries the date fields, until then).
- Batch rationing operator tool surfacing the published allocation rationale to
  members.
