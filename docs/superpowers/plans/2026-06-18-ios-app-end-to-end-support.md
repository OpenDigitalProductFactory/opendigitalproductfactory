# Plan — End-to-End iOS App Support (Dual-Persona, Install-Driven)

**Date:** 2026-06-18
**Status:** In-flight — implementing slice by slice
**Owner:** mobile platform
**Parent spec:** [`docs/superpowers/specs/2026-06-14-native-mobile-archetype-apps-design.html`](../specs/2026-06-14-native-mobile-archetype-apps-design.html)
**Related specs:** [Town super-app](../specs/2026-06-14-multi-business-town-super-app-design.html), [Field dispatch contract](../specs/2026-06-14-field-dispatch-mobile-contract-and-warranty-design.html)

## Goal

Close the remaining code gaps between today's mobile substrate and a real, shippable, install-driven iOS app serving both **field-tech (employee)** and **customer** personas — the HVAC scenario the founder named (tech captures work → drafts invoice → collects payment) AND the customer-facing flip side (view invoices, see visits, pay).

Owner-only steps (Apple Developer enrollment, Google Play, Expo/EAS account, Firebase + APNs key, physical iPhone, store metadata) are explicitly out of scope for this plan — they cannot be performed by an agent regardless of authorization and are tracked in the parent spec §9.

## Architecture (already shipped — context)

Per [`2026-06-14-native-mobile-archetype-apps-design.html`](../specs/2026-06-14-native-mobile-archetype-apps-design.html) §3, the keystone is:

> One generic Expo/RN binary connects to any DPF install, fetches an install manifest (`GET /api/v1/app/config`) carrying **design tokens + capabilities + persona + navigation**, and re-themes + re-functions itself from that data.

What's already on `main` from prior slices:

- `apps/mobile/` Expo SDK 55 / RN 0.83 / Expo Router / Zustand / NativeWind.
- `.well-known/dpf-instance.json` discovery descriptor + runtime URL config (P1).
- `GET /api/v1/app/config` install manifest with branding tokens, capability gating, persona resolution, navigation `defaultTab` (P2).
- Manifest-driven tab visibility + landing tab (PR #2042).
- Field-tech billing path: complete job → draft invoice → record cash/cheque/card/bank payment (PR #2043).
- Customer "My invoices" surface with tap-through to install's `/pay/<invoiceRef>` (PR #2045).

What's left — six tightly-scoped slices, each its own PR.

## Slices

### Slice 1 — `WorkItem` → `CustomerAccount` link end-to-end

Removes the largest piece of friction in the field-tech flow: the tech had to type the customer's `accountId` on the invoice screen. Server resolves the account from the `WorkItem.sourceType` + `sourceId` link (Engagement / Opportunity / StorefrontBooking / Activity); mobile pre-fills it as read-only.

**Status:** PR opened — #2162.

### Slice 2 — Customer "My visits" surface

Customer-side parallel to the employee's My Jobs. Customers see upcoming + recent appointments on Home alongside the My invoices panel. Closed `CustomerVisitStatus` union; `GET /api/v1/customer/visits` scoped two-hop (`account.is.accountId` → contacts → bookings); persona-gated render.

**Status:** PR opened — #2168.

### Slice 3 — Job-completion evidence (photos)

Tech captures one-to-many photos of completed work before billing. Stored on `WorkItem.evidence` JSON (additive — no schema migration). Wire shape (`JobEvidencePhoto`, `AppendJobEvidenceRequest`, `JobEvidenceResponse`) lives in `@dpf/types`; persistence in `POST /api/v1/work-items/:itemId/evidence`; client in `@dpf/api-client/workItems.appendEvidence`; mobile feature store + a new `(tabs)/jobs/[itemId]/complete.tsx` screen that lets the tech capture, list, and proceed to Draft invoice.

Signatures + voice notes deferred to a follow-up slice (each needs its own capture primitive — signature canvas via `react-native-signature-canvas`, voice via `expo-av` — both heavier deps deserving their own PR).

**Status:** This slice — in flight.

### Slice 4 — Multi-space switcher UX (Town M2)

`spaces.store` substrate already exists from prior PRs. This slice adds the *UI*: a switcher component, a "connect another business" entry point reusing the existing `serverConfig` connect flow, and a "Town" home-tile listing connected spaces. Foundation for the founder's "3 businesses in one app" vision.

### Slice 5 — EAS pipeline + path-filtered mobile CI lane

`eas.json` today is a skeleton. This slice fills in the `internal`/`production` profiles for iOS + Android, adds a `.github/workflows/mobile-ci.yml` workflow that runs `pnpm --filter mobile typecheck` + `pnpm --filter mobile test` triggered only on `apps/mobile/**` and shared package paths, and documents the operator-only EAS first-run (Apple Developer enrollment, App Store Connect API key, FCM/APNs setup) as a checklist of owner-actions.

Native binary builds run under EAS cloud — the spec is explicit that `node:24-alpine` Build Studio cannot build iOS (macOS + Xcode only).

### Slice 6 — Geo-discovery "Nearby" stub (Town M4)

Lightweight: `useGeolocation` hook (already-installed `expo-location`), a `Nearby` panel that pings `GET /api/v1/directory/nearby?lat&lng` and lists install descriptors, and a server stub returning the *local* install when geo matches its address. Hosted federation directory (M5 in the Town spec) is intentionally not part of this slice — local single-install path validates the contract first.

## Reuse map

| Existing substrate | What we lean on |
|---|---|
| `WorkItem` model + `/api/v1/work-items` | Slices 1, 3 — append `account` projection + evidence endpoint, no schema migration |
| `StorefrontBooking` + `CustomerContact` | Slice 2 — two-hop scope to a signed-in customer |
| `BrandingConfig.tokens` + install manifest | Already shipped, unchanged |
| `POST /api/v1/upload` (MediaAsset) | Slice 3 — photos upload through it; the new evidence endpoint only links fileIds |
| `spaces.store` (from earlier PRs) | Slice 4 — UI shell over existing state |
| `expo-location` (already installed) | Slice 6 — geolocation hook |
| `eas.json` skeleton | Slice 5 — fill in profiles |

## Risks + open questions

- **No native capture primitives shipped for sig / voice.** Signature canvas needs `react-native-signature-canvas` (out of Slice 3); voice notes need `expo-av`. Each gets its own slice once primary photo capture lands.
- **Apple App Store §3.1.3(e) IAP exemption** holds for the physical-service payment flow (we open the install's `/pay/<invoiceRef>` in the system browser, not in-app). Confirmed in the parent spec §10.
- **`hub.docker.com/v2` digest rotation cadence** (whisper-server) — unrelated to this plan but blocks merges intermittently; rotation playbook lives in `docker-compose.yml`.
- **Town M5 federation directory** — deferred. Single-install "Nearby" stub in Slice 6 validates the shape first.

## Verification per slice

Each slice carries its own PR with the AGENTS §5 build-gate evidence:

- `pnpm --filter web typecheck` + targeted vitest for any new server route.
- `pnpm --filter mobile typecheck` + targeted jest for any new mobile store / projection.
- UX evidence (driving the live install) is deferred until the EAS pipeline (Slice 5) lands and produces an internal TestFlight build a real iPhone can install — the operator-only step.

## What this plan does NOT do

- Stand up Apple Developer / Google Play / Expo / Firebase accounts (owner-only).
- Generate APNs / FCM credentials (owner-only).
- Submit to TestFlight or Play Internal (owner-only — needs the accounts above).
- Touch the Town M5 hosted directory (separate spec, separate epic).
- Add voice-note or signature capture primitives (each its own follow-up slice).
