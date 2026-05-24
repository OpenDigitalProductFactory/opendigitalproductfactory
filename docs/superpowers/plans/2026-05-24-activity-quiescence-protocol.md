# Activity Quiescence Protocol — Implementation Plan

> **For agentic workers:** Implementation flows through **Build Studio** per `feedback_build_studio_for_all_development.md` ("Standing rule since 2026-05-17: file BI → promote → approve Ideate → let BS run. Claude never writes feature code directly."). This plan is a **Build Studio handoff sequencing artifact**, NOT a Claude-executable TDD task list. Each BI below becomes a Build Studio brief; the BS pipeline produces the actual TDD work.

**Goal:** Land the per-surface drain protocol from [`docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md`](../specs/2026-05-24-activity-quiescence-protocol-design.md) across 8 Build Studio shipments, unblocking parent Phase 5 of the [governed upgrade lifecycle](../specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md).

**Architecture:** A `QuiescenceRun` entity + dedicated Inngest function orchestrates a three-level (`normal`/`draining`/`swapping`) drain across 30 concurrent active surfaces. Each surface gets a stop-accept primitive (entry-point gate or Inngest step gate); the coordinator waits for natural checkpoints with per-surface budgets; clients receive an SSE `system:quiescence` event and version-header bundle-mismatch fallback for soft reload after swap.

**Tech Stack:** Next.js 15 middleware, Inngest functions + `step.waitForEvent`, Prisma migrations (additive), PostgreSQL, SSE via `agentEventBus`, existing BI-4ab6be39 heartbeat substrate, existing `taskrun-recovery` per-phase Retry strategies.

## Cross-spec context

- **Parent dependency**: parent spec §5.5 currently sketches a 17-step drain protocol; this work *replaces* that section. After Phase 1 of this plan lands, a separate cleanup BI updates parent §5.5 to reference this spec.
- **Spec §9 decomposition** is the source of truth for BI scope; this plan reorders for sequencing and adds Build-Studio-actionable acceptance criteria per BI.
- **Standing rule**: do NOT bypass Build Studio for the implementation BIs themselves. The spec write and plan write are the operator-acknowledged exceptions ("BS optimization is its own concern").

## Open questions to settle BEFORE filing the affected BIs

The spec ships with 5 open operator decisions in §12. Each blocks one or more BIs. Settle these in a single operator review session (~15–30 min) before the relevant BI is filed:

| Open question | Default | Blocks |
|---|---|---|
| §12 Q1 — default budgets per regime (60s/5min/per-tool max) | Confirm defaults | BI-QUIESCE-002 |
| §12 Q2 — auto-resume vs operator-gated for `paused-for-upgrade` coworkers | Operator-gated v1 | BI-QUIESCE-005 + BI-QUIESCE-006 |
| §12 Q3 — `TOOL_WAIT_BUDGETS` registry maintenance ownership | CI lint requires entry at MCP tool registration | BI-QUIESCE-005 |
| §12 Q4 — Phase 1 vs Phase 2 client-side cut line | v1 = middleware + banner + event; Phase 2 = action gate + resilient EventSource | BI-QUIESCE-006 (scope) + BI-QUIESCE-008 (existence) |
| §12 Q5 — `system:quiescence` event for manual quiescence too? | Yes — same event | BI-QUIESCE-006 |

Operator-settled defaults are written into the spec as concrete decisions before BI filing; the Build Studio Ideate phase doesn't re-litigate them.

## Sequencing overview

```
Phase 1 (blocking):       BI-QUIESCE-001  (schema foundation — everything depends on this)
Phase 2 (parallel after 001 lands):
                           BI-QUIESCE-002  (coordinator)
                           BI-QUIESCE-003  (request-layer gate)
                           BI-QUIESCE-004a (Inngest cron wraps)
                           BI-QUIESCE-005  (entry-point gates + tool registry)
                           BI-QUIESCE-006  (client-side v1)
Phase 3 (after 002 lands): BI-QUIESCE-004b (event-driven Inngest gates)
                           BI-QUIESCE-007  (watchdog extension)
Phase 4 (post-v1):         BI-QUIESCE-008  (resilient EventSource + form gate)
Phase 5 (follow-up):       parent-§5.5-update BI (separate spec edit)
```

Phase 2 parallelism is real — none of 002/003/004a/005/006 depend on each other, only on 001's schema. Five Build Studio briefs can run concurrently. The coordinator (002) is the keystone integration consumer of the others; 003/004a/005/006 are independently testable surfaces.

## Per-BI Build Studio brief content

The following sections are the exact content to file into each Build Studio backlog item. Each follows the standard DPF BI template (Problem / Scope / Acceptance for Ideate / References).

---

### BI-QUIESCE-001 — Schema foundation

**Title**: Activity Quiescence schema — `QuiescenceRun` table + TaskRun status values + watchdog regression

**Prerequisites**: spec PR #1093 merged

**Problem**: The Activity Quiescence Protocol (spec ref above, §5.1, §5.2) needs a persistent audit substrate (`QuiescenceRun`) and three new `TaskRun.status` values (`quiescing`, `paused-for-upgrade`, `paused-for-upgrade-forced`) plus a `quiescedAt` timestamp. The existing watchdog at `apps/web/lib/queue/functions/taskrun-watchdog.ts:60` filters `status IN ('working', 'active')` — the new values are intentionally NOT in that filter (per spec §5.7), but a regression test must lock that assumption down so a future refactor doesn't break it.

**Scope**:

- Add `QuiescenceRun` model to `packages/db/prisma/schema.prisma` (exact shape from spec §5.1).
- Add `quiescedAt DateTime?` to `TaskRun` model.
- Generate Prisma migration (additive only — no destructive changes).
- Add the three new status values to whatever status-value documentation/constants exist in the codebase (search for existing TaskRun.status enum patterns; reuse).
- Watchdog regression test: confirm `quiescing` / `paused-for-upgrade` / `paused-for-upgrade-forced` rows do NOT appear in `taskrunWatchdog` candidate scan results.

**Acceptance for Ideate**:
- Migration file exists at `packages/db/prisma/migrations/YYYYMMDDHHMMSS_quiescence_run/migration.sql`
- Migration is additive (no DROP, no ALTER … NOT NULL on existing rows without defaults)
- Existing `taskrun-watchdog.test.ts` extended with a test that creates TaskRuns in each of the 3 new statuses and asserts the SQL filter doesn't return them
- Prisma client regenerates cleanly (`pnpm db:generate`)
- No downstream typecheck errors (`pnpm typecheck`)

**Test gates**:
- `pnpm test apps/web/lib/queue/functions/taskrun-watchdog.test.ts` passes including new cases
- `pnpm test packages/db/` passes
- No regression in any existing TaskRun consumer (codebase grep for `status === "working"` / `status === "active"` should not need changes — new values are NOT aliases)

**Files**:
- Modify: `packages/db/prisma/schema.prisma` (add model + field)
- Create: `packages/db/prisma/migrations/<ts>_quiescence_run/migration.sql`
- Modify: `apps/web/lib/queue/functions/taskrun-watchdog.test.ts` (extend)
- Possibly create: `apps/web/lib/observability/taskrun-statuses.ts` if no existing enum location

---

### BI-QUIESCE-002 — Coordinator

**Title**: Quiescence coordinator — `quiescence-run.ts` Inngest function + `quiescence.ts` caller API

**Prerequisites**: BI-QUIESCE-001 merged; §12 Q1 (default budgets) settled

**Problem**: The Activity Quiescence Protocol (spec §5.3, §5.4) requires an orchestration entity that drains surfaces in dependency order, captures evidence at each transition, and signals "ready to swap" to its caller via Inngest events. Today no such function exists; `runSelfUpgrade` directly consults `getPortalActivity()` and proceeds or skips with no per-surface evidence.

**Scope**:

- Create `apps/web/lib/queue/functions/quiescence-run.ts` implementing the function in spec §5.3 (full code is in the spec — implementer follows it).
- Create `apps/web/lib/self-upgrade/quiescence.ts` as sibling to `activity.ts` exposing the API in spec §5.4 (`getQuiescenceLevel`, `startQuiescence`, `signalSwapComplete`, `abortQuiescence`).
- State-machine helpers: `transitionState(runId, status, patches?)`, `setQuiescenceLevel(level)`, `captureActiveSessionBlockers()`, `flipActiveTaskRunsToQuiescing()`, `heartbeatQuiescenceRun(runId)`, `pickPrimaryBlocker(snapshot)`.
- The `captureActiveSessionBlockers` implementation is the load-bearing one — it queries every surface category enumerated in spec §6 and returns the `ActiveSessionBlockers` shape from spec §5.6. Reference the seven-class taxonomy.
- Register the new function in `apps/web/lib/queue/functions/index.ts` (existing registration pattern).
- `getQuiescenceLevel` reads `PlatformConfig["portal.quiescence"]` with 1s TTL cache; hot path, <1ms p99. Pattern matches `getSelfUpgradeConfig` at `apps/web/lib/self-upgrade/config.ts:47`.

**Acceptance for Ideate**:
- Function registers and appears in Inngest dashboard
- Unit tests cover state-machine transitions (pending → preparing → draining → ready-to-swap → swapping → completed AND the deferred / aborted / failed branches)
- Integration test: triggers `ops/quiescence.start`, asserts `PlatformConfig["portal.quiescence"]` flips and `system:quiescence` event would be emitted (mock the broadcast)
- API surface compiles: callers can `await startQuiescence(...)` and get a typed `awaitReady()` result
- **Does NOT yet integrate with `runSelfUpgrade`** — that's BI-QUIESCE-005 / a follow-up integration BI to scope separately if needed

**Test gates**:
- `pnpm test apps/web/lib/queue/functions/quiescence-run.test.ts`
- `pnpm test apps/web/lib/self-upgrade/quiescence.test.ts`
- Coordinator timeout is `60m` not `30m` (per spec §5.7)
- All three terminal transitions emit `platform.quiescence-cleared` (the critical invariant from spec §5.2)
- `triggerRefId` is propagated on all three cleared-event emissions

**Files**:
- Create: `apps/web/lib/queue/functions/quiescence-run.ts`
- Create: `apps/web/lib/queue/functions/quiescence-run.test.ts`
- Create: `apps/web/lib/self-upgrade/quiescence.ts`
- Create: `apps/web/lib/self-upgrade/quiescence.test.ts`
- Modify: `apps/web/lib/queue/functions/index.ts` (register function)

---

### BI-QUIESCE-003 — Request-layer gate

**Title**: Quiescence middleware — `apps/web/middleware.ts` + version-header injection

**Prerequisites**: BI-QUIESCE-001 merged (for `getQuiescenceLevel` to read against meaningful state in tests)

**Problem**: No `apps/web/middleware.ts` exists today. The Activity Quiescence Protocol (spec §6.4, §7.2) requires every response to carry `X-Platform-Version` and `X-Bundle-Hash` headers, and new server actions / mutation POSTs / SSE handshakes must be refused with 503 during `draining` and `swapping` levels.

**Scope**:

- Create `apps/web/middleware.ts` per spec §6.4 (full code in spec including header injection on 503 responses).
- Boot-time version read: load `version.json` (parent-spec deliverable; fall back to `process.env.PORTAL_VERSION ?? "unknown"` until parent ships) and the Next.js build manifest hash; cache in module-level constant.
- Allow-list paths: `/api/v1/edge/*`, `/api/health` — gates skip these.
- Request classifiers: `isServerAction(req)`, `isMutationPOST(req)`, `isNewSSEHandshake(req)` — these need careful implementation; Next.js server actions are POSTs with specific headers (`Next-Action` header). Document the discriminators in code comments.

**Acceptance for Ideate**:
- During `normal` level: all requests pass through; headers attached
- During `draining` level: server actions → 503 with `Retry-After: 30`; GETs pass
- During `swapping` level: only edge + health pass; everything else 503
- Headers present on BOTH 503 responses and successful responses
- Allow-listed paths never see 503 regardless of level
- E2E test: flip `PlatformConfig["portal.quiescence"]` to `draining`, fire a server-action POST, assert 503 + Retry-After header

**Test gates**:
- `pnpm test apps/web/middleware.test.ts`
- Manual smoke: dogfooding session sets quiescence to draining via DB, verifies banner-less behavior (banner is BI-QUIESCE-006) — operator action returns 503

**Files**:
- Create: `apps/web/middleware.ts`
- Create: `apps/web/middleware.test.ts`
- Possibly modify: `apps/web/next.config.ts` if middleware matcher config needed

---

### BI-QUIESCE-004a — Inngest cron wraps

**Title**: Inngest quiescence gate helpers + wrap 12 cron functions

**Prerequisites**: BI-QUIESCE-002 merged (for `getQuiescenceLevel` API)

**Problem**: Per spec §6.1, all 12 Inngest cron functions must check `getQuiescenceLevel()` at function entry and skip-and-reschedule if level ≥ `draining`. Self-upgrade scheduled + manual are exempted (they're the callers of quiescence). Today every cron runs unconditionally.

**Scope**:

- Add `gateAtEntry(step)` helper to `apps/web/lib/queue/inngest-client.ts`. Returns `{ skipped: true, reason: "quiescing" }` early if level ≥ `draining`.
- Wrap all 12 cron functions in `apps/web/lib/queue/functions/` with `gateAtEntry` as first call:
  - agent-task-dispatch, taskrun-watchdog, discovery-poll (prometheusPoll + fullDiscoverySweep), code-graph-reconcile, issue-report-triage, wiki-lint, skill-curator, skill-metrics-aggregator, token-expiry-monitor, governed-backlog-tee-up, postgres-daily-backup, infra-prune, model-discovery-refresh
- **Exempt**: `selfUpgradeScheduled` at `apps/web/lib/queue/functions/self-upgrade.ts:95` (would deadlock).

**Acceptance for Ideate**:
- Each wrapped cron function has a unit test asserting it skips when level ≥ draining
- Each test confirms the skipped function returns the standard `{ skipped: true, reason: "quiescing" }` shape
- No cron function is missed (12 cron files; test count matches)
- `selfUpgradeScheduled` explicitly NOT wrapped (verify via test that asserts it does NOT consult `getQuiescenceLevel`)

**Test gates**:
- `pnpm test apps/web/lib/queue/functions/` (whole directory)
- Manual: trigger taskrun-watchdog while quiescence is draining; observe skip in Inngest dashboard

**Files**:
- Modify: `apps/web/lib/queue/inngest-client.ts` (add `gateAtEntry`)
- Modify: each of the 12 cron files (1-line gate call)
- Modify: each of the 12 corresponding `.test.ts` files (1 new test case)

---

### BI-QUIESCE-004b — Event-driven Inngest gates

**Title**: Inngest `gateBetweenSteps` helper + event-driven function wraps

**Prerequisites**: BI-QUIESCE-002 + BI-QUIESCE-004a merged

**Problem**: Per spec §6.1, event-driven Inngest functions (5 total) must call `step.waitForEvent("platform.quiescence-cleared", { timeout: "30m" })` between major steps to suspend cleanly during drain. Per-function judgment is needed on where the major-step boundaries lie.

**Scope**:

- Add `gateBetweenSteps(step)` helper to `apps/web/lib/queue/inngest-client.ts`. Wraps `step.waitForEvent` with a level check (skip if `normal`).
- Wrap 5 event-driven functions, choosing step boundaries per-function:
  - `selfUpgradeManual` — EXEMPT (caller).
  - `eval-background.ts` (ai/eval.run) — gate between dimensions if multi-dimension; otherwise at top.
  - `eval-background.ts` (ai/probe.run) — gate at top.
  - `mcp-catalog-sync.ts` (ops/mcp-catalog.sync) — gate at top; sync is marked `killable: false` so once started it should complete.
  - `deliberation-run.ts` — gate between branch dispatches (per spec §6.1 example).
- The `mcp-catalog-sync` case is the trickiest — it's `killable: false` per spec §6.3 (sync is mid-upsert). Decision: gate at top (refuse new syncs) but don't suspend a running one. Document this in the function header.

**Acceptance for Ideate**:
- Each wrapped function has a unit test asserting it suspends at step boundary when quiescence is draining
- `mcp-catalog-sync` test confirms in-flight sync runs to completion even when level flips
- `selfUpgradeManual` test confirms it does NOT gate (caller exempt)

**Test gates**:
- Same as 004a but for the 5 event-driven files
- Integration test: trigger `ai/eval.run` then start quiescence; observe function suspension; emit `platform.quiescence-cleared`; observe resumption

**Files**:
- Modify: `apps/web/lib/queue/inngest-client.ts` (add `gateBetweenSteps`)
- Modify: 4 event-driven function files (gate insertion + per-function judgment notes)

---

### BI-QUIESCE-005 — Per-entry-point gates + tool registry

**Title**: Quiescence entry-point guards + `TOOL_WAIT_BUDGETS` registry + coworker status-flip

**Prerequisites**: BI-QUIESCE-001 merged; §12 Q2 (auto-resume policy) + §12 Q3 (registry maintenance) settled

**Problem**: Per spec §6.2, §6.5, §6.6, four entry points must check `getQuiescenceLevel()` and refuse new work when level ≥ `draining`. The coworker loop additionally needs the coordinator to be able to flip `TaskRun.status` to `quiescing` (the cooperative-cancel mechanism reusing BI-4ab6be39 heartbeat). MCP tools need a central wait-budget registry so the coordinator can predict drain time.

**Scope**:

- Add `QuiescingError` class to `apps/web/lib/self-upgrade/quiescence.ts` (extends `Error`, carries 503 + Retry-After hint).
- Gate insertions (one-line check throwing `QuiescingError`):
  - `spawnWorkThread()` at `apps/web/lib/actions/agent-threads.ts:27`
  - `startBuildPhaseRun()` at `apps/web/lib/integrate/build-phase-run.ts:30`
  - `sandboxPool.acquire()` — locate exact path (search `apps/web/lib/integrate/sandbox/`)
  - `callBrowserUse()` at `apps/web/lib/operate/browser-use-client.ts:21`
- Caller handling: each call site catches `QuiescingError` and translates to 503 response or operator-visible "Platform upgrading, try again" message.
- Coworker loop integration: the coordinator's `flipActiveTaskRunsToQuiescing()` (from BI-QUIESCE-002) writes `UPDATE TaskRun SET status='quiescing', quiescedAt=NOW() WHERE status IN ('working','active')`. The existing `heartbeat()` at `apps/web/lib/observability/heartbeat.ts:23` already returns `false` when status leaves working/active — no loop code change needed; cooperative cancel fires automatically.
- After-loop terminal state: when a loop exits via heartbeat-returns-false, the loop's outer handler should write `status='paused-for-upgrade'` (cooperative) — needs a small addition to the loop epilogue at the executeAgentThread call site. (`paused-for-upgrade-forced` is written by `agentEventBus.requestCancel` path used by the coordinator's force-cancel logic.)
- Create `apps/web/lib/mcp/tool-timeouts.ts` with the `TOOL_WAIT_BUDGETS` registry per spec §6.6.
- CI lint (or build-time check): if §12 Q3 default is adopted, add a check that every registered MCP tool has a `TOOL_WAIT_BUDGETS` entry.

**Acceptance for Ideate**:
- 4 entry-point unit tests assert each throws `QuiescingError` when level ≥ draining
- Coworker loop test: flip TaskRun to `quiescing`; observe loop exits at next heartbeat boundary with `status='paused-for-upgrade'`
- Coworker loop test: invoke `agentEventBus.requestCancel`; observe loop exits with `status='paused-for-upgrade-forced'`
- Registry has entries for every currently-registered MCP tool (count match)
- CI lint (if adopted): fails on PR that adds a new MCP tool without registry entry

**Test gates**:
- `pnpm test` for each gated file + new tool-timeouts test
- E2E: enable quiescence, attempt to start a build via UI, observe 503 + operator message

**Files**:
- Modify: `apps/web/lib/self-upgrade/quiescence.ts` (add `QuiescingError`)
- Modify: `apps/web/lib/actions/agent-threads.ts` (gate)
- Modify: `apps/web/lib/integrate/build-phase-run.ts` (gate)
- Modify: sandbox pool file (gate)
- Modify: `apps/web/lib/operate/browser-use-client.ts` (gate)
- Create: `apps/web/lib/mcp/tool-timeouts.ts`
- Create: `apps/web/lib/mcp/tool-timeouts.test.ts`
- Possibly modify: CI lint script for registry coverage

---

### BI-QUIESCE-006 — Client-side v1

**Title**: `system:quiescence` SSE event + `<PlatformBanner />` + bundle-hash soft reload

**Prerequisites**: BI-QUIESCE-002 + BI-QUIESCE-003 merged; §12 Q2 + §12 Q4 + §12 Q5 settled

**Problem**: Per spec §7, clients need three things: receive `system:quiescence` events on existing SSE subscriptions, render a banner state machine reflecting protocol state, and detect bundle-hash mismatch to trigger soft reload after the swap.

**Scope**:

- Add `system:quiescence` event variant to `AgentEvent` union at `apps/web/lib/tak/agent-event-bus.ts:7` (exact shape from spec §7.1).
- Add `broadcastSystem(event)` primitive to `apps/web/lib/tak/agent-event-bus.ts` — iterates every subscriber Set, emits the event regardless of threadId keying.
- Inject `window.__DPF_BOOT__ = { version, bundleHash }` script in root layout at `apps/web/app/layout.tsx`.
- Create `apps/web/components/platform/PlatformBanner.tsx` implementing the banner state machine from spec §7.3 (hidden → preparing → swapping → reconnecting → hidden; alternate deferred-or-aborted path).
- Create `apps/web/components/platform/PlatformBannerProvider.tsx` wrapping root layout; subscribes to SSE for `system:quiescence` events.
- Bundle-hash detector: global fetch interceptor or response-header inspector that compares to boot values and triggers soft reload on mismatch.
- Soft reload: `window.location.reload()` after 1s grace per spec §7.3.
- §12 Q5 default (yes — banner fires for manual too) means the banner doesn't filter by trigger.

**Acceptance for Ideate**:
- Banner appears when `system:quiescence` (level=draining) received via any open SSE
- Banner transitions to `swapping` text on second event
- Banner triggers soft reload on bundle-hash mismatch
- 5 existing SSE consumers (AgentCoworkerPanel, BuildStudio, BrandExtractionSection, McpSyncButton, agent stream route) receive the event without modification
- Deferred-or-aborted state shows defer reason + auto-dismisses after 60s
- E2E test: start quiescence, observe banner, signal swap-complete with bundle-hash mismatch, observe reload

**Test gates**:
- `pnpm test apps/web/lib/tak/agent-event-bus.test.ts` (broadcast primitive)
- `pnpm test apps/web/components/platform/PlatformBanner.test.tsx`
- Manual dogfooding: trigger quiescence, observe banner across multiple open tabs

**Out of scope for v1** (per §12 Q4 default): `usePlatformReady()` client-side action gate, `useResilientEventSource()` reconnect hook. These ship in BI-QUIESCE-008.

**Files**:
- Modify: `apps/web/lib/tak/agent-event-bus.ts` (event variant + broadcast)
- Modify: `apps/web/lib/tak/agent-event-bus.test.ts`
- Modify: `apps/web/app/layout.tsx` (boot injection)
- Create: `apps/web/components/platform/PlatformBanner.tsx`
- Create: `apps/web/components/platform/PlatformBanner.test.tsx`
- Create: `apps/web/components/platform/PlatformBannerProvider.tsx`
- Create: `apps/web/lib/hooks/useBundleHashDetector.ts`

---

### BI-QUIESCE-007 — Watchdog extension

**Title**: Stuck-coordinator detection — extend `taskrunWatchdog`

**Prerequisites**: BI-QUIESCE-002 merged

**Problem**: Per spec §5.7, a coordinator crash mid-drain leaves `QuiescenceRun` in `draining` indefinitely with stale `lastHeartbeatAt`. The existing `taskrunWatchdog` cron at `apps/web/lib/queue/functions/taskrun-watchdog.ts:24` runs every minute and is the natural place to detect this.

**Scope**:

- Extend `taskrunWatchdog` to also query `QuiescenceRun WHERE status NOT IN (terminal) AND lastHeartbeatAt < now - 2min`.
- For each stuck row: transition to `failed`, force `setQuiescenceLevel("normal")`, emit `platform.quiescence-cleared` with `outcome: "failed"`.
- The transition uses the same helpers from BI-QUIESCE-002 to avoid duplication.

**Acceptance for Ideate**:
- Test: insert a `QuiescenceRun` in `draining` with `lastHeartbeatAt` 3min stale; run watchdog tick; assert row is `failed`, level is `normal`, event emitted.
- Test: `QuiescenceRun` in terminal state with stale heartbeat is NOT touched.
- Test: `QuiescenceRun` in `draining` with fresh heartbeat (30s stale) is NOT touched.

**Test gates**:
- `pnpm test apps/web/lib/queue/functions/taskrun-watchdog.test.ts` (extended)

**Files**:
- Modify: `apps/web/lib/queue/functions/taskrun-watchdog.ts`
- Modify: `apps/web/lib/queue/functions/taskrun-watchdog.test.ts`

---

### BI-QUIESCE-008 — Phase 2 client-side (post-v1)

**Title**: `usePlatformReady()` action gate + `useResilientEventSource()` migration

**Prerequisites**: BI-QUIESCE-006 merged + v1 deployed and operator-confirmed working

**Problem**: Per spec §7.4 + §7.5, v1 lets users *try* server actions during drain and get 503s; better UX disables buttons / refuses clicks upfront. Also v1 relies on raw EventSource reconnect which has no minimum-delay floor and no stale-bundle check on reconnect.

**Scope**:

- Create `usePlatformReady()` hook at `apps/web/lib/hooks/usePlatformReady.ts` reading from `PlatformBannerProvider` context.
- Apply Pattern 1 (disable buttons) on highest-traffic forms: coworker panel, build settings, prompt editor. Discovery exercise required to enumerate.
- Create `useResilientEventSource()` hook at `apps/web/lib/hooks/useResilientEventSource.ts` with: (a) 5s minimum reconnect delay, (b) `Retry-After` respect, (c) stale-bundle check on successful reconnect.
- Migrate 5 existing EventSource consumers to use the new hook (one PR per consumer or grouped — operator choice).

**Acceptance for Ideate**:
- `usePlatformReady` tests cover normal / draining / swapping states
- Disabled-button UX test: during draining, buttons disabled with tooltip
- `useResilientEventSource` test: simulates reconnect storm, asserts ≥5s spacing
- All 5 existing consumers migrated; no regression in baseline SSE behavior

**Test gates**:
- `pnpm test apps/web/lib/hooks/`
- Manual: open 5 portal tabs, trigger quiescence, observe coordinated banner + no reconnect storm

**Files**:
- Create: `apps/web/lib/hooks/usePlatformReady.ts`
- Create: `apps/web/lib/hooks/usePlatformReady.test.ts`
- Create: `apps/web/lib/hooks/useResilientEventSource.ts`
- Create: `apps/web/lib/hooks/useResilientEventSource.test.ts`
- Modify: 5 SSE consumer files
- Modify: high-traffic forms (TBD by discovery)

---

### Parent-§5.5-update follow-up

**Title**: Update parent governed-upgrade spec §5.5 to reference quiescence spec

**Prerequisites**: BI-QUIESCE-002 merged (substitution code path real)

**Problem**: Parent spec [`2026-05-23-governed-platform-upgrade-lifecycle-design.md`](../specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md) §5.5 currently sketches a 17-step drain protocol. After this work lands, §5.5 should be rewritten to delegate to the quiescence spec and keep only swap-specific steps (L1/L2/L3/L4 apply, smoke window, rollback).

**Scope**: spec text edit only — no code.

**Acceptance**: §5.5 §8 substitution table from quiescence spec is the canonical reference.

**Files**:
- Modify: `docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md` §5.5

---

## Operator kick sequence (recommended)

1. **Settle the 5 open questions** in spec §12 — single review session, write decisions into the spec as concrete defaults. Estimated 15–30 min operator time.
2. **File BI-QUIESCE-001 into Build Studio** via `/admin/backlog` → promote to Ideate → approve Ideate plan → let BS run. Schema work is contained and reviewable in one BS cycle. Estimated 1 BS cycle (~hours).
3. **After 001 PR lands**: file 002, 003, 004a, 005, 006 in parallel into BS. Five concurrent BS cycles. Operator reviews each at gate handoffs per existing BS pipeline.
4. **After 002 PR lands**: file 004b and 007 (both depend on coordinator API).
5. **Verify v1 working in dogfooding** before filing 008. Manual quiescence trigger from `/ops/quiescence` (or whatever surface 006 lands); observe banner; verify no broken SSE; verify operator can defer cleanly.
6. **File 008** (Phase 2 client-side) and the parent-§5.5-update BI in parallel.

## Risks and watchpoints

- **The wrap-12-crons scope in 004a is broad but mechanical.** If a single cron fails the gate test, fix in same PR; don't fragment.
- **The `captureActiveSessionBlockers` implementation in 002 is the most complex single function in the protocol.** It queries 7 detection classes across many tables. Worth a code-review pass focused specifically on this function.
- **The middleware in 003 is request-path-critical.** A bug here breaks every request. The 503 path needs to be tested with realistic Next.js server-action POST shape (`Next-Action` header discrimination).
- **The coworker loop status-flip in 005 reuses BI-4ab6be39 heartbeat machinery.** Critical that the heartbeat continues to return `false` for `quiescing` — locked down by the watchdog regression test in 001.
- **The 5 open questions are real blockers.** Don't file affected BIs without settling them; BS Ideate phase will surface them and re-ask, costing a cycle.

## References

- Spec: [`docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md`](../specs/2026-05-24-activity-quiescence-protocol-design.md)
- Parent spec: [`docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md`](../specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md) §5.5 (replaced) and §5.2.1 (Layer 1 evidence shape consumed)
- Live BIs: [BI-40F05BAC](http://localhost:3000/admin/backlog/BI-40F05BAC) (research; parent of QUIESCE-00X); [BI-5B3FA415](http://localhost:3000/admin/backlog/BI-5B3FA415) (governed upgrade lifecycle parent)
- Standing rule: `feedback_build_studio_for_all_development.md` — Build Studio for all feature work
- Spec-commit-plan process: `feedback_spec_commit_plan_process.md` — approved spec → main + writing-plans, no asking between steps
