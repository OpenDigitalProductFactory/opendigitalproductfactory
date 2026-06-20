# Plan — End-to-End iOS App Support (Dual-Persona, Install-Driven)

**Date:** 2026-06-18
**Status:** In-flight — slices merging in sequence
**Owner:** mobile platform
**Parent spec:** [`docs/superpowers/specs/2026-06-14-native-mobile-archetype-apps-design.html`](../specs/2026-06-14-native-mobile-archetype-apps-design.html)
**Related specs:** [Town super-app](../specs/2026-06-14-multi-business-town-super-app-design.html), [Field dispatch contract](../specs/2026-06-14-field-dispatch-mobile-contract-and-warranty-design.html)

## Goal

Close the remaining code gaps between today's mobile substrate and a real, shippable, install-driven iOS app serving both **field-tech (employee)** and **customer** personas — the HVAC scenario the founder named (tech captures work → drafts invoice → collects payment) AND the customer-facing flip side (view invoices, see visits, pay).

Owner-only steps (Apple Developer enrollment, Google Play, Expo/EAS account, Firebase + APNs key, physical iPhone, store metadata) are explicitly out of scope for this plan — they cannot be performed by an agent regardless of authorization and are tracked in the parent spec §9.

## Slices

### Slice 1 — `WorkItem` → `CustomerAccount` link end-to-end

Removes the largest piece of friction in the field-tech flow: server resolves the account from the `WorkItem.sourceType` + `sourceId` link (Engagement / Opportunity / StorefrontBooking / Activity); mobile pre-fills it as read-only.

**Status:** PR #2162.

### Slice 2 — Customer "My visits" surface

Customer-side parallel to the employee's My Jobs — customers see upcoming + recent appointments on Home alongside My invoices. `GET /api/v1/customer/visits` scoped two-hop, closed `CustomerVisitStatus` union, persona-gated render.

**Status:** PR #2168.

### Slice 3 — Job-completion evidence (photos)

Tech captures one-to-many photos of completed work before billing. Stored on `WorkItem.evidence` JSON (additive — no schema migration). Capture primitive is pluggable so today's stub swaps for `expo-image-picker` / `expo-camera` in a follow-up.

**Status:** PR #2181.

### Slice 4 — Multi-space switcher UX (Town M2)

`spaces.store` substrate already exists from prior PRs. This slice adds the *UI*: a `SpaceSwitcher` component (compact + full variants), a `/connect` screen that takes a URL → fetches the `.well-known/dpf-instance.json` descriptor → registers the space → routes to login, and a More-tab placement that surfaces the current business and lets the user add another. Long-press on a row removes that space. Foundation for the founder's "3 businesses in one app" vision.

**Status:** This slice — in flight.

### Slice 5 — EAS pipeline + path-filtered mobile CI lane

`eas.json` today is a skeleton. Fill in `internal`/`production` profiles for iOS + Android, add a `.github/workflows/mobile-ci.yml` workflow that runs typecheck + jest on `apps/mobile/**` and shared package paths, and document the operator-only EAS first-run (Apple Developer, App Store Connect API key, FCM/APNs) as a checklist of owner-actions.

Native binary builds run under EAS cloud — `node:24-alpine` Build Studio cannot build iOS (macOS + Xcode only).

### Slice 6 — Geo-discovery "Nearby" stub (Town M4)

Lightweight: `useGeolocation` hook (already-installed `expo-location`), a `Nearby` panel that pings `GET /api/v1/directory/nearby?lat&lng` and lists install descriptors, and a server stub returning the *local* install when geo matches its address. Hosted federation directory (Town M5) intentionally not part of this slice.

## Reuse map

| Existing substrate | What we lean on |
|---|---|
| `WorkItem` model + `/api/v1/work-items` | Slices 1, 3 — append `account` projection + evidence endpoint, no schema migration |
| `StorefrontBooking` + `CustomerContact` | Slice 2 — two-hop scope to a signed-in customer |
| `BrandingConfig.tokens` + install manifest | Already shipped, unchanged |
| `POST /api/v1/upload` (MediaAsset) | Slice 3 — photos upload through it |
| `spaces.store` (from earlier PRs) | Slice 4 — UI shell over existing state |
| `expo-location` (already installed) | Slice 6 — geolocation hook |
| `eas.json` skeleton | Slice 5 — fill in profiles |

## Verification per slice

Each slice carries its own PR with the AGENTS §5 build-gate evidence:

- `pnpm --filter web typecheck` + targeted vitest for any new server route.
- `pnpm --filter mobile typecheck` + targeted jest for any new mobile store / projection.
- UX evidence (driving the live install) is deferred until the EAS pipeline (Slice 5) lands and produces an internal TestFlight build a real iPhone can install — the operator-only step.

## What this plan does NOT do

- Stand up Apple Developer / Google Play / Expo / Firebase accounts (owner-only).
- Generate APNs / FCM credentials (owner-only).
- Submit to TestFlight or Play Internal (owner-only).
- Touch the Town M5 hosted directory (separate epic).
- Add voice-note or signature capture primitives (each its own follow-up slice).
