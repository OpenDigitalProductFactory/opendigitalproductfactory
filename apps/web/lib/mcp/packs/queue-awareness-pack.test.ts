import { describe, it, expect, vi, beforeEach } from "vitest";

const readQueueSnapshots = vi.fn();
const readAtRiskQueues = vi.fn();
const readDeadLetters = vi.fn();
const { assessQueueHealth } = await vi.importActual<
  typeof import("@/lib/queue/queue-snapshot-service")
>("@/lib/queue/queue-snapshot-service");

vi.mock("@/lib/queue/queue-snapshot-service", () => ({
  readQueueSnapshots: (...a: unknown[]) => readQueueSnapshots(...a),
  readAtRiskQueues: (...a: unknown[]) => readAtRiskQueues(...a),
  assessQueueHealth: (s: unknown) => assessQueueHealth(s as never),
}));

vi.mock("@/lib/queue/dead-letters", () => ({
  readDeadLetters: (...a: unknown[]) => readDeadLetters(...a),
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
  readDeadLetters.mockReset();
  readDeadLetters.mockResolvedValue([]);
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

// BI-BC5C47D4: work a bounded retry gave up on shows on queue health.
describe("dead letters on queue health", () => {
  const exhausted = {
    queueKey: "dead-letter:job-engine",
    label: "Job runs that lost their lease on every attempt",
    count: 2,
    latest: { at: "2026-10-08T04:00:00.000Z", reason: "agent/child-thread-run", detail: "lease_expired_exhausted: no attempt finished in 1" },
  };

  it("get_queue_status reports dead letters beside the flow metrics", async () => {
    readQueueSnapshots.mockResolvedValue([snap()]);
    readDeadLetters.mockResolvedValue([exhausted, { ...exhausted, queueKey: "dead-letter:async-operation-outbox", count: 0, latest: null }]);
    const result = await queueAwarenessPack.handlers.get_queue_status!({}, "user-1", undefined as never);
    expect(result.data).toMatchObject({ deadLetters: [exhausted] });
    expect(result.message).toContain("Dead letters: 2 job runs that lost their lease on every attempt");
  });

  it("list_at_risk_queues lists a dead-letter source with its reason", async () => {
    readAtRiskQueues.mockResolvedValue([]);
    readDeadLetters.mockResolvedValue([exhausted]);
    const result = await queueAwarenessPack.handlers.list_at_risk_queues!({}, "user-1", undefined as never);
    expect(result.data).toMatchObject({
      queues: [{ queueKey: "dead-letter:job-engine", reasons: [expect.stringContaining("dead letters: 2")], latest: exhausted.latest }],
    });
  });

  it("a failed dead-letter read never breaks queue health", async () => {
    readAtRiskQueues.mockResolvedValue([]);
    readDeadLetters.mockRejectedValue(new Error("db down"));
    const result = await queueAwarenessPack.handlers.list_at_risk_queues!({}, "user-1", undefined as never);
    expect(result).toMatchObject({ success: true, message: "No queues are at-risk right now." });
  });
});
