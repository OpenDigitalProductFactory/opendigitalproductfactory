# Operations Run read-model + liveness/staleness primitives + reaper framework

_Status: implemented with BI-B6157FB7 · EP-8DC217EB BET-10 · 2026-07-09_
_Parent plan: [`2026-07-07-vertical-integration-inward-plan.md`](../plans/2026-07-07-vertical-integration-inward-plan.md) §4 BET-10 · kernel approved whole-bet-in-one-PR (HIGH, margin 3.2)_

## What consolidated

TaskRun was re-queried and re-projected across `ai-operations-map`,
`observability`, `operate`, `workspace/command-center`, and `attention`, each
with its own select, status classifier, liveness literal, staleness math, and
reaper loop. This bet lands the shared primitives and migrates every site — no
schema migration (the `TaskRun` columns + `@@index([status, lastHeartbeatAt])`
already exist).

- **`tak/task-states.ts`** — `TASK_LIVE_STATES = ["working","active"] as const`
  + `isLiveStatus()`. The `["working","active"]` literal was hardcoded in 6
  sites (`observability/heartbeat.ts`, `self-upgrade/quiescence.ts` ×3,
  `build/inert-build-reaper.ts`, the `taskrun-watchdog.ts` SQL — now built from
  the constant). Distinct from the pre-existing `TASK_IN_FLIGHT_STATES`
  (a different, scheduling-in-flight set) — not conflated.
- **`shared/staleness.ts`** — `isStale(now, ts, thresholdMs)` (strict `>`, null
  = not stale) + `newestSignal(...ts)`. Replaces the `now - ts > threshold`
  idiom reimplemented 6+ times; the "newest-signal then compare" pair was
  copied verbatim in `isStuckQuiescingTaskRun` / `isBuildPhaseReapable` /
  `isTaskRunReapable`. Both take `now` explicitly so callers stay pure.
- **`ai-operations-map/operations-run-read-model.ts`** — `OPERATIONS_RUN_SELECT`
  (the one canonical 11-column select, replacing the twin verbatim selects in
  `load-map-data.ts`) + `classifyRunStatus` (the canonical status→severity
  classifier). **Behavior-preservation:** the other status mappers
  (`mapTaskState`, `toTaskState`, `mapEngagementStatus`,
  `severityForTaskRunStatus`) map DIFFERENT input/output domains and are
  deliberately left distinct — documented in-file — because unifying them would
  change observed output.
- **`ai-operations-map/projection-helpers.ts`** — `titleize` (3 copies),
  `normalizeAgentId` (2), `providerFromEndpoint` (the `split(":")[0]` idiom, 3
  copies; per-caller fallback parametrized). Kept in the map hot-zone home.
- **`operations-run/reap.ts`** — `reap({ scan, isReapable, transition, onError })`,
  the neutral skeleton the 4-5 reapers share (coarse scan → pure gate → per-row
  error-isolated transition → count). See NEUTRAL-HOME rule below.
- **`operate/platform-health.ts`** — `aggregatePlatformHealth` /
  `isPlatformHealthy` + `fromJobHealth`/`fromProbe` normalizers: an ADDITIVE
  worst-status-wins façade over the 6 scattered health surfaces (it does not
  replace them; callers inject already-collected signals so it stays IO-free).

## NEUTRAL-HOME rule (hot-zone discipline)

The reaper framework lives in `apps/web/lib/operations-run/`, deliberately
OUTSIDE the EP-CLAUDE-INSIDE-OUT collision hot-zones (`lib/queue`, `lib/tak`,
`lib/routing`, `lib/govern`). The Inngest cron wiring stays in
`lib/queue/functions/taskrun-watchdog.ts` as a thin shell that imports the
framework; only the trigger stays in `queue/`. The shared classifier/liveness
constants are *consumed* by `tak`, never defined there.

## Ratchet

`scripts/check-no-local-liveness-literal.mjs` (+ self-test) bans new hardcoded
`["working","active"]` liveness literals outside the canonical homes
(`tak/task-states.ts`, `shared/staleness.ts`). **Empty allowlist** — every
site migrated. Auto-discovered by the BI-3B0AD9CF guard loop (no ci.yml /
package.json edit).

## Cross-epic

BI-83AC1A03 (Inside-Out reporting/dashboard composer) consumes this read-model
(`OPERATIONS_RUN_SELECT` + `classifyRunStatus` + `aggregatePlatformHealth`) as
its canonical TaskRun projection source — it builds ON this, not a parallel one
(coordination note `2026-07-08-cross-epic-coordination-vertint-vs-insideout.md`).

## Research & benchmarking

The read-model/liveness split follows the in-repo watchdog precedent
(`observability/watchdog-detect.ts` already separates a pure `decideStall` from
the IO), generalizing it fleet-wide. `reap()` mirrors the reconcile-steward
shape already proven engine-agnostic in `reconcile-stuck-runs.ts`. Worst-status
health rollup matches standard SRE composite-health convention (a single down
component fails the aggregate; unobserved ≠ healthy).
