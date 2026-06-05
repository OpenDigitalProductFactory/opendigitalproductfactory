# Plan — Vehicle & Equipment Rental Archetype

- **Date:** 2026-05-29
- **Spec:** `docs/superpowers/specs/2026-05-29-vehicle-equipment-rental-archetype-design.md`
- **Status:** Ready for review (no implementation started)

## Problem (verified)

DPF's 12-category / ~45-leaf archetype catalog models *services sold* and *goods sold*, never the *time-bounded loan of a returnable, stocked asset* — the rental shape (car rental, car-share clubs, equipment/tool hire, RV/boat, P2P host). Verified against `main`: no rental/fleet/vehicle archetype exists; `hoa-property-management` covers long-term leasing only; the field-service spec covers owner-operated dispatch fleet, not rentable inventory.

## Design — reuse substrate, add only the asset layer

Verified reusable substrate (Prisma schema on `origin/main`):

- **Reuse `StorefrontArchetype`/`StorefrontConfig`** — archetype catalog + per-org config (JSON `activationProfile`, `customVocabulary`, `marketingSkillRules`). No change.
- **Reuse `StorefrontItem`** as the rentable **class / rate-card**; rental rate metadata in existing `bookingConfig` JSON.
- **Reuse `BookingHold`** for reservation concurrency over a date range (`slotStart`/`slotEnd`/`expiresAt` already fit a multi-day window).
- **Reuse `ServiceProvider`/`ProviderAvailability`** as pickup location/desk + hours.
- **Reuse `ActivationProfile.modules`** to toggle rental/membership/marketplace (PocketOS's module split maps onto it).
- **Reject** reusing `InventoryEntity` (IT discovery/CMDB graph — wrong domain) — explicit non-reuse.

Add the minimum new model (Spec §6 Option B):

- `RentableUnit` — individual stocked asset, `status` state machine, optional meter; a class may have 0 units (quantity-pool) or many (serialized).
- `RentalAgreement` — checkout→return lifecycle, deposit, verification status, condition links; sibling of `StorefrontBooking` under `StorefrontConfig`.
- `RentalConditionRecord` — bilateral checkout/return condition capture (Turo pattern).

Central decision to confirm via `dpf-decision-via-kernel` before BI-2: per-unit asset model (Option B) vs. quantity-only item extension (Option A). Spec recommends B. Renter identity resolves to a `CustomerContact`/`Principal` (principal-convergence), never a new identity table.

## Phased work (maps to spec §16 backlog items)

**Phase 1 — catalog + model (additive, inert until selected)**
- BI-1: enum + category wiring across spec §13 touch list (1–10). `ArchetypeCategory`, `CtaType: "rental"`, new `ActivationModule`s; industries, vocabulary, contribution-review, mcp-tools SEO branch, seed.
- BI-2: migration for `RentableUnit` / `RentalAgreement` / `RentalConditionRecord`; register every new string-enum column in the enum registry **same commit** (AGENTS.md §3).
- BI-3: `vehicle-equipment-rental.ts` leaves (`car-rental`, `equipment-tool-rental` first) + seed + `VOCABULARY` + `MARKETING_SKILL_RULES`.

**Phase 2 — lifecycle + surfaces**
- BI-4: reservation→return lifecycle service reusing `BookingHold`; availability = pool-count or serialized-unit-count; lifecycle signals (overdue, deposit-release-due, maintenance-due).
- BI-5: customer storefront **date-range reservation** flow (new `rental` CTA) + internal **rental daily board** (pickups/returns/overdue/maintenance/deposits).

**Phase 3 — activation polish + breadth**
- BI-6: customer-surface `CapabilityActivation` rows + `PrimaryAction`s ("Reserve", "Check out", "Mark returned"); Rental Desk coworker emphasis; `car-share-club` / `recreational-rental` / `peer-to-peer-host` leaves; membership-club module.

## Out of scope (separate epics — spec §15)

- Vehicle marketplace / auction (AuctionOS, two-sided host economics).
- Real payment-processor deposit holds (Stripe auth/capture) — v1 is billing-readiness only.
- Insurance underwriting / live insurer API — v1 records requirement + operator attestation.
- Telematics / app unlock (Getaround) — integration slot only.

## Verification (build gate, AGENTS.md §5) — to run per phase

1. **Unit tests** — `npx vitest run` for archetype catalog (`archetypes.test.ts`), vocabulary, contribution-review, and new lifecycle services.
2. **Production build** — `cd apps/web && npx next build` zero errors; this is the exhaustiveness gate for the new `CtaType`/`SectionType`/`ArchetypeCategory` union members.
3. **UX verification** — exercise a `car-rental` install: select archetype → reserve a class for a date range → checkout → return; confirm the internal daily board reflects state.
4. **Migration applies cleanly** — BI-2 migration on a fresh DB.

## Backlog

This plan + spec land as a `doc/` PR. The Epic (spec §16) and BI-1…BI-6 must be filed against the **canonical** backlog via the `dpf` MCP tools (`list_epics` overlap check first, then `create_backlog_item` / `link_backlog_item_to_epic`) — the dev DB used during investigation was empty and is not the canonical backlog. Promotion to Build Studio (`dpf-promote-to-build-studio`) follows triage of BI-1.
