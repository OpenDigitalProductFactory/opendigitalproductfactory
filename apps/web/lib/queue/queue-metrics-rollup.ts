// apps/web/lib/queue/queue-metrics-rollup.ts
//
// EP-3516E23D Phase 1 — event-sourced rollup: reconstruct per-item timelines
// from the QueueTelemetryEvent stream for a period, aggregate them per queueKey
// with the canonical flow-metrics math, and upsert one QueueMetricSnapshot per
// (queueKey, period). Idempotent — re-running the same period recomputes the
// same rows (mirrors the SkillUsageEvent → SkillMetric aggregator). Spec §4.2.
//
// The Prisma delegates are dependency-injected so the pure reconstruction +
// aggregation logic is unit-testable without the generated client or a DB.

import {
  summarizeQueueWindow,
  queueMetricPeriod,
  type QueueItemTimeline,
  type QueueOutcome,
  type QueueWindow,
} from "./flow-metrics";

/** Minimal shape of a telemetry row this rollup consumes. */
export interface QueueTelemetryRow {
  queueKey: string;
  itemKind: string;
  itemId: string;
  transition: string;
  outcome: string | null;
  occurredAt: Date;
  /** Sub-lane; for a `held` row it carries the hold's cause. Optional for old callers. */
  laneKey?: string | null;
}

/** Point-in-time depth/WIP for a queue at rollup time (supplied by the caller). */
export interface QueueLiveCounts {
  depth: number;
  wip: number;
}

export interface QueueSnapshotRow {
  queueKey: string;
  period: string;
  depth: number;
  wip: number;
  arrivals: number;
  throughput: number;
  waitP50Ms: number | null;
  waitP95Ms: number | null;
  processP50Ms: number | null;
  processP95Ms: number | null;
  cycleP50Ms: number | null;
  cycleP95Ms: number | null;
  firstPassYield: number | null;
  slaAttainment: number | null;
  abandonmentRate: number | null;
  heldP50Ms: number | null;
  heldP95Ms: number | null;
  processShare: number | null;
}

function asOutcome(v: string | null): QueueOutcome | null {
  return v === "success" || v === "failed" || v === "cancelled" ? v : null;
}

/**
 * Fold a queue's event rows (already filtered to one queueKey + window) into
 * per-item timelines. Latest wins for each transition's timestamp; requeue
 * counts accumulate. Pure.
 */
export function reconstructTimelines(rows: readonly QueueTelemetryRow[]): QueueItemTimeline[] {
  type Building = QueueItemTimeline & { requeueCount: number; spans?: { from: Date; to: Date | null }[] };
  const byItem = new Map<string, Building>();

  // Process in chronological order so terminal outcome/state reflects the last
  // event, and requeues counted between start and finish are preserved.
  const ordered = [...rows].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  for (const r of ordered) {
    const key = `${r.itemKind}\x00${r.itemId}`;
    const entry =
      byItem.get(key) ?? { requeueCount: 0 };
    switch (r.transition) {
      case "enqueued":
        entry.enqueuedAt = r.occurredAt;
        break;
      case "started":
        // First start wins: an item that resumes after a hold is still the
        // same service interval. A requeue clears it for a fresh interval.
        entry.startedAt ??= r.occurredAt;
        break;
      case "held": {
        entry.spans ??= [];
        const open = entry.spans.find((span) => span.to === null);
        if (!open) entry.spans.push({ from: r.occurredAt, to: null });
        break;
      }
      case "released": {
        const open = entry.spans?.find((span) => span.to === null);
        if (open) open.to = r.occurredAt;
        break;
      }
      case "finished":
        entry.finishedAt = r.occurredAt;
        entry.outcome = asOutcome(r.outcome) ?? "success";
        break;
      case "cancelled":
        entry.cancelledAt = r.occurredAt;
        entry.outcome = "cancelled";
        break;
      case "requeued":
        entry.requeueCount += 1;
        // A requeue reopens the item: clear the started marker so the next
        // start→finish is measured as a fresh service interval.
        entry.startedAt = null;
        break;
      default:
        break;
    }
    byItem.set(key, entry);
  }

  return [...byItem.values()].map(({ spans, ...timeline }) => (spans ? { ...timeline, heldSpans: spans } : timeline));
}

/**
 * Aggregate one queue's rows into a snapshot row. `period` is the day key the
 * rows belong to; `live` supplies point-in-time depth/WIP. Pure.
 */
export function buildSnapshotRow(
  queueKey: string,
  period: string,
  rows: readonly QueueTelemetryRow[],
  live: QueueLiveCounts,
  window?: QueueWindow,
): QueueSnapshotRow {
  const timelines = reconstructTimelines(rows);
  const summary = summarizeQueueWindow(timelines, window);
  return {
    queueKey,
    period,
    depth: live.depth,
    wip: live.wip,
    arrivals: summary.arrivals,
    throughput: summary.throughput,
    waitP50Ms: summary.waitP50Ms,
    waitP95Ms: summary.waitP95Ms,
    processP50Ms: summary.processP50Ms,
    processP95Ms: summary.processP95Ms,
    cycleP50Ms: summary.cycleP50Ms,
    cycleP95Ms: summary.cycleP95Ms,
    firstPassYield: summary.firstPassYield,
    slaAttainment: summary.slaAttainment,
    abandonmentRate: summary.abandonmentRate,
    heldP50Ms: summary.heldP50Ms,
    heldP95Ms: summary.heldP95Ms,
    processShare: summary.processShare,
  };
}

// ─── DB-facing orchestration (thin; delegates injected for tests) ─────────────

export interface RollupDeps {
  /** Fetch all telemetry rows whose occurredAt is within [start, end). */
  fetchEvents: (start: Date, end: Date) => Promise<QueueTelemetryRow[]>;
  /**
   * Earlier rows (before `before`) for the given items, so an item that entered
   * on an earlier day is measured over its whole life, not just today's part.
   * Optional: without it, an item's earlier events are invisible, as before.
   */
  fetchItemHistory?: (items: readonly { itemKind: string; itemId: string }[], before: Date) => Promise<QueueTelemetryRow[]>;
  /** Point-in-time depth/WIP per queueKey (queued vs queued+in-progress). */
  fetchLiveCounts: () => Promise<Map<string, QueueLiveCounts>>;
  /** Idempotent upsert of one snapshot row keyed by (queueKey, period). */
  upsertSnapshot: (row: QueueSnapshotRow) => Promise<void>;
}

export interface AggregateQueueMetricsInput {
  /** Day the window belongs to; defaults to "now". */
  at?: Date;
}

export interface AggregateQueueMetricsResult {
  period: string;
  queues: number;
  upserted: number;
}

/**
 * Aggregate the telemetry stream for the UTC day containing `at` into
 * QueueMetricSnapshot rows — one per queueKey seen in the window (plus any
 * queue that has live depth/WIP even with no events that day, so a backed-up
 * idle queue still surfaces). Idempotent.
 */
export async function aggregateQueueMetrics(
  deps: RollupDeps,
  input: AggregateQueueMetricsInput = {},
): Promise<AggregateQueueMetricsResult> {
  const at = input.at ?? new Date();
  const period = queueMetricPeriod(at);
  const start = new Date(`${period}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const [events, liveCounts] = await Promise.all([
    deps.fetchEvents(start, end),
    deps.fetchLiveCounts(),
  ]);

  // Bring in each windowed item's earlier events. Counting stays window-scoped
  // (summarizeQueueWindow), so history only completes durations.
  const itemKeys = new Map<string, { itemKind: string; itemId: string }>();
  for (const e of events) itemKeys.set(`${e.itemKind}\x00${e.itemId}`, { itemKind: e.itemKind, itemId: e.itemId });
  const history = deps.fetchItemHistory && itemKeys.size > 0
    ? await deps.fetchItemHistory([...itemKeys.values()], start)
    : [];

  const byQueue = new Map<string, QueueTelemetryRow[]>();
  for (const e of [...history, ...events]) {
    const arr = byQueue.get(e.queueKey) ?? [];
    arr.push(e);
    byQueue.set(e.queueKey, arr);
  }
  // Include queues that have live depth but produced no events in the window.
  for (const queueKey of liveCounts.keys()) {
    if (!byQueue.has(queueKey)) byQueue.set(queueKey, []);
  }

  let upserted = 0;
  for (const [queueKey, rows] of byQueue) {
    const live = liveCounts.get(queueKey) ?? { depth: 0, wip: 0 };
    const row = buildSnapshotRow(queueKey, period, rows, live, { start, end });
    await deps.upsertSnapshot(row);
    upserted += 1;
  }

  return { period, queues: byQueue.size, upserted };
}

/** Default deps bound to the live Prisma client. */
export async function defaultRollupDeps(): Promise<RollupDeps> {
  const { prisma } = await import("@dpf/db");
  return {
    fetchEvents: async (start, end) => {
      const rows = await prisma.queueTelemetryEvent.findMany({
        where: { occurredAt: { gte: start, lt: end } },
        select: {
          queueKey: true,
          itemKind: true,
          itemId: true,
          transition: true,
          outcome: true,
          occurredAt: true,
          laneKey: true,
        },
      });
      return rows as QueueTelemetryRow[];
    },
    fetchItemHistory: async (items, before) => {
      // Bounded by the event retention window (90 days) the sweep enforces.
      const since = new Date(before.getTime() - 90 * 24 * 60 * 60 * 1000);
      const byKind = new Map<string, string[]>();
      for (const item of items) byKind.set(item.itemKind, [...(byKind.get(item.itemKind) ?? []), item.itemId]);
      const rows: QueueTelemetryRow[] = [];
      for (const [itemKind, itemIds] of byKind) {
        for (let i = 0; i < itemIds.length; i += 500) {
          const found = await prisma.queueTelemetryEvent.findMany({
            where: { itemKind, itemId: { in: itemIds.slice(i, i + 500) }, occurredAt: { gte: since, lt: before } },
            select: { queueKey: true, itemKind: true, itemId: true, transition: true, outcome: true, occurredAt: true, laneKey: true },
          });
          rows.push(...(found as QueueTelemetryRow[]));
        }
      }
      return rows;
    },
    fetchLiveCounts: async () => {
      // CWQ work queues: depth = queued, wip = queued + in-progress-ish states.
      const grouped = await prisma.workItem.groupBy({
        by: ["queueId", "status"],
        _count: { _all: true },
      });
      const map = new Map<string, QueueLiveCounts>();
      for (const g of grouped) {
        const queueKey = `cwq:${g.queueId}`;
        const entry = map.get(queueKey) ?? { depth: 0, wip: 0 };
        const n = g._count._all;
        if (g.status === "queued") {
          entry.depth += n;
          entry.wip += n;
        } else if (
          g.status === "assigned" ||
          g.status === "in-progress" ||
          g.status === "awaiting-input" ||
          g.status === "awaiting-approval"
        ) {
          entry.wip += n;
        }
        map.set(queueKey, entry);
      }
      // Workroom stages (EP-B70E718D F2): a room sitting at a stage is that
      // stage's WIP; one that is not being worked is its depth (queue).
      const { workroomStageLiveCounts } = await import("@/lib/work-management/workroom-stage-telemetry");
      const { TERMINAL_WORKROOM_STATUSES } = await import("@/lib/work-management/standing-room-nesting");
      const rooms = await prisma.workroom.findMany({
        where: { archivedAt: null, status: { notIn: [...TERMINAL_WORKROOM_STATUSES] } },
        select: { scopeClaims: true, workspaceState: true },
      });
      for (const [queueKey, counts] of workroomStageLiveCounts(rooms)) map.set(queueKey, counts);
      return map;
    },
    upsertSnapshot: async (row) => {
      const { queueKey, period, ...rest } = row;
      await prisma.queueMetricSnapshot.upsert({
        where: { queueKey_period: { queueKey, period } },
        create: { queueKey, period, ...rest, computedAt: new Date() },
        update: { ...rest, computedAt: new Date() },
      });
    },
  };
}
