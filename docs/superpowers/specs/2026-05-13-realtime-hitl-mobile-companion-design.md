# Realtime HITL Notification and Mobile Companion Design

**Date:** 2026-05-13
**Status:** Draft addendum
**Related work:** `2026-05-13-paused-ai-work-approval-surface.md`, `2026-03-19-mobile-companion-app-design.md`, `2026-03-16-async-agent-operations-design.md`, `2026-04-04-collaborative-work-queue-design.md`, `2026-05-11-autonomous-coworker-runtime-design.md`

---

## 1. Why This Moves Now

The autonomous coworker runtime now has a concrete pause state: high-risk remote MCP work can create a `TaskRun`, persist context, and stop at `input-required` before side effects run. The Paused Work approval surface is the canonical portal destination for that human decision.

That changes the timing for realtime messaging and mobile. They should move now, but as a narrow companion layer for autonomous coworker decisions rather than as a full replacement for the portal.

The first mobile value proposition is not "DPF on a phone." It is:

> An AI coworker is blocked, the human who holds authority is away from the desktop, and the platform needs to bring the smallest accountable decision to that human with enough context to act safely.

This preserves the cognitive-load-transfer doctrine:

1. Human intent and policy remain human-owned.
2. AI coworkers prepare decision context and absorb orchestration burden.
3. Repeated pause patterns become procedural policy, typed workflow, or code.
4. Realtime/mobile surfaces reduce time-to-decision without creating approval fatigue.

## 2. Current Starting Points

### 2.1 Existing specs

`docs/superpowers/specs/2026-03-19-mobile-companion-app-design.md` already defines a broad native iOS and Android companion app. It chooses React Native + Expo, Expo Router, NativeWind, Zustand, Expo SQLite/MMKV, Expo notifications, EAS Build/Submit, Jest/RNTL/MSW/Maestro, and REST API boundaries.

That spec is directionally useful but too broad for the next slice. It includes dashboards, backlog, customers, dynamic forms, agent conversations, offline reads, and governance approvals. This addendum narrows the first implementation slice to Paused Work, notifications, and approval deep links.

`docs/superpowers/specs/2026-03-16-async-agent-operations-design.md` already identifies three layers: in-panel status, cross-page banner, and a multi-task hub. It recommends SSE for realtime updates.

`docs/superpowers/specs/2026-04-04-collaborative-work-queue-design.md` defines messaging, notifications, escalation, quick approvals, and mobile push in the broader `WorkItem`/`WorkQueue` future. V1 must not jump straight to the whole queue. Paused Work remains a `TaskRun` projection until a real multi-worker claim/escalation need appears.

`docs/superpowers/specs/2026-05-09-deployment-contracts.md` already reserves unauthenticated `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` contracts for mobile universal links and Android App Links.

### 2.2 Existing runtime primitives

The repo already has:

- `Notification` for user-targeted in-app notifications.
- `PlatformNotification` for platform/system notifications.
- `PushDeviceRegistration` for mobile push tokens.
- `apps/web/lib/queue/notification-adapter.ts`, currently an in-app adapter over `Notification`.
- `apps/web/lib/tak/agent-event-bus.ts`, a typed realtime event bus with `task:status`, `task:artifact`, queue events, build events, verification events, and async inference events.
- `/api/agent/stream`, an SSE route for realtime agent progress.
- `/api/v1/notifications/register-device`, a device registration endpoint.
- `TaskRun.progressPayload`, used for status replay when in-memory SSE events are not enough.

The gap is not "do we have any notifications?" The gap is a canonical HITL event contract, a delivery policy, and a mobile client that treats Paused Work as the first-class action surface.

### 2.3 Live backlog check

The DPF MCP backlog tools were queried on 2026-05-13. Exact searches for realtime/mobile/HITL notification wording did not return a direct active backlog item. Related open work exists around TAK/GAID governance and desktop control, but there is no current backlog owner surfaced by the MCP query for this narrower "Paused Work notification + mobile companion" slice.

Do not create a parallel backlog taxonomy from this spec. Link future backlog items to the autonomous coworker runtime and TAK governance family unless a dedicated mobile epic is reopened.

## 3. Research and Benchmarking

### 3.1 Expo and React Native precedent

The March mobile spec selected React Native + Expo. That remains the recommended first mobile stack.

Current Expo documentation supports this direction:

- Expo push notification setup uses `expo-notifications`, project push credentials, and Expo push tokens for iOS/Android notification delivery. Source: [Expo push notification setup](https://docs.expo.dev/push-notifications/push-notifications-setup/).
- Expo linking documentation covers deep links, iOS Universal Links, and Android App Links for routing notifications into specific app screens. Source: [Expo Linking overview](https://docs.expo.dev/linking/overview/).
- Expo EAS distribution documentation supports managed build and submission workflows for Apple App Store and Google Play. Source: [Expo distribution overview](https://docs.expo.dev/distribution/introduction/).

Adopted:

- Expo managed workflow for first mobile client.
- EAS Build/Submit for reproducible iOS/Android builds.
- Expo notifications for initial push transport.
- Universal/App Links for secure portal-to-app and notification-to-app routing.

Rejected for first slice:

- Building separate native Swift/Kotlin clients.
- Treating mobile as a full portal.
- Relying on mobile foreground SSE as the primary delivery mechanism.

### 3.2 Realtime transport precedent

MDN describes SSE as a browser-native `EventSource` model for server-to-client event streams, with named events and automatic reconnect behavior. Source: [Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events).

DPF already uses SSE successfully in web contexts. For mobile, SSE is useful only while the app is foregrounded. Background delivery must be push notifications. Therefore:

- portal realtime uses SSE plus persisted replay from `TaskRun.progressPayload`;
- mobile foreground may poll or subscribe later, but push is the first reliable background channel;
- the canonical event is persisted before delivery, so losing a live connection does not lose the decision.

### 3.3 HITL security precedent

The Paused Work plan already points to OpenAI HITL, Azure orchestration guidance, and OWASP HITL risks. This companion spec inherits those constraints:

- no high-risk one-tap approval from unauthenticated email or push;
- mobile push opens an authenticated decision surface;
- summaries are never the only evidence;
- raw prompt/action text is visible beside the AI-prepared brief;
- action attempts are audited through `AuthorizationDecisionLog` and `TaskMessage`.

## 4. Product Scope

### 4.1 V1 goal

Build a realtime and mobile notification foundation for Paused Work:

1. When a `TaskRun` enters `input-required` or `auth-required`, create a canonical HITL notification event.
2. Show portal badges and live list updates for Paused Work.
3. Store a user-targeted `Notification` row with a deep link to `/platform/ai/paused-work?taskRunId=...`.
4. Push to registered mobile devices when channel policy permits.
5. Open the mobile app directly to the paused-work detail when installed, or the portal route when not installed.
6. Keep the actual approval decision authenticated and context-rich.

### 4.2 Non-goals

- Full mobile DPF portal.
- Full Build Studio on mobile.
- Full Collaborative Work Queue implementation.
- Slack/Teams/email interactive buttons.
- Unauthenticated approve/reject links for high-risk work.
- Offline approval queueing.
- Multi-tenant white-label app packaging.
- Watch/desktop widgets.

## 5. Experience Model

### 5.1 Portal

The portal remains canonical for first implementation.

Required surfaces:

- Paused Work tab badge: count of actionable paused `TaskRun`s.
- In-app notification feed row: concise title, risk class, coworker/source, and deep link.
- Operations Map attention link: direct to paused work detail.
- Live update path: SSE event or polling fallback when a new paused task arrives.

The portal must not rely on push or mobile to make paused work visible.

### 5.2 Mobile

The first mobile app is a companion, not a general-purpose client.

Initial screens:

1. Sign in.
2. Paused Work inbox.
3. Paused Work detail.
4. Decision confirmation.
5. Notification settings and device registration state.

The detail screen mirrors the portal decision artifact:

- AI-prepared brief.
- Raw requested action/prompt.
- risk class.
- source and token/session attribution.
- coworker and route context.
- authority status.
- approve/reject/request-changes actions where permitted.

If approval is unsupported for a trigger or `auth-required` needs credential remediation, mobile shows the same unsupported state as the portal and deep-links to the portal for heavy remediation.

### 5.3 Push notification copy

Push notification content should be intentionally small:

- Title: `AI work needs review`
- Body: `<coworker or source> paused <riskClass> work: <short title>`
- Data payload: `taskRunId`, `route = "paused-work"`, `riskClass`, `status`, `deepLink`

Push notifications do not include raw prompt content by default because prompt text may include sensitive business data.

## 6. Event Contract

Introduce a canonical paused-work notification event in code, then project it into each transport:

```ts
type HitlNotificationEvent = {
  eventId: string;
  eventType: "task.paused" | "task.decision_requested" | "task.decision_recorded" | "task.resumed" | "task.completed" | "task.failed";
  taskRunId: string;
  status: "input-required" | "auth-required" | "working" | "completed" | "failed" | "rejected";
  userId: string;
  actorAgentId: string | null;
  routeContext: string | null;
  riskClass: "read" | "bounded-write" | "high-risk" | "unknown";
  trigger: string | null;
  sourceRef: { kind: string; id: string } | null;
  title: string;
  summary: string;
  deepLink: string;
  occurredAt: string;
};
```

V1 may not need a new table if `Notification` plus `TaskRun.progressPayload` is enough. If delivery retries and per-channel state are required, add a narrow `NotificationDelivery` table rather than overloading `Notification`.

Do not add a second task identity. `taskRunId` remains the work identity.

## 7. Channel Policy

Channel selection should be rule-driven:

| Risk/status | Portal | Push | Email/messaging |
|---|---|---|---|
| `input-required`, high-risk | Required | Deep-link only | Later deep-link only |
| `input-required`, bounded-write | Required | Deep-link only | Later optional |
| `input-required`, read | Required | Optional | Later optional |
| `auth-required` | Required | Deep-link only | Later deep-link only |
| completed/failed after resume | Required event history | Optional summary | Later optional |

No external channel may approve high-risk work directly in V1.

## 8. Mobile App Architecture

Use the March mobile spec as the base, but scope the first app to HITL:

```text
apps/mobile/
  app/
    (auth)/
      login.tsx
    (tabs)/
      paused-work.tsx
      settings.tsx
    paused-work/
      [taskRunId].tsx
  src/
    api/
      client.ts
      paused-work.ts
      notifications.ts
    components/
      DecisionBrief.tsx
      RiskBadge.tsx
      StatusPill.tsx
    features/
      auth/
      paused-work/
      notifications/
    stores/
      auth-store.ts
      paused-work-store.ts
    test/
      server.ts
```

Keep this app usable without offline mutation support. Cache the last inbox read for convenience, but decisions require online auth.

## 9. Server API Surface

The portal page can use server actions, but mobile needs REST endpoints:

```text
GET  /api/v1/paused-work
GET  /api/v1/paused-work/:taskRunId
POST /api/v1/paused-work/:taskRunId/approve
POST /api/v1/paused-work/:taskRunId/reject
POST /api/v1/paused-work/:taskRunId/request-changes
GET  /api/v1/notifications
PATCH /api/v1/notifications/:id/read
POST /api/v1/notifications/register-device
```

The decision endpoints must call the same `apps/web/lib/paused-ai-work/decisions.ts` functions as the portal. No mobile-only decision path.

## 10. Security and Identity

- Mobile authentication resolves to the same `Principal` model used by portal decisions.
- A device registration is an alias of a user/principal, not a new authority-bearing actor.
- Push token storage must not imply approval authority; it is a delivery endpoint only.
- Device loss revocation is handled by deleting `PushDeviceRegistration` rows and invalidating refresh tokens.
- Decision audit writes `AuthorizationDecisionLog` and `TaskMessage` exactly as the Paused Work plan defines.
- Push payloads avoid sensitive prompt text.
- Universal/App Links route into authenticated app screens. If not authenticated, the app lands on login and then resumes the deep link after auth.

## 11. Implementation Slices

### Slice 1: Portal realtime and notification projection

Depends on the Paused Work read/decision model.

Build:

- `task.paused` notification event creator.
- `Notification` row creation for `input-required` / `auth-required`.
- portal Paused Work badge/count.
- SSE or polling refresh for the Paused Work page.
- Operations Map remains the contextual map surface, not the notification source of truth.

### Slice 2: Push delivery foundation

Build:

- harden `/api/v1/notifications/register-device` around platform values, user ownership, and token rotation;
- add `sendPushNotification` adapter using Expo push service;
- add channel policy for paused work;
- add retry/error logging sufficient for local support.

### Slice 3: Mobile app shell

Build:

- `apps/mobile` Expo app scaffold;
- login/refresh/logout;
- paused-work inbox/detail;
- notification registration;
- deep-link routing;
- Jest/RNTL tests and one Maestro happy path.

### Slice 4: Mobile decision actions

Build:

- approve/reject/request-changes endpoints;
- mobile forms calling the same decision module as portal;
- conflict/unsupported/auth-required states;
- audit verification tests.

### Slice 5: Channel expansion

Only after portal and mobile are working:

- email deep-link notifications;
- Slack/Teams deep links;
- escalation policies from `ValueStreamHitlGate.channels`;
- low-risk signed action links, if and only if security review approves the class.

## 12. Acceptance Criteria

- A high-risk remote MCP `TaskRun` paused as `input-required` creates one user-targeted in-app notification.
- The Paused Work portal surface updates without a full page hunt.
- A registered mobile device receives a push notification with a safe deep link and no sensitive prompt content.
- Opening the notification lands on the paused-work detail after auth.
- Approve/reject/request-changes in mobile and portal call the same decision code.
- High-risk work cannot be approved from an unauthenticated external channel.
- All decision actions write the existing audit records.
- The implementation does not create `WorkItem` rows until the Collaborative Work Queue slice is deliberately started.

## 13. Open Questions

1. Should the first mobile login use the March spec's JWT/refresh-token design, or should it use an existing OAuth/device-flow path first?
   Recommendation: use the March JWT/refresh-token design only if the API auth middleware is already production-ready; otherwise ship portal deep links first and defer mobile decisions.
2. Should mobile foreground use SSE or short polling?
   Recommendation: start with short polling for the Paused Work inbox and push for background. Add foreground SSE only if live detail updates matter.
3. Should push delivery use Expo push service directly or an abstraction that can later swap to direct APNs/FCM?
   Recommendation: implement a `NotificationAdapter` abstraction now and make Expo the first adapter.
4. Should a dedicated mobile epic be reopened?
   Recommendation: yes, but scope it to "Mobile Companion for Paused AI Work" rather than reviving the whole March mobile spec at once.
