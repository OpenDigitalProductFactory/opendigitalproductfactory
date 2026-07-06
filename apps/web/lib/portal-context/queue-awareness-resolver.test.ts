import { describe, it, expect, vi } from "vitest";
import {
  atRiskQueueToSignal,
  resolveQueueAttention,
} from "./queue-awareness-resolver";
import type { QueueSnapshotView } from "@/lib/queue/queue-snapshot-service";

function snap(over: Partial<QueueSnapshotView> = {}): QueueSnapshotView {
  return {
    queueKey: "cwq:field-service",
    period: "2026-07-06",
    depth: 14,
    wip: 16,
    arrivals: 20,
    throughput: 4,
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

describe("atRiskQueueToSignal", () => {
  it("produces a warning-severity queue_backpressure signal with reasons", () => {
    const sig = atRiskQueueToSignal(snap(), { health: "at-risk", reasons: ["14 items waiting", "SLA attainment 60%"] });
    expect(sig.kind).toBe("queue_backpressure");
    expect(sig.severity).toBe("warning");
    expect(sig.message).toContain("cwq:field-service");
    expect(sig.message).toContain("14 items waiting");
    expect(sig.actionHref).toBe("/platform/ai/runtime-health");
  });
});

describe("resolveQueueAttention", () => {
  it("maps at-risk queues to signals, capped", async () => {
    const readAtRiskQueues = vi.fn(async () =>
      Array.from({ length: 8 }, (_, i) => ({
        snapshot: snap({ queueKey: `cwq:q${i}` }),
        assessment: { health: "at-risk" as const, reasons: [`${10 + i} items waiting`] },
      })),
    );
    const signals = await resolveQueueAttention({ readAtRiskQueues, limit: 3 });
    expect(signals).toHaveLength(3);
    expect(signals.every((s) => s.kind === "queue_backpressure")).toBe(true);
  });

  it("returns [] when nothing is at risk", async () => {
    const signals = await resolveQueueAttention({ readAtRiskQueues: async () => [] });
    expect(signals).toEqual([]);
  });

  it("never throws — returns [] on reader failure", async () => {
    const signals = await resolveQueueAttention({
      readAtRiskQueues: async () => {
        throw new Error("db down");
      },
    });
    expect(signals).toEqual([]);
  });
});
