import { describe, expect, it } from "vitest";

import { FLOW_BOTTLENECK_SOURCE, MIN_ROOMS_HELD, bottleneckSignal, findFlowBottlenecks } from "./flow-review";

const shape = (shapeRef: string, roomsHeld: number, cause: string) => ({
  shapeKey: shapeRef.split("@")[0]!, shapeRef, roomsInFlow: roomsHeld + 1, flowTimeP50Ms: null, runs: 0,
  bottleneck: { stageKey: "merge", roomsHeld, cause },
  held: [{ stageKey: "merge", roomsHeld, cause }],
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

  it("merges one step's pile across portfolios into one finding, so a review touches each signal once", () => {
    // Live 2026-10-09..13: the Medium design-note pile sat in foundational and unplaced, and its signal counted twice a day.
    const findings = findFlowBottlenecks([
      { key: "foundational", shapes: [shape("delivery-medium@1.0.0", 9, "awaiting-person")] },
      { key: "manufactureAndDeliver", shapes: [shape("delivery-medium@1.0.0", 2, "awaiting-person")] },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ roomsHeld: 11, portfolios: ["foundational", "manufactureAndDeliver"] });
    expect(new Set(findings.map((f) => bottleneckSignal(f, "Medium").sourceId)).size).toBe(1);
    expect(bottleneckSignal(findings[0]!, "Medium").description).toContain("Portfolios: foundational, manufactureAndDeliver.");
  });

  it("judges the threshold on the whole pile, not one portfolio's share", () => {
    const split = findFlowBottlenecks([
      { key: "foundational", shapes: [shape("delivery-small@1.0.0", 2, "awaiting-person")] },
      { key: "forEmployees", shapes: [shape("delivery-small@1.0.0", 2, "awaiting-person")] },
    ]);
    expect(split.map((f) => f.roomsHeld)).toEqual([4]);
  });

  it("keeps a different cause at the same step as a different pile", () => {
    const findings = findFlowBottlenecks([
      { key: "foundational", shapes: [shape("delivery-small@1.0.0", 3, "awaiting-person")] },
      { key: "forEmployees", shapes: [shape("delivery-small@1.0.0", 3, "conformance_pause")] },
    ]);
    expect(findings).toHaveLength(2);
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
