# Mobile App — Store Launch Runbook (Arcamanus LLC)

**Owner runbook for BI-MOBAPP-ACCOUNTS / EP-MOBILE-ARCHETYPE.** These are the
steps only the account holder can perform; the platform code is built to the
edge of each one (connectivity, install manifest, theming, field surface, push
adapter, offline queue, EAS config all landed). Work top-to-bottom; later steps
depend on earlier ones.

Publishing entity: **Arcamanus LLC** (the OSS supporting company / Apple license
holder). One generic app serves every install via the install manifest — there
is no per-org app to publish.

App identity (current, in `apps/mobile/app.json`):
- name: `DPF Mobile` · slug: `dpf-mobile` · scheme: `dpf-mobile`
- bundle id (iOS) / package (Android): `com.dpf.mobile`

> **Decision before first build:** confirm or change the bundle id. If publishing
> under Arcamanus, you may prefer `com.arcamanus.dpf` (or similar). The id is
> painful to change after first store submission — decide now. Update both
> `ios.bundleIdentifier` and `android.package` in `app.json` to match.

---

## Phase 0 — Accounts (no code; do these in parallel with platform work)

| # | Account | Where | Cost | Notes |
|---|---------|-------|------|-------|
| 1 | **Apple Developer Program** (Organization) | developer.apple.com/programs/enroll | USD 99/yr | Enroll as **Arcamanus LLC**. Needs the legal entity, a **D-U-N-S number** (free, can take days — request early), and a 2FA Apple ID. Record the **Team ID**. |
| 2 | **Google Play Console** (Organization) | play.google.com/console/signup | USD 25 once | Create under the publishing entity. Organization accounts avoid the extra production-access testing hoops personal accounts face. |
| 3 | **Expo / EAS** organization + project | expo.dev | Free to start | Create an Expo org; `eas init` links `apps/mobile` to a project (writes `extra.eas.projectId` into `app.json`). Paid tier only when build volume needs it. |
| 4 | **Firebase** project | console.firebase.google.com | Free (FCM) | For Android push (FCM). Add an Android app entry; download the FCM config; upload the FCM server credential to Expo (`eas credentials`). |
| 5 | **APNs Auth Key** (iOS push) | Apple Developer → Keys | Free | Generate an APNs Auth Key (.p8). Store it in Expo via `eas credentials`. |

**Hardware / testers:** one modern iPhone + one modern Android, both on a
current OS, for push / biometrics / deep-link / store QA (simulators can't do
those four). Add the publisher Apple ID to **App Store Connect** and the Google
account to **Play Console** with least-privilege roles.

---

## Phase 1 — App identity + signing (after accounts exist)

1. Confirm/set the bundle id + Apple **Team ID** in `app.json`.
2. `eas init` (links the Expo project).
3. `eas credentials` → let EAS manage iOS signing (Distribution cert +
   provisioning profile) and Android signing (upload key / Play App Signing).
4. Add the **APNs key** (iOS) and **FCM credential** (Android) under
   `eas credentials` so push tokens resolve to real deliveries.

---

## Phase 2 — Builds (EAS cloud — no Mac required for CI)

The code lives in this monorepo; **native binaries build on EAS** (iOS on
macOS workers, Android on Linux). Profiles are configured in
[`apps/mobile/eas.json`](../../apps/mobile/eas.json):

- **development** — `developmentClient`, iOS simulator on — for local dev with a
  dev client. Run: `eas build --profile development --platform ios|android`.
- **preview** — internal distribution — for ad-hoc / TestFlight-adjacent shares.
- **production** — channel `production`, auto-incrementing build number — for
  store submission.

> Your **Mac** is useful for local iOS debugging (Xcode + iOS Simulator) but is
> **not** required for producing builds — EAS does that. Cross-compiling iOS on
> Linux/Windows is impossible, which is exactly why EAS (cloud macOS) is the
> path.

Smoke order: `development` (on a real device via dev client) → `preview` →
`production`.

---

## Phase 3 — Distribution (TestFlight + Play internal → production)

1. **iOS:** `eas submit --profile production --platform ios` → TestFlight
   internal testing → add yourself + trusted testers → external if needed →
   App Store review.
2. **Android:** `eas submit --profile production --platform android` (lands on
   the `internal` track per `eas.json`) → promote internal → closed → production.
3. Drive the **happy path on a real device** for each: connect to a demo
   install (URL/QR) → sign in → field "My Jobs" → check-in/out → receive a push.

---

## Phase 4 — Enable push

Push delivery code is landed but **gated**. After the Expo project has APNs
(iOS) + FCM (Android) configured (Phase 0 #4/#5), set **`DPF_PUSH_ENABLED=true`**
on the install. The `expo-push` adapter then fans out alongside in-app
notifications — no code change. Until then it is inert.

---

## Phase 5 — Store metadata + compliance (prepare in parallel)

Both stores need: app name, subtitle/short + full description, keywords, app
icon, screenshots (phone), support URL + email, **privacy policy URL**, and the
data-safety / app-privacy "nutrition" labels + content rating. A starting
**privacy policy draft** is at
[`mobile-privacy-policy-draft.md`](./mobile-privacy-policy-draft.md) — host it at
a public HTTPS URL and reference it in both stores.

**Universal / App Links** (deep links): once the production install domain is
fixed, serve `/.well-known/apple-app-site-association` (iOS) and
`/.well-known/assetlinks.json` (Android) from it, with the app id + signing
fingerprints, so `dpf-mobile://` deep links and notification taps open the app.

---

## What's already done (platform side, no action needed)

- Connect-to-your-install (runtime URL + `/.well-known/dpf-instance.json`).
- Install manifest (`/api/v1/app/config`) → design tokens + capabilities + persona.
- Full renderer theming + manifest-driven, capability-gated navigation.
- Field "My Jobs" surface (`/api/v1/work-items` + screens) — PR.
- Offline mutation queue persistence + auto-flush on reconnect — PR.
- Expo push **sender adapter** (gated by `DPF_PUSH_ENABLED`) — PR.
- EAS build profiles ([`eas.json`](../../apps/mobile/eas.json)).

Tracking: epic **EP-MOBILE-ARCHETYPE**.
