import { describe, expect, it } from "vitest";

import { FLOW_BOTTLENECK_SOURCE, MIN_ROOMS_HELD, bottleneckSignal, findFlowBottlenecks } from "./flow-review";

const shape = (shapeRef: string, roomsHeld: number, cause: string) => ({
  shapeKey: shapeRef.split("@")[0]!, shapeRef, roomsInFlow: roomsHeld + 1, flowTimeP50Ms: null, runs: 0,
  bottleneck: { stageKey: "merge", roomsHeld, cause },
});

describe("findFlowBottlenecks", () => {
  it("keeps only real piles, largest first", () => {
    const findings = findFlowBottlenecks([
      { key: "manufactureAndDeliver", shapes: [shape("delivery-small@1.0.0", 4, "awaiting-person"), shape("delivery-medium@1.0.0", MIN_ROOMS_HELD - 1, "conformance_pause")] },
      { key: "foundational", shapes: [shape("payables-watch@1.1.0", 9, "conformance_pause")] },
    ]);
    expect(findings.map((f) => [f.shapeRef, f.roomsHeld])).toEqual([["payables-watch@1.1.0", 9], ["delivery-small@1.0.0", 4]]);
    expect(findings[0]!.queueKey).toBe("wr:payables-watch@1.1.0:merge");
  });
});

describe("bottleneckSignal", () => {
  it("keeps one identity per step and cause, so the improvement facility deduplicates across reviews", () => {
    const [finding] = findFlowBottlenecks([{ key: "foundational", shapes: [shape("payables-watch@1.1.0", 9, "conformance_pause")] }]);
    const signal = bottleneckSignal(finding!, "Payables watch");
    expect(signal.sourceType).toBe(FLOW_BOTTLENECK_SOURCE);
    expect(signal.sourceId).toBe("wr:payables-watch@1.1.0:merge|conformance_pause");
    expect(signal.title).toBe('Work piles up at "merge" in Payables watch (blocked: conformance pause)');
    expect(bottleneckSignal({ ...finding!, roomsHeld: 12 }, "Payables watch").sourceId).toBe(signal.sourceId);
  });
});
