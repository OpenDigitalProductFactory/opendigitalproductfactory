# Plan — End-to-End iOS App Support (Dual-Persona, Install-Driven)

**Date:** 2026-06-18
**Status:** In-flight — slices merging in sequence
**Owner:** mobile platform
**Parent spec:** [`docs/superpowers/specs/2026-06-14-native-mobile-archetype-apps-design.html`](../specs/2026-06-14-native-mobile-archetype-apps-design.html)
**Related specs:** [Town super-app](../specs/2026-06-14-multi-business-town-super-app-design.html), [Field dispatch contract](../specs/2026-06-14-field-dispatch-mobile-contract-and-warranty-design.html)

## Goal

Close the remaining code gaps between today's mobile substrate and a real, shippable, install-driven iOS app serving both **field-tech (employee)** and **customer** personas — the HVAC scenario the founder named (tech captures work → drafts invoice → collects payment) AND the customer-facing flip side (view invoices, see visits, pay).

Owner-only steps (Apple Developer enrollment, Google Play, Expo/EAS account, Firebase + APNs key, physical iPhone, store metadata) are explicitly out of scope for this plan — they cannot be performed by an agent regardless of authorization. They live in the parent spec §9 and Slice 5's operator checklist below.

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

### Slice 1 — `WorkItem` → `CustomerAccount` link

Server resolves account from `WorkItem.sourceType` + `sourceId` (Engagement / Opportunity / StorefrontBooking / Activity). Mobile pre-fills the invoice screen's accountId as read-only. **PR #2162.**

### Slice 2 — Customer "My visits" surface

`GET /api/v1/customer/visits` scoped two-hop (`account.is.accountId` → contacts → bookings). Customers see upcoming + recent appointments on Home alongside the My invoices panel. **PR #2168.**

### Slice 3 — Job-completion evidence (photos)

`POST /api/v1/work-items/:itemId/evidence` appends to `WorkItem.evidence` JSON. Capture primitive is pluggable (today: a deterministic stub; tomorrow: `expo-image-picker` / `expo-camera`). Signatures + voice notes deferred — each needs its own capture primitive in a follow-up slice. **PR #2181.**

### Slice 4 — Multi-space switcher UX (Town M2)

`SpaceSwitcher` (compact + full variants) + `/connect` flow + More-tab placement. `spaces.store` substrate already exists from prior PRs; this is the UI half. **PR #2182.**

### Slice 5 — EAS pipeline + mobile CI lane

**Status:** This slice — in flight.

Two artifacts:

1. **`apps/mobile/eas.json`** filled in beyond the skeleton. Four named build profiles (`development`, `preview`, `internal`, `production`) covering iOS + Android, including resource class, simulator/store distribution, autoIncrement on production, and a release-channel env var so the app knows which channel it's running on. Submit config: `internal` → TestFlight + Play Internal track; `production` → Play production track (iOS App Store submit still owner-gated per Apple).
2. **`.github/workflows/mobile-ci.yml`** path-filtered CI lane — runs `pnpm --filter mobile typecheck` + `pnpm --filter mobile test:ci` on PRs that touch `apps/mobile/**` or the shared `@dpf/api-client` / `@dpf/types` / `@dpf/validators` packages. Path-filtered so mobile-only PRs don't wait on the `apps/web` four-shard vitest matrix + Next build (15-20 min), and web-only PRs don't run mobile jest unnecessarily.

Native binary builds (`.ipa` / `.aab`) DO NOT run in CI — iOS requires macOS + Xcode (Linux cross-compile does not exist for iOS), so binaries are produced by `eas build` on Expo's cloud, triggered on merge-to-main / tag / manual dispatch. CI gates code-level quality only.

#### Operator-action checklist (Slice 5 cannot finish without these)

These cannot be done by an agent — they require the company's legal identity and accounts:

| Action | Why an agent can't | Cost |
|---|---|---|
| Enroll **Apple Developer Program** as **Arcamanus LLC** | legal entity, D-U-N-S, 2FA Apple ID, signed agreements | $99/yr |
| Create **Google Play Console** account (org) | identity verification, signed agreements | $25 one-time |
| Create **Expo / EAS** account + org | account auth for cloud builds | free to start |
| Generate **App Store Connect API key** (`.p8`) | Apple account credential | — |
| Create **Firebase** project + generate **APNs Auth Key** | Google/Apple account-bound credentials | free (push) |
| Reserve **bundle id** `com.dpf.mobile` (or chosen) on both stores | Apple/Google identity | — |
| Provide a **physical iPhone + Android** device | hardware for push / biometric / deep-link / store QA | — |
| TestFlight + Play internal **tester enrollment** | accept builds via your accounts | — |
| **Privacy policy URL** + **data-safety / nutrition labels** | legal + marketing decisions + hosted page | — |

Once the operator has provided these, the agent can:

- Set the EAS project + slug on the operator's account via `eas init`.
- Configure GitHub Actions secrets (`EXPO_TOKEN`, `APP_STORE_CONNECT_API_KEY`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`).
- Wire a release workflow that calls `eas build --profile internal` on merge-to-main and `eas build --profile production` on tag, with `eas submit` follow-on for store submission.

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
| `eas.json` skeleton + `apps/mobile/package.json` scripts | Slice 5 — fill in profiles + add CI lane |

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
