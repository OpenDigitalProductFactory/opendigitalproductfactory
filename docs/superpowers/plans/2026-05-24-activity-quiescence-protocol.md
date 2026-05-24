# Activity Quiescence Protocol — Implementation Plan

> **For agentic workers:** Implementation flows through **Build Studio** per `feedback_build_studio_for_all_development.md` ("Standing rule since 2026-05-17: file BI → promote → approve Ideate → let BS run. Claude never writes feature code directly."). This plan is a **Build Studio handoff sequencing artifact**, NOT a Claude-executable TDD task list. Each BI below becomes a Build Studio brief; the BS pipeline produces the actual TDD work.

**Goal:** Land the per-surface drain protocol from [`docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md`](../specs/2026-05-24-activity-quiescence-protocol-design.md) across 10 Build Studio shipments, unblocking parent Phase 5 of the [governed upgrade lifecycle](../specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md).

**Architecture:** A `QuiescenceRun` entity + dedicated Inngest function orchestrates a three-level (`normal`/`draining`/`swapping`) drain across 30 concurrent active surfaces. Each surface gets a stop-accept primitive (entry-point gate or Inngest step gate); the coordinator waits for natural checkpoints with per-surface budgets; clients receive an SSE `system:quiescence` event and version-header bundle-mismatch fallback for soft reload after swap.

**Tech Stack:** Next.js 16 Proxy (`apps/web/proxy.ts`) + an excluded Node state route, Inngest functions + `step.waitForEvent`, Prisma migrations (additive), PostgreSQL, SSE via `agentEventBus` plus a global platform event stream, existing BI-4ab6be39 heartbeat substrate, existing `taskrun-recovery` per-phase Retry strategies.

## Cross-spec context

- **Parent dependency**: parent spec §5.5 currently sketches a 17-step drain protocol; this work *replaces* that section. After BI-QUIESCE-010 lands and the self-upgrade substitution path is real, a separate cleanup BI updates parent §5.5 to reference this spec.
- **Spec §9 decomposition** is the source of truth for BI scope; this plan reorders for sequencing, adds Build-Studio-actionable acceptance criteria per BI, and makes the self-upgrade integration slice explicit so acceptance criterion #1 has a home.
- **Standing rule**: do NOT bypass Build Studio for the implementation BIs themselves. The spec write and plan write are the operator-acknowledged exceptions ("BS optimization is its own concern").

## Open questions to settle BEFORE filing the affected BIs

The spec ships with 6 open operator decisions in §12. Each blocks one or more BIs. Settle these in a single operator review session (~15–30 min) before the relevant BI is filed:

| Open question | Default | Blocks |
|---|---|---|
| §12 Q1 — default budgets per regime (60s/5min/per-tool max) | Confirm defaults | BI-QUIESCE-002 |
| §12 Q2 — auto-resume vs operator-gated for `paused-for-upgrade` coworkers | Operator-gated v1 | BI-QUIESCE-005 + BI-QUIESCE-006 |
| §12 Q3 — `TOOL_WAIT_BUDGETS` registry maintenance ownership | CI lint requires entry at MCP tool registration | BI-QUIESCE-005 |
| §12 Q4 — Phase 1 vs Phase 2 client-side cut line | v1 = Proxy + Node state route + global banner stream + resilient EventSource migration; Phase 2 = broad action gate | BI-QUIESCE-006 + BI-QUIESCE-008 + BI-QUIESCE-009 |
| §12 Q5 — `system:quiescence` event for manual quiescence too? | Yes — same event | BI-QUIESCE-006 |
| §12 Q6 — Proxy fail-open/fail-closed policy on state-route timeout | Fail open for GET; preserve last known non-normal state for mutation POSTs | BI-QUIESCE-003 |

Operator-settled defaults are written into the spec as concrete decisions before BI filing; the Build Studio Ideate phase doesn't re-litigate them.

## Sequencing overview

```
Phase 1 (blocking):        BI-QUIESCE-001  (schema foundation)
Phase 2 (blocking):        BI-QUIESCE-002  (coordinator + caller API)
Phase 3 (parallel after 002):
                            BI-QUIESCE-003  (Proxy + Node state route)
                            BI-QUIESCE-004a (Inngest cron wraps)
                            BI-QUIESCE-005  (entry-point gates + tool registry)
Phase 4 (after 002/003):    BI-QUIESCE-006  (global banner stream + boot headers)
                            BI-QUIESCE-007  (watchdog extension)
Phase 5 (hardening):        BI-QUIESCE-004b (event-driven Inngest gates)
                            BI-QUIESCE-008  (resilient EventSource migration)
Phase 6 (integration):      BI-QUIESCE-010  (self-upgrade handshake + boot reconcile)
Phase 7 (Phase 2 UX):       BI-QUIESCE-009  (broad action gate)
Phase 8 (follow-up):        parent-§5.5-update BI (separate spec edit)
```

The key sequencing constraint is that request, cron, entry-point, client, watchdog, and self-upgrade work all consume the coordinator API from BI-QUIESCE-002. After 002, 003/004a/005 can run in parallel; 006 depends on the request-layer/header contract from 003; 008 depends on 006's global stream; and 010 should wait until the drain, gates, watchdog, and direct EventSource consumers are all in place.

## Per-BI Build Studio brief content

The following sections are the exact content to file into each Build Studio backlog item. Each follows the standard DPF BI template (Problem / Scope / Acceptance for Ideate / References).

---

### BI-QUIESCE-001 — Schema foundation

**Title**: Activity Quiescence schema — `QuiescenceRun` table + TaskRun status values + watchdog regression

**Prerequisites**: spec PR #1093 merged

**Problem**: The Activity Quiescence Protocol (spec ref above, §5.1, §5.2) needs a persistent audit substrate (`QuiescenceRun`) and three new `TaskRun.status` values (`quiescing`, `paused-for-upgrade`, `paused-for-upgrade-forced`) plus a `quiescedAt` timestamp. The existing watchdog at `apps/web/lib/queue/functions/taskrun-watchdog.ts` filters active task runs; the new values are intentionally NOT active-work values, but a regression test must lock that assumption down so a future refactor doesn't break it.

**Scope**:

- Add `QuiescenceRun` model to `packages/db/prisma/schema.prisma` (exact shape from spec §5.1), including `swapStartedAt`, `swapCompletedAt`, `targetVersion`, `targetBundleHash`, and `completionSource`.
- Add `quiescedAt DateTime?` to `TaskRun` model.
- Generate Prisma migration (additive only — no destructive changes).
- Add the three new status values to whatever status-value documentation/constants exist in the codebase (search for existing TaskRun.status enum patterns; reuse).
- Watchdog regression test: confirm `quiescing` / `paused-for-upgrade` / `paused-for-upgrade-forced` rows do NOT appear in `taskrunWatchdog` stuck-task candidate scan results.

**Acceptance for Ideate**:
- Migration file exists at `packages/db/prisma/migrations/YYYYMMDDHHMMSS_quiescence_run/migration.sql`
- Migration is additive (no DROP, no ALTER … NOT NULL on existing rows without defaults)
- Existing `taskrun-watchdog.test.ts` extended with a test that creates TaskRuns in each of the 3 new statuses and asserts the SQL filter doesn't return them
- Prisma client regenerates cleanly (`pnpm --filter @dpf/db generate`)
- No downstream typecheck errors (`pnpm --filter @dpf/db typecheck` and `pnpm --filter web typecheck`)

**Test gates**:
- `pnpm --filter web test -- apps/web/lib/queue/functions/taskrun-watchdog.test.ts` passes including new cases
- `pnpm --filter @dpf/db test` passes
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
- Create `apps/web/lib/self-upgrade/quiescence.ts` as sibling to `activity.ts` exposing the API in spec §5.4: `getQuiescenceLevel`, `startQuiescence`, `signalSwapStarting`, `signalSwapComplete`, `failQuiescenceSwap`, `abortQuiescence`, and `reconcileQuiescenceOnBoot`.
- State-machine helpers: `transitionState(runId, status, patches?)`, `setQuiescenceLevel(level)`, `captureActiveSessionBlockers()`, `flipActiveTaskRunsToQuiescing()`, `heartbeatQuiescenceRun(runId)`, `pickPrimaryBlocker(snapshot)`, `emitQuiescenceTerminal(...)`.
- The `captureActiveSessionBlockers` implementation is the load-bearing one — it queries every surface category enumerated in spec §6 and returns the `ActiveSessionBlockers` shape from spec §5.6. Reference the seven-class taxonomy.
- Register the new function in `apps/web/lib/queue/functions/index.ts` (existing registration pattern).
- `getQuiescenceLevel` reads `PlatformConfig["portal.quiescence"]` with 1s TTL cache; hot path, <1ms p99. Pattern matches `getSelfUpgradeConfig` at `apps/web/lib/self-upgrade/config.ts:47`.
- `startQuiescence` defaults to `concurrencyMode: "join-active"` and uses a DB transaction/advisory lock so a second caller cannot spawn a second coordinator by race.
- `signalSwapStarting` persists `swapping`, `swapStartedAt`, `targetVersion`, and `targetBundleHash` before the caller starts the promoter; `signalSwapComplete` is best-effort from the old process; `reconcileQuiescenceOnBoot` is the durable completion/failure path after the new process writes its version config.

**Acceptance for Ideate**:
- Function registers and appears in Inngest dashboard
- Unit tests cover state-machine transitions (pending → preparing → draining → ready-to-swap → swapping → completed AND the deferred / aborted / failed branches)
- Integration test: triggers `ops/quiescence.start`, asserts `PlatformConfig["portal.quiescence"]` flips and `system:quiescence` event would be emitted (mock the broadcast)
- API surface compiles: callers can `await startQuiescence(...)` and get a typed `awaitReady()` result
- Concurrency test: two `startQuiescence` calls under `join-active` return the same active run; explicit `queue-after-active` queues without corrupting current state
- **Does NOT yet integrate with `runSelfUpgrade`** — that wiring is BI-QUIESCE-010 so the coordinator can land and be reviewed independently

**Test gates**:
- `pnpm --filter web test -- apps/web/lib/queue/functions/quiescence-run.test.ts`
- `pnpm --filter web test -- apps/web/lib/self-upgrade/quiescence.test.ts`
- Coordinator timeout is `60m` not `30m` (per spec §5.7)
- All terminal transitions emit durable `platform.quiescence-cleared` and UI `system:quiescence(level="cleared")` events (the critical invariant from spec §5.2)
- `triggerRefId` is propagated on every cleared-event emission

**Files**:
- Create: `apps/web/lib/queue/functions/quiescence-run.ts`
- Create: `apps/web/lib/queue/functions/quiescence-run.test.ts`
- Create: `apps/web/lib/self-upgrade/quiescence.ts`
- Create: `apps/web/lib/self-upgrade/quiescence.test.ts`
- Modify: `apps/web/lib/queue/functions/index.ts` (register function)

---

### BI-QUIESCE-003 — Proxy + Node state route

**Title**: Quiescence Proxy extension — existing `apps/web/proxy.ts` + version-header injection + Node state route

**Prerequisites**: BI-QUIESCE-002 merged (for `getQuiescenceLevel` and the state contract)

**Problem**: `apps/web/proxy.ts` already exists and owns canonical-host enforcement, sandbox route blocking, route-class behavior, auth, and `x-pathname`. The Activity Quiescence Protocol (spec §6.4, §7.2) must extend that request-path-critical surface without breaking existing order: every response carries `X-Platform-Version` and `X-Bundle-Hash`, and new server actions / mutation POSTs / SSE handshakes are refused with 503 during `draining` and `swapping` levels.

**Scope**:

- Modify the existing `apps/web/proxy.ts`; do not create `apps/web/middleware.ts`. Next.js 16 calls this surface Proxy, and the repo already migrated to it.
- Preserve current order: canonical host redirect first, sandbox/route classification/auth behavior unchanged, then quiescence gate/header shaping where safe for the response being returned.
- Create `apps/web/app/api/internal/platform/quiescence/state/route.ts` with `export const runtime = "nodejs"` as the Proxy's dynamic state source. This route may read Prisma/PlatformConfig; Proxy may not.
- Exclude the internal state route from Proxy gating/matcher so the Proxy cannot deadlock on its own state fetch.
- Boot-time version read: load `version.json` (parent-spec deliverable; fall back to `process.env.PORTAL_VERSION ?? "unknown"` until parent ships) and the Next.js build manifest hash; cache in module-level constant.
- Allow-list paths: `/api/v1/edge/*`, `/api/health`, the internal quiescence state route, and existing static asset exclusions (`_next/static`, `_next/image`, `favicon.ico`) — gates skip these.
- Implement Edge-safe state fetch/cache: short timeout, 1s cache, no Prisma, no `@dpf/db`, no filesystem APIs, and no Node-only helper imports in `apps/web/proxy.ts`.
- Implement §12 Q6 timeout policy once operator-confirmed: default fail open for GET, preserve last known non-normal state for mutation POSTs.
- Request classifiers: `isServerAction(req)`, `isMutationPOST(req)`, `isNewSSEHandshake(req)` — these need careful implementation; Next.js server actions are POSTs with specific headers (`Next-Action` header). Document the discriminators in code comments.

**Acceptance for Ideate**:
- During `normal` level: all requests pass through; headers attached
- During `draining` level: server actions → 503 with `Retry-After: 30`; GETs pass
- During `swapping` level: only edge + health pass; everything else 503
- Headers present on BOTH 503 responses and successful responses
- Allow-listed paths never see 503 regardless of level
- E2E test: flip `PlatformConfig["portal.quiescence"]` to `draining`, fire a server-action POST, assert 503 + Retry-After header
- Existing `apps/web/proxy.ts` route behavior remains covered: canonical host redirect, public routes, protected API routes, and `x-pathname` still work

**Test gates**:
- `pnpm --filter web test -- apps/web/proxy.test.ts`
- `pnpm --filter web test -- apps/web/app/api/internal/platform/quiescence/state/route.test.ts`
- Manual smoke: dogfooding session sets quiescence to draining through the quiescence API, verifies banner-less behavior (banner is BI-QUIESCE-006) — operator action returns 503

**Files**:
- Modify: `apps/web/proxy.ts`
- Modify/Create: `apps/web/proxy.test.ts`
- Create: `apps/web/app/api/internal/platform/quiescence/state/route.ts`
- Create: `apps/web/app/api/internal/platform/quiescence/state/route.test.ts`

---

### BI-QUIESCE-004a — Inngest cron wraps

**Title**: Inngest quiescence gate helpers + wrap scheduled functions

**Prerequisites**: BI-QUIESCE-002 merged (for `getQuiescenceLevel` API)

**Problem**: Per spec §6.1, scheduled Inngest functions must check `getQuiescenceLevel()` at function entry and skip-and-reschedule if level >= `draining`. Self-upgrade scheduled/manual, the quiescence coordinator, and the stuck-run watchdog path are exempted because they are part of quiescence safety itself. Today most scheduled functions run unconditionally.

**Scope**:

- Add `gateAtEntry(step)` helper to `apps/web/lib/queue/inngest-client.ts`. Returns `{ skipped: true, reason: "quiescing" }` early if level ≥ `draining`.
- Audit `apps/web/lib/queue/functions/index.ts` and every function using an Inngest cron trigger; lock the exact wrapped/exempt list in a test so the plan does not drift as functions are added.
- Wrap scheduled functions in `apps/web/lib/queue/functions/` with `gateAtEntry` as the first call when they are not quiescence-critical:
  - agent-task-dispatch, discovery-poll (prometheusPoll + fullDiscoverySweep), code-graph-reconcile scheduled path, issue-report-triage, wiki-lint, skill-curator, skill-metrics-aggregator, token-expiry-monitor, governed-backlog-tee-up scheduled path, postgres-daily-backup scheduled paths, infra-prune, model-discovery-refresh, rate-recovery, and any other scheduled function discovered by the audit.
- **Exempt**:
  - `selfUpgradeScheduled` and `selfUpgradeManual` at `apps/web/lib/queue/functions/self-upgrade.ts` (callers of quiescence; gating would deadlock).
  - `quiescence-run` once added (the coordinator itself).
  - `taskrunWatchdog` at `apps/web/lib/queue/functions/taskrun-watchdog.ts` because BI-QUIESCE-007 extends it to clear stuck quiescence runs; gating it would remove the safety mechanism.

**Acceptance for Ideate**:
- Each wrapped scheduled function has a unit test asserting it skips when level >= draining
- Each test confirms the skipped function returns the standard `{ skipped: true, reason: "quiescing" }` shape
- No scheduled function is missed: a coverage test enumerates scheduled functions from `allFunctions`/metadata and verifies each is either wrapped or explicitly exempted
- `selfUpgradeScheduled`, `selfUpgradeManual`, `taskrunWatchdog`, and `quiescence-run` are explicitly NOT wrapped (verify via tests that assert they do NOT consult `getQuiescenceLevel` on their safety path)

**Test gates**:
- `pnpm --filter web test -- apps/web/lib/queue/functions/` (whole directory)
- Manual: trigger a non-exempt scheduled function while quiescence is draining; observe skip in Inngest dashboard
- Manual: trigger `taskrunWatchdog` while quiescence is draining; observe that the watchdog still runs

**Files**:
- Modify: `apps/web/lib/queue/inngest-client.ts` (add `gateAtEntry`)
- Modify: each non-exempt scheduled function file (1-line gate call)
- Modify: corresponding `.test.ts` files (1 new test case each)

---

### BI-QUIESCE-004b — Event-driven Inngest gates

**Title**: Inngest `gateBetweenSteps` helper + event-driven function wraps

**Prerequisites**: BI-QUIESCE-002 + BI-QUIESCE-004a merged

**Problem**: Per spec §6.1, event-driven Inngest functions must call `step.waitForEvent("platform.quiescence-cleared", { timeout: "30m" })` between major steps to suspend cleanly during drain. Per-function judgment is needed on where the major-step boundaries lie.

**Scope**:

- Add `gateBetweenSteps(step)` helper to `apps/web/lib/queue/inngest-client.ts`. Wraps `step.waitForEvent("platform.quiescence-cleared", ...)` with a level check (skip if `normal`). This is the durable Inngest wake event; the UI `system:quiescence` event is emitted separately by the coordinator API.
- Wrap event-driven functions, choosing step boundaries per-function and locking the exact wrapped/exempt list in tests:
  - `selfUpgradeManual` — EXEMPT (caller).
  - `quiescence-run` — EXEMPT (coordinator).
  - `eval-background.ts` (ai/eval.run) — gate between dimensions if multi-dimension; otherwise at top.
  - `eval-background.ts` (ai/probe.run) — gate at top.
  - `mcp-catalog-sync.ts` (ops/mcp-catalog.sync) — gate at top; sync is marked `killable: false` so once started it should complete.
  - `deliberation-run.ts` — gate between branch dispatches (per spec §6.1 example).
- The `mcp-catalog-sync` case is the trickiest — it's `killable: false` per spec §6.3 (sync is mid-upsert). Decision: gate at top (refuse new syncs) but don't suspend a running one. Document this in the function header.

**Acceptance for Ideate**:
- Each wrapped function has a unit test asserting it suspends at step boundary when quiescence is draining
- `mcp-catalog-sync` test confirms in-flight sync runs to completion even when level flips
- `selfUpgradeManual` and `quiescence-run` tests confirm they do NOT gate (caller/coordinator exempt)

**Test gates**:
- `pnpm --filter web test -- <event-driven function tests>`
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

- Extend `apps/web/lib/self-upgrade/quiescence.ts` with a `QuiescingError` class if BI-QUIESCE-002 did not already add it (extends `Error`, carries 503 + Retry-After hint).
- Gate insertions (one-line check throwing `QuiescingError`):
  - `spawnWorkThread()` at `apps/web/lib/actions/agent-threads.ts:27`
  - `startBuildPhaseRun()` at `apps/web/lib/integrate/build-phase-run.ts:30`
  - canonical sandbox acquisition seam — discovery required; if no single `sandboxPool.acquire()` equivalent exists, introduce one rather than sprinkling guards across call sites
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
- `pnpm --filter web test -- <each gated test file> apps/web/lib/mcp/tool-timeouts.test.ts`
- E2E: enable quiescence, attempt to start a build via UI, observe 503 + operator message

**Files**:
- Modify: `apps/web/lib/self-upgrade/quiescence.ts` (add `QuiescingError`)
- Modify: `apps/web/lib/actions/agent-threads.ts` (gate)
- Modify: `apps/web/lib/integrate/build-phase-run.ts` (gate)
- Modify/Create: canonical sandbox acquisition file (gate)
- Modify: `apps/web/lib/operate/browser-use-client.ts` (gate)
- Create: `apps/web/lib/mcp/tool-timeouts.ts`
- Create: `apps/web/lib/mcp/tool-timeouts.test.ts`
- Possibly modify: CI lint script for registry coverage

---

### BI-QUIESCE-006 — Global client-side v1

**Title**: Global `system:quiescence` stream + `<PlatformBanner />` + bundle-hash soft reload

**Prerequisites**: BI-QUIESCE-002 + BI-QUIESCE-003 merged; §12 Q2 + §12 Q4 + §12 Q5 settled

**Problem**: Per spec §7, every authenticated shell page needs three things even when no coworker/build-specific SSE stream is open: receive `system:quiescence` events, render a banner state machine reflecting protocol state, and detect bundle-hash mismatch to trigger soft reload after the swap.

**Scope**:

- Add `system:quiescence` event variant to `AgentEvent` union at `apps/web/lib/tak/agent-event-bus.ts:7` (exact shape from spec §7.1).
- Add `broadcastSystem(event)` primitive to `apps/web/lib/tak/agent-event-bus.ts` — iterates every subscriber Set, emits the event regardless of threadId keying.
- Add `subscribeSystem()` primitive and a global `/api/platform/events` SSE route for shell-wide platform events.
- Inject `window.__DPF_BOOT__ = { version, bundleHash }` script in root layout at `apps/web/app/layout.tsx`.
- Create `apps/web/components/platform/PlatformBanner.tsx` implementing the banner state machine from spec §7.3 (hidden → preparing → swapping → reconnecting → hidden; alternate deferred-or-aborted path).
- Create `apps/web/components/platform/PlatformBannerProvider.tsx` and mount it in `apps/web/app/(shell)/layout.tsx` so authenticated shell pages get the operational banner without affecting public/portal surfaces.
- Bundle-hash detector: global fetch interceptor or response-header inspector that compares to boot values and triggers soft reload on mismatch.
- Soft reload: `window.location.reload()` after 1s grace per spec §7.3.
- Styling follows AGENTS.md §12: no hardcoded colors; banner uses DPF CSS variables, compact operational chrome, and does not use marketing-card layout.
- §12 Q5 default (yes — banner fires for manual too) means the banner doesn't filter by trigger.

**Acceptance for Ideate**:
- Banner appears when `system:quiescence` (level=draining) is received via `/api/platform/events`
- Banner transitions to `swapping` text on second event
- Banner triggers soft reload on bundle-hash mismatch
- Shell pages with no coworker/build stream still receive the banner event
- Existing targeted SSE streams remain unchanged until BI-QUIESCE-008 migrates their direct EventSource consumers
- Deferred-or-aborted state shows defer reason + auto-dismisses after 60s
- E2E test: start quiescence, observe banner, signal swap-complete with bundle-hash mismatch, observe reload

**Test gates**:
- `pnpm --filter web test -- apps/web/lib/tak/agent-event-bus.test.ts` (broadcast/subscribe primitive)
- `pnpm --filter web test -- apps/web/components/platform/PlatformBanner.test.tsx`
- `pnpm --filter web test -- apps/web/app/api/platform/events/route.test.ts`
- Manual dogfooding: trigger quiescence, observe banner across multiple open tabs

**Out of scope for this BI** (per §12 Q4 default): direct consumer migration to `useResilientEventSource()` (BI-QUIESCE-008) and broad `usePlatformReady()` client-side action gates (BI-QUIESCE-009).

**Files**:
- Modify: `apps/web/lib/tak/agent-event-bus.ts` (event variant + broadcast)
- Modify: `apps/web/lib/tak/agent-event-bus.test.ts`
- Modify: `apps/web/app/layout.tsx` (boot injection)
- Modify: `apps/web/app/(shell)/layout.tsx` (mount provider)
- Create: `apps/web/app/api/platform/events/route.ts`
- Create: `apps/web/app/api/platform/events/route.test.ts`
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
- For each stuck row: transition to `failed`, force `setQuiescenceLevel("normal")`, and call BI-QUIESCE-002's terminal-event helper so both durable `platform.quiescence-cleared` and UI `system:quiescence(level="cleared")` fire with `outcome: "failed"`.
- The transition uses the same helpers from BI-QUIESCE-002 to avoid duplication.
- Confirm BI-QUIESCE-004a keeps `taskrunWatchdog` exempt from entry gating; otherwise the stuck-run detector cannot execute while the platform is draining.

**Acceptance for Ideate**:
- Test: insert a `QuiescenceRun` in `draining` with `lastHeartbeatAt` 3min stale; run watchdog tick; assert row is `failed`, level is `normal`, event emitted.
- Test: `QuiescenceRun` in terminal state with stale heartbeat is NOT touched.
- Test: `QuiescenceRun` in `draining` with fresh heartbeat (30s stale) is NOT touched.

**Test gates**:
- `pnpm --filter web test -- apps/web/lib/queue/functions/taskrun-watchdog.test.ts` (extended)

**Files**:
- Modify: `apps/web/lib/queue/functions/taskrun-watchdog.ts`
- Modify: `apps/web/lib/queue/functions/taskrun-watchdog.test.ts`

---

### BI-QUIESCE-008 — Resilient EventSource migration

**Title**: `useResilientEventSource()` hook + current direct EventSource consumers

**Prerequisites**: BI-QUIESCE-006 merged + v1 deployed and operator-confirmed working

**Problem**: Per spec §7.5, direct `new EventSource(...)` consumers have inconsistent error behavior. Some close immediately, some rely on browser retry, and none apply the platform's reconnect floor or stale-bundle check. That creates exactly the half-stream UX this protocol is supposed to avoid during a swap.

**Scope**:

- Create `useResilientEventSource()` hook at `apps/web/lib/hooks/useResilientEventSource.ts` with: (a) 5s minimum reconnect delay, (b) `Retry-After` respect, (c) stale-bundle check on successful reconnect.
- Migrate the current direct EventSource consumers discovered during plan review:
  - `apps/web/components/agent/AgentCoworkerPanel.tsx`
  - `apps/web/components/build/BuildStudio.tsx`
  - `apps/web/components/storefront-admin/BrandExtractionSection.tsx`
  - `apps/web/components/platform/McpSyncButton.tsx`
- Migrate `PlatformBannerProvider`'s `/api/platform/events` stream to the same hook if BI-QUIESCE-006 initially used raw EventSource.
- Preserve baseline SSE semantics for each consumer: message parsing, completion handling, abort behavior, and existing recovery polling all remain intact.

**Acceptance for Ideate**:
- `useResilientEventSource` test: simulates reconnect storm, asserts ≥5s spacing
- Hook test respects `Retry-After` when present
- Hook test performs stale-bundle check after reconnect and delegates to the BI-QUIESCE-006 reload primitive
- All current direct EventSource consumers migrated; no regression in baseline SSE behavior

**Test gates**:
- `pnpm --filter web test -- apps/web/lib/hooks/useResilientEventSource.test.ts`
- `pnpm --filter web test -- <migrated component tests>`
- Manual: open multiple portal tabs with coworker/build/integration streams, trigger quiescence, observe coordinated banner + no reconnect storm

**Files**:
- Create: `apps/web/lib/hooks/useResilientEventSource.ts`
- Create: `apps/web/lib/hooks/useResilientEventSource.test.ts`
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`
- Modify: `apps/web/components/build/BuildStudio.tsx`
- Modify: `apps/web/components/storefront-admin/BrandExtractionSection.tsx`
- Modify: `apps/web/components/platform/McpSyncButton.tsx`
- Possibly modify: `apps/web/components/platform/PlatformBannerProvider.tsx`

---

### BI-QUIESCE-009 — Phase 2 action gate

**Title**: `usePlatformReady()` action gate across high-traffic forms

**Prerequisites**: BI-QUIESCE-006 + BI-QUIESCE-008 merged; v1 dogfooding confirms global banner and SSE hardening work

**Problem**: v1 correctly refuses server actions and mutation POSTs during drain, but it still lets users press buttons and then receive a 503. Phase 2 improves operator UX by disabling or intercepting actions before they leave the browser.

**Scope**:

- Create `usePlatformReady()` hook at `apps/web/lib/hooks/usePlatformReady.ts` reading from `PlatformBannerProvider` context if BI-QUIESCE-006 did not already expose it.
- Apply Pattern 1 (disable buttons with tooltip) on highest-traffic forms: coworker panel, build settings, prompt editor, MCP sync button, storefront extraction, and any other high-traffic mutation surfaces discovered by the implementation audit.
- Apply Pattern 2 (intercept submit and show toast/message) where disabling the initiating control would hide meaningful context.
- Styling follows AGENTS.md §12: DPF CSS variables only, no hardcoded colors, and no decorative cards around operational controls.
- Keep the server-side Proxy/API gates authoritative. Client action gating is UX hardening, not correctness.

**Acceptance for Ideate**:
- `usePlatformReady` tests cover normal / draining / swapping / cleared states
- Disabled-button UX test: during draining, actions are disabled with an accessible tooltip or status message
- Submit-intercept test: attempted action during swapping never calls the mutation and shows the platform-upgrading message
- No mutation surface in the audited high-traffic list remains clickable without either a server-side gate explanation or a deliberate exception note

**Test gates**:
- `pnpm --filter web test -- apps/web/lib/hooks/usePlatformReady.test.ts`
- `pnpm --filter web test -- <modified component tests>`
- Manual: trigger quiescence, verify high-traffic forms do not initiate new work and show the same platform-upgrading language

**Files**:
- Create: `apps/web/lib/hooks/usePlatformReady.ts`
- Create: `apps/web/lib/hooks/usePlatformReady.test.ts`
- Modify: high-traffic mutation components discovered by audit
- Possibly modify: `apps/web/components/platform/PlatformBannerProvider.tsx` (context export)

---

### BI-QUIESCE-010 — Self-upgrade integration + boot reconciliation

**Title**: Replace `getPortalActivity()` stopgap with quiescence handshake in `runSelfUpgrade`

**Prerequisites**: BI-QUIESCE-002, 003, 004a, 004b, 005, 006, 007, and 008 merged

**Problem**: The protocol is not complete until the actual upgrade orchestrator uses it. Today `apps/web/lib/queue/functions/self-upgrade.ts` calls `getPortalActivity()` at lines 48-58 and then runs `runPromoter()` directly. That only observes recent `ToolExecution` rows and cannot drain or resume the 30-surface inventory.

**Scope**:

- Replace the `getPortalActivity()` pre-check in `runSelfUpgrade()` with the compact caller code from spec §8:
  - `startQuiescence({ trigger: "self-upgrade", triggerRefId, requestedBy, concurrencyMode: "join-active" })`
  - `awaitReady()`
  - `signalSwapStarting(runId, { targetVersion, targetBundleHash })`
  - `runPromoter(...)`
  - `signalSwapComplete(...)` on success
  - `failQuiescenceSwap(...)` on promoter failure after the swap window begins
- Preserve current `dryRun` and `force` semantics explicitly. `dryRun` should not leave the platform in `draining`; `force` should map to the spec's force/ship-force policy, not bypass quiescence silently.
- Add boot reconciliation in the platform version writer (`apps/web/lib/platform/version-config.ts` is the current anchor): after `PlatformConfig["platform.version"]` is written and health is live, call `reconcileQuiescenceOnBoot()` to complete or fail a `swapping` run based on target version/hash.
- Ensure the old process path and the boot-reconciler path both call the same terminal-event helper.
- Keep the `runSelfUpgrade` integration small: no per-surface drain details leak into the upgrade function.

**Acceptance for Ideate**:
- `runSelfUpgrade` starts a quiescence run before promoter execution and does not call `runPromoter` until `awaitReady()` succeeds
- `ready-to-swap` -> `swapping` is persisted before `runPromoter` starts
- Promoter success calls `signalSwapComplete`; promoter failure after `signalSwapStarting` calls `failQuiescenceSwap`
- Simulated old-process death after `signalSwapStarting` is reconciled by `reconcileQuiescenceOnBoot()` when the new version/hash matches
- Boot reconcile fails the run with operator-visible evidence when the target version/hash does not match
- Existing skipped/deferred return shapes from `runSelfUpgrade` remain understandable to callers

**Test gates**:
- `pnpm --filter web test -- apps/web/lib/queue/functions/self-upgrade.test.ts`
- `pnpm --filter web test -- apps/web/lib/self-upgrade/quiescence.test.ts`
- `pnpm --filter web test -- apps/web/lib/platform/version-config.test.ts`
- Manual: run self-upgrade in dry-run mode and verify no stranded quiescence state remains

**Files**:
- Modify: `apps/web/lib/queue/functions/self-upgrade.ts`
- Modify: `apps/web/lib/queue/functions/self-upgrade.test.ts`
- Modify: `apps/web/lib/platform/version-config.ts`
- Modify: `apps/web/lib/platform/version-config.test.ts`
- Modify: `apps/web/lib/self-upgrade/quiescence.ts`
- Modify: `apps/web/lib/self-upgrade/quiescence.test.ts`

---

### Parent-§5.5-update follow-up

**Title**: Update parent governed-upgrade spec §5.5 to reference quiescence spec

**Prerequisites**: BI-QUIESCE-010 merged (self-upgrade substitution path real)

**Problem**: Parent spec [`2026-05-23-governed-platform-upgrade-lifecycle-design.md`](../specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md) §5.5 currently sketches a 17-step drain protocol. After this work lands, §5.5 should be rewritten to delegate to the quiescence spec and keep only swap-specific steps (L1/L2/L3/L4 apply, smoke window, rollback).

**Scope**: spec text edit only — no code.

**Acceptance**: §5.5 §8 substitution table from quiescence spec is the canonical reference.

**Files**:
- Modify: `docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md` §5.5

---

## Operator kick sequence (recommended)

1. **Settle the 6 open questions** in spec §12 — single review session, write decisions into the spec as concrete defaults. Estimated 15–30 min operator time.
2. **File BI-QUIESCE-001 into Build Studio** via `/admin/backlog` → promote to Ideate → approve Ideate plan → let BS run. Schema work is contained and reviewable in one BS cycle. Estimated 1 BS cycle (~hours).
3. **After 001 PR lands**: file 002. Do not parallelize consumers before the coordinator API exists.
4. **After 002 PR lands**: file 003, 004a, and 005 in parallel. These are independently testable consumers of the coordinator API.
5. **After 003 lands**: file 006 and 007. Verify `/api/platform/events`, shell banner mounting, version headers, and stuck-run clearing before using quiescence for real self-upgrades.
6. **After 004a/005/006/007 land**: file 004b and 008. This hardens event-driven Inngest suspension and all direct EventSource consumers.
7. **After 004b/008 land**: file 010. Replace `getPortalActivity()` in `runSelfUpgrade`, add `signalSwapStarting`/`signalSwapComplete`/`failQuiescenceSwap`, and wire `reconcileQuiescenceOnBoot` through the version writer.
8. **Verify v1 working in dogfooding** before filing 009. Manual quiescence trigger from `/ops/quiescence` or `/ops/self-upgrade`; observe banner; verify no broken SSE; verify operator can defer cleanly; verify self-upgrade dry-run leaves no stranded quiescence state.
9. **File 009** (Phase 2 broad action gate) and then the parent-§5.5-update BI once the substitution path is real.

## Risks and watchpoints

- **The scheduled-function scope in 004a is broad but mechanical.** If a single non-exempt scheduled function fails the gate test, fix in same PR; don't fragment. Keep `taskrunWatchdog`, self-upgrade, and quiescence-run exempt so safety functions still run during drain.
- **The `captureActiveSessionBlockers` implementation in 002 is the most complex single function in the protocol.** It queries 7 detection classes across many tables. Worth a code-review pass focused specifically on this function.
- **The Proxy in 003 is request-path-critical.** A bug here breaks every request. Preserve the existing canonical-host, sandbox, auth, and route-class behavior in `apps/web/proxy.ts`; test the 503 path with realistic Next.js server-action POST shape (`Next-Action` header discrimination).
- **The coworker loop status-flip in 005 reuses BI-4ab6be39 heartbeat machinery.** Critical that the heartbeat continues to return `false` for `quiescing` — locked down by the watchdog regression test in 001.
- **The self-upgrade integration in 010 is where the protocol becomes real.** `signalSwapStarting()` must run before `runPromoter`; old-process completion is best-effort; boot reconciliation is the durable escape hatch.
- **The sandbox acquisition seam may not exist as one function today.** BI-005 should introduce a canonical seam if discovery finds scattered acquisition logic; do not add scattered one-off guards.
- **The 6 open questions are real blockers.** Don't file affected BIs without settling them; BS Ideate phase will surface them and re-ask, costing a cycle.

## References

- Spec: [`docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md`](../specs/2026-05-24-activity-quiescence-protocol-design.md)
- Parent spec: [`docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md`](../specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md) §5.5 (replaced) and §5.2.1 (Layer 1 evidence shape consumed)
- Existing Proxy: `apps/web/proxy.ts` and `apps/web/lib/canonical-host.ts` (Next 16 Proxy, not `middleware.ts`)
- Shell banner mount: `apps/web/app/(shell)/layout.tsx`
- Self-upgrade caller: `apps/web/lib/queue/functions/self-upgrade.ts`
- Boot-version writer: `apps/web/lib/platform/version-config.ts`
- Queue function registry: `apps/web/lib/queue/functions/index.ts`
- Current direct EventSource consumers: `apps/web/components/agent/AgentCoworkerPanel.tsx`, `apps/web/components/build/BuildStudio.tsx`, `apps/web/components/storefront-admin/BrandExtractionSection.tsx`, `apps/web/components/platform/McpSyncButton.tsx`
- Live BIs: [BI-40F05BAC](http://localhost:3000/admin/backlog/BI-40F05BAC) (activity quiescence; live state checked 2026-05-24: `triaging`, no linked active epic); [BI-5B3FA415](http://localhost:3000/admin/backlog/BI-5B3FA415) (governed upgrade lifecycle parent; live state checked 2026-05-24: `triaging`, no linked active epic)
- Standard: [Next.js 16 Proxy](https://nextjs.org/docs/app/getting-started/proxy) and [Next.js Edge Runtime](https://nextjs.org/docs/app/api-reference/edge)
- Standing rule: `feedback_build_studio_for_all_development.md` — Build Studio for all feature work
- Spec-commit-plan process: `feedback_spec_commit_plan_process.md` — approved spec → main + writing-plans, no asking between steps
