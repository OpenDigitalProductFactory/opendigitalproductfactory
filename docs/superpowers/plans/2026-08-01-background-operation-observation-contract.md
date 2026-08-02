# Background Operation Observation Contract — implementation plan

| Field | Value |
| --- | --- |
| Date | 2026-08-01 |
| Backlog | `BI-AF4D4F23` |
| Epic | `EP-UPGRADE-LIFECYCLE` |
| Work Capsule | `WC-4C050897` |
| Plan coverage | Atomic receipt `cmsaj98s5048f01qk745eoy7c` |
| Delivery | One atomic PR: the shared transport, observer, self-upgrade migration, guard, and contract are not independently safe to ship |

## Outcome

Make `/ops/self-upgrade` navigation-safe while an upgrade, revision check, or
optional impact analysis is slow, and establish the reusable platform contract
that prevents queued work from being observed by refreshing an entire route.

The durable command/execution side is already correct: Inngest executes the
upgrade and `SelfUpgradeRun` is the ledger. This plan replaces the browser-side
observation pattern.

## Existing substrate and constraints

- `SelfUpgradeRun` is authoritative durable state; no second run table or event
  store is introduced.
- `/api/agent/system-stream`, `agentEventBus.broadcastSystem`,
  `createSseResponse`, and `useResilientEventSource` are reused.
- The system stream is HTTP/1.1. `PlatformBanner` and `usePlatformReady`
  currently create separate connections, so page-specific consumers must not
  add another direct `EventSource`.
- `router.refresh()` refetches and re-renders the current Server Component
  route. It is suitable after bounded mutations, not as a progress transport.
- The previous route-level `loading.tsx` mitigation wedged on its skeleton and
  was reverted. This plan makes the route cheap to observe instead of relying
  on a loading boundary to conceal slow work.

## Design grounding

- Existing specs/plans reviewed:
  `docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md`,
  `docs/superpowers/specs/2026-06-19-sse-liveness-heartbeat-design.md`, and
  this implementation plan.
- Current code substrate reviewed:
  `apps/web/app/(shell)/ops/self-upgrade/page.tsx`,
  `apps/web/components/ops/SelfUpgradeClient.tsx`,
  `apps/web/components/ops/SelfUpgradeTriggerControl.tsx`,
  `apps/web/components/ops/UpgradeImpactPanel.tsx`,
  `apps/web/app/api/agent/system-stream/route.ts`,
  `apps/web/lib/tak/agent-event-bus.ts`, and
  `apps/web/lib/self-upgrade/run-store.ts`.
- Source of truth: `SelfUpgradeRun` remains the durable operation ledger;
  `/api/agent/system-stream` is an invalidation transport; the authenticated
  shell owns the singleton system-event connection; and the narrow status
  projection rehydrates browser state.
- Decision: replace page-owned interval refresh with shell-owned event
  distribution plus abortable, single-flight projection reads. Slow optional
  analysis owns only local request state and cannot participate in navigation.

## Research and benchmarking

| Source | Standard/pattern | DPF decision |
| --- | --- | --- |
| Next.js App Router `useRouter` | `router.refresh()` requests and re-renders the current route | Prohibit interval-driven refresh; fetch a narrow projection |
| React transitions | Navigations are transitions and may wait for pending Actions | Long-running observation and inference stay outside navigation Actions |
| WHATWG Server-Sent Events | One-way server push with reconnect semantics | Use SSE as an invalidation hint, never as durable truth |
| MDN SSE guidance | HTTP/1.1 has a low per-origin connection ceiling across tabs | One shell-owned system stream per tab, shared by consumers |
| WHATWG HTML Page Visibility | Hidden documents can be throttled and emit `visibilitychange` when restored | Pause background reconciliation while hidden and rehydrate on visibility restoration |
| DPF SSE liveness design | Heartbeat/watchdog reconnect; transport never reloads the page | Reuse the resilient transport and keep navigation ownership above it |

## Phase 1 — one system event connection per shell

Deliverables:

1. Add `SystemEventProvider`, mounted once in the authenticated shell.
2. Expose stable `useSystemEvent(type, handler)` and connection-status hooks.
3. Migrate `PlatformBanner` and `usePlatformReady` from direct resilient-stream
   ownership to the provider.
4. Tests prove multiple consumers create one `EventSource`, receive typed
   events, isolate handler failures, and unsubscribe cleanly.

Verification: focused Vitest with fake `EventSource` and existing resilient-SSE
regression tests.

## Phase 2 — reusable live-operation observer

Deliverables:

1. Add `useBackgroundOperationObserver<TSnapshot>` on top of the system event
   provider.
2. It owns one abortable, single-flight snapshot request; rehydrates on stream
   reconnect; reacts to a selected system event; and uses visibility-aware,
   jittered exponential fallback polling only while degraded or explicitly
   requested.
3. Stale responses cannot overwrite newer snapshots; unmount/navigation aborts
   in-flight reads and timers.

Verification: red/green fake-timer tests for coalescing, abort, reconnect,
visibility pause, backoff, and stale-response ordering.

## Phase 3 — self-upgrade projection and migration

Deliverables:

1. Define a typed `SelfUpgradeStatusSnapshot` containing only bounded DB/config
   reads: latest run, quiescence state, cooldown, and job-engine health.
   Exclude git, network discovery, release history, and inference.
2. Serve it through an authenticated, `no-store` route.
3. Emit `system:self-upgrade` invalidation hints after each durable run-state
   transition (`queued`, `running`, and terminal states). Event delivery is
   best-effort and cannot make the ledger mutation fail.
4. Add a page-scoped self-upgrade live provider. Both the primary trigger and
   advanced detail panel consume the same snapshot and observer.
5. Remove all interval-driven `router.refresh()` calls from both components.
   Bounded mutation completion requests a targeted snapshot refresh instead.
6. Job-engine recovery uses the same targeted observer at a slower cadence;
   there is still exactly one poller.

Verification: component tests prove a queued/running transition updates both
surfaces without a route refresh and navigation cleanup aborts the request.

## Phase 4 — prevention and optional-work isolation

Deliverables:

1. Remove `useTransition` from impact-summary fetching; use explicit local
   request state and `AbortController` so it cannot join navigation Actions.
2. Keep persisted impact output stale-while-revalidate and clearly label its
   independent loading/error state. The request may be slow, but it cannot own
   route navigation.
3. Add a source-policy fitness test that rejects interval-driven
   `router.refresh()` in application source. Migrate the remaining promotions
   occurrence or file a bounded follow-up if its semantics require separate
   work.
4. Publish `docs/architecture/background-operation-observation-contract.md`
   as the canonical ownership and review checklist.

Verification: structural test scans production TypeScript/TSX; impact-panel
tests prove unmount abort and no React transition ownership.

## Phase 5 — gates and live proof

1. Focused affected Vitest suites.
2. Web typecheck and production build.
3. Local merged-code pregate in the governed shared sandbox.
4. Authenticated browser proof on the governed runtime:
   - trigger or fixture a queued/running state;
   - delay the snapshot endpoint and impact request independently;
   - navigate away within the agreed responsiveness budget;
   - verify one system SSE connection per tab;
   - repeat with multiple tabs and across reconnect.
5. Independent semantic review, DCO commit, overlap sweep, push, ready PR, and
   mechanical `pr:health` confirmation.

## Definition of done

Every acceptance criterion in `BI-AF4D4F23` has direct test or runtime evidence;
the architecture document is linked from the relevant SSE/quiescence design;
there are no untracked interval-driven `router.refresh()` occurrences in
application source (the ratcheted promotions exception is `BI-B8F44BF7`); and
the exact merged tree is green before publication.
