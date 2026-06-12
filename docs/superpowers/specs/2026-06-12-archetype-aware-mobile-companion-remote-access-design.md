# Archetype-Aware Mobile Companion And Remote Access Design

**Date:** 2026-06-12
**Status:** Draft
**Scope:** Decide what DPF mobile should be responsible for, how it differs from Claude/Codex/headless use, how archetype-specific remote jobs are delivered, and how phones reach customer-owned DPF installs without weakening the Authority Core.

## Problem Statement

DPF already started down the native mobile path. The repository has an Expo React Native app in `apps/mobile`, REST API routes under `/api/v1`, push notification and dynamic form models, an offline queue, native device capabilities, and prior mobile specs.

The open question is no longer "should DPF have mobile code?" It is:

1. Which remote jobs need a native mobile app rather than a responsive portal or a headless Claude/Codex experience?
2. Should DPF ship many archetype-specific iOS/Android variants, or one companion app that adapts by archetype?
3. How should mobile reach an Authority Core deployed on customer-owned hardware, private networks, or customer cloud?
4. Which refactors are required before the current mobile foundation becomes product architecture rather than scaffolded breadth?

The answer must preserve DPF's deployment premise: each customer owns a single-tenant Authority Core. Mobile is a client packaging target of that Authority Core, not a SaaS control plane.

## Current-State Anchors

Existing implementation:

- `apps/mobile` is an Expo React Native app using Expo Router, Zustand, NativeWind, `expo-secure-store`, `expo-sqlite`, `expo-notifications`, `expo-camera`, and `expo-location`.
- `apps/mobile/dynamic` already contains schema-driven form and view renderers with camera, location, lookup, select, signature, and widget components.
- `apps/mobile/src/lib/apiClient.ts` and `apps/mobile/src/stores/offlineQueue.ts` still default to `http://localhost:3000`, which is wrong for phones outside the host machine.
- `apps/mobile/src/stores/offlineQueue.ts` keeps queued mutations in memory, while the March mobile spec expects durable queued writes.
- `packages/db/prisma/migrations/20260319030000_mobile_models/migration.sql` created `Notification`, `PushDeviceRegistration`, `DynamicForm`, and `DynamicView`.

Existing specs:

- `2026-03-19-mobile-companion-app-design.md` selected Expo React Native and defined the broad companion app.
- `2026-05-13-realtime-hitl-mobile-companion-design.md` narrowed the first high-value slice to Paused Work / HITL notifications.
- `2026-05-20-mobile-expo-55-upgrade.md` upgraded the target to Expo SDK 55 and documents the current dependency posture.
- `2026-04-22-enterprise-auth-directory-federation-design.md` requires mobile device identity to converge through `Principal` / `PrincipalAlias`, not a parallel identity island.
- `2026-05-09-deployment-contracts.md` classifies mobile as a Contract 10 client/API surface and requires universal link / app link well-known routes.
- `2026-05-20-edge-node-deployment-matrix.md` proves that LAN/host visibility cannot be assumed from Docker Desktop; Windows and macOS need native Edge Node binaries for real local network visibility.

Persona evidence:

- Dale / HVAC needs technicians to update truck stock and parts-used from the field.
- Linda / dental needs appointment readiness and exception triage on mobile without exposing platform internals.
- Marisol / retail needs urgent order, stock, receiving, and return exceptions prioritized on mobile.

## Research And Benchmarking

### Expo and native app delivery

Expo remains the best first-party mobile stack for DPF because it matches the existing TypeScript/React monorepo, supports iOS and Android from one codebase, and has first-class build and notification tooling.

Official Expo docs state that EAS Build is a hosted service for building Expo and React Native app binaries, and the push notification docs cover credentials, Expo push tokens, and sending notifications through a server-side integration. Sources: [EAS Build](https://docs.expo.dev/build/introduction/), [Expo push notification setup](https://docs.expo.dev/push-notifications/push-notifications-setup/), [Expo notifications SDK](https://docs.expo.dev/versions/latest/sdk/notifications/).

Adopted:

- Keep Expo React Native as the native mobile foundation.
- Use EAS Build / Submit for reproducible app-store and internal distribution.
- Use `expo-notifications` behind a DPF `NotificationAdapter` abstraction, so Expo can be the first adapter without becoming the only possible push transport.

Rejected:

- Separate Swift and Kotlin apps for v1. They would double the implementation and verification surface with little archetype benefit.
- Replacing Expo with Flutter or MAUI. Those would sever TypeScript sharing with the web, API client, validators, and dynamic renderer.

### Native auth

OAuth 2.0 for Native Apps, RFC 8252, says native app authorization requests should use an external user agent, primarily the user's browser. Source: [RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252).

Adopted:

- Mobile auth must support `identity-edge-oidc-pkce` through the system browser.
- `local-password` may remain as a transitional mode, but the app architecture must not bake it in.
- Mobile device registration is a delivery endpoint and an alias, not an authority actor.

Rejected:

- Embedded webviews for workforce login.
- Shipping a mobile app with a bundled client secret.

### PWA and web-wrapped alternatives

Apple supports Web Push for web apps and Safari using standards-based push notification APIs. Android Trusted Web Activities can package PWA content into an Android app using Custom Tabs. Sources: [Apple web push notifications](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [Android Trusted Web Activities](https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities).

Adopted:

- Responsive web and PWA remain useful for light mobile access, first-run setup pages, and customer-facing portal flows.
- Android TWA can be reconsidered later for very narrow customer-facing portal packaging.

Rejected:

- PWA as the primary DPF mobile answer. It is too weak for field work that needs durable offline writes, camera/location/signature capture, secure token storage, deep link recovery, and high-trust HITL push.
- Web-wrapped app-store variants per archetype. They create distribution work without solving the hard parts: identity, offline, push, and customer-network reachability.

### Remote access and customer-owned hardware

Cloudflare Tunnel creates outbound-only connections from a private network to Cloudflare and can expose private services without a publicly routable IP. Tailscale Serve shares local services inside a tailnet; Tailscale Funnel can expose a local service publicly over HTTPS. Sources: [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/), [Cloudflare private network connector](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/cloudflared/), [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve), [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel).

Adopted:

- Mobile reaches the Authority Core through a deployment-selected HTTPS URL or private mesh/VPN route.
- DPF may document Cloudflare Zero Trust, Tailscale, WireGuard, customer VPN, or private cloud networking as supported reachability modes.
- The Authority Core remains the only policy decision point; tunnels move packets, not authorization.

Rejected:

- Making DPF depend on one relay vendor.
- Treating Edge Node as a general mobile relay. Edge Nodes submit host/local estate data and enforce local trust boundaries; they are not a second Authority Core.
- Exposing `localhost:3000` semantics to mobile.

### Comparable product patterns

Adopted patterns:

- **Agent inbox / HITL companion:** mobile is strongest when a blocked autonomous process needs the accountable human away from desktop.
- **Field-service native apps:** native wins when work happens at a site, vehicle, shelf, warehouse, or counter and needs capture.
- **Dynamic form renderer:** one app can safely render many business-specific mobile jobs from server-owned schemas.

Rejected anti-patterns:

- "Full portal clone on phone." It produces dense admin UI where the job is actually triage, capture, and confirmation.
- "One binary per archetype." It multiplies app-store, signing, QA, and support burden while the meaningful variation is data/schema/workflow, not compiled code.
- "AI-only / headless-only remote ops." Claude or Codex can build and administer, but they do not replace a worker's need to scan, photograph, confirm, sign, or receive a push-gated decision.

## Design Decision

DPF should ship **one native mobile companion app** and many **archetype job packs**.

The native app owns common capabilities:

- device-bound authentication and secure token storage;
- push notifications and deep links;
- offline read cache and durable queued writes;
- native capture fields: camera, location, signature, files, barcode later;
- schema-driven forms, views, and action lists;
- mobile HITL decision surfaces;
- per-device revocation and audit attribution through the principal model.

The Authority Core owns variable behavior:

- which job packs are active for the organization's archetype;
- which forms/views/actions the mobile app can render;
- capability gates and authority decisions;
- notification channel policy;
- deployment reachability configuration;
- app link / universal link well-known routes.

Claude, Codex, and Build Studio remain peer creation and administration surfaces. They are not substitutes for remote operational mobile work.

## Kernel Consultation Note

The DPF MCP `principle_decide` tool was not callable in this Codex session, so this section records a manual option mapping against the checked-in `PRINCIPLE_DIMENSIONS` registry rather than claiming a live kernel result.

Options considered:

1. **Native adaptive companion**: one Expo app, server-driven archetype job packs.
2. **PWA first**: responsive/PWA mobile portal, native deferred.
3. **Per-archetype native variants**: separate binaries or branded wrappers for major verticals.
4. **Headless only**: rely on Claude/Codex/Build Studio and skip mobile.

Manual scoring:

| Option | Strengths | Weaknesses | Direction |
|---|---|---|---|
| Native adaptive companion | Strong on `long_term_maintainability`, `reusability`, `schema_grounding`, `data_privacy`, and `human_cognitive_load` | Requires refactor before GA; app-store operations required | Recommended |
| PWA first | Strong on `speed_to_value` and deployment simplicity | Weak on offline, device identity, native capture, push reliability, field ergonomics | Use only as light-access companion |
| Per-archetype variants | Strong on branding | Weak on maintainability, QA, support, signing, update coordination | Reject for v1 |
| Headless only | Strong for builders/admins | Fails field work, push/HITL, native capture, nontechnical workers | Reject as mobile replacement |

The manual result aligns with architecture-over-shortcuts: keep one canonical app and make the archetype variation a server-owned schema/policy layer.

## Experience Model

### Surface responsibilities

| Surface | Best for | Not for |
|---|---|---|
| Claude / Codex / Build Studio | creating features, refactoring, admin reasoning, governed build work | field capture, consumer-grade worker UX, offline forms |
| Responsive portal / PWA | light read-only access, customer portal pages, admin pages on a tablet, first-launch setup links | high-risk mobile approvals, durable field work, native capture |
| Native mobile companion | push-gated HITL, field tasks, short action lists, native capture, offline-tolerant work | full admin shell, EA modeler, Build Studio implementation loops |

### Mobile first viewport

The native app should not open to a generic dashboard. It should open to a **Today / Needs You** surface:

- blocking approvals or paused work;
- assigned field tasks;
- urgent archetype exceptions;
- recently queued offline work;
- a single route-aware coworker action only when useful.

Generic KPIs belong below the fold or in an analytics route. The mobile mental model is "what needs action where I am," not "show me every module."

### Archetype job examples

| Archetype family | Native mobile jobs | Native requirement |
|---|---|---|
| Trades / field service | Job detail, parts used, truck stock, customer signature, photos, GPS arrival, offline note | Camera, location, signature, offline queue |
| Retail | Receiving, count adjustment, low-stock action, pickup/shipping tasks, return exception | Barcode later, camera, short action list |
| Healthcare / wellness | Appointment readiness, missing forms, reminder failure follow-up, capacity exceptions | Secure push, privacy-safe summaries, strict auth |
| Public sector / HOA / property | Inspection checklist, service request evidence, member/resident follow-up | Photos, GPS, signature, offline queue |
| MSP / IT services | Remote support consent, site visit checklist, incident approval, device handoff | Secure push, device identity, approval audit |
| Professional services / finance | Approval inbox, time/expense capture, document acknowledgement | Push, secure storage; native only when urgency or compliance demands it |

## Architecture

### Layers

```text
Mobile shell
  - auth mode selection
  - secure token store
  - notification registration
  - deep link recovery
  - offline cache / queue
  - native field primitives

Archetype job runtime
  - dynamic form renderer
  - dynamic view renderer
  - action list renderer
  - job pack routing
  - local validation

Authority Core
  - principal / alias resolution
  - route and object authorization
  - job pack registry
  - form / view schema source
  - notification policy
  - audit and evidence

Deployment reachability
  - public HTTPS, private VPN/mesh, customer cloud, or tunnel
  - universal links and app links
  - OIDC discovery and callback
```

### Job pack contract

An archetype job pack is a server-owned bundle:

```ts
type MobileJobPack = {
  packId: string;
  archetypeIds: string[];
  categoryIds: string[];
  version: number;
  label: string;
  entryRoute: "today" | "forms" | "inbox" | "customers" | "field";
  capabilities: string[];
  forms: string[];
  views: string[];
  actions: MobileActionDefinition[];
  offlinePolicy: "online-only" | "read-only-cache" | "queue-and-sync";
};
```

The mobile app should never download executable customer code. It renders known primitives from server-owned schemas, and the server validates every submission again.

### Remote access modes

| Mode | Description | Recommended for | Notes |
|---|---|---|---|
| Public customer HTTPS | Authority Core available at a stable customer domain | most cloud/single-VM installs | Requires TLS, OIDC callback, app links |
| Private mesh/VPN | Phone joins customer-controlled private network | regulated / private installs | DPF documents the contract; customer chooses provider |
| Cloudflare/Tailscale-style tunnel | Customer-controlled tunnel exposes Authority Core | small business without public IP | Optional deployment wrapper, not core dependency |
| Portal-only local access | `localhost:3000` on host | desktop-only local installs | Not a mobile target |

Mobile first-launch provisioning must accept a QR code or link that includes:

- Authority Core URL;
- auth mode;
- OIDC issuer/discovery hint when applicable;
- mobile universal link domain;
- bootstrap nonce or invitation token;
- optional reachability-mode label for operator support.

No default mobile base URL.

## Identity And Security

Mobile identity rules:

- A phone is a `mobile-device` alias linked to a human/customer `Principal`.
- Authorization resolves on the `Principal`, not on the device token.
- Push tokens are delivery endpoints only.
- Device revocation must be independent of user revocation.
- Push payloads must avoid sensitive prompt, patient, financial, or customer text by default.
- High-risk work cannot be approved from unauthenticated notification actions.
- Native login uses OIDC PKCE through the system browser when the identity edge is enabled.

Required server-side records or convergence:

- Retrofit `PushDeviceRegistration` toward `PrincipalAlias` / `mobile-device`, or add a bridge field that resolves to `Principal` while preserving existing rows.
- Add per-device metadata needed for support: platform, app version, push environment, lastSeenAt, revokedAt, revocation reason.
- Ensure `AuthorizationDecisionLog`, `TaskMessage`, and any mobile-submitted field evidence can attribute both principal and alias/device.

## Refactoring Budget

Per the 20 percent refactoring expectation, the first implementation phase must reserve work for the substrate that lets later mobile features stay simple:

1. **Authority Core URL provisioning**
   - Replace `EXPO_PUBLIC_API_URL ?? "http://localhost:3000"` defaults with a runtime `mobileAuthorityCoreUrl` stored in secure storage.
   - Add a first-launch QR/link setup flow.
   - Add tests proving mobile cannot silently fall back to localhost in production mode.

2. **Durable offline queue**
   - Move queued mutations from Zustand memory to SQLite.
   - Add idempotency keys, retry metadata, and safe failure states.
   - Preserve the UX distinction between "queued", "retrying", "failed", and "server rejected".

3. **Device identity convergence**
   - Align `PushDeviceRegistration` and future `MobileDevice` semantics with `PrincipalAlias`.
   - Add per-device revocation and audit attribution.

4. **Job pack registry boundary**
   - Introduce a server-owned `MobileJobPack` or equivalent projection before adding more hardcoded tabs.
   - Use existing `DynamicForm` / `DynamicView` where possible rather than creating parallel schema models.

5. **Notification policy**
   - Make `riskClass` / event type decide push vs ambient notification.
   - Avoid turning mobile into an activity feed that trains users to ignore urgent decisions.

## Implementation Slices

### Slice 1: Mobile substrate hardening

- Runtime Authority Core provisioning.
- No-localhost production guard.
- Durable SQLite offline queue.
- Push/device registration ownership hardening.
- Source-local mobile tests.

### Slice 2: HITL and notification companion

- Canonical paused-work notification event.
- Push adapter abstraction with Expo as first adapter.
- Mobile Paused Work inbox and detail.
- Approve / reject / request-changes through the same decision module as portal.

### Slice 3: Archetype job pack registry

- Server projection for active mobile job packs by archetype/category/capability.
- Dynamic form/view lookup filtered by job pack.
- Today / Needs You mobile home driven by job pack output.
- First packs: field service, clinic scheduler, retail merchandiser.

### Slice 4: Field-work capture

- Offline-capable forms with camera, location, signature, and upload handoff.
- Idempotent submission and server reconciliation.
- Evidence views in portal for submitted mobile work.

### Slice 5: Remote access packaging

- QR provisioning from Authority Core.
- Universal link / Android App Link routes and tests.
- Deployment docs for public HTTPS, private mesh/VPN, and tunnel options.
- Optional admin surface for issuing mobile install links.

## UX Fit Review

- **Decision:** fits-with-guardrails.
- **Owning area:** Platform for identity/reachability; Workspace and customer-facing archetype surfaces for job packs.
- **Route family:** mobile client plus `/api/v1/**`; portal configuration likely under `/platform/identity` and mobile setup under Platform Development or deployment settings.
- **Primary persona:** remote worker or accountable operator who needs a small action surface away from desktop.
- **Navigation layer touched:** mobile bottom tabs and contextual deep links; no new global portal nav required until setup UI lands.
- **Reuse/convergence:** reuse dynamic renderer, notifications API, Principal convergence, and deployment Contract 10. Do not create a parallel mobile schema.
- **Source truth:** `StorefrontConfig.archetypeId`, `OrganizationCapabilityActivation`, principal/alias identity, dynamic form/view schemas, and task/notification records.
- **Empty/failure behavior:** if no Authority Core is configured, show setup only; if not reachable, show last cached read data and clear reconnect state; if offline, block high-risk approvals and queue only allowed mutations.
- **AI boundary:** mobile may show coworker-prepared briefs, but approval actions require explicit authenticated confirmation.
- **Evidence before merge:** mobile unit tests, API route tests, production no-localhost guard, browser/viewport check for setup pages, and device/simulator verification before release.

## Test And Verification Strategy

Docs-only changes to this spec require:

- `git diff --check`;
- link/path spot check for referenced local specs.

Implementation later requires:

- `pnpm --filter mobile typecheck`;
- `pnpm --filter mobile test`;
- affected web/API Vitest tests;
- route-level tests for universal link well-known JSON;
- app-link / universal-link verification in simulator or device;
- EAS preview build before claiming iOS/Android readiness;
- Maestro happy paths for login, notification deep link, paused-work decision, and one archetype job form;
- canonical local install or shared local-CI lease for portal-side runtime gates.

## Risks

- **App-store operations become product drag.** Mitigation: one app, not per-archetype binaries; use internal distribution first.
- **Alarm fatigue.** Mitigation: push only for blocking or high-value events, driven by notification policy.
- **Private install reachability confusion.** Mitigation: first-launch QR provisioning and explicit reachability mode; never default to localhost.
- **Offline conflict complexity.** Mitigation: v1 queue-and-sync only for idempotent field submissions; no broad offline CRUD.
- **Parallel identity island.** Mitigation: principal/alias convergence before broad rollout.
- **Dynamic renderer overreach.** Mitigation: fixed primitive set, server validation, no arbitrary code.

## Open Questions

1. Does mobile v1 support customer contacts, workforce users, or both? Recommendation: workforce first for HITL and field work; customer contacts only where an archetype job explicitly needs it.
2. Which reachability options should be installer-supported versus documented only? Recommendation: public HTTPS and private VPN/mesh as supported contracts; Cloudflare/Tailscale as documented deployment recipes until tool evaluation approves a hard integration.
3. Should job packs be stored as first-class DB rows or derived projections from existing archetype/capability/form records? Recommendation: derive first; add a model only when the projection needs versioning and audit.
4. Should Expo push service be allowed in regulated deployments? Recommendation: make it configurable; support direct APNs/FCM or disabled push later through the adapter.
5. What is the first archetype job pack for dogfood? Recommendation: field service truck stock because Dale already proves native need and business value.

## Relationship To Existing Specs

This spec does not delete the March mobile companion spec. It narrows and supersedes its product doctrine:

- Keep Expo, REST API, dynamic renderer, offline cache, and push choices.
- Supersede the broad "full mobile DPF" launch posture with "native companion for HITL and archetype remote jobs."
- Preserve the May HITL mobile addendum as the first implementation slice.
- Preserve the deployment doctrine Contract 10 requirements for mobile API, universal links, and app links.
- Add a refactoring-first requirement before additional mobile feature breadth.

## Acceptance Criteria For This Design

- DPF has one mobile app architecture, not one binary per archetype.
- Native mobile has a clear job boundary separate from Claude/Codex/headless and responsive portal.
- Archetype-specific behavior is delivered by server-owned job packs and dynamic schemas.
- Customer-owned hardware reachability is explicit and deployment-selected.
- Mobile device identity converges with `Principal` / `PrincipalAlias`.
- The first 20 percent of implementation effort hardens URL provisioning, durable offline queue, device identity, job-pack registry, and notification policy.
