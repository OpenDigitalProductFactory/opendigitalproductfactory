# Plan — End-to-End iOS App Support (Dual-Persona, Install-Driven)

**Date:** 2026-06-18
**Status:** In-flight — slices merging in sequence
**Owner:** mobile platform
**Parent spec:** [`docs/superpowers/specs/2026-06-14-native-mobile-archetype-apps-design.html`](../specs/2026-06-14-native-mobile-archetype-apps-design.html)
**Related specs:** [Town super-app](../specs/2026-06-14-multi-business-town-super-app-design.html), [Field dispatch contract](../specs/2026-06-14-field-dispatch-mobile-contract-and-warranty-design.html)

## Goal

Close the remaining code gaps between today's mobile substrate and a real, shippable, install-driven iOS app serving both **field-tech (employee)** and **customer** personas.

Owner-only steps (Apple Developer enrollment, Google Play, Expo/EAS account, Firebase + APNs key, physical iPhone, store metadata) are explicitly out of scope for this plan — they cannot be performed by an agent regardless of authorization. They live in the parent spec §9 and Slice 5's operator checklist.

## Slices

### Slice 1 — `WorkItem` → `CustomerAccount` link

Server resolves account from `WorkItem.sourceType` + `sourceId`. Mobile pre-fills the invoice screen's accountId as read-only. **PR #2162.**

### Slice 2 — Customer "My visits" surface

`GET /api/v1/customer/visits` scoped two-hop. Customers see upcoming + recent appointments on Home. **PR #2168.**

### Slice 3 — Job-completion evidence (photos)

`POST /api/v1/work-items/:itemId/evidence` appends to `WorkItem.evidence` JSON. Capture primitive is pluggable. **PR #2181.**

### Slice 4 — Multi-space switcher UX (Town M2)

`SpaceSwitcher` + `/connect` flow + More-tab placement. **PR #2182.**

### Slice 5 — EAS pipeline + mobile CI lane

`eas.json` filled out (4 profiles, submit config); `.github/workflows/mobile-ci.yml` path-filtered. **PR #2183.**

### Slice 6 — Geo-discovery "Nearby" stub (Town M4)

**Status:** This slice — in flight.

Customer-facing geo discovery for the "3 businesses in one app" community vision. Three artifacts:

1. **`GET /api/v1/directory/nearby?lat=…&lng=…&radiusKm=…`** — public (unauthenticated) endpoint. Returns the install IF its own `Organization.address` lat/long falls inside the query radius AND `PUBLIC_URL` is configured (so the row points at a reachable target). Same wire shape (`NearbyResponse` → `NearbyInstance[]`) the future hosted federation directory (Town M5) will return.
2. **`apps/mobile/src/hooks/useGeolocation.ts`** — thin `expo-location` wrapper that requests foreground permission once and exposes `{ latitude, longitude, permission, isFetching, error, refresh }`.
3. **`apps/mobile/src/features/nearby/NearbyPanel.tsx`** — customer-mode home panel. On location, fires `api.directory.nearby({lat, lng})`, lists each row with distance; tapping a row pulls the descriptor and connects via the existing `spaces.addSpace` flow before handing off to `/login`.

Single-install path (no federation) validates the contract. Town M5 — hosted directory aggregating many installs — is intentionally a separate epic.

## Reuse map

| Existing substrate | What we lean on |
|---|---|
| `WorkItem` model + `/api/v1/work-items` | Slices 1, 3 — append `account` projection + evidence endpoint, no schema migration |
| `StorefrontBooking` + `CustomerContact` | Slice 2 — two-hop scope |
| `BrandingConfig.tokens` + install manifest | Already shipped, unchanged |
| `POST /api/v1/upload` (MediaAsset) | Slice 3 — photos upload through it |
| `spaces.store` | Slice 4 — UI shell over existing state |
| `expo-location` (installed) | Slice 6 — geolocation hook |
| `Organization.address` JSON | Slice 6 — install's own lat/long for the stub |
| `eas.json` skeleton | Slice 5 — fill in profiles + CI lane |

## Operator-action checklist (Slice 5 cannot finish without these)

These cannot be done by an agent — they require legal identity + accounts:

| Action | Why an agent can't | Cost |
|---|---|---|
| Enroll **Apple Developer Program** as **Arcamanus LLC** | legal entity, D-U-N-S, 2FA Apple ID, signed agreements | $99/yr |
| Create **Google Play Console** account | identity verification, signed agreements | $25 one-time |
| Create **Expo / EAS** account + org | account auth for cloud builds | free to start |
| Generate **App Store Connect API key** (`.p8`) | Apple account credential | — |
| Create **Firebase** project + **APNs Auth Key** | Google/Apple account-bound credentials | free |
| Reserve **bundle id** on both stores | Apple/Google identity | — |
| Provide physical iPhone + Android device | hardware for push / biometric / deep-link / store QA | — |
| TestFlight + Play internal **tester enrollment** | accept builds via your accounts | — |
| **Privacy policy URL** + data-safety / nutrition labels | legal + marketing decisions + hosted page | — |

## Verification per slice

Each slice carries AGENTS §5 build-gate evidence:

- `pnpm --filter web typecheck` + targeted vitest for any new server route.
- `pnpm --filter mobile typecheck` + targeted jest for any new mobile store / projection.
- Native binary UX evidence is deferred until the operator-action checklist lands.

## What this plan does NOT do

- Stand up Apple Developer / Google Play / Expo / Firebase accounts.
- Generate APNs / FCM credentials.
- Submit to TestFlight or Play Internal.
- Touch the Town M5 hosted federation directory (separate epic).
- Add voice-note or signature capture primitives (follow-up slices).
