# Build Studio Phase Stall Detection and Recovery

| Field | Value |
| --- | --- |
| Date | 2026-05-19 |
| Status | Draft for review |
| Working title | Build Studio Stall Detection and Recovery |
| Primary v1 surface | Build Studio + AI Operations Map |
| Related epics | `EP-BUILD-STUDIO`, `EP-COWORKER-RT`, `EP-OBSERVABILITY` (create if absent) |
| Related docs | `2026-05-17-wwmd-decision-perspective-kernel-design.md`, `2026-04-21-deliberation-pattern-framework-design.md`, `2026-04-30-ai-coworker-operator-pattern.md`, `2026-05-11-autonomous-coworker-runtime-design.md` |

## 1. Purpose

Any `TaskRun` that enters `status = "working"` and never exits is currently invisible to the platform. There is no heartbeat, no watchdog, no per-phase timeout, no operator-visible "stalled" indicator, and no recovery action. From the outside the build looks alive — the badge says *working* — but in fact the runtime loop is dead, the agent process has been GC'd, the Codex CLI is blocked on a closed socket, or the inngest function has crashed silently.

The cost of this failure mode is structural, not cosmetic:

- Mark and any future operator wait indefinitely for a job that will never complete.
- The AI Operations Map shows a phantom-busy slot, blocking accurate capacity accounting.
- Downstream Build Studio gates do not advance because the upstream phase never reports terminal status.
- Concurrent runs can't reclaim worker capacity that was claimed by a corpse task.

This spec defines a heartbeat-and-watchdog substrate over `TaskRun`, a per-phase timeout configuration surface, a new `stalled` terminal-equivalent status, and the operator-visible recovery flow. It applies to every Build Studio phase (`ideate`, `plan`, `build`, `review`, `ship`) and to every long-running inner loop (deliberation consensus rounds, plan-document-reviewer iterations, Codex CLI agent loops, sandbox build pipeline steps).

This is plumbing. It is not a Build Studio feature in the product-thesis sense. It is the observability + recovery guarantee that makes every Build Studio feature trustworthy.

## 2. Product Thesis

A trustworthy autonomous platform must answer three questions about any in-flight work, at any time, without an operator opening a shell:

1. **Is it actually alive?** A `status = "working"` row that hasn't emitted a heartbeat in 60 seconds is not alive.
2. **Is it on time?** Every phase has a defensible upper bound. Ideate should finish in minutes; Build can take an hour. The platform must know the difference.
3. **What can I do about it?** When something stalls, the operator needs one-click `Retry`, `Abandon`, and `Escalate` actions — not a copy-pasted SQL command.

Operating principle:

> A working task with no recent heartbeat is a dead task. Treat silence as failure, not progress.

The system must err toward declaring stalls and surfacing them, not toward hiding them. False positives are recoverable (the operator clicks Retry); false negatives are an indefinite wait.

## 3. Scope

### 3.1 In scope (v1)

- Heartbeat field on `TaskRun` (`lastHeartbeatAt`).
- Heartbeat emission contract for the agent runtime, deliberation loop, Codex CLI adapter, and build pipeline steps.
- A background watchdog that detects stalled `TaskRun`s and writes `status = "stalled"` with audit context.
- Per-phase timeout configuration with operator-editable defaults at the org level.
- A `stalled` state lifecycle: distinct from `failed`, with explicit `retry` / `abandon` recovery actions.
- Operator surface: stalled indicator + Retry / Abandon / Escalate buttons on the AI Operations Map and Build Studio phase panel.
- Notification on first stall detection per `TaskRun`.

### 3.2 Out of scope (v1, candidates for v2)

- Predictive stall detection ("this one looks like it's going to stall"). V1 reacts to absent heartbeats only.
- Auto-retry without operator approval. V1 surfaces the stall; the operator chooses.
- Cross-task dependency unblocking when a stalled parent blocks children — v1 marks the parent stalled and lets the operator decide whether to cancel the subtree.
- Cost-tier-aware timeouts (e.g. "this is using Opus and Opus is slow today, extend the budget"). V1 uses static per-phase thresholds.
- Anomaly detection beyond heartbeat absence (e.g. detecting a stuck token-emission loop that is heart-beating but making no progress). Belongs in a v2 progress-signal spec.

### 3.3 Explicit non-goals

- **Not a retry framework.** Retry semantics for failed sandbox steps already exist in [build-pipeline.ts](apps/web/lib/integrate/build-pipeline.ts) and `MAX_RETRIES` in [build-exec-types.ts](apps/web/lib/integrate/build-exec-types.ts). This spec orchestrates *operator-triggered* retry of a stalled `TaskRun` by handing back to those existing primitives — it does not duplicate them.
- **Not a cancellation framework.** The A2A-aligned `canceled` status already exists on `TaskRun` and is operator-initiated. `stalled` is watchdog-initiated.
- **Not a progress-bar surface.** Heartbeat presence/absence is binary at v1. Granular progress percentages are a separate UX concern.

## 4. Research and Benchmarking

Stall detection over long-running work is a solved domain in distributed systems; the patterns are well established. The design adopts them rather than inventing new ones.

| Reference | Pattern to adopt | Pattern to reject |
| --- | --- | --- |
| [Temporal Workflows — heartbeats and timeouts](https://docs.temporal.io/activities#activity-timeouts) | Activity heartbeats with a separate `HeartbeatTimeout`, distinct from `StartToCloseTimeout`. Watchdog acts on heartbeat-timeout independent of total-duration timeout. | Do not adopt Temporal's full execution model — DPF uses Inngest + Postgres rows, not workflow event histories. |
| [AWS Step Functions activity heartbeats](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-activities.html) | Activity tasks must send heartbeats or the state machine treats them as timed out. Heartbeat is a write, not a query. | Do not require the watchdog to actively poll the worker; the worker writes its own heartbeat. |
| [Kubernetes pod liveness probes](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes) | Separate liveness (still alive?) from readiness (making progress?). | Do not conflate the two — v1 detects liveness only. |
| [Sidekiq job heartbeat / leader election](https://github.com/sidekiq/sidekiq/wiki/Reliability) | Worker process heartbeat backed by a redis key with TTL; recovery scanner reclaims orphaned jobs. | Do not adopt Redis as a substrate — we already have Postgres. |
| [Inngest function step durability](https://www.inngest.com/docs/functions/multi-step) | Step-level checkpointing already produces durable progress signals. | Do not require coworkers to refactor every function into discrete inngest steps just to get heartbeat coverage; expose a heartbeat tick that is independent of step boundaries. |
| [A2A task lifecycle](https://agent2agent.info/docs/concepts/task/) | Terminal status semantics: `failed`, `canceled`, `rejected` are distinct outcomes. | Do not overload `failed` to mean "watchdog gave up" — that conflates worker-reported failure with platform-detected silence. |

### 4.1 Market Positioning

The combination of (a) governed agent autonomy, (b) per-phase timeout configuration, and (c) heartbeat-driven stall recovery with single-click operator action does not exist as a packaged primitive in any commercial agent platform reviewed in May 2026. Microsoft Copilot Studio, IBM watsonx Orchestrate, Salesforce Agentforce, and the Google Enterprise Agent Platform all expose run timeouts, but stalled runs surface as "failed" with no distinguishing signal and no opinionated recovery flow. LangGraph and CrewAI have node-level timeouts but no operator console for stall recovery.

DPF's differentiator is the integration: the same `TaskRun` row that the AI Operations Map and Build Studio phase panel already render is the row the watchdog updates, so stall state is first-class in the operator UI without a parallel observability stack.

## 5. Design Pillars

### 5.1 Heartbeat is a Write, Not a Query

The watchdog never asks the worker "are you alive?" The worker writes `lastHeartbeatAt = now()` on a fixed cadence. Silence is the signal. This is the only pattern that survives process death, network partition, and CLI subprocess hangs — all of which would block a query-based check.

### 5.2 Stalled is a Distinct Status

`stalled` is added to the `TaskRun.status` enum alongside the existing A2A states (`submitted | working | input-required | auth-required | completed | failed | canceled | rejected | archived`).

`stalled` semantics:

- **Terminal-equivalent for the work loop.** Once `stalled`, the worker MUST NOT continue writing progress; the row is no longer considered live by any scheduler, capacity counter, or downstream gate.
- **Not terminal for the operator.** From `stalled` the operator can transition to `working` (Retry — re-dispatch) or `canceled` (Abandon). The watchdog itself never auto-transitions out of `stalled`.
- **Distinct from `failed`.** `failed` means the worker reported failure with a reason. `stalled` means the platform detected silence and made the call. The audit trail must show which.

### 5.3 Heartbeat Cadence is per Loop Type, Not per Phase

A phase is not a loop. One Build phase may contain a sandbox pipeline (long, infrequent step boundaries), a deliberation run (medium, per-round), and a Codex CLI agent loop (frequent, per-tool-call). Each has a natural emission point and a natural cadence. Forcing one global cadence either over-heartbeats fast loops or under-heartbeats slow ones.

The contract:

| Loop type | Emission point | Cadence (informational; thresholds are runtime-configurable in §5.4) |
| --- | --- | --- |
| Agent runtime tool call (Codex CLI / Claude Code) | After every tool response, before next inference call | Per tool call (no fixed wall-clock period) |
| Deliberation consensus round | At round boundary | Per round |
| Plan-document-reviewer / code review iteration | Per file or per iteration | Per iteration |
| Sandbox build pipeline step | At each `STEP_ORDER` transition | Per step |
| Long single-shot inference (no inner loop) | Wrapper task wakes a ticker | `heartbeatTimeoutSeconds / 3` (default-derived; see §6.1) |

The watchdog cares only that the heartbeat is *recent enough*, where "recent enough" is configurable per phase.

### 5.4 Timeouts are per-Phase, Operator-Editable

Each Build Studio phase has two configurable thresholds at the organization level:

- `heartbeatTimeoutSeconds` — how long without a heartbeat before the watchdog declares `stalled`.
- `totalPhaseTimeoutSeconds` — absolute wall-clock cap from `startedAt`, regardless of heartbeats.

A phase exceeding either threshold is `stalled`. Both are required because heartbeat alone does not catch a livelock — a loop heart-beating forever while making no real progress. Wall-clock catches it bluntly.

Defaults (operator-editable, NOT hardcoded constants):

| Phase | `heartbeatTimeoutSeconds` | `totalPhaseTimeoutSeconds` |
| --- | --- | --- |
| `ideate` | 90 | 900 (15 min) |
| `plan` | 120 | 1800 (30 min) |
| `build` | 180 | 3600 (60 min) |
| `review` | 120 | 1800 (30 min) |
| `ship` | 120 | 1800 (30 min) |

Rationale for defaults: derived from observed Build Studio lifecycle data captured in [`project_build_studio_lifecycle_status`](memory) — the first full end-to-end lifecycle hit ~50 min total with Build as the dominant phase. Defaults must accommodate the observed p95 with headroom; they are not aspirational SLAs.

Operator override surface: `Admin > Build Studio > Stall Thresholds`. Values persist in a new `OrgSettings`-style row, keyed by `phase`. Inline edit, immediate effect on next watchdog tick. No restart required.

### 5.5 Recovery is per Phase Type, Not Generic

A "Retry" button that does the same thing at every phase is a footgun. Phases have different failure profiles:

| Phase | Default recovery action | Why |
| --- | --- | --- |
| `ideate` | Retry from start | Cheap, stateless; no sandbox cost lost. |
| `plan` | Retry from last deliberation checkpoint if one exists, else from start | Plan generation often invokes deliberation; replaying from the last `DeliberationRun.completedAt` salvages real work. |
| `build` | Retry from last `BuildExecStep` via existing `runBuildPipeline` resume logic | Sandbox state is expensive to recreate; the checkpoint pipeline is built for this. |
| `review` | Retry the current reviewer pass; do not re-run upstream | Reviewers are idempotent; replaying upstream wastes the artifact. |
| `ship` | Escalate (Retry button disabled by default) | Ship-phase failures often involve external state (DCO, PR merge, deploy). Replay can double-publish. |

For the ship phase specifically, the operator UI shows the Retry button **disabled** with a tooltip explaining the double-publish risk. The operator can enable it via a one-click confirm dialog that displays the risk language and requires explicit acknowledgment. This is the single canonical position — §6.3 and §12 reference this rule rather than restating it.

The Retry action is *opinionated* per phase. The Abandon action is uniform (transition to `canceled`, free worker capacity, do not roll back artifacts, propagate to live children per §6.5). The Escalate action notifies the accountable human and parks the row in `stalled` for inspection.

### 5.6 Inner-Loop Coverage is Mandatory, Not Optional

Every long-running inner loop must emit heartbeats. The substrate provides:

- A `heartbeat(taskRunId)` helper exported from a new `apps/web/lib/observability/heartbeat.ts`.
- A wrapper `withHeartbeatTicker(taskRunId, intervalMs, fn)` that runs `fn` while a setInterval emits heartbeats on its behalf — for the long-single-shot case where there is no natural emission point.

Coverage is enforced by code review and by an invariant: any new code that writes `status = "working"` to a `TaskRun` without a corresponding heartbeat emission path is rejected. A lint rule (custom ESLint or a project-grep CI check) backs this — see §11.

### 5.7 Watchdog Runs as Inngest Cron

The watchdog is a new Inngest function — `ops/taskrun-watchdog` — triggered by `cron("* * * * *")` (every minute). The detection approach is **coarse-fetch in SQL, threshold-filter in app code**: the watchdog selects all candidate-stale rows using the smallest applicable threshold across phases as the SQL filter, then applies the phase-specific threshold in TypeScript against the joined `FeatureBuild.phase` value. This avoids encoding per-phase numerics in SQL (where they would have to be re-deployed on every threshold change) and keeps thresholds editable at runtime from the admin surface (§5.4).

Pseudo-flow:

```ts
// 1. Load current thresholds from BuildStudioStallThreshold (§7.2).
const thresholds = await loadStallThresholds();
const minHeartbeatTimeout = Math.min(...thresholds.map(t => t.heartbeatTimeoutSeconds));

// 2. SQL: fetch any working TaskRun whose silence MIGHT exceed even the smallest
//    per-phase threshold. Joined to FeatureBuild for phase (LEFT JOIN — coworker
//    TaskRuns without a build use the default threshold from §12.2).
const candidates = await prisma.$queryRaw`
  SELECT tr.taskRunId, tr."lastHeartbeatAt", tr."startedAt", tr."buildId", fb.phase
  FROM "TaskRun" tr
  LEFT JOIN "FeatureBuild" fb ON tr."buildId" = fb."buildId"
  WHERE tr.status = 'working'
    AND (
      tr."lastHeartbeatAt" IS NULL
      OR now() - tr."lastHeartbeatAt" > make_interval(secs => ${minHeartbeatTimeout})
      OR now() - tr."startedAt" > make_interval(secs => ${minTotalTimeout})
    )
`;

// 3. App-code filter: for each candidate, look up the row's phase, apply the
//    phase-specific thresholds, and decide. Working set is small (handful of
//    concurrent builds), so the per-row decision is cheap.
const stalled = candidates.filter(row => exceedsThreshold(row, thresholdFor(row.phase)));
```

For each stalled row: transition `status` → `stalled`, write a `StallEvent` audit row (§7.3), and emit a `Notification` to the accountable operator. All three writes execute in a single transaction.

Cadence justification: minute granularity matches the existing [`agent-task-dispatch`](apps/web/lib/queue/functions/agent-task-dispatch.ts) cron (`*/5 * * * *`) and [`discovery-poll`](apps/web/lib/queue/functions/discovery-poll.ts) (`0 * * * *`) — a minute is the tightest defensible interval before watchdog overhead becomes a concern at scale. The query is indexed by `(status, lastHeartbeatAt)`, so per-minute is appropriate.

### 5.8 Detection is Layered, Not Replaced

The existing `BuildExecutionState` checkpointing in [build-pipeline.ts](apps/web/lib/integrate/build-pipeline.ts) already handles sandbox step failures with retries. That layer continues to operate. The watchdog operates above it — when the *checkpoint pipeline itself* hangs (e.g. an inngest step is mid-execution but the process died), the watchdog catches it.

Concretely, the two layers cover disjoint failure modes:

- **Pipeline alive, step failed:** `BuildExecutionState` retries the failed step up to `MAX_RETRIES`. Pipeline keeps heart-beating between steps; watchdog stays quiet.
- **Pipeline alive, stuck in retry loop:** Pipeline is heart-beating each step transition, so `heartbeatTimeoutSeconds` does NOT trip. `totalPhaseTimeoutSeconds` catches it bluntly — this is exactly why the wall-clock cap exists alongside the heartbeat cap.
- **Pipeline process dead:** No heartbeats. `heartbeatTimeoutSeconds` trips. Watchdog declares `stalled`.

The two layers never both act on the same row in the same tick.

## 6. Runtime Flow

### 6.1 Heartbeat Emission

Inside any agent or pipeline that holds a `TaskRun` in `working`:

```ts
import { heartbeat, withHeartbeatTicker } from "@/lib/observability/heartbeat";

// Loop-boundary emission (preferred — every natural progress point)
for (const round of deliberationRounds) {
  await runRound(round);
  await heartbeat(taskRunId);
}

// Wrapper emission (for opaque long calls). Interval is NOT hardcoded — the
// helper resolves it from the row's phase threshold at call time, defaulting
// to `heartbeatTimeoutSeconds / 3` so the worker emits three heartbeats per
// timeout window (one missed tick is normal jitter; two missed is suspicious;
// three missed trips the watchdog).
await withHeartbeatTicker(taskRunId, async () => {
  return await callLongRunningInference();
});
```

`heartbeat()` writes `lastHeartbeatAt = now()` with `WHERE taskRunId = ? AND status = 'working'`. If the row is no longer `working` (canceled, completed, stalled), the write is a no-op and returns `false` — giving the caller a cooperative-cancellation signal at the next heartbeat boundary.

`withHeartbeatTicker()` accepts an optional `intervalMs` override for tests, but production callers should not pass one. The threshold-derived interval keeps cadence and detection coupled to the same operator-editable knob (§5.4) so they cannot drift apart.

### 6.2 Watchdog Tick

1. Cron fires `ops/taskrun-watchdog` every minute.
2. Load current per-phase thresholds from `OrgSetting`.
3. Run the query in §5.7.
4. For each stalled candidate, in a single transaction:
   - `TaskRun.status = "stalled"`, `TaskRun.completedAt = now()`.
   - Insert `StallEvent` row (§7.3) with reason (`heartbeat_timeout` | `total_timeout` | `never_started`).
   - Insert `Notification` to the build owner (or platform admin if no owner).
   - Insert `BuildActivity` row scoped to the parent `buildId` so the Build Studio activity stream reflects the stall.
5. Emit an `AgentEvent` `taskrun:stalled` so live UIs subscribed via the event bus update without polling.

### 6.3 Operator Recovery

Operator sees a stalled indicator on the AI Operations Map or Build Studio phase panel. Available actions, gated by the row's `phase` per §5.5:

- **Retry** — per-phase dispatcher chooses the recovery strategy from the §5.5 table. Spawns a sibling `TaskRun` linked via `parentTaskRunId` to the stalled row (see §6.6 below), clears `lastHeartbeatAt`, writes a `StallEvent` continuation row on the original (`outcome = "retry"`), re-dispatches the sibling. For `phase = "ship"`, the button is disabled by default per §5.5; enabling requires the confirm dialog.
- **Abandon** — `TaskRun.status = "canceled"`, write `StallEvent.outcome = "abandoned"`, free worker capacity, propagate cancel to children per §6.5.
- **Escalate** — `Notification` to the accountable human role, leave the row in `stalled`, write `StallEvent.outcome = "escalated"`.

Each action is one click (ship-phase Retry: one click + one confirm). No SQL, no shell.

### 6.4 Interaction with WWMD Gate

When a stall is detected during a WWMD-gated phase (e.g. plan-advancement), the watchdog does NOT consult the gate. The stall is mechanical, not doctrinal. However, the operator's recovery action (Retry vs Abandon vs Escalate) is a candidate WWMD invocation in v2 — given the stall history of this phase / pattern / build owner, what would Mark do? Out of scope for v1 but the schema (§7) is designed to be queryable as future perspective material.

### 6.5 Cancel Propagation to Children

Existing `agent-threads.ts` has no cascade-cancel logic (verified 2026-05-19 — `parentTaskRunId` is set on spawn but no consumer propagates state changes through it). This spec introduces the first cascade behaviour:

When the watchdog declares a `TaskRun` `stalled`, or the operator clicks Abandon (`canceled`), the same transaction walks `TaskRun.parentTaskRunId` ← children and:

- For each child currently in an in-flight state (`submitted | working | input-required | auth-required`): transition to `canceled` with a `StallEvent` row of reason `"parent_stalled"` or `"parent_abandoned"`.
- Terminal children (`completed | failed | canceled | rejected | archived`) are left alone — their work outcome is real and must not be rewritten.
- The propagation is one level only per tick; if a child has grandchildren, the watchdog catches them on the next minute as their own parent transitions land.

This default is conservative: cascade is *not* opt-in per row. Build Studio runs are tree-shaped with the FeatureBuild as the root context; leaving live children orphaned would re-create the original phantom-busy problem one level down.

### 6.6 Retry Spawns a Sibling, Not a Mutation

When the operator clicks Retry on a stalled `TaskRun`, the dispatcher does NOT flip the stalled row back to `working`. Instead it:

1. Creates a new `TaskRun` with the same `userId`, `objective`, `routeContext`, etc., and `parentTaskRunId` set to the stalled row's id.
2. Writes `StallEvent.outcome = "retry"` and `StallEvent.outcomeBy = <operator>` on the stalled row.
3. Dispatches the new row through the normal path.

The stalled row remains `stalled`, preserving the audit timeline. Operators see "Retry #1 of build X / phase plan" in the activity stream rather than a row that mysteriously rebooted. The chain `parentTaskRunId → parentTaskRunId → …` is the retry history; the Build Studio phase panel renders it as a stacked retry strip (§9.2).

## 7. Data Model

### 7.1 `TaskRun` additions

```prisma
model TaskRun {
  // ... existing fields ...
  status             String   @default("submitted")
  // See TASK_STATES in apps/web/lib/tak/task-states.ts for canonical values.
  // Adds "stalled" alongside the existing A2A states.
  lastHeartbeatAt    DateTime?
  // ... existing fields ...

  stallEvents        StallEvent[]

  @@index([status, lastHeartbeatAt])  // new — supports watchdog query
}
```

**Canonical type location:** the `TaskState` union and `TASK_STATES` array live at [apps/web/lib/tak/task-states.ts](apps/web/lib/tak/task-states.ts) (verified 2026-05-19). The migration commit must:

1. Add `"stalled"` to `TASK_STATES` in that file.
2. Update `TASK_IN_FLIGHT_STATES` decision: `stalled` is **not** in-flight (it's terminal-equivalent for scheduling; see §5.2). Confirm at implementation that no in-flight consumer relies on stalled being treated as live.
3. Re-run the TypeScript build to surface every `switch (status)` or exhaustive check that needs a new arm — TypeScript will reject the existing exhaustive checks until they handle `stalled`. This is the enforcement mechanism for completeness; the implementation plan must include a sub-task to walk every diagnostic the build emits, not assume the union-update is mechanical.

### 7.2 `BuildStudioStallThreshold` (new dedicated table)

The existing `OrgSettings` model at `packages/db/prisma/schema.prisma:7162` is single-purpose (currency/FX settings) and is NOT a generic key/value substrate (verified 2026-05-19). Rather than retrofit it into one as a side effect of this spec — which would violate single-source-of-truth and create a substrate that future specs will fight over — this spec adds a dedicated model:

```prisma
model BuildStudioStallThreshold {
  id                       String   @id @default(cuid())
  scope                    String   @unique // "phase.ideate" | "phase.plan" | "phase.build" | "phase.review" | "phase.ship" | "default"
  heartbeatTimeoutSeconds  Int
  totalPhaseTimeoutSeconds Int
  updatedAt                DateTime @updatedAt
  updatedBy                String?  // User.id of last operator edit, null if seeded
}
```

Seeded rows (operator-editable, NOT hardcoded constants in TypeScript):

| scope | heartbeatTimeoutSeconds | totalPhaseTimeoutSeconds |
| --- | --- | --- |
| `phase.ideate` | 90 | 900 |
| `phase.plan` | 120 | 1800 |
| `phase.build` | 180 | 3600 |
| `phase.review` | 120 | 1800 |
| `phase.ship` | 120 | 1800 |
| `default` | 120 | 1800 |

The `default` row applies to `TaskRun`s without a `buildId` (coworker-spawned, skill-spawned, proactive). Watchdog code falls back to this row when no phase-specific row matches.

Seed lives in `packages/db/src/seed.ts` per the fix-the-seed-not-the-runtime principle. Watchdog code reads via Prisma; values are not embedded in the TS source.

### 7.3 `StallEvent` (new)

Durable audit trail for every stall detection and operator response. This is the data that lets v2 build "What would Mark do about a stall?" perspective material.

```prisma
model StallEvent {
  id                   String    @id @default(cuid())
  taskRunId            String
  buildId              String?
  phase                String?   // FeatureBuild.phase at the time of detection
  reason               String    // "heartbeat_timeout" | "total_timeout" | "never_started"
  detectedAt           DateTime  @default(now())
  lastHeartbeatAt      DateTime?
  startedAt            DateTime
  thresholdHeartbeatS  Int
  thresholdTotalS      Int
  outcome              String?   // null while pending operator | "retry" | "abandoned" | "escalated" | "auto-recovered"
  outcomeAt            DateTime?
  outcomeBy            String?   // User.id of operator who acted, null if watchdog auto-action
  notes                String?   @db.Text
  createdAt            DateTime  @default(now())

  taskRun              TaskRun   @relation(fields: [taskRunId], references: [id], onDelete: Cascade)

  @@index([taskRunId])
  @@index([buildId])
  @@index([phase, reason])
  @@index([outcome])
}
```

### 7.4 Notification typing

Reuses existing `Notification` model. Notification `type = "taskrun.stalled"` with `deepLink` pointing at the Build Studio phase panel for the parent build.

## 8. Existing DPF Primitives to Reuse

| Need | Existing primitive |
| --- | --- |
| Status enum substrate | `TaskRun.status` (A2A-aligned) |
| Build phase progression | `FeatureBuild.phase` + `PHASE_ORDER` in `lib/explore/feature-build-types.ts` |
| Sandbox step retries | `BuildExecutionState` + `MAX_RETRIES` in [build-exec-types.ts](apps/web/lib/integrate/build-exec-types.ts) |
| Cron-driven background jobs | Inngest `cron(...)` functions in `apps/web/lib/queue/functions/*` |
| Operator visibility surface | [AiOperationsMap.tsx](apps/web/components/platform/AiOperationsMap.tsx) |
| Build activity stream | `BuildActivity` rows surfaced in Build Studio phase panels |
| Live UI updates | `AgentEvent` bus + `emit(...)` in [build-pipeline.ts](apps/web/lib/integrate/build-pipeline.ts) |
| User notification | `Notification` model |
| Audit trail pattern | Existing `*Event` tables (e.g. `BuildActivity`, `ToolExecutionReceipt`) |

Schema additions beyond these primitives: `TaskRun.lastHeartbeatAt`, the `stalled` enum value, `StallEvent`, and the org-level stall thresholds.

## 9. UI and Surfaces

### 9.1 AI Operations Map

The map already renders TaskRun status as a badge. v1 adds:

- A distinct visual treatment for `stalled` — same prominence as `failed`, different color (suggest `var(--dpf-warning)` not `--dpf-error`, since stalls are often recoverable where failures are not). Final color picked in implementation against the existing palette.
- A small "Stalled for Xm" subtitle showing minutes since `detectedAt`.
- Inline `Retry` / `Abandon` / `Escalate` actions on hover or in the slot's expanded view.

### 9.2 Build Studio Phase Panel

For a stalled phase, the panel shows:

- The phase badge in stalled state.
- The reason from `StallEvent.reason` translated to operator-readable copy ("No heartbeat for 4 minutes" vs "Exceeded 60-minute phase budget").
- The same three action buttons.
- A small history strip: prior `StallEvent` rows for this build, so a repeatedly-stalling phase is visible at a glance.

### 9.3 Admin > Build Studio > Stall Thresholds

A small settings surface listing the per-phase thresholds with inline numeric editors. Save persists to `OrgSetting` (or `BuildStudioStallThreshold`). No restart needed; next watchdog tick reads the new value.

### 9.4 Notification UI

Reuses the existing notification dropdown. `taskrun.stalled` notifications group by `buildId` so a build that has stalled multiple phases doesn't fill the tray.

## 10. First Implementation Slice

Recommended v1 cut, ordered so each step delivers a usable increment:

1. **Schema + migration + type sweep.** Three coupled sub-tasks in one commit:
   - **Schema:** add `TaskRun.lastHeartbeatAt`, add the `BuildStudioStallThreshold` model, add the `StallEvent` model, add the `(status, lastHeartbeatAt)` index on `TaskRun`. No DB enum change required — `status` remains `String`; "stalled" is a new permitted value.
   - **Seed:** add the six seeded `BuildStudioStallThreshold` rows (§7.2) to `packages/db/src/seed.ts`. Include a seed invariant that fails the seed run if any phase row is missing.
   - **Type sweep:** add `"stalled"` to `TASK_STATES` in [apps/web/lib/tak/task-states.ts](apps/web/lib/tak/task-states.ts); leave `TASK_IN_FLIGHT_STATES` unchanged (stalled is terminal-equivalent for scheduling per §5.2). Then run `pnpm --filter web typecheck` and walk every exhaustiveness diagnostic the build emits — each one is a real consumer that needs a stalled-handling arm. Do not assume the count; the build is the source of truth for completeness.
2. **Heartbeat helper.** Implement `heartbeat()` and `withHeartbeatTicker()` in `apps/web/lib/observability/heartbeat.ts` with unit tests. No callers yet.
3. **Watchdog cron.** Implement `ops/taskrun-watchdog` as an Inngest function. With no callers emitting heartbeats yet, every `working` TaskRun older than its threshold will trip the watchdog — so the rollout gates this on instrumentation reaching key call sites first. Practical sequence: ship the cron *behind a feature flag* (`STALL_WATCHDOG_ENABLED=false`) at this step, enable it after step 4 lands.
4. **Instrument the four hot loops.** Add `heartbeat()` calls in:
   - The agent runtime tool-call boundary in [agent-coworker.ts](apps/web/lib/actions/agent-coworker.ts).
   - The deliberation round loop in `apps/web/lib/actions/deliberation.ts`.
   - The sandbox step boundary in [build-pipeline.ts](apps/web/lib/integrate/build-pipeline.ts).
   - The Codex CLI adapter (look for `[tool-trace]` logging site per the `project_tool_trace_logging` memory; that's the natural emission point).
5. **Enable watchdog.** Flip the feature flag. Observe one stall cycle end-to-end in a controlled run.
6. **Operator UI.** Add the stalled state treatment + Retry/Abandon/Escalate actions to the AI Operations Map and Build Studio phase panel. Reuse the existing slot/expanded-view layout — don't add new surfaces. Note: this step ships *before* the per-phase recovery dispatcher (step 8), so the Retry button initially calls a uniform "re-dispatch from scratch" path that ignores per-phase checkpoints. That's an acceptable partial-functionality window — the button works, it's just less optimal than it will be after step 8 lands.
7. **Admin threshold editor.** Ship after the watchdog is proven; thresholds can be edited by raw DB seed value in the interim (Mark does not run SQL — Claude handles any interim edit per AGENTS.md §1).
8. **Per-phase recovery dispatcher.** Implement the §5.5 dispatch table. Replaces the step-6 fallback. Sandbox-phase Retry now resumes via `runBuildPipeline` from the last `BuildExecStep` checkpoint instead of restarting; ship-phase Retry surfaces the disabled-with-confirm-dialog UX.

## 11. Coverage Enforcement

A heartbeat substrate is only as good as its coverage. To prevent regressions:

- **Typed-write enforcement.** Rather than rely on a brittle regex against literal `"working"` strings (which a typed accessor `TaskState.WORKING` would slip past), introduce a thin helper `markTaskRunWorking(taskRunId)` in `lib/observability/heartbeat.ts` that is the only sanctioned way to transition a `TaskRun` into `working` from new code. The CI check then becomes: "any file writing `status: ... working ...` to `TaskRun` must import from `lib/observability/heartbeat`." Existing call sites (e.g. [brand-extract.ts](apps/web/lib/queue/functions/brand-extract.ts)) are grandfathered in slice step 4 when they receive heartbeat instrumentation; new code uses the helper from day one.
- **Integration test.** A test that: (a) creates a `TaskRun` in `working`, (b) advances the clock past `heartbeatTimeoutSeconds` without emitting a heartbeat, (c) runs the watchdog, (d) asserts `status === "stalled"` and a `StallEvent` row exists.
- **Smoke run.** Build Studio end-to-end smoke test (existing playwright lifecycle test per `project_playwright_testing`) verifies a normal lifecycle does NOT trip the watchdog — i.e. instrumentation is dense enough.

## 12. Open Questions

(Several v0 opens resolved in §5–§7 ahead of commit and now stated as design decisions rather than questions: threshold storage uses a dedicated `BuildStudioStallThreshold` model not `OrgSettings` (§7.2); ship-phase Retry is disabled-by-default with a confirm-dialog enable (§5.5); cancel propagates one level per tick to live children only (§6.5); Retry spawns a sibling via `parentTaskRunId` and preserves the stalled row (§6.6). Remaining genuine opens:)

1. **Heartbeat write volume.** At Build Studio scale (a handful of concurrent builds), per-tool-call heartbeat writes are negligible. At hive-mind / multi-tenant scale they are not. v1 ships the simple write; v2 may need to batch heartbeats or move them to a separate hot table. Defer to a future load review — the v1 write path is intentionally simple so this is easy to migrate.

2. **WWMD-gated ship-phase Retry.** §5.5 disables ship Retry by default and requires an operator confirm-dialog to enable. Should that confirm-dialog be replaced by a WWMD invocation once the decision ledger has enough data? Candidate v2 follow-up; not a v1 blocker.

3. **Notification fatigue.** A misconfigured threshold (e.g. 30s heartbeat for a phase that legitimately takes 90s) will spam notifications. v1 mitigation: one notification per `TaskRun` per stall event (not per watchdog tick); group by `buildId` in the UI. Sufficient for v1; revisit if observed.

4. **Watchdog self-stall.** The watchdog itself runs as an Inngest cron and could in principle fail — the irony is sharp. v1 relies on Inngest's own function-failure observability (the Inngest dashboard surfaces cron skips and function failures) plus the existing platform-notification surface for cron health. If watchdog reliability becomes a real concern at scale, v2 can add a meta-watchdog ("when was the watchdog last successful?") via the same primitives. v1: documented dependency, no extra mechanism.

5. **Phase-aware vs source-aware thresholds.** §7.2's `default` row covers non-build `TaskRun`s with a single fallback (120s / 1800s). If observed behaviour shows coworker-spawned work has materially different stall characteristics from build phases, split the `default` row by `source` (`coworker | skill | proactive`). v1 default is uniform; revisit with data.

## 13. Backlog Follow-Ups

These should become explicit backlog items when the spec is accepted:

1. Schema migration: `TaskRun.lastHeartbeatAt`, `stalled` status, `StallEvent`, threshold storage.
2. `heartbeat()` and `withHeartbeatTicker()` helpers + unit tests.
3. Watchdog Inngest cron + integration test + feature flag.
4. Instrument agent runtime, deliberation loop, sandbox pipeline, Codex CLI adapter.
5. Operator UI: AI Operations Map stalled state + actions.
6. Operator UI: Build Studio phase panel stalled state + actions + history strip.
7. Per-phase recovery dispatcher (§5.5).
8. Admin > Build Studio > Stall Thresholds editor.
9. Lint / CI coverage enforcement.
10. WWMD-gated ship-phase Retry (v2 candidate).
11. Heartbeat batching / hot-table separation (v2 load review).
12. Cross-task stall propagation to children (v2 if v1 default proves insufficient).
