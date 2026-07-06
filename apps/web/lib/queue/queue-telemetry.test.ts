import { describe, it, expect, vi } from "vitest";
import {
  recordQueueTransition,
  mirrorQueueTransition,
  type QueueMetricsMirror,
  type QueueTelemetryCreator,
} from "./queue-telemetry";

function fakeMirror() {
  return {
    arrivals: vi.fn(),
    throughput: vi.fn(),
    depth: vi.fn(),
    waitSeconds: vi.fn(),
    processSeconds: vi.fn(),
    cycleSeconds: vi.fn(),
  } satisfies QueueMetricsMirror;
}

describe("mirrorQueueTransition", () => {
  it("counts an arrival on enqueued and publishes depth", () => {
    const m = fakeMirror();
    mirrorQueueTransition(
      { queueKey: "cwq:triage", itemKind: "work-item", itemId: "WI1", transition: "enqueued", depth: 7 },
      m,
    );
    expect(m.arrivals).toHaveBeenCalledWith("cwq:triage");
    expect(m.depth).toHaveBeenCalledWith("cwq:triage", 7);
    expect(m.throughput).not.toHaveBeenCalled();
  });

  it("records throughput + duration observations on finished/success", () => {
    const m = fakeMirror();
    mirrorQueueTransition(
      {
        queueKey: "cwq:triage",
        itemKind: "work-item",
        itemId: "WI1",
        transition: "finished",
        outcome: "success",
        durations: { waitMs: 5000, processMs: 15000, cycleMs: 20000 },
      },
      m,
    );
    expect(m.throughput).toHaveBeenCalledWith("cwq:triage", "success");
    expect(m.waitSeconds).toHaveBeenCalledWith("cwq:triage", 5);
    expect(m.processSeconds).toHaveBeenCalledWith("cwq:triage", "success", 15);
    expect(m.cycleSeconds).toHaveBeenCalledWith("cwq:triage", 20);
  });

  it("defaults outcome to cancelled on a cancelled transition", () => {
    const m = fakeMirror();
    mirrorQueueTransition(
      { queueKey: "q", itemKind: "work-item", itemId: "WI1", transition: "cancelled" },
      m,
    );
    expect(m.throughput).toHaveBeenCalledWith("q", "cancelled");
  });

  it("skips negative/absent durations", () => {
    const m = fakeMirror();
    mirrorQueueTransition(
      {
        queueKey: "q",
        itemKind: "work-item",
        itemId: "WI1",
        transition: "finished",
        outcome: "failed",
        durations: { waitMs: -1, processMs: null },
      },
      m,
    );
    expect(m.throughput).toHaveBeenCalledWith("q", "failed");
    expect(m.waitSeconds).not.toHaveBeenCalled();
    expect(m.processSeconds).not.toHaveBeenCalled();
  });
});

describe("recordQueueTransition", () => {
  it("persists the event with normalized fields", async () => {
    const create = vi.fn().mockResolvedValue({});
    const creator: QueueTelemetryCreator = { create };
    const m = fakeMirror();

    await recordQueueTransition(
      {
        queueKey: "compute:sandbox-pool",
        itemKind: "sandbox-slot",
        itemId: "FB-1",
        transition: "finished",
        outcome: "success",
        laneKey: "dpf-sandbox-1",
        actorType: "system",
        durations: { processMs: 60000 },
      },
      { getCreator: async () => creator, getMirror: async () => m },
    );

    expect(create).toHaveBeenCalledOnce();
    const data = create.mock.calls[0]![0].data;
    expect(data.queueKey).toBe("compute:sandbox-pool");
    expect(data.transition).toBe("finished");
    expect(data.laneKey).toBe("dpf-sandbox-1");
    expect(data.actorType).toBe("system");
    expect(m.throughput).toHaveBeenCalledWith("compute:sandbox-pool", "success");
    expect(m.processSeconds).toHaveBeenCalledWith("compute:sandbox-pool", "success", 60);
  });

  it("skips the write when a locating field is missing", async () => {
    const create = vi.fn();
    await recordQueueTransition(
      { queueKey: "", itemKind: "work-item", itemId: "WI1", transition: "enqueued" },
      { getCreator: async () => ({ create }), getMirror: async () => fakeMirror() },
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("never throws when the delegate rejects (fire-and-forget)", async () => {
    const create = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(
      recordQueueTransition(
        { queueKey: "q", itemKind: "work-item", itemId: "WI1", transition: "enqueued" },
        { getCreator: async () => ({ create }), getMirror: async () => fakeMirror() },
      ),
    ).resolves.toBeUndefined();
  });

  it("still lands the event when the metrics mirror throws", async () => {
    const create = vi.fn().mockResolvedValue({});
    const brokenMirror = {
      ...fakeMirror(),
      arrivals: vi.fn(() => {
        throw new Error("prom exploded");
      }),
    } satisfies QueueMetricsMirror;
    await expect(
      recordQueueTransition(
        { queueKey: "q", itemKind: "work-item", itemId: "WI1", transition: "enqueued" },
        { getCreator: async () => ({ create }), getMirror: async () => brokenMirror },
      ),
    ).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledOnce();
  });
});
