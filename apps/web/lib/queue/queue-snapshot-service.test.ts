import { describe, it, expect, vi } from "vitest";
import {
  assessQueueHealth,
  readQueueSnapshots,
  readAtRiskQueues,
  type QueueSnapshotView,
} from "./queue-snapshot-service";

function view(over: Partial<QueueSnapshotView> = {}): QueueSnapshotView {
  return {
    queueKey: "cwq:q1",
    period: "2026-07-06",
    depth: 0,
    wip: 0,
    arrivals: 0,
    throughput: 0,
    waitP50Ms: null,
    waitP95Ms: null,
    processP50Ms: null,
    processP95Ms: null,
    cycleP50Ms: null,
    cycleP95Ms: null,
    firstPassYield: null,
    slaAttainment: null,
    abandonmentRate: null,
    computedAt: "2026-07-06T12:00:00.000Z",
    ...over,
  };
}

describe("assessQueueHealth", () => {
  it("is idle when nothing waiting or flowing", () => {
    expect(assessQueueHealth(view()).health).toBe("idle");
  });
  it("is healthy when flowing with good metrics", () => {
    const a = assessQueueHealth(view({ throughput: 5, firstPassYield: 0.95, depth: 2 }));
    expect(a.health).toBe("healthy");
  });
  it("is at-risk on a deep backlog", () => {
    const a = assessQueueHealth(view({ depth: 12, throughput: 1 }));
    expect(a.health).toBe("at-risk");
    expect(a.reasons.join(" ")).toContain("12 items waiting");
  });
  it("is watch on a single soft signal", () => {
    const a = assessQueueHealth(view({ throughput: 4, firstPassYield: 0.6, depth: 3 }));
    expect(a.health).toBe("watch");
    expect(a.reasons.join(" ")).toContain("first-pass yield 60%");
  });
  it("is at-risk when two soft signals combine", () => {
    const a = assessQueueHealth(
      view({ throughput: 4, firstPassYield: 0.6, slaAttainment: 0.5, depth: 3 }),
    );
    expect(a.health).toBe("at-risk");
    expect(a.reasons.length).toBeGreaterThanOrEqual(2);
  });
  it("is at-risk when backlog has no completions", () => {
    const a = assessQueueHealth(view({ depth: 3, arrivals: 3, throughput: 0 }));
    expect(a.health).toBe("at-risk");
    expect(a.reasons).toContain("no completions with backlog");
  });
  it("watches a queue whose p95 wait exceeds the explicit progress SLO", () => {
    const a = assessQueueHealth(view({ depth: 2, throughput: 2, waitP95Ms: 7_200_000 }));
    expect(a.health).toBe("watch");
    expect(a.reasons.join(" ")).toContain("p95 wait");
  });
});

describe("readQueueSnapshots", () => {
  it("queries the current-day period and maps rows to views", async () => {
    const findMany = vi.fn(async (_args: { where?: Record<string, unknown> }) => [
      { queueKey: "cwq:q1", period: "2026-07-06", depth: 3, wip: 5, arrivals: 8, throughput: 6, firstPassYield: 0.9, computedAt: new Date("2026-07-06T12:00:00Z") },
    ]);
    const result = await readQueueSnapshots(
      {},
      { getFinder: async () => ({ findMany }), now: new Date("2026-07-06T15:00:00Z") },
    );
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany.mock.calls[0]![0].where).toEqual({ period: "2026-07-06" });
    expect(result[0]!.depth).toBe(3);
    expect(result[0]!.firstPassYield).toBe(0.9);
    expect(result[0]!.computedAt).toBe("2026-07-06T12:00:00.000Z");
  });

  it("returns [] on read failure (never throws)", async () => {
    const result = await readQueueSnapshots(
      {},
      { getFinder: async () => ({ findMany: async () => { throw new Error("db down"); } }) },
    );
    expect(result).toEqual([]);
  });

  it("filters by queueKey when supplied", async () => {
    const findMany = vi.fn(async (_args: { where?: Record<string, unknown> }) => []);
    await readQueueSnapshots(
      { queueKey: "compute:sandbox-pool" },
      { getFinder: async () => ({ findMany }), now: new Date("2026-07-06T00:00:00Z") },
    );
    expect(findMany.mock.calls[0]![0].where).toEqual({
      period: "2026-07-06",
      queueKey: "compute:sandbox-pool",
    });
  });
});

describe("readAtRiskQueues", () => {
  it("returns only at-risk queues with their assessments", async () => {
    const findMany = vi.fn(async () => [
      { queueKey: "cwq:hot", period: "2026-07-06", depth: 15, throughput: 2, computedAt: new Date() },
      { queueKey: "cwq:calm", period: "2026-07-06", depth: 1, throughput: 9, firstPassYield: 0.98, computedAt: new Date() },
    ]);
    const atRisk = await readAtRiskQueues({ getFinder: async () => ({ findMany }) });
    expect(atRisk).toHaveLength(1);
    expect(atRisk[0]!.snapshot.queueKey).toBe("cwq:hot");
    expect(atRisk[0]!.assessment.health).toBe("at-risk");
  });
});
