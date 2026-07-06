import { describe, it, expect } from "vitest";
import { queueTileModel, humanizeQueueKey } from "./queue-tile-model";
import type { QueueSnapshotView } from "./queue-snapshot-service";

function snap(over: Partial<QueueSnapshotView> = {}): QueueSnapshotView {
  return {
    queueKey: "cwq:triage-default",
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

describe("humanizeQueueKey", () => {
  it("strips the cwq prefix", () => {
    expect(humanizeQueueKey("cwq:triage-default")).toBe("triage-default");
  });
  it("annotates compute lanes", () => {
    expect(humanizeQueueKey("compute:sandbox-pool")).toBe("sandbox-pool (compute)");
  });
});

describe("queueTileModel", () => {
  it("maps a healthy flowing queue to a success tile with an up delta", () => {
    const m = queueTileModel(snap({ depth: 2, throughput: 8, arrivals: 6, firstPassYield: 0.95, cycleP50Ms: 120000, waitP95Ms: 30000 }));
    expect(m.intent).toBe("success");
    expect(m.value).toBe("2 waiting");
    expect(m.hint).toContain("p95 wait 30s");
    expect(m.hint).toContain("FPY 95%");
    expect(m.delta).toEqual({ label: "8/6 done/in", direction: "up" });
  });

  it("maps a deep backlog to a danger tile", () => {
    const m = queueTileModel(snap({ depth: 25, throughput: 2, arrivals: 20 }));
    expect(m.intent).toBe("danger");
    expect(m.health).toBe("at-risk");
    expect(m.delta!.direction).toBe("down");
  });

  it("maps an idle queue to a neutral tile with no delta", () => {
    const m = queueTileModel(snap());
    expect(m.intent).toBe("neutral");
    expect(m.health).toBe("idle");
    expect(m.delta).toBeNull();
  });
});
