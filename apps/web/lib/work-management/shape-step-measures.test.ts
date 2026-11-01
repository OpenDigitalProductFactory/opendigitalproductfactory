import { describe, expect, it } from "vitest";

import { computeShapeStepMeasures, topByWaitTimesQueue, typicalStepWaitMs, type StepSnapshot } from "./shape-step-measures";

const H = 3_600_000;
const NOW = new Date("2026-10-14T12:00:00Z");
const SHAPE = "delivery-medium@1.0.0";
const day = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 24 * H).toISOString().slice(0, 10);
const snap = (stage: string, daysAgo: number, throughput: number, cycleH: number, processH: number | null, fpy: number | null = null): StepSnapshot => ({
  queueKey: `wr:${SHAPE}:${stage}`,
  period: day(daysAgo),
  throughput,
  cycleP50Ms: cycleH * H,
  processP50Ms: processH == null ? null : processH * H,
  firstPassYield: fpy,
});
const stages = [
  { key: "design-note", title: "Design note" },
  { key: "implement", title: "Implement" },
  { key: "merge", title: "Merge" },
];

describe("computeShapeStepMeasures", () => {
  it("gives each step a data box: queue, typical dwell, process, wait and first-pass yield, weighted by exits", () => {
    const { steps } = computeShapeStepMeasures({
      shapeRef: SHAPE,
      stages,
      snapshots: [snap("design-note", 20, 3, 10, 1, 1), snap("design-note", 10, 3, 20, 3, 0.5)],
      liveCounts: new Map([[`wr:${SHAPE}:design-note`, { wip: 9, depth: 6 }]]),
      now: NOW,
    });
    const box = steps[0]!;
    expect(box.queue).toEqual({ wip: 9, depth: 6 });
    expect(box.exits).toBe(6);
    expect(box.dwellMs).toBe(15 * H);
    expect(box.processMs).toBe(2 * H);
    expect(box.waitMs).toBe(13 * H);
    expect(box.firstPassYield).toBeCloseTo(0.75);
  });

  it("says too few to measure below five exits, never a number", () => {
    const { steps, ladder } = computeShapeStepMeasures({
      shapeRef: SHAPE,
      stages,
      snapshots: [snap("implement", 3, 4, 5, 2)],
      liveCounts: new Map(),
      now: NOW,
    });
    expect(steps[1]).toMatchObject({ exits: 4, dwellMs: null, processMs: null, waitMs: null, firstPassYield: null, heat: null });
    expect(steps[1]!.queue).toEqual({ wip: 0, depth: 0 });
    expect(ladder).toBeNull();
  });

  it("builds the timeline ladder from measured steps: process above, wait below, efficiency = process / dwell", () => {
    const { ladder } = computeShapeStepMeasures({
      shapeRef: SHAPE,
      stages,
      snapshots: [snap("design-note", 5, 5, 10, 1), snap("implement", 5, 5, 6, 3), snap("merge", 5, 2, 50, 1)],
      liveCounts: new Map(),
      now: NOW,
    });
    expect(ladder).toEqual({
      steps: [
        { key: "design-note", processMs: 1 * H, waitMs: 9 * H },
        { key: "implement", processMs: 3 * H, waitMs: 3 * H },
      ],
      processMs: 4 * H,
      waitMs: 12 * H,
      flowEfficiency: 0.25,
      unmeasured: 1,
    });
  });

  it("marks a step hotter or cooler when its last seven days differ from its four-week baseline by a quarter", () => {
    const { steps } = computeShapeStepMeasures({
      shapeRef: SHAPE,
      stages,
      snapshots: [
        // design-note: baseline 10h over 20 days ago, recent 30h -> hotter
        snap("design-note", 20, 10, 10, 1), snap("design-note", 2, 5, 30, 1),
        // implement: recent faster -> cooler
        snap("implement", 20, 10, 20, 2), snap("implement", 1, 5, 5, 2),
        // merge: recent too few exits -> no heat
        snap("merge", 20, 10, 8, 1), snap("merge", 1, 2, 30, 1),
      ],
      liveCounts: new Map(),
      now: NOW,
    });
    expect(steps[0]!.heat).toMatchObject({ direction: "hotter", recentDwellMs: 30 * H });
    expect(steps[0]!.heat!.baselineDwellMs).toBeCloseTo((10 * 10 + 5 * 30) / 15 * H);
    expect(steps[1]!.heat?.direction).toBe("cooler");
    expect(steps[2]!.heat).toBeNull();
  });

  it("ignores snapshots outside the four-week window and other shape versions", () => {
    const { steps } = computeShapeStepMeasures({
      shapeRef: SHAPE,
      stages,
      snapshots: [snap("design-note", 40, 50, 99, 1), { ...snap("design-note", 3, 50, 99, 1), queueKey: "wr:delivery-medium@2.0.0:design-note" }],
      liveCounts: new Map(),
      now: NOW,
    });
    expect(steps[0]!.exits).toBe(0);
  });
});

describe("typicalStepWaitMs", () => {
  it("is dwell minus process, weighted by exits, and null below five exits", () => {
    expect(typicalStepWaitMs([snap("merge", 2, 3, 10, 1), snap("merge", 1, 3, 20, 3)])).toBe(13 * H);
    expect(typicalStepWaitMs([snap("merge", 2, 4, 10, 1)])).toBeNull();
    expect(typicalStepWaitMs([snap("merge", 2, 6, 10, null)])).toBeNull();
  });
});

describe("topByWaitTimesQueue", () => {
  it("picks the most rooms held × wait among measured piles, falling back to rooms held when none is measured", () => {
    expect(topByWaitTimesQueue([{ id: "a", roomsHeld: 9, waitMs: 1 }, { id: "b", roomsHeld: 2, waitMs: 10 }, { id: "c", roomsHeld: 50, waitMs: null }])?.id).toBe("b");
    expect(topByWaitTimesQueue([{ id: "a", roomsHeld: 3, waitMs: null }, { id: "b", roomsHeld: 7, waitMs: null }])?.id).toBe("b");
    expect(topByWaitTimesQueue([{ id: "a", roomsHeld: 0, waitMs: 99 }])).toBeNull();
  });
});
