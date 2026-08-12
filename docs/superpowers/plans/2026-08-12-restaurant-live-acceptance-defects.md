# Restaurant live-acceptance defect batch

**Backlog coverage:** BI-6DDD4B16, BI-661BBC66, BI-421D494A

**Work capsule:** WC-DB96EC6E

**Date:** 2026-08-12

## Outcome

Repair the confirmed defects from a canonical-runtime Restaurant business rehearsal as one bounded acceptance batch: table-backed reservations must use authored Restaurant capacity and hours, the host stand must create its first service-turn event, and an order row must describe the next action for its current status.

The batch is complete only after exact-tree pregate, a ready PR, protected merge, normal self-upgrade, and a fresh CAN-TEST rehearsal of the affected Restaurant paths.

## Design grounding

- **Existing specifications and plans reviewed:** `2026-07-30-food-hospitality-resource-capacity-design.md`, `2026-07-31-restaurant-business-grade-floor.md`, `2026-07-22-restaurant-booking-handoff.md`, and the customer submit-result contract.
- **Current substrate reviewed:** `HospitalityResource`, its availability and allocation repositories, the Restaurant demo-floor repair precedent, `StorefrontBooking`/`BookingHold`, `BusinessProfile`, `ProviderAvailability`, the service-turn repository, and the shared order lifecycle vocabulary.
- **Source of truth:** authored table resources own Restaurant seating capacity; confirmed business hours are projected to provider and table-resource availability; service-turn events inherit organization identity from their parent relation; order status owns the next-action copy.
- **Decision:** repair and connect those existing authorities. Do not add a Restaurant-only booking store, another schedule model, a parallel lifecycle, or category-wide behavior that would affect non-Restaurant food businesses.

Operational-Precedent: restaurant-floor

## Implementation boundary

1. Project the canonical Restaurant template's 11:00-22:00 schedule when owner hours are unconfirmed, and mirror saved hours to every active provider plus linked hospitality resources.
2. Repair only the platform-owned demo Restaurant providers/resources so booking services and availability reach the authored tables; remove the generic-provider bypass for that exact demo storefront.
3. Fail closed at hold and final booking submission when the exact Restaurant archetype has no table resource, and translate capacity conflicts into customer-safe guidance.
4. Remove the invalid organization field from the first nested service-turn event.
5. Recompute the order inbox's next action from its optimistic current status and converge touched status styles on DPF theme tokens.

## Deliberate exclusions

- The separately owned booking timezone defect remains under BI-EFF5F220 until its exact live root cause is proven.
- The food-safety compliance vertical remains under BI-15AA7A4D.
- Broader Restaurant content/reset quality remains part of the existing Restaurant keystone and is not widened into this defect batch.

## Verification contract

- Focused unit and component tests for hold/booking capacity, operating-hour projection, service-turn creation, order lifecycle copy, and the corrective migration.
- Migration safety, timestamp collision, data-impact, prose, style-drift, production build, semantic review, and exact-tree pregate.
- Post-merge canonical-runtime checks: table-backed public reservation, oversized-party refusal without partial booking, host seating, full order lifecycle, operating-hours consistency, and confirmation/inbox reconciliation.
