# BI-83E63277 — Push-based reactive agent progress

**Backlog item:** BI-83E63277 — Push-based reactive agent-progress — replace polling with real-time push in the agent-session feed  
**Status:** Implementation plan  
**Worktree:** `/Users/markbodman/dpf-worktrees/agent-progress-push`  
**Branch:** `codex/agent-progress-push`

## Goal

Make the Work Capsule agent-session feed update in real time when an AI coworker or external executor records progress, without requiring page refresh or client polling.

The intended user experience is the “reactive subscription” behavior called out in the BI: a non-technical operator watching a capsule should see “what the coworker is doing now” appear as it happens.

## Current substrate verified

- `apps/web/app/(shell)/build/work/[capsuleId]/page.tsx` server-renders `AgentSessionFeed` from `getCapsuleDetail(capsuleId)`.
- `apps/web/components/build/AgentSessionFeed.tsx` is currently a static server/client-neutral renderer over `capsule.activities`.
- `apps/web/lib/work-capsules/work-capsule-store.ts` has the canonical write path, `recordAgentActivity()`, which calls the internal `recordActivity()` helper.
- `packages/db/prisma/schema.prisma` has `WorkCapsuleActivity` indexed by `(workCapsuleId, recordedAt desc)`, which is enough for replay/catch-up without a new datastore.
- `apps/web/lib/sse/sse-stream.ts` provides the shared heartbeating SSE response builder.
- `apps/web/lib/hooks/useResilientEventSource.ts` provides the browser-side EventSource wrapper with heartbeat watchdog/reconnect behavior.
- `apps/web/package.json` already depends on `pg`, so Postgres `LISTEN/NOTIFY` is available without adding a new service.

## Design

Use Postgres `NOTIFY` as the cross-process wake-up bus and SSE as the browser transport.

The database remains the source of truth. The push channel is only an invalidation/event-delivery path:

1. `recordActivity()` persists the `WorkCapsuleActivity`.
2. After the write succeeds, the server publishes a small notification containing `capsuleId` and `activityId`.
3. A capsule-scoped SSE route subscribes to notifications, fetches the committed activity row, presents it with the existing `presentAgentSession()` projection, and sends it to the browser.
4. The browser appends unseen entries to the feed in place.
5. On connect/reconnect, the stream replays recent rows after the caller’s last known timestamp/id so missed events are recovered.

No new datastore, queue, or browser polling loop.

## Phases

### Phase 1 — WorkCapsule activity event bus

Files:

- `apps/web/lib/work-capsules/activity-events.ts` (new)
- `apps/web/lib/work-capsules/work-capsule-store.ts`
- focused tests near `apps/web/lib/work-capsules/`

Deliverable:

- Add a small helper for:
  - building a safe Postgres channel name;
  - publishing a committed capsule activity notification;
  - subscribing/unsubscribing to notifications with `pg`;
  - parsing notification payloads defensively.
- Call the publisher after `workCapsuleActivity.create()` succeeds.
- Fail open if notification publish fails; activity persistence must remain authoritative.

Verification:

- Unit tests prove channel/payload parsing, publish fail-open behavior, and that `recordAgentActivity()` still returns a persisted activity even if notification fails.

### Phase 2 — Capsule-scoped SSE route

Files:

- `apps/web/app/api/work-capsules/[capsuleId]/activity-stream/route.ts` (new)
- `apps/web/lib/work-capsules/activity-stream.ts` (new helper if needed)

Deliverable:

- Add an authenticated SSE endpoint for one capsule.
- Use `createSseResponse()` for heartbeats, cleanup, and reconnect safety.
- On connection, replay the latest agent-session activities from `WorkCapsuleActivity`.
- On notification, fetch the committed row and send a named event such as `capsule-activity`.
- Return only presented feed entries, not raw DB plumbing.

Verification:

- Route/unit tests prove:
  - unauthorized requests fail;
  - initial replay sends current activities;
  - a matching notification emits a new activity event;
  - non-matching capsule notifications are ignored;
  - cleanup unsubscribes on stream close.

### Phase 3 — Reactive feed client

Files:

- `apps/web/components/build/AgentSessionFeed.tsx`
- possibly `apps/web/components/build/AgentSessionFeedLive.tsx` (new client wrapper)
- `apps/web/app/(shell)/build/work/[capsuleId]/page.tsx`

Deliverable:

- Keep the server-rendered initial feed for first paint and non-JS fallback.
- Add a client wrapper that opens the capsule SSE stream with `useResilientEventSource()`.
- Append new, deduped entries in chronological display order.
- Surface a small connection state only when useful; do not make transport status the hero of the page.

Verification:

- Component tests prove initial rows render, pushed rows append, duplicate events are ignored, and the empty state changes when the first pushed event arrives.

### Phase 4 — Documentation and evidence

Files:

- This plan.
- Potentially `docs/user-guide/build-studio/index.md` or Work Capsule docs if the route behavior needs an operator-facing note.

Deliverable:

- Record execution evidence on BI-83E63277.
- Link tests and any manual/live verification.

Verification:

- Targeted tests for the event bus, route, and feed.
- Source-local typecheck/build as appropriate; runtime-bound live verification should use canonical install or local-CI sandbox before PR merge.

## UX fit

The user-facing behavior should be calm and plain:

- The Activity section remains the same mental model.
- New coworker lines appear automatically.
- The page should not ask the operator to refresh.
- Connection/reconnect status is secondary; the content is the point.

## Risks and rollback

- **Cross-process delivery risk:** In-memory events would miss worker/process boundaries, so this plan uses Postgres `LISTEN/NOTIFY`.
- **Lost event risk:** Notifications are not durable, so replay on connect/reconnect reads the canonical activity table.
- **Connection-slot risk:** All SSE uses the existing heartbeating `createSseResponse()` and `useResilientEventSource()` pair.
- **Blast radius:** Limited to Work Capsule activity feed and `recordActivity()` notification side effect. If push misbehaves, the persisted activity feed still works on page reload.
- **Rollback:** Remove the SSE client/route and notification helper call; no schema rollback required.
