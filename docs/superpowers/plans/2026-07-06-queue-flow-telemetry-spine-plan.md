# EP-3516E23D Phase 1 — Queue flow-telemetry spine (BI-A5885E0D)

**Spec:** [docs/superpowers/specs/2026-07-06-reusable-queueing-substrate-design.md](../specs/2026-07-06-reusable-queueing-substrate-design.md) §4.1–4.2
**BI:** BI-A5885E0D (EP-3516E23D)
**Goal:** Stand up the ONE shared flow-telemetry contract every queue in the
platform (scarce-compute admission lanes AND CWQ work queues) emits into, so
wait / process / cycle time, throughput, first-pass yield and SLA attainment are
finally measurable — the foundation Phases 2–4 build visibility and dispatch on.

## Architecture

A pure metric registry defines the vocabulary and math once; a fire-and-forget
recorder writes an append-only event stream and mirrors to Prometheus; an hourly
idempotent rollup folds the stream into per-`(queueKey, period)` snapshots. The
first two emitters (sandbox slot pool + CWQ work-queue actions) prove the
contract end to end without touching hot inference paths (those come in Phase 2).

## Tasks (all complete in this PR)

1. **`lib/queue/flow-metrics.ts`** — pure. Closed vocab (`QUEUE_TRANSITIONS`,
   `QUEUE_OUTCOMES`, `FLOW_METRIC_KEYS`) + `computeFlowDurations`,
   `isFirstPassSuccess`, `metSla`, `percentile`, `summarizeQueueWindow`,
   `queueMetricPeriod`. Unit-tested (16 cases). No DB, no clock, no I/O.
2. **Prisma models** — `QueueTelemetryEvent` (append-only stream) +
   `QueueMetricSnapshot` (per queueKey×day rollup, `@@unique([queueKey, period])`
   mirroring `SkillMetric`). Migration `20260706090000_add_queue_flow_telemetry`
   — two brand-new tables only, data-safe by construction (attested).
3. **`lib/queue/queue-telemetry.ts`** — `recordQueueTransition`, the single
   fire-and-forget writer (never throws; DI'd delegate + Prometheus mirror, per
   `coworker-turn-metrics.ts`). Prometheus mirrors added to `lib/operate/metrics.ts`
   (`dpf_queue_depth|wait_seconds|process_seconds|cycle_seconds|throughput_total|arrivals_total`).
   Unit-tested (8 cases, incl. fire-and-forget failure paths).
4. **`lib/queue/queue-metrics-rollup.ts`** + **`functions/queue-metrics-aggregator.ts`**
   — event-sourced idempotent rollup (reconstruct timelines → `summarizeQueueWindow`
   → upsert snapshot), hourly Inngest cron registered in `functions/index.ts`.
   Unit-tested (4 cases).
5. **Two emitters wired** — `sandbox-pool.ts` acquire→`started` / release→`finished`
   (process time = hold duration); `actions/work-queue.ts`
   create→`enqueued`, claim→`started`, complete→`finished` with wait/process/cycle.

## Verification bar (spec §8)

- Unit: 28 cases green across the three new modules.
- Structural: `prisma validate` clean; migration applies cleanly to a scratch
  Postgres producing exactly the declared tables + unique index; `tsc --noEmit`
  clean across apps/web.
- Functional (post-merge, live): claim/complete a WorkItem and acquire/release a
  sandbox slot → `QueueTelemetryEvent` rows land, the aggregator upserts a
  `QueueMetricSnapshot`, and `/api/metrics` exposes `dpf_queue_*`.

## Not in this phase

Real-time `queue:*` event-bus emission and the coworker MCP surface (Phase 3 —
they read this data, and their live subscribers do not exist yet); the
`ResourceLane` compute admission facade + honest busy signal (Phase 2,
BI-6112DDE0/BI-98572A51); field-service dispatch (Phase 4, BI-10E350A6).
