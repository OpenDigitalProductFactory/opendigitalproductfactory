# Plan — Walk-Up Front Door, First Cut (anonymous Nearby → Menu)

**Date:** 2026-08-05
**BI:** BI-9FEB61B8 (child slice) · **Epic:** EP-MOBILE-IOS-APP
**Spec:** [`docs/superpowers/specs/2026-08-05-viral-walkup-consumer-front-door-design.md`](../specs/2026-08-05-viral-walkup-consumer-front-door-design.md)

## Scope (deliberately minimal)

One capability: a customer with **no account** opens the app, sees the businesses **near them** by geo, taps one, and browses its **menu** — all anonymous, read-only. Nothing that requires the spec's four open decisions (anonymous identity, payments, geofence-trust, guest checkout). Ordering/cart/payment/table-binding are explicitly phase 2.

Why safe to build now: read-only browse over the **already-public** storefront surface (`classifyRoute` treats `/api/storefront/*` as `PublicApi`) means no auth, no new identity model, no payment path.

## Build order (3 commits, this PR)

1. **`GET /api/storefront/nearby?lat&lng`** — public. Reads the single local Organization + its published `StorefrontConfig` via the canonical `getPublicStorefront`, extracts coordinates from `Organization.address` JSON (no schema migration in the first cut), computes straight-line distance, returns `NearbyBusiness[]`. When the business published no coordinates, it is still surfaced with `distanceMeters: null` so the flow is demonstrable on any install. Pure geo helper (`lib/storefront/geo.ts`) + unit tests + route test.
2. **Mobile visitor surface** — a `visitor` persona (anonymous default when unauthenticated), a `useNearby` geo hook (`expo-location`, already installed), a `nearby` feature store + api-client method, and the "Right here" screen listing nearby businesses. Jest-tested store + projection.
3. **`GET /api/storefront/[slug]/menu`** + mobile menu — public menu projection (items grouped by `category`) over `getPublicStorefront`; menu feature store + api-client method + anonymous menu screen reached from the Nearby list.

## Reuse (no new substrate)

- `getPublicStorefront(slug)` (`lib/release/storefront-data.ts`) — canonical public read; source of truth for both endpoints.
- `Organization.address` (JSON) — coordinate source; `Organization.slug` — public id.
- `StorefrontItem.category` — the menu grouping.
- `expo-location` — geo hook.
- Public route classification — endpoints mounted under `/api/storefront/` inherit `PublicApi`, so no proxy/`classifyRoute` change.

## Explicitly out of scope (phase 2, gated on spec §5 decisions)

Cart, ordering, payment, guest identity, order-to-table binding, and the hosted multi-install federation directory (Town M5). The first-cut `nearby` endpoint answers from the **local install only**; the hosted geo directory is the follow-on.

## Verification

- `pnpm --filter web exec vitest run` for the geo helper + both routes (the runtime-bound, CI-verifiable core).
- `pnpm --filter mobile typecheck` + `jest` for stores/projections.
- Mobile screen UX (the "Right here" + menu render) verified on the iOS Simulator once merged — noted as follow-on, not claimed here.
