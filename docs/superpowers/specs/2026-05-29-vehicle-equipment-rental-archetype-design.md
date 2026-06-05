# Vehicle & Equipment Rental Archetype Design

- **Status:** Draft for review
- **Author:** Claude (investigation requested by maintainer)
- **Date:** 2026-05-29
- **Related specs:** `2026-04-23-it-service-provider-msp-archetype-design.md` (new-archetype precedent), `2026-05-22-customer-surface-archetype-activation-design.md` (capability activation), `2026-04-04-custom-archetype-creation-and-refinement-design.md` (archetype creation flow), `2026-05-19-field-service-trades-ai-dispatch-design.md` (owned-fleet contrast)

---

## 1. Problem Statement

DPF's market-archetype catalog covers 12 categories and ~45 leaf templates, all of which model **services sold** (booking an appointment, requesting a quote) or **goods sold** (a one-way purchase). None of them model the **time-bounded loan of a stocked, returnable asset** — the defining shape of the rental economy: car rental, car-share/membership clubs, equipment and tool hire, RV/boat/trailer rental, and peer-to-peer host operations.

The investigation anchor is **PocketOS** (pocketos.ai), a vertical "operating system for automotive businesses" that packages this shape as composable modules — RentalOS (fleet + reservations), ClubOS (membership), AuctionOS (vehicle marketplace) — plus renter verification, insurance validation, deposit holds, digital agreements, and check-out/check-in with condition logging. It is the clearest single reference for what a rental archetype must support, and it serves exactly DPF's target operator size (SMB through mid-market).

A rental archetype is **not** another `itemTemplates` list. Its core entities differ from every existing archetype:

- The thing transacted is a **stocked unit** (an individual vehicle/asset) with live state — `available`, `reserved`, `out`, `returned`, `maintenance` — not a stateless catalog row.
- The transaction is a **rental agreement** with a checkout→return lifecycle, a security **deposit hold**, a **condition record** on out and return, and frequently **renter identity/insurance verification** before keys change hands.
- Pricing is **duration- or usage-based** (per-day, per-week, per-mile/hour, plus deposits and damage charges), not a single list price.

This spec proposes a new `vehicle-equipment-rental` category, its leaf archetypes, and — critically — the domain model needed to support stocked rentable units and rental agreements, reusing DPF's existing storefront/booking substrate wherever it already fits.

## 2. Live Backlog Context

The `dpf` MCP connector was **not connected** in the investigating session, so per the DPF DB-fallback rule the live Postgres backlog was queried directly. The reachable install is a **fresh dev instance with 0 epics and 0 backlog items** — i.e. not the canonical maintainer backlog. A keyword sweep of the repo (specs, code, kernel) found **no existing rental / fleet / vehicle archetype work**. The nearest existing rows by concept:

- `hoa-property-management → property-management-company` carries `rental`/`lease` tags, but models **long-term real-estate leasing**, not short-term returnable-asset hire.
- `trades-maintenance` + the field-service dispatch spec model **owner-operated fleet for dispatch** (vehicles as crew transport), not rentable inventory.

**Action for the canonical backlog:** before promotion, re-run the overlap check against the maintainer's populated backlog via the `dpf` MCP `list_epics` / `list_backlog_items` tools. This spec assumes no overlap; that assumption must be confirmed against live state, not this empty dev DB.

## 3. Research & Benchmarking

Per the DPF Design Research rule, the design reads the data models of leaders in the rental space — not just feature lists.

### 3.1 PocketOS (pocketos.ai) — the investigation anchor

Vertical business-OS for automotive rental. Module decomposition: **RentalOS** (fleet + reservation management), **ClubOS** (membership/subscription programs), **AuctionOS** (vehicle marketplace), plus white-label booking sites and Turo calendar sync. Workflow spine: booking → **renter verification (KYC + background)** → **insurance validation** → payment with **deposit hold / refund** → **digital agreement e-sign** → **check-out / check-in with condition capture** → real-time fleet availability throughout.

- **Adopted:** the reservation → verify → deposit → agreement → checkout → return → condition spine as the canonical rental lifecycle; per-unit fleet state; deposit holds as a first-class money state distinct from payment.
- **Adopted (module framing):** PocketOS's module split maps cleanly to DPF's existing `ActivationProfile.modules` mechanism — rental, membership, and marketplace become activation toggles, not separate products.
- **Rejected:** the marketplace/auction module (AuctionOS) as in-scope for v1 — DPF should ship the rental core first; marketplace is a separate epic (see §16).

> **Governance note (not a vertical requirement, but a proof-point worth recording):** PocketOS is the company whose production database an AI coding agent (Cursor) wiped in ~9 seconds in April 2026. That incident is a direct external validation of DPF's Build Studio quiescence guards, scope-gated MCP write tokens, and the `never-wipe-db-for-code-fixes` commandment. It belongs in DPF's governance narrative, not in this archetype's runtime requirements.

### 3.2 Turo (peer-to-peer car share)

Marketplace model: hosts list individual vehicles with per-day pricing, trip-based booking with defined start/end, host-set delivery, protection plans, and a trip lifecycle (booked → checked-in with photos → active → checked-out with photos). Data model centers on the **individual vehicle (VIN-level)** and the **trip** as the agreement.

- **Adopted:** per-unit (VIN-level) identity; the **trip = agreement** with start/end timestamps and bilateral condition photos.
- **Rejected:** host-marketplace two-sided economics for v1; DPF's first operator is a single rental business, not a marketplace platform.

### 3.3 Getaround / car-share clubs

Membership + unlock model: members hold a subscription, reserve by time block, unlock via app, usage-metered (hours + miles). Reinforces the **membership/club** module and **usage-based pricing** (the `usage-based` commercial model and a metered charge model).

- **Adopted:** membership as an activation module; usage-based metering as a supported (not required) pricing pattern.

### 3.4 Booqable / EZRentOut (equipment & tool rental)

General rental-management leaders. Two patterns of note: (a) **quantity-pool stock** — for fungible equipment (e.g. "12 scaffold towers") operators track a *count* available per period, not individual serial numbers; (b) **serialized assets** — for high-value items, individual unit tracking with maintenance history. Both support **availability calendars**, **deposits**, and **rental periods spanning days/weeks**.

- **Adopted:** support **both** a serialized (per-unit) mode and a quantity-pool mode — this is the central design decision in §6.
- **Adopted:** multi-day/multi-week period as a native rental duration, not minute-granular slots.

### 3.5 Patterns rejected across all references

- A bespoke per-archetype calendar/availability engine — DPF already has `BookingHold` + provider availability; rental reuses it rather than forking it.
- Treating the rentable asset as the IT `InventoryEntity` — that model is a discovery/CMDB graph (manufacturer, support status, discovery-run attribution, customer-estate scope) and is semantically wrong for org-owned rentable fleet. Reuse here would corrupt both domains.

## 4. Design Goals

1. Add `vehicle-equipment-rental` as a first-class archetype **category** with leaf templates, vocabulary, and storefront/portal shapes, following the same wiring contract as every existing category.
2. Introduce the **minimum** new domain model for stocked rentable units and rental agreements, **reusing** `StorefrontItem` (rate-card class), `BookingHold` (reservation concurrency), `ServiceProvider`/availability (location/pickup desk), and the `ActivationProfile` module mechanism.
3. Support **both** serialized per-unit fleets (car rental) and quantity-pool stock (equipment hire) under one model.
4. Model **deposit holds**, **renter verification readiness**, and **condition capture** as first-class lifecycle states — "prepared, not prescribed," matching DPF's existing billing-readiness posture.
5. Keep marketplace/auction and two-sided host economics **out of scope** for v1, behind a separate epic.

## 5. Non-Goals

- Real payment-processor deposit-hold integration (Stripe auth/capture) — v1 is **billing-readiness** (records the obligation; does not move money autonomously).
- Insurance underwriting or live insurer API verification — v1 records the **verification requirement and operator attestation**, not an automated insurer check.
- Telematics / IoT unlock (Getaround-style) — out of scope.
- Vehicle marketplace / auction (PocketOS AuctionOS) — separate epic (§16).
- Long-term real-estate leasing — already served by `hoa-property-management`.

## 6. Core Design Decision — how rentable assets are modeled

This is the decision that should run through `dpf-decision-via-kernel`. Three options were weighed; the recommendation reuses the booking substrate and adds the smallest stateful asset layer.

**Option A — Extend `StorefrontItem` + `StorefrontBooking` only (no new asset model).**
Add rental fields (`rentalPeriodUnit`, `depositAmount`, `stockQuantity`) to the item's `bookingConfig`; reuse `StorefrontBooking` as the rental period. Fleet is a *quantity* per item class — no individual unit identity.
- *Pros:* smallest change; no migration beyond JSON config; ships fastest.
- *Cons:* cannot represent per-unit state, mileage, condition history, or unit-level maintenance — fatal for car rental and high-value equipment. Overloads `StorefrontBooking.durationMinutes` for multi-day periods.

**Option B — First-class `RentableUnit` + `RentalAgreement`, reusing holds/availability.**
`StorefrontItem` stays the **rate-card class** (e.g. "Compact SUV", "Scaffold Tower"). A new `RentableUnit` represents an individual stocked asset (optional — a class can be quantity-pool with `stockQuantity` and zero units). A new `RentalAgreement` carries the checkout→return lifecycle, deposit, condition records, and verification status. `BookingHold` is reused for reservation concurrency; `ServiceProvider` repurposed as pickup location/desk.
- *Pros:* supports both serialized and quantity-pool modes; clean lifecycle; reuses concurrency + availability substrate; aligns with Turo/Booqable data models.
- *Cons:* two new models + migration; more surface to build.

**Option C — Reuse IT `InventoryEntity` as the rentable unit.**
- *Rejected outright* (§3.5): wrong domain (discovery/CMDB), wrong scope semantics.

**Recommendation: Option B.** It is the only option that satisfies the car-rental and high-value-equipment cases, and it reuses the maximum amount of existing substrate (holds, availability, item rate-card, activation modules). Quantity-pool equipment is supported by a class with `stockQuantity > 0` and no `RentableUnit` rows; serialized fleets attach `RentableUnit` rows. The decision and its kernel-scored rationale should be recorded via `dpf-record-decision-outcome` before implementation begins.

## 7. Capability Modules Activated By The Rental Archetype

Reuses the existing `ActivationProfile.modules` mechanism (PocketOS's module split maps onto it):

- **`rental-fleet`** *(new module)* — rentable-unit registry, per-unit/quantity-pool stock, availability, maintenance hold.
- **`rental-agreements`** — the checkout→return lifecycle, deposit holds, condition records (reuses the `service-agreements` family).
- **`membership-club`** *(activation-gated)* — recurring membership for car-share/club leaves (reuses subscription commercial model).
- **`billing-readiness`** — duration/usage pricing, deposit obligations, damage charges (prepared-not-prescribed).
- **`lifecycle-signals`** — overdue returns, deposit-release due, maintenance-due, license/insurance-expiry signals on the daily board.
- **`integrations`** — calendar sync (Turo-style) and payment/e-sign slots, declared but not built in v1.

## 8. Core Domain Model

### 8.1 Schema audit (Data Model Stewardship)

Reused as-is:
- `StorefrontArchetype` / `StorefrontConfig` — archetype catalog + per-org config (JSON `activationProfile`, `customVocabulary`, `marketingSkillRules`). No change.
- `StorefrontItem` — becomes the **rentable class / rate-card** (e.g. a vehicle category). Rental rate metadata lives in its existing `bookingConfig` JSON; no column change required for v1.
- `BookingHold` — reused for reservation holds on a unit/class for a date range (`slotStart`/`slotEnd`/`expiresAt` already fit a multi-day window).
- `ServiceProvider` / `ProviderAvailability` — repurposed as **pickup location / rental desk** and its operating hours.

New models (Option B):
- **`RentableUnit`** — `id`, `storefrontItemId` (the class), `unitRef` (plate/VIN/serial), `label`, `status` (`available|reserved|out|returned|maintenance|retired`), `meterReading` (mileage/hours, nullable), `attributes` (Json), `acquiredAt`, timestamps. Indexed on `(storefrontItemId, status)`.
- **`RentalAgreement`** — `id`, `agreementRef`, `storefrontId`, `storefrontItemId`, `rentableUnitId` (nullable for quantity-pool), `customerContactId`/contact fields, `periodStart`, `periodEnd`, `pricingModel` (`per-day|per-week|usage-based|fixed`), `rateAmount`, `depositAmount`, `status` (`reserved|verified|active|returned|closed|cancelled`), `verificationStatus` (`not-required|pending|verified|failed`), `checkoutConditionId`/`returnConditionId`, `idempotencyKey`, timestamps.
- **`RentalConditionRecord`** — `id`, `agreementId`, `phase` (`checkout|return`), `meterReading`, `notes`, `mediaRefs` (Json), `recordedAt`, `recordedById`. Bilateral condition capture (Turo pattern).

`StorefrontBooking` is **not** reused for the rental period — its `durationMinutes` + appointment semantics are a poor fit for multi-day, unit-bound agreements with deposits. `RentalAgreement` is the rental analog of `StorefrontBooking`; both hang off `StorefrontConfig`.

### 8.2 Strongly-typed enums

New string-enum columns (`RentableUnit.status`, `RentalAgreement.status`, `RentalAgreement.verificationStatus`, `RentalConditionRecord.phase`, `RentalAgreement.pricingModel`) must be added to the canonical enum registry (`apps/web/lib/backlog.ts` conventions for unions + the MCP tool `enum:` arrays) in the **same commit** that introduces them, per AGENTS.md §3. Hyphens, not underscores.

### 8.3 Key relationship rules

- A `RentableUnit` belongs to exactly one `StorefrontItem` (class). A class may have zero units (quantity-pool) or many (serialized).
- A `RentalAgreement` references a class always, and a unit only when serialized. Availability for a class = `stockQuantity − overlapping active agreements` (pool) or count of `available` units (serialized).
- A `BookingHold` against a class/unit + date range blocks double-booking during checkout, exactly as it does for appointments today.

## 9. Reservation → Return Lifecycle

1. **Reserve.** Customer selects a class + date range on the storefront. A `BookingHold` is taken (existing concurrency machinery). `RentalAgreement` created `status=reserved`.
2. **Verify.** If the leaf requires it (`provisioning: account-with-kyc`), `verificationStatus` moves `pending → verified` via operator attestation (v1) — license + insurance recorded, not auto-checked. Agreement → `verified`.
3. **Checkout.** Operator confirms; deposit obligation recorded (billing-readiness); `RentalConditionRecord(phase=checkout)` captured; unit `status=out`; agreement `status=active`.
4. **Return.** `RentalConditionRecord(phase=return)` captured; meter delta + damage assessed; unit `status=returned → available` (or `maintenance`); deposit-release/damage-charge obligation prepared; agreement `status=returned → closed`.
5. **Signals.** Overdue return, deposit-release-due, and maintenance-due surface on the internal daily board via `lifecycle-signals`.

## 10. Portal & Archetype Load Behavior

- **Customer portal shape:** hero → fleet/catalog (browse classes, see availability) → how-it-works → reserve CTA → contact. New CTA type `rental` (§13) drives a date-range reservation flow rather than a single-slot booking.
- **Internal workspace shape:** the rental daily board — today's pickups, today's returns, overdue, units in maintenance, deposits to release. This is the "first board the operator sees," per the archetype doctrine.
- **Vocabulary:** fleet, unit, reservation, rental period, pickup/return, deposit, member (club), renter. Defined in the `VOCABULARY` map (§13).
- **Coworker emphasis:** a "Rental Desk" / "Fleet Coordinator" coworker prominent on the board (reservations, returns, overdue follow-up), consistent with the named-by-work coworker doctrine.

## 11. Leaf Archetypes (v1)

Under category `vehicle-equipment-rental`:

| `archetypeId` | Name | Mode | Notable activation |
| --- | --- | --- | --- |
| `car-rental` | Car Rental | serialized | KYC + insurance verification required; deposit |
| `car-share-club` | Car-Share / Membership Club | serialized | membership-club module; usage-based pricing |
| `equipment-tool-rental` | Equipment & Tool Rental | quantity-pool + serialized | deposit; per-day/week |
| `recreational-rental` | RV / Boat / Trailer Rental | serialized | KYC + insurance; deposit; per-day |
| `peer-to-peer-host` | P2P Vehicle Host | serialized | single-host subset of marketplace; deferred features flagged |

Each leaf supplies `itemTemplates` (example classes), `sectionTemplates`, `formSchema` (renter details: license, dates, optional insurance), `tags`, and an `activationProfile` selecting the modules above.

## 12. Boundary Between Base Archetype And Operator Overlay

Following the MSP precedent: the **base archetype** seeds the modules, vocabulary, leaf templates, and default fleet classes. The **operator overlay** is their actual fleet (`RentableUnit` rows), real rate cards, deposit amounts, and verification policy — created at setup via the wizard/coworker, never seeded as fake inventory.

## 13. Wiring Touch List (closed-enum + catalog changes)

Adding the category is a coordinated change across these points (verified against current `main`):

1. `packages/storefront-templates/src/types.ts` — add `"vehicle-equipment-rental"` to `ArchetypeCategory`; add `"rental"` to `CtaType`; consider a `"fleet"` `SectionType`; extend `ActivationModule` with `rental-fleet` / `rental-agreements` / `membership-club`.
2. `packages/storefront-templates/src/archetypes/vehicle-equipment-rental.ts` *(new)* + register in `index.ts`.
3. `apps/web/lib/storefront/industries.ts` — `INDUSTRY_OPTIONS`.
4. `apps/web/lib/storefront/archetype-vocabulary.ts` — `VOCABULARY` entry (fleet/renter/return/deposit vocab).
5. `apps/web/lib/integrate/contribution-review.ts` — `VERTICAL_CATEGORIES` (+ keywords: rental, fleet, vehicle, hire, car-share) and `CTA_VERTICAL_MAP` (`rental` → the new category).
6. `apps/web/lib/mcp-tools.ts` — SEO-intent archetype branch (`rental … near me`) and any `ctaType` switch handling.
7. `packages/db/src/seed-storefront-archetypes.ts` — seed rows + `MARKETING_SKILL_RULES` for the category.
8. `packages/db/prisma/migrations/` — new `RentableUnit`, `RentalAgreement`, `RentalConditionRecord` models + backfill (none needed; net-new).
9. Enum registry (`apps/web/lib/backlog.ts` + MCP `enum:` arrays) for every new string-enum column, same commit.
10. Customer-surface activation registry (per `2026-05-22-customer-surface-archetype-activation-design.md`) — `CapabilityActivation` rows + `PrimaryAction`s (e.g. "Reserve", "Check out", "Mark returned") for the new modules.

Any new `ctaType` or `SectionType` value must be handled everywhere those unions are switched on — a build-time exhaustiveness sweep (`next build`) is the gate.

## 14. Data Model Stewardship Implications

- The rentable-asset concept is genuinely new; no existing model is the right home (the `InventoryEntity` reuse is explicitly rejected). This satisfies the "verify substrate before proposing new" discipline — the new models are justified by an audit, not a reflex.
- `RentalAgreement` is a sibling of `StorefrontBooking`/`StorefrontOrder` under `StorefrontConfig`, keeping the storefront transaction family coherent.
- Renter identity should resolve to a `CustomerContact`/`Principal` per the principal-convergence rule (post-2026-05-09 identity-bearing entities are `PrincipalAlias`es) — a `RentalAgreement` references a principal-backed contact, it does not introduce a parallel "renter" identity table.

## 15. Related But Separate Epics

- **Vehicle marketplace / auction** (PocketOS AuctionOS, Turo two-sided host economics) — separate epic; v1 ships single-operator rental only.
- **Real payment deposit holds** (Stripe auth/capture) — extends `billing-readiness` once the deposit obligation model lands.
- **Telematics / app unlock** (Getaround) — separate epic; integration slot only in v1.

## 16. Recommended Epic

**Epic: Vehicle & Equipment Rental Archetype** (`type: portfolio`).

Backlog items (sized; to be filed via `dpf-file-backlog-item` against the canonical backlog):

1. **BI-1** — Category + enum wiring (`vehicle-equipment-rental`, `rental` CTA, modules) across the §13 touch list. *(M)*
2. **BI-2** — Domain model migration: `RentableUnit`, `RentalAgreement`, `RentalConditionRecord` + enum registry. *(L)*
3. **BI-3** — Leaf archetype templates + seed + vocabulary + marketing rules. *(M)*
4. **BI-4** — Reservation/hold reuse + reservation→return lifecycle service + lifecycle signals. *(L)*
5. **BI-5** — Customer storefront rental flow (date-range reserve) + internal rental daily board. *(L)*
6. **BI-6** — Capability activation rows + primary actions + Rental Desk coworker emphasis. *(M)*

## 17. Rollout Recommendation

- **Phase 1 (BI-1, BI-2, BI-3):** category wiring + domain model + `car-rental` and `equipment-tool-rental` leaves seeded. Behind no flag — additive catalog rows are inert until an install selects the archetype.
- **Phase 2 (BI-4, BI-5):** reservation→return lifecycle + customer flow + internal board. UX verification against a running portal with a `car-rental` install (per the mandatory build gate).
- **Phase 3 (BI-6 + remaining leaves):** capability activation polish, membership-club leaf, Rental Desk coworker, marketing rules.

## 18. Final Recommendation

Proceed with **Option B**: a new `vehicle-equipment-rental` category plus a minimal stateful asset layer (`RentableUnit` / `RentalAgreement` / `RentalConditionRecord`) that reuses the existing storefront, booking-hold, and activation-module substrate. Ship the rental core first; defer marketplace, real deposit capture, and telematics to the separate epics in §15. The central asset-modeling decision (§6) and the renter-identity-via-principal rule (§14) should be confirmed through `dpf-decision-via-kernel` and recorded before BI-2 implementation begins.
