# Activity Quiescence Protocol

> **Observation architecture note:** this spec owns the durable quiescence lifecycle. Browser
> observation of that lifecycle follows the canonical
> [background-operation observation contract](../../architecture/background-operation-observation-contract.md):
> one shell system stream, event-as-invalidation, targeted projection rehydration, and no
> timer-driven route refresh.

| Field | Value |
| --- | --- |
| Date | 2026-05-24 |
| Status | Chief architect review applied; ready for implementation planning |
| Primary epic | None linked yet. Live backlog item `BI-40F05BAC` is in `triaging`; parent `BI-5B3FA415` (governed platform upgrade lifecycle) is also `triaging`. No active epic to extend. |
| Related backlog | `BI-40F05BAC` Activity Quiescence Protocol (this spec); `BI-5B3FA415` parent governed-upgrade lifecycle |
| Related docs | `docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md` §5.5 (the drain protocol this spec replaces); `docs/superpowers/specs/2026-05-19-build-studio-stall-detection.md` (BI-4ab6be39 — substrate this spec reuses); `docs/superpowers/specs/2026-05-22-build-studio-sandbox-admin-recovery-design.md` (another caller for quiescence) |
| Triggering signals | `project_self_upgrade_kills_in_session_ux.md` — the documented failure mode: PR #830 self-upgrade recycles portal on every bundle-hash change; server actions 404, executor flows drop, UX driving breaks during concurrent-PR merges. The Phase 0 stopgap at `apps/web/lib/self-upgrade/activity.ts` defers when a non-edge `ToolExecution` landed in the last 5 minutes — one signal across one surface, doesn't generalize across the 30 concurrent active surfaces this spec inventories. |
| Review evidence | Repo state and live backlog re-checked 2026-05-24 in worktree `claude/infallible-torvalds-936ac4`; DPF MCP confirms `BI-40F05BAC` and `BI-5B3FA415` remain `triaging` with no linked active epic. Next.js 16 Proxy/Edge runtime docs checked for request-gate feasibility. |

## 1. Purpose

The parent governed-upgrade spec [§5.5](2026-05-23-governed-platform-upgrade-lifecycle-design.md) sketched a 17-step "graceful recycle" protocol that treats *quiescence* — the act of getting in-flight work to a clean state — as a single operation. Codebase inspection finds 30 distinct concurrent active surfaces in the running portal, each with its own four answers:

1. **Detection** — how do we know work is in flight here?
2. **Stop-accept** — how do we refuse new work without killing existing work?
3. **Wait / checkpoint** — how do we let in-flight work finish or persist its state?
4. **Fail-safe** — bounded timeout, force-cancel, resume contract.

The current `getPortalActivity()` stopgap at `apps/web/lib/self-upgrade/activity.ts` is a single boolean derived from `ToolExecution` row recency. It defers upgrades when operators are active, but it generalizes to none of the actual quiescence concerns: it doesn't gate new work, doesn't wait on checkpoints, doesn't define resume contracts, and is invisible to in-process surfaces (SSE streams, browser-use sessions) that don't write `ToolExecution` rows at all.

This spec defines:

- A **per-surface quiescence protocol** — what detection signal, stop-accept primitive, wait checkpoint, and fail-safe each surface uses.
- A **coordinator** — `QuiescenceRun` entity + dedicated Inngest function + caller API — that orchestrates drain across surfaces, emits operator-visible evidence, and signals "ready to swap" to its caller.
- A **client-side counterpart** — SSE `system:quiescence` event, response-header version signal, banner state machine, and reconnect contract.
- The **replacement for parent spec §5.5** — the parent's 17-step drain becomes "call `startQuiescence`, await ready, do the swap, call `signalSwapComplete`."

The goal is to move the portal from "recycle blindly and hope" to "drain deterministically, surface what's blocking, defer cleanly when needed, resume native-checkpointed work transparently after the swap."

## 2. Current Repo Truth Checked

### 2.1 Surface inventory (Q1)

Code-grounded walk found 30 distinct surfaces. Grouped by quiescence behavior class:

| Group | Count | Examples (file:line) |
|---|---|---|
| **Inngest cron-driven** | 12 | self-upgrade hourly ([self-upgrade.ts:95](../../../apps/web/lib/queue/functions/self-upgrade.ts:95)); agent-task-dispatch 5min; taskrun-watchdog 1min ([taskrun-watchdog.ts:24](../../../apps/web/lib/queue/functions/taskrun-watchdog.ts:24)); discovery hourly (prometheusPoll + fullDiscoverySweep at [discovery-poll.ts:4,16](../../../apps/web/lib/queue/functions/discovery-poll.ts:4)); postgres-daily-backup; infra-prune weekly; model-discovery-refresh daily; code-graph-reconcile 15min; issue-report-triage 15min; wiki-lint; skill-curator; skill-metrics-aggregator; token-expiry-monitor; governed-backlog-tee-up daily |
| **Inngest event-driven** | 5 | `ops/self-upgrade.run` manual ([self-upgrade.ts:109](../../../apps/web/lib/queue/functions/self-upgrade.ts:109)); `ai/eval.run` background eval; `ai/probe.run`; `ops/mcp-catalog.sync`; deliberation-run |
| **In-process streaming** | 6 | SSE executor token stream ([api/agent/stream/route.ts](../../../apps/web/app/api/agent/stream/route.ts)); SSE task subscribe; SSE catalog sync progress; agent coworker reasoning loop (`executeAgentThread`); Build Studio phase state machine ([BuildPhaseRun](../../../packages/db/prisma/schema.prisma:4713)); browser-use sidecar sessions |
| **Bounded request-scoped** | 3 | Next.js server actions (the stale-action-ID hazard); MCP tool calls in flight; long Postgres transactions (Serializable thread spawn at [agent-threads.ts:100](../../../apps/web/lib/actions/agent-threads.ts:100)) |
| **Background / explicitly excluded** | 1 | Edge-node heartbeats (already filtered by `EDGE_AGENT_PREFIX` at [activity.ts:21](../../../apps/web/lib/self-upgrade/activity.ts:21) — pattern to generalize) |
| **Lifecycle-coupled (not independent)** | 3 | Build Studio sandbox containers (lifetime tied to phase machinery); assurance scan; hive scout ingest (dispatched via ScheduledAgentTask, not standalone cron) |

Not found in current code (named in research, absent from codebase): external webhook handlers (Stripe/GitHub) — no `apps/web/app/api/webhooks/` directory exists; will need to be re-evaluated when added. Distinct Next.js API-route surface separate from server actions — most API routes are SSE/preview/infra; no independent activity-tracking pattern.

The full per-surface table — including file:line refs, lifetime contracts, and the four columns — appears in §6 as part of the per-surface protocol design.

### 2.2 Current stopgap and why it doesn't generalize

`getPortalActivity()` at [activity.ts:49–69](../../../apps/web/lib/self-upgrade/activity.ts:49):

- **Single signal**: `ToolExecution` rows within last 5 minutes, excluding `agentId` starting with `edge-node:`.
- **Consumed by**: `runSelfUpgrade()` at [self-upgrade.ts:48–58](../../../apps/web/lib/queue/functions/self-upgrade.ts:48); returns `{ skipped: true, reason: "portal-active" }` if activity detected.
- **Three structural problems**:
  1. **Proxy, not direct signal.** A server action that performs a DB write but doesn't call any MCP tool is invisible — it writes no `ToolExecution` row. Most operator activity calls tools, but it's not a contract.
  2. **One surface, not 30.** SSE streams open with no recent tool call, browser-use sessions in flight, BuildPhaseRun mid-execution, long Postgres transactions, plugin MCPs holding HTTP sessions — none of these write `ToolExecution` rows on entry.
  3. **No graceful behavior.** The check is binary: defer the upgrade or don't. There is no "stop accepting new work but let existing work finish," no operator-visible evidence shape, no signal to in-flight work that it should checkpoint.

The stopgap was correctly scoped to the Phase 0 stabilization task in the parent spec. This spec is the substantive replacement.

### 2.3 Existing substrate to reuse (not reinvent)

Five DPF substrates already exist and the protocol reuses them rather than inventing parallel infrastructure:

| Substrate | Where | What quiescence reuses it for |
|---|---|---|
| BI-4ab6be39 heartbeat | [observability/heartbeat.ts:23–47](../../../apps/web/lib/observability/heartbeat.ts:23) — `heartbeat()` returns `false` when row leaves `working`/`active` state | Cooperative-cancel signal for coworker reasoning loops; flip TaskRun.status → next heartbeat returns false → loop exits at iteration boundary |
| TaskRun recovery | [actions/taskrun-recovery.ts:99–203](../../../apps/web/lib/actions/taskrun-recovery.ts:99) — per-phase Retry strategies (`resume-build`, `resume-plan`, `review-current`, `ship-force`, `fresh`) | After-swap resume contract for `paused-for-upgrade` TaskRuns; no new per-phase logic needed |
| BuildPhaseRun idempotency | [integrate/build-phase-run.ts:38–43](../../../apps/web/lib/integrate/build-phase-run.ts:38) — explicit "phase may restart rarely" | Phase row reused on resume; no new schema needed |
| agentEventBus subscription | [tak/agent-event-bus.ts](../../../apps/web/lib/tak/agent-event-bus.ts) — per-thread subscribe + EP-ASYNC-COWORKER-001 active-thread tracking | SSE delivery channel for `system:quiescence` event; extended with new `broadcastSystem()` primitive |
| PlatformConfig key-value | [self-upgrade/config.ts:48](../../../apps/web/lib/self-upgrade/config.ts:48) — established pattern (`portal.selfUpgrade`) | New `portal.quiescence` row holds runtime level state; hot-read by Node gates and exposed to Proxy via the internal state route |
| Inngest step.waitForEvent | Inngest framework primitive | Suspend-and-resume mechanism for Inngest functions during drain; no parallel pause infrastructure |

### 2.4 Gaps that must be closed (new code required)

| Gap | What's missing | Where it lands |
|---|---|---|
| Request-layer gate | `apps/web/proxy.ts` already exists for canonical-host, sandbox, auth, and route-class policy; it has no quiescence gate or version headers yet | Extend the existing Edge-safe `apps/web/proxy.ts` with quiescence header injection and mutation/SSE refusal while preserving current route policy order. Next.js 16 calls this Proxy, not Middleware. |
| Proxy state source | Proxy cannot import Prisma or Node-only helpers; no Node route exposes current quiescence state | New Node runtime route `apps/web/app/api/internal/platform/quiescence/state/route.ts`, excluded from Proxy matching; Proxy reads it with a short timeout + 1s module cache. |
| Version-signal headers | No `X-Bundle-Hash` or `X-Platform-Version` response headers exist anywhere | Same Proxy |
| Broadcast-to-all SSE | `agentEventBus.emit(threadId, event)` is per-thread only; no system-namespace event variant exists | Extend `tak/agent-event-bus.ts` |
| Global operator event stream | Existing SSE streams are opened only by active coworker/build/sync surfaces; a user sitting on `/ops` or `/platform` may have no EventSource open | New authenticated `apps/web/app/api/platform/events/route.ts`; `PlatformBannerProvider` subscribes globally from the shell layout. |
| Quiescing TaskRun status | `TaskRun.status` has no `quiescing` / `paused-for-upgrade` / `paused-for-upgrade-forced` values | Add status enum values + `quiescedAt` timestamp; one Prisma migration |
| Coordinator entity | `QuiescenceRun` model doesn't exist | New table |
| Coordinator function | No `ops/quiescence-run` Inngest function exists | New file `apps/web/lib/queue/functions/quiescence-run.ts` |
| Swap completion reconciliation | Current promoter can recreate the portal container; the old process may die before it can report completion | Add boot-time/post-health `reconcileQuiescenceOnBoot()` so a new portal process can complete or fail a run left in `swapping`. |
| Per-tool wait budgets | No central registry of MCP tool typical/max wait + killability | New file `apps/web/lib/mcp/tool-timeouts.ts` |
| Client banner | No `<PlatformBanner />` component exists | New component + provider context |

These are the load-bearing additions. The rest of the design is wiring + per-entry-point one-line gates.

## 3. Research & Benchmarking

The platform principle is to research standards before inventing (memory: `feedback_research_standards_first.md`). Comparable systems that solve adjacent quiescence problems:

### 3.1 Standards adopted

| Standard | Contribution | DPF decision |
|---|---|---|
| [Kubernetes Pod termination lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination) | `terminationGracePeriodSeconds` (default 30s) + `preStop` hook + `readinessProbe` flip-to-not-ready before SIGTERM. Two-phase: "stop accepting new work" (readiness false), then "drain existing work" (preStop), then "kill." | DPF's three quiescence levels (`normal` / `draining` / `swapping`) mirror this two-phase pattern, with `draining` ≈ readiness-false + preStop and `swapping` ≈ post-SIGTERM cleanup window. |
| [AWS ELB connection draining](https://docs.aws.amazon.com/elasticloadbalancing/latest/classic/config-conn-drain.html) | `deregistration_delay` (default 300s) — bounded wait for in-flight requests after target removal. Forces a per-protocol max. | DPF's `budgetMs` per quiescence run mirrors `deregistration_delay`; per-surface wait budgets in §6 collapse to a single coordinator-visible upper bound. |
| [Erlang/OTP hot code reload](https://www.erlang.org/doc/man/code.html) | Per-process code upgrade with `code:purge/2` after all callers have transitioned. The platform tracks per-module reference counts and only purges when zero. | DPF can't approach per-process granularity (Next.js is monolithic per-instance), but the principle — never swap while any consumer holds a reference — is what the `system:quiescence` + bundle-hash dual-signal achieves. |
| [Next.js 16 Proxy](https://nextjs.org/docs/app/getting-started/proxy) + [Edge Runtime](https://nextjs.org/docs/app/api-reference/edge) | Proxy is the current request-interception convention; it is intended for request/response shaping, not slow data fetching, and it runs in the limited Edge runtime. | DPF uses `apps/web/proxy.ts` for cheap header injection and mutation/SSE refusal only. It MUST NOT import Prisma, `@dpf/db`, filesystem APIs, or Node-only helpers. Dynamic quiescence state is read through an excluded Node runtime route with a short timeout and 1s cache. |

### 3.2 Comparable patterns

| Pattern | Adopted | Rejected |
|---|---|---|
| [Linkerd traffic shifting](https://linkerd.io/2.16/tasks/traffic-shifting/) — weighted gradual migration between service versions | Conceptually: client-side bundle-hash mismatch detection causes per-tab migration to the new bundle on next interaction, an emergent gradual shift. | Server-side weighted routing isn't applicable — DPF runs a single Next.js instance per install. |
| [Cloudflare Workers gradual deployment](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/) — percentage-based traffic split between versions | Same — emergent through client lag rather than explicit. | Same. |
| [Stripe API versioning](https://stripe.com/docs/upgrades) — clients pin to a specific API version, gradual migration over months | Inspiration only — DPF's "soft reload" gives clients an explicit, immediate version-step rather than gradual. | Pinning is wrong for a portal — operators expect "click works on whatever's deployed." |
| [Postgres `pg_terminate_backend()` for stuck queries](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-SIGNAL) | **Explicitly rejected for quiescence.** §5.5 marks long Postgres transactions as `killable:false`. Forcing termination mid-`Serializable` corrupts intent. | Coordinator must defer the upgrade rather than terminate. |

### 3.3 Project-specific benchmark

The closest internal comparable is `docs/superpowers/specs/2026-05-19-build-studio-stall-detection.md` (BI-4ab6be39). That spec built the heartbeat + watchdog + recovery substrate this spec reuses. The architectural lesson it carries forward:

> Cooperative cancellation (heartbeat returns false when the row's status changes) is more robust than imperative cancellation (kill the process). The work itself decides when to break the loop; the orchestrator just changes the signal it reads.

Quiescence adopts this directly: the protocol changes `TaskRun.status` to `quiescing`, and the loops cooperatively exit at their next heartbeat. No process kill, no abandoned partial state.

## 4. Problem Statement

### 4.1 §5.5 conflates "quiet" with "swap"

The parent spec's 17-step protocol mixes:

- The act of getting surfaces to a quiet state (steps 4–7).
- The act of doing the schema migration, seed deltas, container swap, and post-swap reconciliation (steps 8–12).
- Smoke verification + rollback (steps 13–17).

These have completely different concerns. Quiescence is operator-time and per-surface; swap is point-in-time and per-layer (L1/L2/L3/L4 from the parent spec); smoke is post-time and synthetic. Inlining quiescence into the upgrade orchestrator both blocks reuse (sandbox recovery and future maintenance workflows can't share the drain protocol) and bloats the upgrade flow with thirty surface-specific concerns.

### 4.2 Today's stopgap is structurally inadequate

§2.2 listed the three problems. The deeper issue: a single ToolExecution-recency boolean can never be the right answer. Quiescence demands a structured evidence shape (`activeSessionBlockers`) so the coordinator can decide differentially:

```
if (hardBlockers > 0)       defer;
else if (softBlockers > 0)  prompt operator;
else if (unobservable > 0)  proceed with extended budget;
else                        proceed immediately;
```

A boolean can't carry that decision.

### 4.3 The documented failure mode

From `project_self_upgrade_kills_in_session_ux.md`:

> PR #830 self-upgrade recycles portal on every bundle-hash change (i.e. every sibling-session PR merge to main). Server actions 404, executor flows drop, UX driving becomes unreliable when concurrent PR activity is happening.

Three concrete pathologies the protocol must eliminate:

1. **Stale server-action IDs**: browser holds cached server-action identifiers; the new bundle hashes them differently; next click returns 404.
2. **Dropped SSE streams**: token streams from coworker reasoning loops die mid-message with no client-side reconnection contract; the user sees a frozen half-rendered response.
3. **Mid-phase Build Studio kills**: a `build` phase mid-execution loses its checkpoint state; the operator has to manually retry from the BS UI, often with no clear understanding of why the build stopped.

The protocol solves all three: (1) Proxy refuses new actions during drain + bundle-hash mismatch triggers soft reload; (2) `system:quiescence` closes streams gracefully and `useResilientEventSource()` reconnects/replays from `TaskRun.progressPayload`; (3) BuildPhaseRun is treated as a hard blocker by default — the coordinator either waits for phase completion or defers the upgrade.

### 4.4 Unobservable surfaces produce silent failure modes

Class-G surfaces from the §2.1 inventory (bare MCP tool calls mid-execution before their `ToolExecution` row commits; long Postgres transactions not yet committed; in-flight steps inside an Inngest function between checkpoints) have no direct detection signal. Today the stopgap is silent about them; the upgrade just proceeds and hopes. The protocol must either gate these transitively (refuse the entry point that would START them) or surface them as `unobservableSurfaces` in evidence so the operator knows what the protocol can and cannot prove.

## 5. Design — Coordinator

### 5.1 `QuiescenceRun` entity

Separate model rather than extending `SelfUpgradeRun`. Quiescence is a phase of upgrade, but it's also independently triggerable (operator maintenance mode, sandbox recovery, future planned-downtime workflows). Coupling its state to `SelfUpgradeRun.status` ties it to one caller.

```prisma
model QuiescenceRun {
  id              String    @id @default(cuid())
  runId           String    @unique                    // e.g. QR-2026-05-24-abc123
  trigger         String                                // "self-upgrade" | "manual" | "sandbox-recovery"
  triggerRefId    String?                               // FK-ish to SelfUpgradeRun.runId when applicable

  status          String                                // see §5.2 state machine
  startedAt       DateTime  @default(now())
  enteredStateAt  Json      @default("{}")              // { draining: ts, swapping: ts, ... }
  swapStartedAt   DateTime?
  swapCompletedAt DateTime?
  completedAt     DateTime?
  lastHeartbeatAt DateTime?                             // Inngest function liveness

  initialSnapshot Json                                  // ActiveSessionBlockers (§5.6) at start
  finalSnapshot   Json?                                 // at completion / defer

  targetVersion   String?                               // expected post-swap platform version
  targetBundleHash String?                              // expected post-swap bundle hash

  budgetMs        Int                                   // operator-promised wait budget
  actualWaitMs    Int?

  deferReason     String?                               // populated when status='deferred'
  deferSurface    String?                               // which surface blocked
  forcedSurfaces  Json      @default("[]")              // surfaces force-cancelled past budget

  outcome         String?                               // succeeded | deferred-by-surface | aborted-by-operator | failed
  completionSource String?                              // caller | boot-reconciler | watchdog
  outcomeNotes    String?

  @@index([trigger, startedAt])
  @@index([status, lastHeartbeatAt])                   // for stuck-coordinator detection
}
```

The `enteredStateAt` JSON-of-timestamps pattern (rather than columns per state) keeps the model open to per-surface telemetry expansion without a migration per signal added. `lastHeartbeatAt` reuses the BI-4ab6be39 pattern so the existing watchdog can detect stuck coordinators.

### 5.2 State machine

```
                  ┌─────────────────────────────────────┐
                  │                                     │
                  ▼                                     │
   pending → preparing → draining → ready-to-swap → swapping → completed
                            │              │             │
                            │              └─→ aborted   └─→ failed
                            │                 (before       (swap failed /
                            │                  swap)         boot reconcile failed)
                            └─→ deferred (auto, on hard-blocker timeout)
                                   │
                                   └─→ (caller may retry by creating a new run)

   any state → failed (coordinator crash / Inngest function error)
```

Per-state contract:

| State | Invariant | Operator-visible? |
|---|---|---|
| `pending` | Row created, Inngest function dispatched but not started | yes |
| `preparing` | Initial snapshot captured; about to flip level | yes |
| `draining` | `PlatformConfig.portal.quiescence.level = "draining"`; all stop-accept primitives (§6) active; waiting for §6.X checkpoints | yes — banner shown |
| `ready-to-swap` | `hardBlockers === 0`; coordinator paused awaiting `signalSwapStarting` from caller. Level remains `draining` so new work stays refused until the caller explicitly accepts the swap window. | yes |
| `swapping` | `PlatformConfig.portal.quiescence.level = "swapping"`; Proxy rejects everything except edge, health, and the internal quiescence state route; caller has persisted target version/hash and is applying the swap. Completion may be reported by the caller or by post-boot reconciliation if the old process dies. | yes |
| `completed` | Swap succeeded; level back to `normal`; durable and UI cleared events emitted | terminal |
| `deferred` | Hard blocker exceeded budget; level back to `normal`; new run may be scheduled | terminal — operator sees defer reason |
| `aborted` | Operator cancelled before `swapping`; cleanup identical to deferred. After `swapping`, cancellation becomes rollback/failure handling in the parent upgrade spec. | terminal |
| `failed` | Coordinator crashed; watchdog forces level reset | terminal |

**Critical invariant**: every terminal transition (`completed`, `deferred`, `aborted`, `failed`) calls one idempotent helper, `emitQuiescenceTerminal(runId, outcome)`. That helper emits both transports from the same state change:

- Durable Inngest event `platform.quiescence-cleared` for functions suspended on `step.waitForEvent`.
- UI `system:quiescence` event with `level: "cleared"` for the global banner and open task streams.

These are two transports, not one shared event. Without both, either the queue can wait forever or the operator UI can remain stuck after a coordinator crash.

### 5.3 Sequencing inside the coordinator function

The drain order, encoded as named Inngest steps so each is independently checkpointed and retryable:

```ts
// apps/web/lib/queue/functions/quiescence-run.ts (new)
export const quiescenceRun = inngest.createFunction(
  { id: "ops/quiescence-run", retries: 0, concurrency: { limit: 1, scope: "fn" } },
  { event: "ops/quiescence.start" },
  async ({ event, step }) => {
    const runId = event.data.runId as string;
    const budgetMs = event.data.budgetMs as number;
    const triggerRefId = event.data.triggerRefId as string | undefined;

    const initialSnapshot = await step.run("snapshot-initial", captureActiveSessionBlockers);
    await step.run("enter-preparing", () => transitionState(runId, "preparing", { initialSnapshot }));

    await step.run("enter-draining", () => transitionState(runId, "draining"));
    await step.run("flip-level-draining", () => setQuiescenceLevel("draining"));
    await step.run("broadcast-quiescence", () => broadcastSystemEvent("quiescence", {
      level: "draining", swapEtaSeconds: budgetMs / 1000, runId,
    }));
    await step.run("flip-taskruns-quiescing", flipActiveTaskRunsToQuiescing);

    // Wait loop — re-snapshot every 5s up to budget. Step ids MUST be deterministic
    // across retries; never include Date.now() or other non-replayable values.
    const maxTicks = Math.max(1, Math.ceil(budgetMs / 5_000));
    let lastSnapshot: ActiveSessionBlockers = initialSnapshot;
    for (let tick = 0; tick < maxTicks && lastSnapshot.hardBlockers > 0; tick += 1) {
      await step.sleep(`drain-tick-${tick}`, "5s");
      lastSnapshot = await step.run(`snapshot-drain-${tick}`, captureActiveSessionBlockers);
      if (lastSnapshot.hardBlockers === 0) break;
      await step.run(`heartbeat-${tick}`, () => heartbeatQuiescenceRun(runId));
    }

    if (lastSnapshot.hardBlockers > 0) {
      const blockingSurface = pickPrimaryBlocker(lastSnapshot);
      await step.run("enter-deferred", () => transitionState(runId, "deferred", {
        finalSnapshot: lastSnapshot,
        deferReason: `Hard blocker exceeded ${budgetMs}ms budget`,
        deferSurface: blockingSurface,
      }));
      await step.run("flip-level-normal", () => setQuiescenceLevel("normal"));
      await step.run("emit-cleared-deferred", () =>
        emitQuiescenceTerminal(runId, { outcome: "deferred", triggerRefId }),
      );
      return { ok: false, outcome: "deferred", deferSurface: blockingSurface };
    }

    await step.run("enter-ready-to-swap", () => transitionState(runId, "ready-to-swap", { finalSnapshot: lastSnapshot }));

    const swapStart = await step.waitForEvent("await-swap-starting", {
      event: "ops/quiescence.swap-starting",
      timeout: "10m",
      if: `async.data.runId == "${runId}"`,
    });

    if (!swapStart) {
      await step.run("enter-aborted", () => transitionState(runId, "aborted", { outcomeNotes: "caller did not accept ready-to-swap within 10m" }));
      await step.run("flip-level-normal-on-abort", () => setQuiescenceLevel("normal"));
      await step.run("emit-cleared-aborted", () =>
        emitQuiescenceTerminal(runId, { outcome: "aborted", triggerRefId }),
      );
      return { ok: false, outcome: "aborted" };
    }

    // signalSwapStarting() already persisted level=swapping before returning to
    // the caller. This step is idempotent confirmation for the durable timeline.
    await step.run("enter-swapping", () => transitionState(runId, "swapping", {
      targetVersion: swapStart.data.targetVersion,
      targetBundleHash: swapStart.data.targetBundleHash,
    }));
    await step.run("flip-level-swapping", () => setQuiescenceLevel("swapping"));
    await step.run("broadcast-swapping", () => broadcastSystemEvent("quiescence", {
      level: "swapping", swapEtaSeconds: 30, runId,
    }));

    const swapComplete = await step.waitForEvent("await-swap-complete", {
      event: "ops/quiescence.swap-complete",
      timeout: "30m",
      if: `async.data.runId == "${runId}"`,
    });

    if (!swapComplete) {
      await step.run("enter-failed", () => transitionState(runId, "failed", { outcomeNotes: "swap-complete signal never received within 30m" }));
      await step.run("flip-level-normal-on-failure", () => setQuiescenceLevel("normal"));
      await step.run("emit-cleared-failed", () =>
        emitQuiescenceTerminal(runId, { outcome: "failed", triggerRefId }),
      );
      return { ok: false, outcome: "failed" };
    }

    await step.run("enter-completed", () => transitionState(runId, "completed", {
      swapCompletedAt: swapComplete.data.completedAt,
      completionSource: swapComplete.data.source ?? "caller",
    }));
    await step.run("flip-level-normal-on-success", () => setQuiescenceLevel("normal"));
    await step.run("emit-cleared-success", () =>
      emitQuiescenceTerminal(runId, { outcome: "succeeded", triggerRefId }),
    );

    return { ok: true, outcome: "succeeded", runId };
  },
);
```

Note `triggerRefId` is included on every `platform.quiescence-cleared` payload (deferred, aborted, failed, succeeded). Callers that `step.waitForEvent` on the cleared event use `if: async.data.triggerRefId == "..."` to filter when multiple non-self-upgrade callers (e.g., concurrent manual + sandbox-recovery) might emit in close sequence. Without this, a sibling caller's terminal event could wake the wrong waiter.

`signalSwapStarting()` is deliberately separate from `signalSwapComplete()`. The caller MUST persist `swapping` before running `runPromoter`; otherwise the UI and Proxy only learn about the swap after it has already happened. Because `scripts/promote.sh` can recreate the portal container, `signalSwapComplete()` is best-effort from the old process. The durable fallback is `reconcileQuiescenceOnBoot()` in the new process: after `/api/health` is live and `platform.version` / bundle hash match the stored target, it emits `ops/quiescence.swap-complete` with `source: "boot-reconciler"`.

Three properties this preserves:

- **Resumable on worker restart** — every `step.run` is checkpointed; a worker dying mid-drain resumes from the next step.
- **Single-flight via API lease + Inngest backstop** — `startQuiescence()` uses a DB transaction/advisory lock to return the active run by default; Inngest `concurrency: { limit: 1, scope: "fn" }` prevents accidental double execution if events race.
- **Caller-coordinator handshake via events** — `ops/quiescence.swap-complete` is the swap-done signal; matches Inngest distributed-coordination idiom.

### 5.4 Coordinator API

```ts
// apps/web/lib/self-upgrade/quiescence.ts (new — sibling to activity.ts)

// Hot-read by Node gates. Proxy reads the internal state route instead of
// importing this Node/Prisma-backed helper directly.
// Backed by PlatformConfig["portal.quiescence"] with in-memory 1s TTL cache.
export async function getQuiescenceLevel(): Promise<"normal" | "draining" | "swapping">;

// Called by callers (runSelfUpgrade, sandbox recovery, etc.) to start a drain.
// Returns immediately with a runId; awaitReady() blocks until ready-to-swap or terminal.
export async function startQuiescence(opts: {
  trigger: "self-upgrade" | "manual" | "sandbox-recovery";
  triggerRefId?: string;
  budgetMs?: number;     // defaults to 5min (§5.5)
  concurrencyMode?: "join-active" | "queue-after-active"; // default join-active
}): Promise<{ runId: string; awaitReady: () => Promise<QuiescenceOutcome> }>;

// Called by caller immediately AFTER awaitReady() succeeds and immediately BEFORE
// runPromoter. Persists state=swapping/level=swapping before returning.
export async function signalSwapStarting(runId: string, opts: {
  targetVersion?: string;
  targetBundleHash?: string;
}): Promise<void>;

// Called by caller AFTER it has done the actual swap (e.g., runPromoter returned 0).
// Best-effort from the old process; reconcileQuiescenceOnBoot is the durable fallback.
export async function signalSwapComplete(runId: string): Promise<void>;

// Called when the swap attempt fails after signalSwapStarting.
// Transitions swapping -> failed and emits terminal events.
export async function failQuiescenceSwap(runId: string, reason: string): Promise<void>;

// Called by operator from /ops/self-upgrade UI.
export async function abortQuiescence(runId: string, operatorUserId: string): Promise<void>;

// Called during platform-version boot reconciliation. Completes or fails a
// swapping run left behind by a process/container replacement.
//
// LANDED (2026-06-20). Implemented in apps/web/lib/self-upgrade/quiescence.ts
// and wired at boot + on a 20-min periodic safety net in
// apps/web/instrumentation.ts (alongside reconcileSelfUpgradeRunsOnBoot). It
// matches a run's stored target against the running bundle identity
// (DEPLOYED_SHA, compared to targetBundleHash/targetVersion), then: in-flight +
// match -> signalSwapComplete (drive the live coordinator's success path);
// in-flight + no-match -> failQuiescenceSwap; recently-`failed` + match ->
// transition completed (completionSource="boot-reconciler") + re-emit a
// truthful quiescence-cleared/succeeded.
//
// Why it was load-bearing: until it landed, the stub returned `{reconciled:0}`
// and was never called, so EVERY successful self-upgrade whose swap recreated
// the portal orphaned the coordinator, which then ran out its full 10-minute
// waitForEvent and emitted `outcome=failed`. The PlatformBanner rendered that
// as "Upgrade postponed, failed. You can continue working." even though the
// SelfUpgradeRun was `succeeded` and DEPLOYED_SHA matched the target — a
// false-negative observed on the live install for the 2026-06-18 and
// 2026-06-20 upgrades (QuiescenceRun.outcomeNotes = "swap-complete signal never
// received within 10m"). The new portal now completes the handshake the dying
// portal could not.
export async function reconcileQuiescenceOnBoot(): Promise<void>;

type QuiescenceOutcome =
  | { ok: true; outcome: "ready-to-swap"; runId: string; finalSnapshot: ActiveSessionBlockers }
  | { ok: false; outcome: "deferred"; deferSurface: string; finalSnapshot: ActiveSessionBlockers }
  | { ok: false; outcome: "aborted" | "failed"; reason: string };
```

Default `concurrencyMode: "join-active"` means a second caller receives the active run and waits on its outcome instead of creating a surprise follow-on drain. Explicit `queue-after-active` is reserved for manual maintenance workflows that truly want a second run after the first terminal state. The API enforces this under a DB transaction/advisory lock; Inngest function concurrency is only the execution backstop, not the correctness boundary.

The integration with `runSelfUpgrade` collapses the parent spec's §5.5 numbered protocol into ~12 lines of caller code; see §8.

### 5.5 Wait budgets — three regimes

Three regimes the operator sees when deciding whether to trigger an upgrade:

| Regime | When | Default budget | Past-budget behavior |
|---|---|---|---|
| **Fast drain** | No BuildPhaseRun in flight, no `killable:false` MCP tools | 60 seconds | Force-close SSE; coordinator escalates |
| **Normal drain** | At least one mid-phase BuildPhaseRun or active coworker loop | 5 minutes | Operator prompt at 80% budget |
| **Extended drain** | Long-running tool (eval, deliberation) in flight | up to tool's `maxMs` from per-tool registry | Operator prompt at 80% budget |

The coordinator chooses regime at `preparing` time by inspecting `initialSnapshot`. Operator can override via `budgetMs` parameter; manual `startQuiescence` calls (non-self-upgrade) may pass arbitrary budgets.

**When multiple regimes apply** (e.g., normal drain regime AND a `build` phase blocker present), the effective budget is `max(regimeBudget, phaseBudget)`. A `build` phase in flight uses the §6.5 phase budget (30 min) even under the Normal drain regime; otherwise the 5-min regime budget would defer-then-retry forever against any in-progress build. The "Operator prompt at 80% budget" timing uses the effective budget.

### 5.6 `ActiveSessionBlockers` evidence shape

The structured snapshot the coordinator captures at `preparing`, re-captures during the wait loop, and stores as `initialSnapshot` / `finalSnapshot`. This is also what populates the parent spec's [§5.2.1 Layer 1 `activeSessionBlockers` column](2026-05-23-governed-platform-upgrade-lifecycle-design.md) on `PreflightRun` — today a hand-wave; this spec makes it concrete.

```ts
type ActiveSessionBlockers = {
  capturedAt: string;
  thresholdMs: number;
  totalBlockers: number;
  hardBlockers: number;          // surfaces that MUST quiesce before swap
  softBlockers: number;          // operator-overridable
  unobservableSurfaces: string[];// class-G surfaces known to exist but unsignalled
  surfaces: SurfaceBlocker[];
};

type SurfaceBlocker = {
  surface: string;                    // canonical id, e.g., "coworker.reasoning-loop"
  detectionClass: "A"|"B"|"C"|"D"|"E"|"F"|"G";
  kind: "hard" | "soft";
  blockerSignal: BlockerSignal;
  estimatedWaitMs: number | null;     // null = unbounded
  evidence: Record<string, unknown>;  // surface-specific
};

type BlockerSignal =
  | { class: "A"; model: string; rowId: string; status: string }
  | { class: "B"; model: string; mostRecentAt: string; windowMs: number; count: number }
  | { class: "C"; model: string; rowId: string; lastHeartbeatAt: string; staleAfterMs: number }
  | { class: "D"; functionId: string; runId: string; status: "Running"|"Scheduled"; currentStep?: string }
  | { class: "E"; registry: string; subscriberCount: number; sampleIds?: string[] }
  | { class: "F"; endpoint: string; observation: unknown }
  | { class: "G"; reason: string; mitigations: string[] };
```

The seven-class detection taxonomy (A–G) categorizes every surface by signal trustworthiness:

| Code | Kind | What we read | Trust |
|---|---|---|---|
| **A** | DB-row status | `TaskRun.status='active'`, `BuildPhaseRun.completedAt IS NULL`, `SelfUpgradeRun.status='running'` | high — committed state |
| **B** | DB-row recency (proxy) | "Was a side-effect row written in last N min?" — today's stopgap | medium — proxy, not direct |
| **C** | DB heartbeat freshness | `lastHeartbeatAt > now - threshold` (TaskRun) | high — designed for liveness |
| **D** | Inngest API | `inngest.functions.runs.list({functionId, status: 'Running'})` | high — authoritative for Inngest |
| **E** | In-memory registry | `agentEventBus` subscriber map, SSE counts | medium — invisible cross-process, lost on swap |
| **F** | External process query | `docker inspect`, browser-use `/status`, `pg_stat_activity` | high — direct observation |
| **G** | None today | Bare MCP mid-call before commit; in-progress txns writing nothing | unknown — managed via upstream gate |

Operator UI renders each surface differently based on `detectionClass`: A/C/D/F = "confirmed in flight"; B = "inferred from proxy"; E = "in-memory only (cross-process invisible)"; G appears in `unobservableSurfaces` separately with "managed by entry-point gate" footnote.

### 5.7 Stuck-coordinator detection

`QuiescenceRun.lastHeartbeatAt` is written every wait-loop tick (~5s). If a coordinator crashes between ticks, the row sits in `draining` indefinitely. Two defenses:

1. **Extend existing 1-minute `taskrunWatchdog`** at [taskrun-watchdog.ts:24](../../../apps/web/lib/queue/functions/taskrun-watchdog.ts:24). Detection: `QuiescenceRun WHERE status NOT IN (terminal) AND lastHeartbeatAt < now - 2min`. Action: transition to `failed`, force level back to `normal`, emit `platform.quiescence-cleared`.
2. **Inngest function timeout** — declare `timeout: "60m"` so even without the watchdog, Inngest itself terminates a runaway coordinator. **60min — not 30min** — because §6.5's `build` phase budget is 30min, and at 30min coordinator timeout the watchdog would race the legitimate completion of a long build and flip level back to `normal` mid-wait, causing `awaitReady` to return `failed` even when nothing is wrong. 60min gives 2× headroom over the longest legitimate single-surface wait. The watchdog is secondary defense.

**Watchdog allow-list for new TaskRun statuses**: the existing `taskrunWatchdog` at [taskrun-watchdog.ts:60](../../../apps/web/lib/queue/functions/taskrun-watchdog.ts:60) filters `status IN ('working', 'active')` to find stall candidates. The new `quiescing` value is intentionally in-flight but cooperatively cancelling — it must NOT be flagged as a stall (the loop will exit on next heartbeat). Filter stays as-is; `quiescing` is implicitly excluded. The two `paused-for-upgrade*` values are terminal-ish (loop has exited) and also implicitly excluded. BI-QUIESCE-001 must include a watchdog regression test confirming none of the three new statuses appear in stall candidates.

## 6. Design — Per-Surface Protocol

Each subsection covers a surface category from §2.1 with its four answers (Detection / Stop-accept / Wait / Fail-safe + Resume).

### 6.1 Inngest functions (D-class, 17 surfaces)

**Detection** — Inngest API: `runs.list({functionId, status: 'Running' | 'Scheduled'})`. For functions writing `ScheduledJob.lastStatus` (eval, probe), DB row is secondary signal.

**Stop-accept** — Two helpers in `apps/web/lib/queue/inngest-client.ts`:

- `gateAtEntry(step, inngestId)` — for cron functions. Returns early with `{ skipped: true, reason: "quiescing" }` if level ≥ `draining`. Function will re-fire on next cron tick after `cleared`. Since BI-7E49FA15 the same gate also enforces the per-job kill switch (`ScheduledJob.enabled`, reason `disabled-by-operator`) for catalog entries declaring `honorsEnabledGate: true`; the required `inngestId` is how it resolves the job — see `docs/superpowers/specs/2026-08-28-scheduled-job-kill-switch-design.md`.
- `gateBetweenSteps(step)` — for long-running event-driven functions. Calls `step.waitForEvent("platform.quiescence-cleared", { timeout: "30m" })` between major steps to suspend cleanly. Resumes when the durable Inngest `platform.quiescence-cleared` event fires for any terminal outcome. The UI `system:quiescence` event is emitted from the same transition but is not the durable wake signal.

Every existing Inngest function in `apps/web/lib/queue/functions/` is wrapped with the appropriate gate as a Phase 1 deliverable. Cron functions get `gateAtEntry`; event-driven and long-running functions get `gateBetweenSteps` between their natural steps.

**Wait / checkpoint** — Inngest's native step boundary. Worst-case wait per function = single step max (typically <5min; ai/eval is the worst at ~5min step timeout).

**Fail-safe + Resume** — Inngest native. Worker dies mid-step → function retries from last checkpoint on next dispatch. Suspended function resumes when `platform.quiescence-cleared` fires. No extra contract needed.

**Exception — `selfUpgradeScheduled`, `selfUpgradeManual`, and `quiescenceRun` themselves**: these are the CALLERS / COORDINATOR of quiescence. Gating them would deadlock the upgrade. Explicitly exempt from `gateAtEntry`; they consume `getQuiescenceLevel` directly to make their own routing decisions.

### 6.2 Coworker reasoning loops (A + C class, 1 surface)

**Detection** — `TaskRun.status ∈ {active, working}` (A-class) plus `lastHeartbeatAt` freshness (C-class). Both signals already exist in the BI-4ab6be39 substrate.

**Stop-accept** — Two-layer gate:

1. Entry point: `spawnWorkThread()` at [agent-threads.ts:27](../../../apps/web/lib/actions/agent-threads.ts:27) checks `getQuiescenceLevel()` and throws `QuiescingError` if not `normal`. New TaskRuns refused.
2. In-flight loops: coordinator runs `UPDATE TaskRun SET status='quiescing', quiescedAt=NOW() WHERE status IN ('working','active')` in single statement. Each loop's next `heartbeat()` call returns `false` (per [heartbeat.ts:27](../../../apps/web/lib/observability/heartbeat.ts:27): "Returns false if the row is no longer in 'working' — caller can treat that as cooperative cancellation"). Loop exits at next iteration boundary.

**Wait / checkpoint** — Iteration boundary. Typical: 5–30s (tool call + LLM round-trip). Worst case: ~3min (a long Claude/Codex reasoning step with no intermediate tool calls — bounded by LLM provider timeout).

**Fail-safe** — Per §5.5 normal-drain budget (5min default), force-cancel via existing `agentEventBus.requestCancel(threadId)` at [agent-event-bus.ts:112](../../../apps/web/lib/tak/agent-event-bus.ts:112) (machinery already exists, just newly invoked by the coordinator). Status flips to `paused-for-upgrade-forced` distinguishing from cooperative `paused-for-upgrade`.

**Resume contract** — Operator clicks "Resume" on the UI thread → calls `taskrunRetry(taskRunId)` with new `quiescence-resume` strategy (variant of `resume-plan` at [taskrun-recovery.ts:156–181](../../../apps/web/lib/actions/taskrun-recovery.ts:156)) that pre-seeds prior message context. No auto-resume in v1 — operator-gated avoids surprising users who navigated away.

### 6.3 SSE streams (E-class, 3 surfaces)

**Detection** — `agentEventBus` subscriber Sets in process memory. E-class limitation: invisible cross-process; only the same Next.js process can read its own subscribers. DPF is single-org-per-install / single-portal-instance so this is acceptable.

**Stop-accept** — Three-step protocol on `normal → draining`:

1. `agentEventBus.broadcastSystem({ type: "system:quiescence", level: "draining", swapEtaSeconds, runId })` — iterates every subscriber Set, emits the event. (New primitive — §2.4 gap.)
2. Each open stream emits the event to its client, then continues serving its existing event chain (no mid-stream cancel).
3. Proxy (§6.4) rejects NEW SSE handshakes with 503 + Retry-After.

**Wait / checkpoint** — Stream closes when current event chain reaches `done`. Client receives `system:quiescence`, EventSource closes cleanly via AbortSignal, server unsubscribes. Typical: <500ms after broadcast. Worst case: bounded by `forceCloseAfterMs` (default 5s) — server force-closes via AbortController on the Response object.

**Fail-safe** — 5s force-close window past broadcast. Force-close is safe (closing a stream is non-destructive).

**Resume contract** — `useResilientEventSource()` owns reconnect/backoff. New connection hits Proxy 503 during drain → backs off with floor/jitter → succeeds when level returns to `normal`. Replay machinery (EP-ASYNC-COWORKER-001 at [agent-event-bus.ts:91–106](../../../apps/web/lib/tak/agent-event-bus.ts:91)) catches clients up from `TaskRun.progressPayload` where available. Direct current consumers must migrate in BI-QUIESCE-008; this is not "free" in the existing repo because some handlers close permanently on `onerror`.

**Exception — SSE catalog sync progress**: marked `killable: false`. The catalog sync underneath is mid-upsert; force-closing the SSE doesn't kill the sync but loses operator visibility. Coordinator treats an in-flight catalog sync as a hard blocker.

### 6.4 Request layer — server actions + page POSTs (B-class, many surfaces)

**Detection** — B-class proxy via `ToolExecution` recency (today's stopgap). Sharpened by Node-runtime mutation wrappers writing an `inFlightActions` gauge (new in-memory counter exposed through the same internal state route). Proxy itself should not own this gauge because it cannot reliably observe route completion.

**An observation is not activity (BI-2C7F51BA).** Every MCP call writes a `ToolExecution` row, including read-only ones — so the raw recency signal cannot tell a worker from a *waiter*. Observed 2026-08-04, twice independently: a coordinator sat at `ready-to-swap` with exactly one drain blocker, `request.recent-tool-execution` count 1, which was the waiting local-CI gate's own liveness poll. The gate waited for the drain; the waiting is what prevented the drain from clearing. `get_quiescence_status` — a read explicitly permitted during quiescence — has the same effect: any agent checking whether it is safe to proceed extends the condition it is checking.

The signal therefore excludes tool names whose canonical `resolveAnnotations().readOnlyHint` is true ([`read-only-tool-signal.ts`](../../../apps/web/lib/self-upgrade/read-only-tool-signal.ts)), applied *in* the query so a page of reads can never hide a mutating call behind `take: 5`. This narrows the SIGNAL, not the protocol: the scheduled/unattended path still honours soft blockers (BI-F36E7510), and mutating calls block the drain exactly as before. The same argument was already accepted one stage earlier at TRIGGER time in [`self-upgrade.ts`](../../../apps/web/lib/queue/functions/self-upgrade.ts) (BI-CC82B9A8); it simply had never been carried through to drain/swap. Waiters additionally back off as a drain persists rather than polling at a fixed interval, so an unexcluded observer cannot re-arm the blocker at a constant rate.

**Stop-accept** — extend the existing `apps/web/proxy.ts` (§2.4 gap). Next.js 16 renamed Middleware to Proxy; Proxy runs in the Edge runtime and cannot import Prisma, `@dpf/db`, filesystem APIs, or Node-only helpers. Therefore the gate has two layers:

1. **Proxy path** — injects version headers on all matched responses and rejects mutation POSTs / new SSE handshakes when cached quiescence state is `draining` or `swapping`.
2. **Node state path** — `GET /api/internal/platform/quiescence/state` runs in the Node runtime, reads `PlatformConfig["portal.quiescence"]`, and returns `{ level, runId, retryAfterSeconds, version, bundleHash }`. This route is excluded from Proxy matching to avoid recursion.

Proxy reads the Node state path with a 50ms timeout and 1s module-level cache. On timeout, it fails open for idempotent GETs and fails closed for mutation POSTs only when the last cached state was non-normal; this keeps the platform usable during transient state-route hiccups while preserving the drain once observed.

Per-request decision:

```ts
const state = await getCachedQuiescenceState(req); // Edge-safe fetch, no Prisma import
const level = state.level;
// Version headers go on EVERY response, including 503s — clients need to detect
// bundle mismatch from any response, not just successful ones.
const versionHeaders = {
  "X-Platform-Version": state.version,
  "X-Bundle-Hash": state.bundleHash,
};

if (level === "swapping") {
  return new Response(null, { status: 503, headers: { ...versionHeaders, "Retry-After": "30" } });
}
if (level === "draining") {
  if (isServerAction(req) || isMutationPOST(req) || isNewSSEHandshake(req)) {
    return new Response(null, { status: 503, headers: { ...versionHeaders, "Retry-After": "30" } });
  }
  // GETs, page loads, page-data revalidation: allow.
}
// Allowed path — inject headers onto whatever the route handler returns:
response.headers.set("X-Platform-Version", state.version);
response.headers.set("X-Bundle-Hash", state.bundleHash);
```

Edge-node heartbeat paths (`/api/v1/edge/*`) and `/api/health` are explicitly allow-listed — they're consumed by non-browser callers that don't care about quiescence.

**Wait / checkpoint** — HTTP response written. Natural boundary. Worst case: bounded by Next.js server-action timeout (~30s default).

**Fail-safe** — None needed. Server actions in flight when level flips complete naturally; no cancel needed.

**Resume contract** — Proxy allows new requests once level returns to `normal`. Combined with client-side action gate (§7.4), the operator never sees a 503 in normal UX flow.

### 6.5 Build Studio phases + sandbox (A-class, 2 surfaces)

**Detection** — `BuildPhaseRun.completedAt IS NULL AND phase ∈ {ideate, plan, build, review, ship}`. Schema-confirmed unique index `(buildId, phase)` at [schema.prisma:4730](../../../packages/db/prisma/schema.prisma:4730).

**Stop-accept** — Gate `startBuildPhaseRun()` at [build-phase-run.ts:30](../../../apps/web/lib/integrate/build-phase-run.ts:30) and the canonical sandbox acquisition seam (`sandboxPool.acquire()` if that is introduced as the seam). Both throw `QuiescingError` if level ≥ `draining`. New phase transitions and new sandbox acquisitions refused.

**Wait / checkpoint** — Phase completion. Phase-specific wait budget:

| Phase | Default budget | Budget basis |
|---|---|---|
| `ideate` | 5 min | typical phase duration |
| `plan` | 5 min | typical with deliberation |
| `build` | 30 min | bounded by existing `BuildStudioStallThreshold` |
| `review` | 5 min | typical reviewer pass |
| `ship` | **unbounded by default — emergency override available** | per [taskrun-recovery.ts:224–228](../../../apps/web/lib/actions/taskrun-recovery.ts:224) ship-force gate; double-publish risk |

**Fail-safe** — Per-phase budget exhausts → defer the upgrade (NOT force-cancel the phase). Phase keeps running; coordinator transitions to `deferred`; operator sees defer reason with phase id.

**Ship-phase override**: by default the coordinator defers indefinitely while a ship-phase BuildPhaseRun is mid-flight. An operator can force the upgrade through using an emergency override that matches the existing `ship-force` ceremony from [taskrun-recovery.ts:191–197](../../../apps/web/lib/actions/taskrun-recovery.ts:191) — explicit `{ shipForce: true }` flag on `startQuiescence`, recorded on `QuiescenceRun.forcedSurfaces` for audit, with the same double-publish-risk acknowledgment text shown to the operator. This is the same shape as the recovery ceremony already in the codebase; quiescence reuses it rather than inventing a parallel override.

**Resume contract** — After successful upgrade and swap:

- Phase row's `completedAt` is null; `FeatureBuild` is still at the same `runningPhase`. Idempotent `startBuildPhaseRun` upserts the existing row.
- Build phase: `runBuildPipeline(buildId, existingState)` resumes from failed step — `FeatureBuild.buildExecState` IS the checkpoint, explicitly designed per [taskrun-recovery.ts:150–152](../../../apps/web/lib/actions/taskrun-recovery.ts:150).
- Plan/review phases: per-phase `taskrunRetry` strategy from [taskrun-recovery.ts:142–203](../../../apps/web/lib/actions/taskrun-recovery.ts:142) — already exists, reused.

Sandbox containers are lifecycle-coupled to BuildPhaseRun — rolled up into phase wait. Sandbox release happens at phase-end, never mid-phase.

### 6.6 MCP tool calls + long Postgres transactions (B-proxy + G class)

**Detection** — MCP: B-class proxy via `ToolExecution` recency for completed calls; bare in-flight calls are G-class (no signal until `ToolExecution` commits on completion). Postgres txns: F-class via `pg_stat_activity` query.

**Stop-accept** — No direct gate possible on either. Gated **upstream** via entry-point refusal:
- Coworker reasoning loop refuses new TaskRuns → no new tool dispatches.
- Proxy refuses mutation POSTs → no new actions starting txns.
- Inngest gates refuse new dispatches → no new background work spawning either.

This is the structural answer: class-G surfaces are managed transitively by gating every surface that could START them.

**Wait / checkpoint** — MCP: tool returns + `ToolExecution` row commits. Per-tool max from new registry:

```ts
// apps/web/lib/mcp/tool-timeouts.ts (NEW — §2.4 gap)
export const TOOL_WAIT_BUDGETS: Record<string, {
  typicalMs: number; maxMs: number; killable: boolean;
}> = {
  "start_deliberation":  { typicalMs: 30_000,  maxMs: 180_000, killable: true },
  "start_build":         { typicalMs: 5_000,   maxMs: 30_000,  killable: false },  // commits, must not interrupt
  "brand-extract":       { typicalMs: 7_000,   maxMs: 30_000,  killable: true },
  "run_endpoint_tests":  { typicalMs: 60_000,  maxMs: 300_000, killable: true },
  // … one row per registered MCP tool; new tool registration MUST add an entry
};
```

Coordinator sums `maxMs` for in-flight tools to compute wait budget. `killable: false` tools (anything irreversibly committing to DB or external state) anchor upper bound — coordinator must wait, not force-cancel.

Postgres: `COMMIT` or `ROLLBACK`. Typical: <100ms; Serializable thread spawn ~seconds; schema migration: minutes (but migrations are separately gated — they're part of parent spec's L2 Apply, not quiescence).

**Fail-safe** — MCP `killable: true`: force-cancel after registry `maxMs`. MCP `killable: false`: defer the upgrade. Postgres: NEVER force-cancel (`pg_terminate_backend` mid-Serializable corrupts index state) — defer the upgrade if any txn exceeds 10s threshold.

**Resume contract** — MCP `killable: true`: Inngest function wrapping the call retries on next dispatch. MCP `killable: false`: natural completion before swap; no resume needed. Postgres: natural commit; coordinator picks back up at next loop tick.

### 6.7 Unobservable surfaces (G-class) — transparency, not gating

Three surfaces have no direct signal:

1. Bare MCP tool calls mid-execution (before `ToolExecution` row commits).
2. Long Postgres transactions writing nothing observable (rare; covered by Serializable threshold).
3. Plugin MCP servers holding HTTP connections outside the Next.js process.

The coordinator can't see them directly. The protocol's answer:

- **Gate upstream** — every entry point that could START them is gated by §6.1–6.6 primitives.
- **Surface as `unobservableSurfaces`** in `ActiveSessionBlockers` — operator sees: "5 surfaces in flight, 2 surfaces unobservable (in-flight bare MCP calls, plugin MCP sessions) — proceeding under the wait budget guarantees them."
- **Don't lie about confidence** — operator UI explicitly distinguishes "we proved this surface is quiet" (A/C/D/F) from "we waited the budget and trust upstream gates" (G).

This is the operator-trust contract: never claim certainty the system doesn't have.

### 6.8 Drain order (cross-surface sequencing)

The wait phase processes surfaces in dependency order (longest-tolerable last):

1. **Block all entry points** (single batch, on `normal → draining`):
   - Proxy refuses new server actions / mutation POSTs / new SSE handshakes
   - `spawnWorkThread` / `startBuildPhaseRun` / canonical sandbox acquisition / `callBrowserUse` refuse new entries
   - Inngest cron functions skip-and-reschedule at entry; long-running event-driven suspend at next step
2. **Broadcast quiescence** — single `agentEventBus.broadcastSystem` call; all UI clients learn
3. **Flip TaskRuns to `quiescing`** — single UPDATE; coworker loops exit at next iteration
4. **Wait for natural checkpoints**, in order (longest-tolerable last):
   - a. Server actions complete (~30s max)
   - b. SSE clients close (~5s after broadcast)
   - c. Coworker loops exit at iteration boundary (~30s typical, ~3min worst)
   - d. Inngest in-flight steps finish + functions suspend (~5min worst)
   - e. BuildPhaseRun in-flight phases complete (~minutes; ship phase indefinite)
   - f. MCP `killable: false` tools complete
   - g. Long Postgres txns commit
5. **Re-check** — when `hardBlockers === 0`, transition `draining → ready-to-swap`
6. **Class-G surfaces** — covered transitively because steps 1–5 closed every entry point that could have started them. Coordinator records them in `unobservableSurfaces` for transparency.

Steps 4a–4d typically complete in <2 min. Step 4e is the operator-decision case — phase budget exhausts → coordinator defers, doesn't force-kill.

## 7. Design — Client-side

### 7.1 SSE event taxonomy

Extends the `AgentEvent` union at [agent-event-bus.ts:7–72](../../../apps/web/lib/tak/agent-event-bus.ts:7) with one new variant. First `system:` namespace event (no `system:*` event exists today).

```ts
| { type: "system:quiescence";
    level: "draining" | "swapping" | "cleared";
    runId: string;                     // QuiescenceRun.runId
    swapEtaSeconds: number | null;     // null when level=cleared
    deferReason: string | null;        // populated when level=cleared AND outcome=deferred
    deferSurface: string | null;
    outcome: "draining" | "swapping" | "succeeded" | "deferred" | "aborted" | "failed";
  }
```

Three states map onto the §5.2 state machine:

- `level: "draining"` — emitted on `pending → draining`
- `level: "swapping"` — emitted on `ready-to-swap → swapping`
- `level: "cleared"` — emitted on **every terminal transition** (completed/deferred/aborted/failed); `outcome` distinguishes them

The `level: "cleared"` UI event and the durable `platform.quiescence-cleared` Inngest event are emitted by the same `emitQuiescenceTerminal()` helper. They are intentionally separate transports: UI subscribers need an `AgentEvent`, while suspended Inngest functions need a durable event name. The single source of truth is the `QuiescenceRun` terminal transition, not either transport by itself.

The broadcast pathway requires two new primitives: `agentEventBus.broadcastSystem(event)` (iterate every subscriber Set, ignore threadId keying) and `agentEventBus.subscribeSystem(handler)` for the new global `/api/platform/events` route used by the shell banner.

### 7.2 Response header contract

Every Next.js portal response carries:

```
X-Platform-Version: 1.0.0
X-Bundle-Hash: a7c3f2e1
```

Source: read once at boot from `version.json` (parent-spec Phase 1 deliverable) + Next.js build manifest hash; exposed through the internal quiescence state route and injected by the existing Proxy.

Client-side comparison: boot-time values stored in `window.__DPF_BOOT__ = { version, bundleHash }` (injected into root layout). Any response with mismatched headers triggers soft reload on next nav/action.

This is the **defensive layer**: even if SSE failed to deliver `system:quiescence` (browser asleep, edge proxy buffering), the next response header mismatch triggers the same reload. SSE is happy path; headers are fallback.

Exclusions: edge-node heartbeat endpoint, `/api/health`, static assets, and `/api/internal/platform/quiescence/state` skip quiescence gating. Edge/health callers do not need operator banners, and the internal state route must remain reachable so Proxy can read current state.

### 7.3 Banner state machine

Lives in `PlatformBannerProvider` context mounted from `apps/web/app/(shell)/layout.tsx`, near the existing `StatusBanner` / `UpdatePendingBanner` shell chrome. The provider opens one authenticated global EventSource to `/api/platform/events`, so operators see quiescence state even when no coworker/build/sync stream is active. Rendered by `<PlatformBanner />` at the top of every authenticated shell page.

Styling follows AGENTS.md §12: no hardcoded colors; use `text-[var(--dpf-text)]`, `text-[var(--dpf-muted)]`, `bg-[var(--dpf-surface-1)]`, `border-[var(--dpf-border)]`, and `bg-[var(--dpf-accent)]` with the existing `text-white` accent-button exception only when needed. This banner is operational chrome, not a marketing hero; it should be compact, persistent, and scannable.

```
hidden
  ↓ system:quiescence (level=draining)
preparing
   "Platform upgrade preparing. Your current work will finish — please don't start new actions."
   ETA: swapEtaSeconds countdown
  ↓ system:quiescence (level=swapping)
swapping
   "Platform upgrading. Please wait — should take ~30 seconds."
   Spinner + countdown
  ↓ X-Bundle-Hash mismatch on next response OR system:quiescence (level=cleared, outcome=succeeded)
reconnecting
   "Upgrade complete. Reloading…"
   Soft window.location.reload() after 1s grace
  ↓ (page reload — banner resets via fresh boot)
hidden

Alternate paths:
  swapping → system:quiescence (level=cleared, outcome=deferred|aborted) → deferred-or-aborted
  preparing → same → deferred-or-aborted

deferred-or-aborted
   "Upgrade postponed: {deferReason}. You can continue working."
   Dismissable; auto-dismiss after 60s
  ↓ user dismiss OR timeout
hidden
```

Two design choices:

- **No reload mid-swap** — banner waits for bundle-hash mismatch (proof new server is live) before reloading. Reloading on bare `swapping` event races old container's death.
- **Soft reload, not hard reload** — `window.location.reload()` preserves history. 1s grace gives in-flight `task:status` event time to deliver "your TaskRun is now paused-for-upgrade" message before the blank refresh.

### 7.4 Client-side action gate

Proxy already returns 503 on new actions during drain — but letting users *try* and get a 503 is worse UX than refusing the click upfront.

Implementation: `usePlatformReady()` hook reads from banner context. Three patterns:

```tsx
// Pattern 1: disable buttons
const { ready, level } = usePlatformReady();
<Button disabled={!ready} title={!ready ? "Platform upgrading…" : undefined}>Save</Button>

// Pattern 2: intercept form submit
const handleSubmit = (e) => {
  if (!ready) { e.preventDefault(); toast.info("Platform upgrading — try again in a moment"); return; }
};

// Pattern 3: explicit override for paths that should still work
<Button data-platform-bypass onClick={...}>Dismiss</Button>
```

This is Phase 2 UX hardening. v1 relies on the authoritative Proxy/API refusal plus the global banner and resilient EventSource migration; broad button/form action gating ships after dogfooding confirms the v1 drain path.

### 7.5 EventSource reconnect contract

Current repo truth: EventSource handling is inconsistent. `AgentCoworkerPanel` leaves the connection open on `onerror`, but `BrandExtractionSection` and `McpSyncButton` explicitly close on error, and `BuildStudio` has no explicit reconnect/backoff wrapper. Therefore v1 cannot rely on native EventSource auto-reconnect or HTTP `Retry-After` behavior alone.

Phase 1 introduces `useResilientEventSource()` and migrates the direct EventSource consumers found in the current repo:

- `apps/web/components/agent/AgentCoworkerPanel.tsx`
- `apps/web/components/build/BuildStudio.tsx`
- `apps/web/components/storefront-admin/BrandExtractionSection.tsx`
- `apps/web/components/platform/McpSyncButton.tsx`
- New `PlatformBannerProvider` global stream for `/api/platform/events`

Contract:

- **On graceful close from `draining`** — server emits `system:quiescence`, closes after the current event chain, and the hook backs off at least 5s before reconnect.
- **On 503 during `draining` / `swapping`** — hook reads `Retry-After` when present but owns the floor/jitter itself; browser native behavior is not treated as sufficient.
- **On `level=cleared`** — Proxy unblocks; reconnect succeeds; replay machinery catches clients up from `TaskRun.progressPayload` where available.
- **On successful reconnect after swap** — first successful response/event compares `X-Bundle-Hash`; mismatch triggers soft reload immediately.

The fallback polling already present in `AgentCoworkerPanel` and `BuildStudio` remains, but it is a safety net rather than the primary upgrade-reconnect path.

### 7.6 File inventory for client-side deliverables

| Deliverable | File | New or modify |
|---|---|---|
| `system:quiescence` event variant | [agent-event-bus.ts:7–72](../../../apps/web/lib/tak/agent-event-bus.ts:7) | modify (add union variant) |
| `broadcastSystem` + `subscribeSystem` primitives | [agent-event-bus.ts](../../../apps/web/lib/tak/agent-event-bus.ts) | modify (new exports) |
| Header injection + level gate | `apps/web/proxy.ts` | **extend existing Proxy** |
| Node state source for Proxy | `apps/web/app/api/internal/platform/quiescence/state/route.ts` | **new file** |
| Boot version injection | `apps/web/app/layout.tsx` | modify (`window.__DPF_BOOT__` script) |
| `PlatformBannerProvider` + `<PlatformBanner />` | `apps/web/components/platform/PlatformBanner.tsx` | **new** |
| Global platform event stream | `apps/web/app/api/platform/events/route.ts` | **new** |
| Shell mount | `apps/web/app/(shell)/layout.tsx` | modify near `StatusBanner` / `UpdatePendingBanner` |
| `usePlatformReady()` hook | `apps/web/lib/hooks/usePlatformReady.ts` | **new (Phase 1 provider; broad form adoption Phase 2)** |
| `useResilientEventSource()` | `apps/web/lib/hooks/useResilientEventSource.ts` | **new (Phase 1, migrate known consumers)** |
| Bundle-hash mismatch detector | wired into global fetch interceptor or banner provider | **new** |

Phase 1 ships Proxy + Node state route + boot injection + global platform event stream + banner provider + `system:quiescence` event + resilient EventSource wrapper for known consumers. This is the minimum viable user experience: every authenticated shell page sees the banner, and active task streams reconnect deliberately.

Phase 2 ships broad `usePlatformReady()` action gate coverage across forms and the full bundle-hash defensive layer on every fetch.

## 8. How This Replaces Parent Spec §5.5

The parent spec's [§5.5 graceful recycle protocol](2026-05-23-governed-platform-upgrade-lifecycle-design.md) has 17 numbered steps that conflate "wait for activity to drop" with "do the swap." This spec splits them:

| Parent §5.5 step | What it actually is | Where it lives now |
|---|---|---|
| 4. "Server enters drain mode" | `→ draining` transition + Proxy activation | `quiescence-run.ts:enter-draining` + `flip-level-draining` |
| 5. "UI receives platform.upgrading" | SSE broadcast | `broadcast-quiescence` step + `system:quiescence` event (§7.1) |
| 6. "Inngest workers stop dequeuing" | per-function gate at step boundary | §6.1 `gateBetweenSteps` |
| 7. "Drain wait" | wait loop with re-snapshot | `drain-tick` loop in coordinator (§5.3) |
| 8–12. L2/L3/L1/L4 apply | the swap itself — caller's job (orthogonal to quiescence) | `signalSwapStarting()` then `runPromoter` after `awaitReady()` returns |
| 13. "Emit platform.upgraded" | `signalSwapComplete` or boot reconciler → `emit-cleared-success` | caller invokes best-effort; boot reconciler is durable fallback |
| 14. "Soft reload via X-Bundle-Hash" | client-side bundle-hash mismatch | §7.2 + §7.3 |

The substitution makes parent §5.5 dramatically shorter. The current 17-step protocol becomes (in `runSelfUpgrade()`):

```ts
// Replace existing getPortalActivity() check at self-upgrade.ts:48–58
const { runId, awaitReady } = await startQuiescence({
  trigger: "self-upgrade",
  triggerRefId: upgradeRunId,
  budgetMs: 5 * 60 * 1000,
});
const outcome = await awaitReady();
if (!outcome.ok) {
  return { skipped: true, reason: outcome.outcome, deferSurface: outcome.deferSurface };
}

await signalSwapStarting(runId, { targetVersion, targetBundleHash });

// Existing promoter flow — unchanged
const result = await runPromoter({ ... });

if (result.exitCode === 0) {
  await signalSwapComplete(runId);
  await completeRun(run.runId);
  // ... existing success path
} else {
  await failQuiescenceSwap(runId, "promoter failed");
  // ... existing failure path
}
```

Parent spec §5.5 should be rewritten to reference this spec for quiescence concerns and keep only the swap-specific steps (L1/L2/L3/L4 apply ordering, smoke window, rollback decisions). A follow-up PR updates the parent spec text.

## 9. Phase Placement and Decomposition

This spec sits between parent Phase 4 (`PreflightRun` and operator surface) and Phase 5 (Graceful recycle + rollback) in the parent spec's phasing. Phase 5 cannot be specified concretely without this work; the parent spec explicitly defers to it for the drain protocol.

### 9.1 Within this spec's scope (proposed BIs)

- `BI-QUIESCE-001` — `QuiescenceRun` schema + Prisma migration + `quiescedAt` + new TaskRun.status enum values (`quiescing`, `paused-for-upgrade`, `paused-for-upgrade-forced`). One additive migration.
- `BI-QUIESCE-002` — Coordinator: `quiescence-run.ts` Inngest function + state-machine helpers + `apps/web/lib/self-upgrade/quiescence.ts` caller API.
- `BI-QUIESCE-003` — Request-layer gate: extend existing `apps/web/proxy.ts` with Edge-safe quiescence level check + response-header injection + `Retry-After` 503, plus `apps/web/app/api/internal/platform/quiescence/state/route.ts` Node state source.
- `BI-QUIESCE-004a` — Inngest gate helpers + scheduled-function wraps: implement `gateAtEntry` + `gateBetweenSteps` in `apps/web/lib/queue/inngest-client.ts`; wrap non-exempt scheduled functions with `gateAtEntry`. Mechanical, low-risk; scheduled functions exit cleanly on next tick while self-upgrade, quiescence-run, and taskrunWatchdog remain exempt.
- `BI-QUIESCE-004b` — Event-driven `gateBetweenSteps` placement: wrap 5 event-driven functions, choosing checkpoint boundaries per-function (deliberation-run between branches; eval-background between dimensions; etc.). Requires per-function judgment; ships after 004a.
- `BI-QUIESCE-005` — Per-entry-point gates: `spawnWorkThread`, `startBuildPhaseRun`, canonical sandbox acquisition, `callBrowserUse` guard insertions; per-tool timeout registry; coworker loop status-flip integration.
- `BI-QUIESCE-006` — Client-side: `system:quiescence` event variant + `broadcastSystem` / `subscribeSystem` primitives + global `/api/platform/events` stream + `PlatformBannerProvider` in shell layout + boot injection + soft-reload on bundle-hash mismatch.
- `BI-QUIESCE-007` — Watchdog extension: stuck-coordinator detection in `taskrunWatchdog`.
- `BI-QUIESCE-008` — `useResilientEventSource()` hook migration for current direct EventSource consumers.
- `BI-QUIESCE-009` (Phase 2) — broad `usePlatformReady()` action gate across forms.

### 9.2 Cross-spec dependencies

- This spec depends on parent Phase 1 (`version.json` + `PlatformConfig["platform.version"]`) for the `X-Platform-Version` header source. If quiescence ships first, header value falls back to `process.env.PORTAL_VERSION ?? "unknown"`.
- This spec also depends on the parent Phase 1 boot-version writer as the natural host for `reconcileQuiescenceOnBoot()`: after the new process writes `PlatformConfig["platform.version"]`, it can safely decide whether a `swapping` run reached the expected target.
- This spec UNBLOCKS parent Phase 5 (Graceful recycle + rollback) — Phase 5 cannot ship until quiescence does.
- The [BS sandbox admin recovery spec](2026-05-22-build-studio-sandbox-admin-recovery-design.md) is a second caller of `startQuiescence({trigger: "sandbox-recovery"})`. Quiescence ships first; sandbox recovery integrates as a follow-up.

### 9.3 Standing rule — Build Studio bypass for this work

Per standing operator direction (memory: `feedback_build_studio_for_all_development.md`), this research+spec is the operator-acknowledged exception case ("BS optimization is its own concern"). Spec is committed via direct PR; subsequent BI-QUIESCE-00X items flow through normal Build Studio pipeline.

## 10. Acceptance Criteria

The protocol is complete when:

1. `/ops/self-upgrade` cron triggers a quiescence run before the promoter; the run is visible at `/ops/quiescence` (or in the upgrade UI) with state, surfaces in flight, and budget countdown.
2. An operator with an active coworker thread sees the banner appear, their thread completes its current iteration, status flips to `paused-for-upgrade`, and after swap the thread offers a "Resume" button that re-dispatches via `taskrunRetry`.
3. A Build Studio `build` phase in flight when the upgrade fires causes the coordinator to either wait up to phase budget OR defer the upgrade with phase id as `deferSurface` — never force-cancel the phase.
4. A `ship`-phase build in flight defers the upgrade indefinitely until ship completes; only `ship-force` ceremony allows override.
5. SSE clients receive `system:quiescence`, close gracefully, reconnect after swap, and replay missed events from `TaskRun.progressPayload` — no frozen half-streams.
6. Operators on authenticated shell pages with no active coworker/build stream still see the global banner via `/api/platform/events`.
7. The bundle-hash mismatch detector fires soft-reload on the next response after swap; no operator click returns a 404 on a stale server-action ID.
8. A coordinator crash mid-drain is detected by watchdog within 2 minutes; level resets to `normal`; durable `platform.quiescence-cleared` and UI `system:quiescence(level="cleared")` events fire; no surfaces are left waiting indefinitely.
9. A portal process/container replacement after `signalSwapStarting` does not strand the run: `reconcileQuiescenceOnBoot()` completes it when the new version/hash matches the stored target or fails it with operator-visible evidence when it does not.
10. Class-G surfaces are surfaced as `unobservableSurfaces` in the UI rather than silently ignored.
11. Operator-triggered manual maintenance (`startQuiescence({trigger: "manual"})`) works independently of upgrade flow.
12. The replacement integration in `runSelfUpgrade` is ≤12 lines of caller code and includes the explicit `signalSwapStarting` / `signalSwapComplete` handshake; no per-surface quiescence concerns leak into the upgrade orchestrator.
13. A second `startQuiescence` call while a run is already active does NOT spawn a second concurrent coordinator by default: the API returns the active run under `concurrencyMode: "join-active"`. Only an explicit `queue-after-active` caller queues a follow-on run. Inngest function concurrency remains the backstop, not the primary correctness boundary.

## 11. Out of Scope

- **Multi-instance portal coordination.** DPF is single-org-per-install / single-Next.js-instance per `project_single_org_per_install.md`. Cross-instance quiescence is unnecessary.
- **Hive-wide quiescence.** Install-local only. Hive contributions are decoupled.
- **Inngest framework upgrades.** Quiescence works with current Inngest. If Inngest adds first-class "pause function" semantics, the gates may simplify — out of scope here.
- **MCP plugin server quiescence inside plugin processes.** The portal can refuse new dispatches to plugin MCPs; the protocol does not reach inside plugin processes. Plugin MCPs are responsible for their own internal state.
- **The actual container swap, health check, smoke window, rollback.** These are parent spec §5.5 remainder (Phase 5 BIs). Quiescence is the prerequisite; swap is the next layer.
- **Upgrade-window scheduling beyond what `PlatformConfig.maintenanceWindows` already supports.** Existing parent-spec mechanism.

## 12. Operator Decisions (Locked Defaults)

The six questions originally listed here have been resolved with the recommended defaults below (operator-acknowledged 2026-05-24 during in-session implementation directive). Each decision is locked into the implementation BIs and can be revisited via a follow-up spec edit + corresponding BI if a default needs to flip.

1. **Default budgets per regime** — **DECIDED**: fast drain 60s; normal drain 5min; extended drain = per-tool `maxMs` from `TOOL_WAIT_BUDGETS`. Locked in §5.5. BI-QUIESCE-002 implements.
2. **Coworker `paused-for-upgrade` resume policy** — **DECIDED**: operator-gated in v1 (Resume button on the thread). Auto-resume considered for fast-drain regime in a future iteration once dogfooding shows the banner-under-60s case is well-behaved. Locked in §5.3 + §6.2. BI-QUIESCE-005 + 006 implement.
3. **`TOOL_WAIT_BUDGETS` registry maintenance** — **DECIDED**: registry entry is required at MCP tool registration time; CI lint fails the PR that adds a new MCP tool without a registry entry. Pattern mirrors the seed-registry approach in the parent spec. Locked in §6.6. BI-QUIESCE-005 implements registry + lint.
4. **Phase 1 vs Phase 2 client-side cut line** — **DECIDED**: v1 = Proxy + Node state route + global banner stream + resilient EventSource migration for the 5 current consumers (BI-QUIESCE-003 + 006 + 008). Phase 2 = broad `usePlatformReady()` action gate across high-traffic forms (BI-QUIESCE-009, post-v1). Locked in §7.6.
5. **`system:quiescence` event on operator-triggered manual quiescence** — **DECIDED**: yes, same event fires for `trigger: "manual"` and `trigger: "sandbox-recovery"`. Operators triggering manual maintenance want users to see the banner. Locked in §7.1. BI-QUIESCE-006 implements (no special-case filtering).
6. **Proxy fail-open vs fail-closed on state-route timeout** — **DECIDED**: fail open for GET / page-data revalidation (read-only paths); preserve last known non-normal state for mutation POSTs / server actions / new SSE handshakes (the safety-critical paths). Rationale: reads must never break due to coordinator availability, but writes during an in-progress drain should fail safely toward the previously-observed drain posture. Locked in §6.4. BI-QUIESCE-003 implements.

## 13. References

**Live backlog**

- BI: [BI-40F05BAC](http://localhost:3000/admin/backlog/BI-40F05BAC) — Activity Quiescence Protocol (this spec). Live state checked 2026-05-24: status `triaging`.
- Parent BI: [BI-5B3FA415](http://localhost:3000/admin/backlog/BI-5B3FA415) — Governed platform upgrade lifecycle.

**Repo-local anchors**

- [`docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md`](2026-05-23-governed-platform-upgrade-lifecycle-design.md) — parent spec; §5.5 is the drain protocol this spec replaces; §5.2.1 Layer 1 evidence column is what `ActiveSessionBlockers` populates.
- [`docs/superpowers/specs/2026-05-19-build-studio-stall-detection.md`](2026-05-19-build-studio-stall-detection.md) — BI-4ab6be39 heartbeat + watchdog substrate this spec reuses.
- [`docs/superpowers/specs/2026-05-22-build-studio-sandbox-admin-recovery-design.md`](2026-05-22-build-studio-sandbox-admin-recovery-design.md) — second caller of `startQuiescence`.
- [`apps/web/lib/self-upgrade/activity.ts`](../../../apps/web/lib/self-upgrade/activity.ts) — Phase 0 stopgap this spec replaces.
- [`apps/web/lib/queue/functions/self-upgrade.ts`](../../../apps/web/lib/queue/functions/self-upgrade.ts) — primary caller of quiescence after this lands.
- [`apps/web/app/(shell)/layout.tsx`](<../../../apps/web/app/(shell)/layout.tsx>) — authenticated shell chrome where `PlatformBannerProvider` mounts near existing banners.
- [`apps/web/lib/observability/heartbeat.ts`](../../../apps/web/lib/observability/heartbeat.ts) — cooperative-cancel signal reused for coworker quiescence.
- [`apps/web/lib/actions/taskrun-recovery.ts`](../../../apps/web/lib/actions/taskrun-recovery.ts) — per-phase Retry strategies reused for post-swap resume.
- [`apps/web/lib/tak/agent-event-bus.ts`](../../../apps/web/lib/tak/agent-event-bus.ts) — extended with `broadcastSystem`, `subscribeSystem`, and `system:quiescence` event.
- [`apps/web/lib/integrate/build-phase-run.ts`](../../../apps/web/lib/integrate/build-phase-run.ts) — `startBuildPhaseRun` idempotency enables phase resume after swap.

**External standards and benchmarks**

- [Kubernetes Pod termination lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination)
- [AWS Classic ELB connection draining](https://docs.aws.amazon.com/elasticloadbalancing/latest/classic/config-conn-drain.html)
- [Erlang/OTP code loading](https://www.erlang.org/doc/man/code.html)
- [Linkerd traffic shifting](https://linkerd.io/2.16/tasks/traffic-shifting/)
- [Cloudflare Workers gradual deployment](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/gradual-deployments/)
- [Stripe API versioning](https://stripe.com/docs/upgrades)
- [Next.js 16 Proxy](https://nextjs.org/docs/app/getting-started/proxy)
- [Next.js Edge Runtime](https://nextjs.org/docs/app/api-reference/edge)

**Internal memory signals**

- `project_self_upgrade_kills_in_session_ux.md` — the documented failure mode
- `feedback_propose_acknowledge_reassign.md` — PAR pattern for `paused-for-upgrade` resume decisions
- `feedback_db_seed_migration_sync.md` — informs why schema changes are additive only
- `project_single_org_per_install.md` — informs §11 out-of-scope multi-instance
- `feedback_check_tool_signals_first.md` — informs the seven-class detection taxonomy's bias toward direct signals
