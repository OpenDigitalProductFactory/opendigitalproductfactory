---
title: Reusable Queueing Substrate — scarce-resource queues, shared flow telemetry, and situational visibility
date: 2026-07-06
status: ratified-design (kernel decision 2026-07-06, margin 0.598 high)
relates_to:
  - EP-056D2A5E (Resource contention & concurrency safety — compute-side admission)
  - BI-6112DDE0 (local-inference admission control)
  - BI-98572A51 (unify the two GPU serializers)
  - BI-B62B9F1E (atomic BacklogItem claim)
  - BI-94A765BD (contention decision rule as kernel principle)
  - EP-CWQ-001 (2026-04-04 collaborative work queue design — Phase 1 shipped, currently dormant)
  - docs/superpowers/specs/2026-06-09-instance-admission-control-design.md (build-pipeline lane)
  - docs/superpowers/specs/2026-07-02-concurrency-contention-architecture-analysis.md (race register)
principles:
  - architecture-over-shortcuts
  - never-assume-verify
  - remove-avoidable-failure-opportunities
  - structural-verification-is-not-functional
---

# Reusable Queueing Substrate

## 1. Operator goal (verbatim intent)

> We need an inherent reusable queueing mechanism for scarce resources across this
> platform. We don't want to re-invent this every time, and where there are
> bottlenecks, we need the queueing to work well for the different patterns.
> Queue visibility must be surfaced in various ways based on the situation, and
> the AI Coworker and the human must both be informed about queuing and the basic
> metrics — process time, cycle time, % correct and other common metrics — that
> help manage these queues and limited resources effectively over time.

## 2. What exists today (research inventory, verified 2026-07-06)

### 2.1 Compute-side serialization (scarce compute)

| Site | Pattern | Limit | On contention | Queue metrics |
|---|---|---|---|---|
| `apps/web/lib/routing/chat-adapter.ts:55` `withLocalInferenceLock` | in-process promise chain | 1 per GPU | implicit FIFO wait; timeout starts after lock | none (only `inferenceMs` after dispatch) |
| `apps/web/lib/integrate/build-orchestrator.ts:1314` `MAX_CONCURRENT_TASKS` | in-memory batch | 2 cloud / 1 local | silent in-memory wait; usage-limit fast-abort | phase events, cost — no wait time |
| `apps/web/lib/integrate/sandbox/sandbox-pool.ts` | DB slot pool | `DPF_SANDBOX_POOL_SIZE` (1) | poll 30 s up to 30 min, then throw | pool status only |
| Inngest functions (~60 in `apps/web/lib/queue/functions/`) | durable event queue, per-fn concurrency 1–2 | per-fn | durable wait + retry | Inngest dashboard only |
| `apps/web/lib/queue/admission.ts` build-pipeline lane | shared account-scoped Inngest concurrency key | `DPF_BUILD_PIPELINE_CONCURRENCY` | Inngest queues excess | `admission-observability.ts` snapshot line |
| `apps/web/lib/nonprod/environment-lease.ts` | partial-unique atomic gate | 1/key | conflict-return (no wait) | timestamps only |

Known races already filed: two uncoordinated GPU serializers (BI-98572A51), no
admission control / unbounded implicit queue (BI-6112DDE0), advisory BacklogItem
claim (BI-B62B9F1E).

### 2.2 Work/people-side queues (business domains)

- **CWQ Phase 1 is built but dormant.** `WorkQueue`/`WorkItem`/`WorkItemMessage`/
  `WorkSchedule` models exist (`schema.prisma:10119+`), plus router
  (`lib/queue/queue-router.ts`), server actions (`lib/actions/work-queue.ts`),
  `/workspace/my-queue` UI, `/api/v1/work-queue/*` routes, and two bridges
  (`lib/queue/bridges/`) — **the bridges have zero callers and the live DB holds
  0 WorkItem / 0 WorkQueue rows.** WorkItem already carries `slaDueAt` +
  `slaPolicy`; the agent event bus already defines `queue:*` event shapes
  (created/assigned/claimed/status_changed/completed/sla_warning/escalation) —
  pre-shaped, unused.
- **Field service (trades-maintenance archetype / Dale vertical)**: no dispatch
  board, no technician job queue. Field work is modeled as `StorefrontBooking`;
  field-dispatch proactivity (`lib/proactivity/field-dispatch-runtime.ts`) lives
  in the notification layer, not as queue work items.
- **Bookings/rentals**: `StorefrontBooking`/`BookingHold`/`RentalAgreement` +
  `ServiceProvider(+ProviderAvailability)` with GIST no-overlap constraints and
  `overlapQuarantinedAt` review queues (migration 20260702150000) — the proven
  atomic pattern for time-based capacity.
- **Service delivery**: `ServiceTicket` (slaPolicy/slaDueAt),
  `StorefrontInquiry` (311 queue UI at `/service-requests`), Engagement →
  Opportunity → Quote → SalesOrder → Invoice chain (`stageChangedAt` = raw
  time-in-state), Dunning escalation chains.
- **Workforce**: `CoworkerService`/`CoworkerEngagement`
  (requested→accepted→completed), `ValueStreamTeam(+Role,+HitlGate)` — no
  capacity/utilization model.

### 2.3 Metrics & visibility substrate

- Prometheus registry in `lib/operate/metrics.ts` (`dpf_*` counters/histograms),
  scraped at `/api/metrics`, queried via `/api/platform/metrics`.
- Rollup-model precedents: `EndpointTaskPerformance` (per endpoint×taskType:
  successCount/evaluationCount, latency), `SkillMetric` (per skill×agent×period),
  `CoworkerTurnMetric` (per turn), `TaskEvaluation`, `StallEvent`.
- Human UI: report-kit primitives (`StatCard`/`StatusBadge`/`DataTable`/`Chart`),
  `ServiceHealthDashboard`, RevenueCockpit tiles, `/platform/ai/runtime-health`.
- Coworker awareness plumbing: portal-context resolvers (parallel, attention
  signals) → prompt injection; MCP **tool packs** (`composeToolPacks`, 12 packs —
  new tools must land in packs, `mcp-tools.ts` inline array is frozen);
  proactivity system with activity families (including
  `field-dispatch-appointment`) and escalation targets (including `dispatcher`).

**Conclusion of the inventory:** the platform has all the *parts* of a queueing
substrate and none of the *connective tissue*: waits are implicit and
unmeasured, rejects are timeout-shaped, the universal work queue is dormant, and
no queue anywhere reports wait/process/cycle time, throughput, or first-pass
yield to either the operator or the coworker.

## 3. Decision (kernel-ratified)

`principle_decide` (2026-07-06, in_platform_coworker, structured coverage
strong, no commandment conflict):

| Option | Composite |
|---|---|
| **two-primitives-shared-spine** | **1.435** ← recommended, margin 0.598, high |
| observability-only-overlay | 0.837 |
| universal-workitem-queue | 0.743 |
| greenfield-broker | 0.034 |

Top contributors: *Never Assume — Verify*, *Architecture Over Shortcuts*.

**The ruling shape:** queueing in DPF is not one broker; it is **two canonical
serialization primitives** (already in-repo) **plus one shared flow-telemetry
and visibility contract** that every queue — compute or business — emits into.
"Reusable mechanism" = the contract + helpers, not a new subsystem.

1. **Machine-speed scarce compute** (GPU inference, build slots, sandbox
   containers, heavy background jobs) queues via **admission lanes**: Inngest
   concurrency keys + atomic DB gates + bounded in-process waiters, fronted by a
   small generic facade (`ResourceLane`). Never through Postgres work rows on
   the hot path.
2. **Human-speed work** (field-service jobs, tickets, approvals, backlog claims,
   coworker engagements) queues via the **existing CWQ WorkItem substrate**,
   which this epic activates (its bridges currently have no callers).
3. **Both emit the same `QueueTelemetry` events** and are surfaced through the
   same metric definitions, rollups, tiles, MCP tools, and proactivity signals.

## 4. The reusable contract

### 4.1 Canonical flow-metric definitions (one registry, used by every surface)

For every queue-managed item, from the timestamps `enqueuedAt → startedAt →
finishedAt`:

| Metric | Definition | Lean/ToC name |
|---|---|---|
| **Wait time** | `startedAt − enqueuedAt` | queue time |
| **Process time** | `finishedAt − startedAt` | touch time |
| **Cycle time** | `finishedAt − enqueuedAt` | lead time through the queue |
| **Queue depth** | count(status = queued) at observation | WIP-waiting |
| **WIP** | count(queued + in-progress) | work in process |
| **Arrival rate** | enqueued per period | demand |
| **Throughput** | finished per period | flow rate |
| **% correct / first-pass yield** | finished successfully without rework, re-queue, retry, or downstream rejection ÷ finished | FPY |
| **SLA attainment** | finished within `slaDueAt` ÷ finished (where SLA set) | on-time delivery |
| **Abandonment** | cancelled/expired while queued ÷ enqueued | balk/renege rate |
| **Utilization** | busy time ÷ available time per lane/worker | capacity use |

Sanity relationship surfaced as an insight, not enforced: Little's Law
(`WIP ≈ throughput × cycle time`) — a queue whose measured numbers violate it
has broken instrumentation.

These definitions live in **one module** (`lib/queue/flow-metrics.ts`) with the
enum of metric keys, so tiles, MCP tools, and rollups can never drift apart.

### 4.2 Telemetry emission (the spine)

- **`QueueTelemetryEvent`** — a tiny append-only Prisma model (or reuse-shaped
  event): `{ queueKey, itemRef (kind+id), transition (enqueued|started|finished|
  cancelled|requeued), outcome?, occurredAt, laneKey?, actorType?, actorId? }`.
  One helper — `recordQueueTransition(...)` — fire-and-forget, never throws into
  the caller's path (same discipline as `recordCoworkerTurnMetric`).
- **`QueueMetricSnapshot`** — periodic rollup per `queueKey` × period (hour/day):
  depth, p50/p95 wait/process/cycle, throughput, arrivals, FPY, SLA attainment,
  abandonment. Computed by one Inngest cron function (the pattern of
  `skill-metrics-aggregator.ts`), following the `(subject, period)` unique-key
  precedent of `SkillMetric`.
- **Prometheus mirrors** (`dpf_queue_depth`, `dpf_queue_wait_seconds`,
  `dpf_queue_cycle_seconds`, `dpf_queue_throughput_total`,
  `dpf_queue_sla_breaches_total`) in `lib/operate/metrics.ts`, labelled
  `{queue_key, lane}` — so the existing monitoring profile graphs queues with
  zero new infra.
- **Real-time**: emit the already-defined `queue:*` agent-event-bus events on
  transitions so coworker panels and SSE surfaces update live.

Who emits: compute lanes (facade below), CWQ WorkItem server actions
(claim/complete already exist in `lib/actions/work-queue.ts`), and — cheaply,
without model changes — existing domain lifecycles that are queues in disguise
(`ServiceTicket` open→acknowledged, `StorefrontInquiry` intake, booking holds),
each mapped to `enqueued/started/finished` in its own adapter.

### 4.3 Compute admission facade (`ResourceLane`)

A small module (`lib/queue/resource-lane.ts`) giving every scarce-compute
serializer one shape:

```ts
acquire(laneKey, { timeoutMs, maxQueueDepth }) →
  { admitted: true, release() } | { admitted: false, reason: "busy"|"timeout", depth, aheadOfYou }
```

- Backed by the pattern appropriate to the resource: in-process bounded FIFO for
  the local GPU (subsumes `withLocalInferenceLock` — closes the two-serializer
  split of **BI-98572A51** when the sandbox path acquires the same lane),
  Inngest concurrency lane for pipeline work (reuses
  `buildPipelineConcurrency`), DB atomic gate for cross-process exclusivity
  (the `NonProductionEnvironmentLease.activeKey` gold standard).
- **Bounded + honest**: explicit `maxQueueDepth`; over-depth requests are
  *rejected with a reason and depth* instead of timing out invisibly — this is
  exactly **BI-6112DDE0**'s "honest busy/fallback signal".
- Every acquire/release records a `QueueTelemetryEvent`, which is what finally
  makes "both reviewers timed out" show up as *wait time on a saturated lane*
  instead of a mystery inference failure.

### 4.4 Business/work queues: activate CWQ, first consumer = field service

- Wire the dormant bridges: BacklogItem-claim and TaskNode `awaiting_human`
  paths create WorkItems (the original EP-CWQ-001 intent).
- **Field-service dispatch (trades-maintenance archetype, Dale vertical)** is
  the first archetype consumer and the template for service-delivery verticals:
  - `StorefrontBooking` (customer reservation) → on assignment becomes a
    WorkItem (`sourceType: "field-service-job"`, registered in
    `lib/work-management/source-registry.ts`) in a per-crew `WorkQueue`.
  - Dispatch board (operator/dispatcher view) + "My jobs" (technician view)
    over the existing `/api/v1/work-queue` routes, archetype-gated via
    `StorefrontArchetype.activationProfile` and labelled with
    `archetype-vocabulary.ts` terms ("Job Requests", "Crew").
  - The proactivity `field-dispatch-appointment` family and `dispatcher`
    escalation target hook these WorkItems instead of bare notifications.
- Same shape then generalizes to healthcare-wellness appointments,
  service-request-311 triage, and ticket queues without new models.

### 4.5 Situational visibility (surface per audience, one data source)

| Situation / audience | Surface |
|---|---|
| Operator, platform compute | Lane/queue health on `/platform/ai/runtime-health` + ops dashboards: depth, p95 wait, throughput, utilization per lane (extends `admission-observability.ts`) |
| Operator/dispatcher, business queue | Dispatch board + report-kit `StatCard` tiles (depth, oldest wait, SLA at-risk count, FPY) on the domain page (CRM cockpit pattern) |
| Worker (technician/agent) | "My jobs / my queue" list with position, due, SLA badge (existing `/workspace/my-queue` + field-service view) |
| Customer | Honest expectation signals where a queue is customer-visible: "N ahead of you / expected start" on bookings & inquiries — never raw internals |
| AI coworker (pull) | `queue-awareness` MCP tool pack: `get_queue_status(queueKey)` (depth, p95 wait/cycle, throughput, FPY, SLA breaches), `list_queue_items`, read-only; write-side transitions stay on existing domain tools |
| AI coworker (push) | Portal-context resolver injects at-risk queue signals (attention items: "queue X: depth 14, oldest 3 d, SLA breaches 4"); proactivity family `queue-health` decides cadence/escalation; `queue:*` SSE events for live panels |
| Both, over time | `QueueMetricSnapshot` trend charts (report-kit `Chart`) — is cycle time drifting up? is FPY dropping after a process change? |

The **same numbers** flow to human tiles and coworker tools from the same
snapshot/rollup — no parallel computation, so human and AI never argue from
different data.

## 5. What this is NOT

- Not a new broker/scheduler service (kernel score 0.034 — rejected).
- Not "every inference becomes a Postgres row" (universal-workitem-queue
  rejected; hot-path admission stays in-process/Inngest).
- Not metrics-only: the observability-only overlay was explicitly outscored —
  the dormant CWQ substrate gets activated and the compute lanes get honest
  admission, not just gauges on today's races.

## 6. Decision rule (feeds BI-94A765BD)

- **Scarce compute, machine-speed** → admission lane (`ResourceLane`: bounded
  waiters, honest reject, Inngest concurrency for durable work).
- **Shared record / slot** → atomic DB constraint (partial-unique or GIST
  EXCLUDE; conflict-return, no waiting).
- **Human-speed work item** → CWQ WorkItem in a WorkQueue (routing, SLA,
  claim/complete).
- **Everything that queues emits `QueueTelemetryEvent`** — a queue without flow
  telemetry is a defect, because unmeasured queues are how bottlenecks hide.
- Advisory check-then-act is never a queue: it is the anti-pattern this
  replaces.

## 7. Phasing (each phase independently shippable)

1. **Phase 1 — Telemetry spine**: `flow-metrics.ts` registry,
   `QueueTelemetryEvent` + `QueueMetricSnapshot` models + migration,
   `recordQueueTransition` helper, rollup cron, Prometheus mirrors. Wire the two
   cheapest emitters: sandbox-pool acquire/release and CWQ server actions.
2. **Phase 2 — Compute lanes**: `ResourceLane` facade; migrate
   `withLocalInferenceLock` onto a bounded lane (BI-6112DDE0), sandbox/build
   path acquires the same GPU lane (BI-98572A51); lane panel on runtime-health.
3. **Phase 3 — Coworker + human visibility**: `queue-awareness` MCP pack,
   portal-context resolver + attention signals, proactivity `queue-health`
   family, report-kit queue tiles + snapshot trend charts.
4. **Phase 4 — Field-service dispatch (first archetype consumer)**:
   booking→WorkItem bridge, dispatch board + technician queue, archetype
   gating, customer "N ahead" signal; template write-up for other
   service-delivery archetypes.
5. **Phase 5 — Doctrine**: decision rule into kernel principle + AGENTS.md
   (closes BI-94A765BD); wire remaining domain adapters (tickets, 311,
   engagements) as they prove valuable.

Dependencies: Phase 2–4 all depend on Phase 1. BI-B62B9F1E (atomic claim) rides
with Phase 4's WorkItem activation. Open EP-056D2A5E compute BIs stay filed —
Phases 1–2 are their delivery vehicle, not duplicates.

## 8. Verification bar

Structural pass is not verification. Each phase verifies functionally:

- Phase 1: enqueue/claim/complete a WorkItem and acquire/release a sandbox slot
  on the live install → telemetry rows exist, rollup computes, `/api/metrics`
  exposes `dpf_queue_*`.
- Phase 2: saturate the local lane with N+2 concurrent inferences → excess get
  honest busy/queued signals with depth, none silently time out waiting; GPU
  never double-subscribed (chat + sandbox concurrently).
- Phase 3: coworker answers "how is the X queue doing?" from `get_queue_status`
  with the same numbers the operator tile shows; at-risk queue produces an
  attention item.
- Phase 4: booking → dispatch board → technician claims → completes → invoice
  chain on live install; FPY reflects a forced rework case.
