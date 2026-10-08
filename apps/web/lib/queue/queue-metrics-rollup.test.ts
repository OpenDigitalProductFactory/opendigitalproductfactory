import { describe, it, expect, vi } from "vitest";
import {
  reconstructTimelines,
  buildSnapshotRow,
  aggregateQueueMetrics,
  type QueueTelemetryRow,
  type QueueLiveCounts,
  type QueueSnapshotRow,
} from "./queue-metrics-rollup";

const at = (iso: string) => new Date(iso);

function ev(
  itemId: string,
  transition: string,
  iso: string,
  outcome: string | null = null,
  queueKey = "cwq:q1",
): QueueTelemetryRow {
  return { queueKey, itemKind: "work-item", itemId, transition, outcome, occurredAt: at(iso) };
}

describe("reconstructTimelines", () => {
  it("folds a stream into per-item timelines with outcomes", () => {
    const rows: QueueTelemetryRow[] = [
      ev("A", "enqueued", "2026-07-06T00:00:00Z"),
      ev("A", "started", "2026-07-06T00:05:00Z"),
      ev("A", "finished", "2026-07-06T00:20:00Z", "success"),
      ev("B", "enqueued", "2026-07-06T00:01:00Z"),
      ev("B", "cancelled", "2026-07-06T00:10:00Z"),
    ];
    const timelines = reconstructTimelines(rows);
    const a = timelines.find((t) => t.enqueuedAt?.toISOString() === "2026-07-06T00:00:00.000Z");
    expect(a?.outcome).toBe("success");
    expect(a?.startedAt).toEqual(at("2026-07-06T00:05:00Z"));
    const b = timelines.find((t) => t.cancelledAt);
    expect(b?.outcome).toBe("cancelled");
  });

  it("counts requeues and reopens the service interval", () => {
    const rows: QueueTelemetryRow[] = [
      ev("A", "enqueued", "2026-07-06T00:00:00Z"),
      ev("A", "started", "2026-07-06T00:02:00Z"),
      ev("A", "requeued", "2026-07-06T00:03:00Z"),
      ev("A", "started", "2026-07-06T00:06:00Z"),
      ev("A", "finished", "2026-07-06T00:10:00Z", "success"),
    ];
    const [a] = reconstructTimelines(rows);
    expect(a!.requeueCount).toBe(1);
    // startedAt reflects the fresh interval after requeue
    expect(a!.startedAt).toEqual(at("2026-07-06T00:06:00Z"));
  });
});

describe("buildSnapshotRow", () => {
  it("produces a snapshot with live depth/wip and window aggregates", () => {
    const rows: QueueTelemetryRow[] = [
      ev("A", "enqueued", "2026-07-06T00:00:00Z"),
      ev("A", "started", "2026-07-06T00:05:00Z"),
      ev("A", "finished", "2026-07-06T00:20:00Z", "success"),
    ];
    const live: QueueLiveCounts = { depth: 3, wip: 5 };
    const row = buildSnapshotRow("cwq:q1", "2026-07-06", rows, live);
    expect(row.depth).toBe(3);
    expect(row.wip).toBe(5);
    expect(row.arrivals).toBe(1);
    expect(row.throughput).toBe(1);
    expect(row.firstPassYield).toBe(1);
    expect(row.cycleP50Ms).toBe(20 * 60_000);
  });
});

describe("aggregateQueueMetrics", () => {
  it("groups events per queue, includes idle-but-backed-up queues, upserts idempotently", async () => {
    const events: QueueTelemetryRow[] = [
      ev("A", "enqueued", "2026-07-06T01:00:00Z", null, "cwq:q1"),
      ev("A", "started", "2026-07-06T01:05:00Z", null, "cwq:q1"),
      ev("A", "finished", "2026-07-06T01:10:00Z", "success", "cwq:q1"),
    ];
    // q2 has live depth but produced no events in the window.
    const liveCounts = new Map<string, QueueLiveCounts>([
      ["cwq:q1", { depth: 0, wip: 1 }],
      ["cwq:q2", { depth: 4, wip: 4 }],
    ]);
    const upserts: QueueSnapshotRow[] = [];
    const deps = {
      fetchEvents: vi.fn(async (_start: Date, _end: Date) => events),
      fetchLiveCounts: vi.fn(async () => liveCounts),
      upsertSnapshot: vi.fn(async (row: QueueSnapshotRow) => {
        upserts.push(row);
      }),
    };

    const result = await aggregateQueueMetrics(deps, { at: at("2026-07-06T12:00:00Z") });
    expect(result.period).toBe("2026-07-06");
    expect(result.queues).toBe(2); // q1 (events) + q2 (live only)
    expect(upserts.map((u) => u.queueKey).sort()).toEqual(["cwq:q1", "cwq:q2"]);
    const q2 = upserts.find((u) => u.queueKey === "cwq:q2")!;
    expect(q2.depth).toBe(4);
    expect(q2.throughput).toBe(0);

    // Window bounds cover the whole UTC day.
    const call = deps.fetchEvents.mock.calls[0] as [Date, Date];
    expect(call[0].toISOString()).toBe("2026-07-06T00:00:00.000Z");
    expect(call[1].toISOString()).toBe("2026-07-07T00:00:00.000Z");
  });
});

// BI-927FF076: the history read must stay scoped to Workroom stage items. An
// unscoped read pulled 90 days of every item with events today (8.6M
// federation-demand rows on the live install) and exhausted the portal heap.
describe("aggregateQueueMetrics history scope (BI-927FF076)", () => {
  const stageEv = (itemId: string, transition: string, iso: string, outcome: string | null = null): QueueTelemetryRow => ({
    queueKey: "wr:delivery:build",
    itemKind: "workroom-stage",
    itemId,
    transition,
    outcome,
    occurredAt: at(iso),
  });
  const demandEv = (itemId: string, iso: string): QueueTelemetryRow => ({
    queueKey: "cwq:federation-delivery",
    itemKind: "federation-demand",
    itemId,
    transition: "enqueued",
    outcome: null,
    occurredAt: at(iso),
  });

  it("asks history only for workroom-stage items, never for other queues' items", async () => {
    const events: QueueTelemetryRow[] = [
      demandEv("D1", "2026-07-06T01:00:00Z"),
      demandEv("D2", "2026-07-06T01:01:00Z"),
      ev("A", "enqueued", "2026-07-06T01:00:00Z"),
      stageEv("cap1:build", "finished", "2026-07-06T03:00:00Z", "success"),
    ];
    const fetchItemHistory = vi.fn(async (_items: readonly { itemKind: string; itemId: string }[], _before: Date) => [
      stageEv("cap1:build", "enqueued", "2026-07-05T20:00:00Z"),
      stageEv("cap1:build", "started", "2026-07-05T21:00:00Z"),
    ]);
    const upserts: QueueSnapshotRow[] = [];
    await aggregateQueueMetrics(
      {
        fetchEvents: async () => events,
        fetchItemHistory,
        fetchLiveCounts: async () => new Map(),
        upsertSnapshot: async (row) => {
          upserts.push(row);
        },
      },
      { at: at("2026-07-06T12:00:00Z") },
    );

    expect(fetchItemHistory).toHaveBeenCalledTimes(1);
    expect(fetchItemHistory.mock.calls[0]![0]).toEqual([{ itemKind: "workroom-stage", itemId: "cap1:build" }]);
    // History still completes the stage item's duration across the day boundary.
    const stage = upserts.find((u) => u.queueKey === "wr:delivery:build")!;
    expect(stage.throughput).toBe(1);
    expect(stage.cycleP50Ms).toBe(7 * 60 * 60 * 1000);
    // Other queues are measured from the window alone, as before.
    const demand = upserts.find((u) => u.queueKey === "cwq:federation-delivery")!;
    expect(demand.arrivals).toBe(2);
  });

  it("makes no history read when no workroom-stage item moved in the window", async () => {
    const fetchItemHistory = vi.fn(async () => [] as QueueTelemetryRow[]);
    await aggregateQueueMetrics(
      {
        fetchEvents: async () => [demandEv("D1", "2026-07-06T01:00:00Z"), ev("A", "enqueued", "2026-07-06T01:00:00Z")],
        fetchItemHistory,
        fetchLiveCounts: async () => new Map(),
        upsertSnapshot: async () => {},
      },
      { at: at("2026-07-06T12:00:00Z") },
    );
    expect(fetchItemHistory).not.toHaveBeenCalled();
  });
});

describe("defaultRollupDeps.fetchItemHistory (BI-927FF076)", () => {
  it("scopes the history query to workroom-stage items in the WHERE clause", async () => {
    vi.resetModules();
    const findMany = vi.fn(async (_args: unknown) => [] as unknown[]);
    vi.doMock("@dpf/db", () => ({ prisma: { queueTelemetryEvent: { findMany } } }));
    try {
      const { defaultRollupDeps } = await import("./queue-metrics-rollup");
      const deps = await defaultRollupDeps();
      await deps.fetchItemHistory!(
        [
          { itemKind: "federation-demand", itemId: "D1" },
          { itemKind: "workroom-stage", itemId: "cap1:build" },
        ],
        at("2026-07-06T00:00:00Z"),
      );
      expect(findMany).toHaveBeenCalled();
      for (const call of findMany.mock.calls) {
        const where = (call[0] as { where: Record<string, unknown> }).where;
        expect(where.itemKind).toBe("workroom-stage");
        expect(where.queueKey).toEqual({ startsWith: "wr:" });
        expect((where.itemId as { in: string[] }).in).toEqual(["cap1:build"]);
      }
    } finally {
      vi.doUnmock("@dpf/db");
      vi.resetModules();
    }
  });
});
