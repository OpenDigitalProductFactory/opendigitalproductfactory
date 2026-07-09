# TaskRun liveness + staleness primitives — BET-10 phase 1

_Status: BI-B6157FB7 phase 1 (BI stays in-progress) · EP-8DC217EB BET-10 · 2026-07-09_
_Parent plan: [`2026-07-07-vertical-integration-inward-plan.md`](../plans/2026-07-07-vertical-integration-inward-plan.md) §4 BET-10 (live health/run read-model)_

## Scope decision (kernel-gated)

BET-10 consolidates the ways TaskRun is re-queried, re-projected, and reaped:
shared liveness/staleness primitives, an `OperationsRunReadModel` projector
merge, one parameterized reaper framework, and one platform-health aggregator.
`principle_decide` ranked the full single-PR build highest on architecture
grounds, but the **reaper framework's host file
`apps/web/lib/queue/functions/taskrun-watchdog.ts` is in the EP-CLAUDE-INSIDE-OUT
`queue/` hot-zone** (co-edited by the parallel workflow-primitive thread), which
the standing build-it-once rule reserves for coordinated work. This PR therefore
ships the **hot-zone-safe foundation** every option builds on and defers the
read-model projector merge, the reaper framework, and the health aggregator to
coordinated follow-on phases.

## What landed (phase 1)

Two shared primitives + adoption + a ratchet — **no schema migration** (the
watchdog index `@@index([status, lastHeartbeatAt])` already exists):

- **`TASK_LIVE_STATES` + `isLiveStatus`** (`apps/web/lib/tak/task-states.ts`, the
  existing task-state SSOT). The `["working","active"]` "loop is live and
  heartbeating" set was hand-copied to 6 sites; this is its one home. `"active"`
  is a legacy value predating the closed `TASK_STATES` enum (kept for old rows +
  the watchdog SQL), so the constant is a plain string tuple, not
  `satisfies TaskState[]`. Distinct from `TASK_IN_FLIGHT_STATES` (the broader
  scheduling set).
- **`isStale` / `newestSignal` / `isStaleSince`**
  (`apps/web/lib/observability/staleness.ts`, a neutral module). The
  `now − ts > threshold` comparison and the "freshest-of-N-signals then compare"
  idiom were re-implemented across the reapers. Null timestamps are treated as
  stale (the conservative default every caller had).

### Adopters migrated in this PR (all outside the queue/ hot-zone)
- `observability/heartbeat.ts` — heartbeat updateMany filter → `TASK_LIVE_STATES`
- `build/inert-build-reaper.ts` — live-taskrun count → `TASK_LIVE_STATES`;
  `isInertBuildReapable` age check → `isStale`
- `self-upgrade/quiescence.ts` — the 3 `["working","active"]` filters →
  `TASK_LIVE_STATES`
- `observability/watchdog-detect.ts` — `decideStall` total/heartbeat/never-started
  comparisons → `isStale` (reason branching unchanged)

### Ratchet (anti-regrowth, plan §6)
`scripts/check-no-liveness-literal.mjs` (+ self-test) bans a NEW inline
`["working","active"]` JS array literal anywhere in `apps/web`, steering to
`TASK_LIVE_STATES`. Auto-discovered by the BI-3B0AD9CF guard loop — no ci.yml
edit. Allowlist is **empty** (all JS-array sites migrated). The queue/ watchdog
uses raw SQL `IN ('working','active')` (single-quoted, not a JS array) and
`deliberation-run`/`brand-extract` write the single status `"active"` — neither
matches the guard; they migrate with the reaper-framework phase.

## Deferred to follow-on phases (BI-B6157FB7 stays in-progress)

1. **OperationsRunReadModel** — one canonical TaskRun select + `projectRun` +
   one `classifyRunStatus`, collapsing the ai-operations-map twin selects, the 5
   hand-rolled status→state classifiers, and the `titleize`/`normalizeAgentId`/
   `splitEndpoint`/`dedupeById` projector-helper copies. (Neutral homes; no
   queue/.)
2. **Parameterized reaper framework** `reap({ scan, isReapable, transition,
   writeAudit, notify })` hosting the stall/quiescing/inert/dead-phase reapers —
   the framework module lives OUTSIDE queue/, with the Inngest cron shell in
   `queue/taskrun-watchdog.ts` importing it. **Coordinate with the Inside-Out
   thread (queue/ hot-zone) before editing the watchdog.**
3. **One platform-health aggregator** (`isPlatformHealthy`) unifying
   command-center / dependency-health / health-probe-bridge / alert-sources /
   scheduled-job health, feeding `platform/ai/runtime-health`.
4. Remaining staleness adopters: `quiescence.isTaskRunReapable`,
   `scheduled-jobs/staleness-escalation.evaluateJobStaleness` →
   `isStale`/`isStaleSince`.
