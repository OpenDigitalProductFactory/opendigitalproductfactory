import { describe, it, expect, vi, beforeEach } from "vitest";

const readQueueSnapshots = vi.fn();
const readAtRiskQueues = vi.fn();
const { assessQueueHealth } = await vi.importActual<
  typeof import("@/lib/queue/queue-snapshot-service")
>("@/lib/queue/queue-snapshot-service");

vi.mock("@/lib/queue/queue-snapshot-service", () => ({
  readQueueSnapshots: (...a: unknown[]) => readQueueSnapshots(...a),
  readAtRiskQueues: (...a: unknown[]) => readAtRiskQueues(...a),
  assessQueueHealth: (s: unknown) => assessQueueHealth(s as never),
}));

import { queueAwarenessPack } from "./queue-awareness-pack";

function snap(over: Record<string, unknown> = {}) {
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

beforeEach(() => {
  readQueueSnapshots.mockReset();
  readAtRiskQueues.mockReset();
});

describe("queueAwarenessPack", () => {
  it("declares two read-only tools with matching grants", () => {
    expect(queueAwarenessPack.packId).toBe("queue-awareness");
    expect(queueAwarenessPack.definitions.map((d) => d.name).sort()).toEqual([
      "get_queue_status",
      "list_at_risk_queues",
    ]);
    for (const def of queueAwarenessPack.definitions) {
      expect(def.sideEffect).toBe(false);
      expect(queueAwarenessPack.grants[def.name]).toEqual(["work_capsule_read"]);
    }
  });

  it("get_queue_status formats durations/percentages and a health verdict", async () => {
    readQueueSnapshots.mockResolvedValue([
      snap({ queueKey: "cwq:hot", depth: 12, throughput: 3, waitP95Ms: 45000, cycleP50Ms: 500, firstPassYield: 0.9 }),
    ]);
    const res = await queueAwarenessPack.handlers.get_queue_status!({}, "u1");
    expect(res.success).toBe(true);
    const queues = res.data!.queues as Array<Record<string, unknown>>;
    expect(queues[0]!.queueKey).toBe("cwq:hot");
    expect(queues[0]!.health).toBe("at-risk"); // depth ≥ 10
    expect(queues[0]!.waitP95).toBe("45s");
    expect(queues[0]!.cycleP50).toBe("500ms");
    expect(queues[0]!.firstPassYield).toBe("90%");
  });

  it("get_queue_status returns an honest empty message when no snapshot exists", async () => {
    readQueueSnapshots.mockResolvedValue([]);
    const res = await queueAwarenessPack.handlers.get_queue_status!({ queueKey: "cwq:none" }, "u1");
    expect(res.success).toBe(true);
    expect(res.message).toContain("No flow-metric snapshot");
    expect((res.data!.queues as unknown[]).length).toBe(0);
  });

  it("list_at_risk_queues surfaces reasons", async () => {
    readAtRiskQueues.mockResolvedValue([
      { snapshot: snap({ queueKey: "cwq:hot", depth: 20 }), assessment: { health: "at-risk", reasons: ["20 items waiting"] } },
    ]);
    const res = await queueAwarenessPack.handlers.list_at_risk_queues!({}, "u1");
    expect(res.success).toBe(true);
    const queues = res.data!.queues as Array<Record<string, unknown>>;
    expect(queues[0]!.reasons).toEqual(["20 items waiting"]);
  });
});
