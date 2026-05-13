# Realtime HITL and Mobile Companion Readiness Report

**Date:** 2026-05-13
**Status:** Recommendations
**Related spec:** [Realtime HITL Notification and Mobile Companion Design](../specs/2026-05-13-realtime-hitl-mobile-companion-design.md)
**Related plan:** [Paused AI Work Approval Surface Implementation Plan](../plans/2026-05-13-paused-ai-work-approval-surface.md)

---

## Executive Recommendation

Move this track now, but keep the first release narrow:

1. **Finish Paused Work in the portal.**
2. **Add realtime HITL notifications and deep links.**
3. **Ship a mobile companion for Paused Work only.**
4. **Add richer mobile workflows after the decision/audit path is proven.**

The mobile app should not start as "the whole portal on a phone." The first valuable app is a secure companion that wakes the right human when an autonomous coworker is blocked and presents the smallest accountable decision with enough context to approve, reject, or request changes.

## Current Repo Readiness

DPF already has the right foundation:

- `TaskRun` is the work identity for autonomous coworker runs.
- `input-required` and `auth-required` are the pause states.
- `TaskMessage` and `AuthorizationDecisionLog` can preserve decision context.
- `Notification`, `PlatformNotification`, and `PushDeviceRegistration` already exist.
- `apps/web/lib/queue/notification-adapter.ts` is already a pluggable notification adapter, currently in-app only.
- `apps/web/lib/tak/agent-event-bus.ts` already carries task, queue, build, verification, async, and deliberation events.
- `/api/agent/stream` already provides a web SSE path.
- `/api/v1/notifications/register-device` already exists as the starting device-registration endpoint.
- `docs/superpowers/specs/2026-03-19-mobile-companion-app-design.md` already chose React Native + Expo.

The missing pieces are not basic primitives. The missing pieces are:

- a canonical paused-work notification event,
- a channel policy,
- push delivery,
- mobile auth,
- store registration,
- deep-link contracts,
- operational accounts and credentials.

## Account and Service Gaps

### Required before App Store or Play Store release

| Need | Recommendation | Owner action |
|---|---|---|
| Apple Developer Program | Enroll as an organization if DPF should publish under the company name. Apple lists the standard program membership as USD 99 per year. | Create or confirm Apple Developer account, legal entity, D-U-N-S details, two-factor Apple ID. |
| Google Play Console | Create a Google Play developer account. Google lists a USD 25 one-time registration fee. | Create or confirm Play Console account under the publishing entity. |
| Expo account | Use EAS Build/Submit for the first app build pipeline. Expo is the shortest path for an Expo-managed React Native app. | Create Expo organization/project, decide paid tier only when build volume requires it. |
| Firebase project | Use Firebase Cloud Messaging for Android push. FCM is currently no-cost for push messaging. | Create Firebase project, Android app entry, server credentials, and FCM config. |
| Apple push credentials | APNs key/certificate is required for iOS push via Expo/EAS. | Generate APNs Auth Key in Apple Developer, store in Expo/EAS credentials. |
| Public web domain | Universal Links and Android App Links require `.well-known` files on the install domain. | Confirm production domain and HTTPS path for `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`. |
| Privacy policy URL | Both stores and app auth flows need a privacy policy. | Publish DPF mobile privacy policy before store submission. |
| Support URL and support email | Both stores expect user support/contact metadata. | Decide public support email and support page. |
| App name and bundle IDs | Stable identifiers are painful to change later. | Reserve name and IDs early: suggested `com.opendigitalproductfactory.mobile` or company-specific equivalent. |

Official references:

- Apple Developer Program: [Apple Developer Program enrollment](https://developer.apple.com/programs/enroll/)
- Google Play Console: [Get started with Play Console](https://support.google.com/googleplay/android-developer/answer/6112435)
- Expo EAS: [EAS Build introduction](https://docs.expo.dev/build/introduction/) and [EAS Submit introduction](https://docs.expo.dev/submit/introduction/)
- Expo push: [Expo push notification setup](https://docs.expo.dev/push-notifications/push-notifications-setup/)
- Firebase Cloud Messaging: [FCM pricing FAQ](https://firebase.google.com/support/faq#fcm-pricing)
- Apple Universal Links: [Supporting associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
- Android App Links: [Verify Android App Links](https://developer.android.com/training/app-links/verify-android-applinks)

### Likely required for smoother testing

| Need | Recommendation | Owner action |
|---|---|---|
| Physical iPhone | Required for push, biometrics, deep links, and real App Store/TestFlight QA. Simulator is not enough. | Identify one modern iPhone on a current iOS version. |
| Physical Android phone | Required for FCM, app links, notification permissions, and Play internal testing. | Identify one modern Android phone on a supported OS. |
| TestFlight testers | Use internal TestFlight first, then external if needed. | Add Mark and any trusted testers to App Store Connect. |
| Play internal testing track | Use Play internal testing first. Personal Play developer accounts may face extra production-access testing requirements; organization accounts are usually easier for company publishing. | Prefer organization publishing account if available. |
| Apple App Store Connect access | Needed for TestFlight, app metadata, app privacy, builds, and review. | Add the developer/publisher Apple ID with least necessary role. |
| Google Play Console access | Needed for internal testing, app signing, data safety, and releases. | Add the developer/publisher Google account with least necessary role. |

## Apps and Local Tools to Install

### Developer/build machine

| Tool | Why | Timing |
|---|---|---|
| Node/pnpm from repo toolchain | Already required by DPF. | Existing. |
| Expo CLI via `pnpm` scripts | Project scaffolding, local dev, EAS commands. | Slice 3. |
| EAS CLI via `pnpm` scripts | Cloud builds and submit workflows. | Slice 3 or before first TestFlight. |
| Android Studio | Android emulator, SDK inspection, local diagnostics. | Helpful before Android QA. |
| Xcode on macOS | iOS simulator, local native diagnostics, Apple signing sanity checks. | Needed if you want local iOS simulator/debugging beyond EAS cloud builds. |
| Maestro CLI | Mobile E2E tests as selected in the March mobile spec. | Before mobile PR verification. |
| Expo Go | Fast early UI testing if no custom native modules are needed. | Early only. |
| Development build app | Required once native notification/deep-link behavior matters. | Before push/deep-link QA. |

### Phone apps/accounts

| App/account | Why |
|---|---|
| TestFlight on iPhone | Install internal iOS test builds. |
| Expo Go on iPhone/Android | Useful for early UI-only validation. |
| Google account tied to Play testing | Needed for Android internal testing. |
| Apple ID with 2FA | Required for Apple Developer/App Store Connect. |
| Authenticator/password manager | Store Apple, Google, Firebase, Expo, and APNs credentials safely. |

## Store and Compliance Gaps

### Apple App Store metadata

Prepare:

- app name,
- subtitle,
- description,
- keywords,
- support URL,
- marketing URL if available,
- privacy policy URL,
- screenshots,
- app icon,
- sign-in demo account or review notes,
- app privacy nutrition labels.

### Google Play metadata

Prepare:

- app name,
- short description,
- full description,
- app icon,
- feature graphic,
- phone screenshots,
- support email,
- privacy policy URL,
- Data safety form,
- content rating questionnaire,
- target audience declaration.

### DPF-specific policy content

The privacy policy and store metadata should explicitly cover:

- account authentication,
- push notifications,
- AI coworker decision notifications,
- audit logging of approvals/rejections/request-changes,
- device token storage,
- no sensitive prompt text in push payloads,
- data retention tied to the DPF install.

## Recommended Sequence

### Phase 0: No-cost preparation

Do now:

1. Decide the app name.
2. Decide bundle/package ID.
3. Confirm production domain for universal/app links.
4. Draft mobile privacy policy and support page.
5. Decide whether publishing entity is individual or organization.
6. Confirm physical iPhone and Android test devices.

### Phase 1: Portal implementation

Do before mobile build work:

1. Implement Paused Work portal surface.
2. Implement paused-work REST endpoints.
3. Implement `Notification` rows for paused tasks.
4. Implement portal badge/live refresh.
5. Verify high-risk MCP pause, reject, and approve/resume locally.

### Phase 2: Push foundation

Do after portal behavior is stable:

1. Harden device registration endpoint.
2. Add Expo push notification adapter.
3. Add channel policy.
4. Test push payloads without sensitive prompt text.
5. Add universal/app links.

### Phase 3: Mobile app shell

Do after accounts are ready:

1. Scaffold `apps/mobile`.
2. Implement login.
3. Implement Paused Work inbox/detail.
4. Register device for push.
5. Open push/deep link into a paused-work detail.
6. Add mobile decision actions only after portal decision module is stable.

### Phase 4: Store/test distribution

Do when first mobile shell passes local testing:

1. EAS internal iOS build.
2. TestFlight internal test.
3. EAS internal Android build.
4. Play internal test track.
5. Store metadata and privacy/data-safety review.

## Buy or Create Now

### Create now

- Apple Developer organization account, if not already present.
- Google Play Console organization account, if not already present.
- Expo organization/project.
- Firebase project for DPF mobile push.
- Public support email or alias.
- Public privacy policy URL.

### Do not buy yet

- Paid Expo tier, unless build volume or team permissions require it.
- Slack/Teams production apps, until portal/mobile paused-work notification path is proven.
- Direct APNs/FCM infrastructure outside Expo, unless Expo push service becomes a constraint.
- Mobile device farm subscription, until Maestro tests need CI device coverage.

### Hardware to have available

- One iPhone for TestFlight/push/deep-link QA.
- One Android phone for Play/FCM/app-link QA.
- A macOS machine with Xcode access if local iOS debugging becomes necessary.

## Risk Register

| Risk | Why it matters | Recommendation |
|---|---|---|
| Mobile scope creep | The March spec is broad enough to absorb months of work. | Keep first app to Paused Work only. |
| Store account delay | Apple organization enrollment and app review can block release timing. | Start account setup before mobile implementation begins. |
| Push data leakage | Prompt text may include sensitive data. | Put only safe summary fields in push payloads. |
| Approval fatigue | Mobile can make every pause feel urgent. | Use channel policy and risk classes. |
| Parallel decision path | Mobile might accidentally bypass portal audit logic. | All mobile decision endpoints call the same paused-work decision module as portal. |
| Deep-link drift | Universal/App Links need domain files and app IDs to match. | Implement `.well-known` contracts early and test before store review. |
| Personal Play account production gating | Personal accounts can have extra testing requirements before production access. | Prefer organization publishing account for DPF. |

## Concrete Next Recommendation

The next implementation thread should not start with `apps/mobile`.

Start with:

1. Paused Work portal implementation.
2. Paused Work REST API endpoints shaped for mobile reuse.
3. Notification event projection into `Notification`.
4. Push-device registration hardening.

Then start `apps/mobile` once the server contract is stable.

This keeps the phone app from inventing its own data model, its own approval path, or its own view of HITL state. It also makes mobile a thin, secure companion to the governed coworker runtime, which is the architecture we want.
