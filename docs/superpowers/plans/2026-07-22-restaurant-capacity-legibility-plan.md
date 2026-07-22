# Restaurant Capacity Legibility — Implementation Plan

- **Spec:** `docs/superpowers/specs/2026-07-22-restaurant-capacity-legibility-design.md`
- **BI:** BI-7C95A586 (medium, bug) — EP-UX-COGLOAD
- **Date:** 2026-07-22

## Backlog coverage

This plan delivers the single medium bug BI-7C95A586 as one PR. The phases are **sequencing of one indivisible legibility fix** (a shared model that the surfaces then render), not independently shippable deliverables — the smoke-test acceptance requires the surfaces to reconcile against the same model in one change. No decomposition into new BIs. The coordinated BIs (BI-57F34A00, BI-287AA5F7, BI-075F731F, BI-36807E68, BI-0E4A1228, BI-A60D53AF, BI-C39DC90C, BI-348766E5, BI-2B2FCB2B) remain open and consume the seams this leaves (see spec Non-goals).

## Phases

### Phase 1 — Shared capacity model (foundation)
- `apps/web/lib/storefront/restaurant-capacity.ts`: types (`TableCapacityState`, `RestaurantTable`, `RestaurantCapacitySnapshot`, `ServicePeriodReadiness`), `classifyStorefrontResource()`, `deriveRestaurantCapacity()`, `resolveServicePeriod()`, `capacityStateIntent()`. Pure/DB-free; nouns from `deriveTwinProfile`.
- `restaurant-capacity.test.ts`: classification, per-table state folding, counts, readiness, next-action, service-period resolution.

### Phase 2 — Vocabulary (kill provider/rental jargon)
- `apps/web/lib/storefront/archetype-vocabulary.ts`: add `resourceLabel`/`resourceSingular`/`addResourceButtonLabel`/`staffLabel`; fill `food-hospitality`; default derivation for other categories.
- Update `/storefront/team` (`TeamManager.tsx`) to split Staff vs Tables via `classifyStorefrontResource`, replace "+ Add Provider".
- Archetype-guard `/storefront/units` rental copy.

### Phase 3 — Tables & Capacity owner surface
- `apps/web/app/(shell)/storefront/tables/page.tsx` + `TablesCapacityManager` component (report-kit StatCard/DataTable/StatusBadge). Archetype-gated tab in storefront nav (physical/FLOOR only).
- Readiness banner + single next action.

### Phase 4 — Workspace readiness reconciliation
- `apps/web/lib/twin/living-business-snapshot.ts`: FLOOR-gated capacity chips from the projection; fix reservations-queue fill; readiness quest.

### Phase 5 — Public booking states
- `apps/web/components/storefront/SlotBookingFlow.tsx`: explicit available/unavailable/loading/sold-out states in restaurant terms; remove per-provider copy for FLOOR.

### Phase 6 — Smoke tests + docs
- Cross-surface reconciliation + no-jargon + booking-state tests.
- Docs: user-guide storefront + `docs/architecture` note; PR trailers (Design-Grounding, UX-Fit, Docs-Impact, Process-Spine).

## Verification
- `pnpm --filter web exec vitest run` on affected files (Phases 1–6).
- `pnpm --filter web build` (source-local where possible; sandbox lease for runtime-bound).
- UX: exercise `/storefront/tables`, `/storefront/team`, `/workspace`, public booking against a leased env or canonical install.
