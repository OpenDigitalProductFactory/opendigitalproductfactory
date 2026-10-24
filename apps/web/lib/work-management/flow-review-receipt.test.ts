import { describe, expect, it } from "vitest";

import { computeFlowReviewHistory, liveStageHolds, type ReceiptSnapshot } from "./flow-review-receipt";

const H = 3_600_000;
const SHAPE = "delivery-small@1.0.0";
const START = "2026-07-01";
const on = (offsetDays: number) => new Date(Date.parse(`${START}T00:00:00Z`) + offsetDays * 24 * H).toISOString().slice(0, 10);
const snap = (stage: string, offsetDays: number, throughput: number, cycleH: number, processH: number, depth = 0): ReceiptSnapshot => ({
  queueKey: `wr:${SHAPE}:${stage}`,
  period: on(offsetDays),
  throughput,
  cycleP50Ms: cycleH * H,
  processP50Ms: processH * H,
  firstPassYield: null,
  depth,
});
const stages = [{ key: "implement", title: "Implement" }, { key: "merge", title: "Merge" }];

describe("computeFlowReviewHistory", () => {
  it("compares each review point with the version's first four weeks, newest first", () => {
    const history = computeFlowReviewHistory({
      shapeRef: SHAPE,
      stages,
      snapshots: [
        // The version's first stage data, then a baseline of 10 exits at 10h dwell, 1h process.
        snap("implement", 0, 0, 0, 0),
        snap("implement", 3, 10, 10, 1),
        // After: 10 exits at 4h dwell, 2h process.
        snap("implement", 40, 10, 4, 2),
      ],
      everyDays: 14,
      now: new Date(Date.parse(`${START}T00:00:00Z`) + 60 * 24 * H),
    });
    expect(history).toMatchObject({ baselineFrom: START, baselineTo: on(28), baseline: { exits: 10, stepDwellMs: 10 * H, flowEfficiency: 0.1 } });
    // Reviews at day 28, 42 and 56; the day-14 review falls inside the baseline.
    expect(history!.receipts.map((r) => r.reviewedOn)).toEqual([on(56), on(42), on(28)]);
    expect(history!.receipts[0]!.current).toEqual({ exits: 10, stepDwellMs: 4 * H, flowEfficiency: 0.5 });
  });

  it("names the step with the most rooms held × typical wait, and only the latest review carries the live cause", () => {
    const snapshots = [
      snap("implement", 0, 0, 0, 0),
      ...[2, 4, 6].map((d) => snap("implement", d, 2, 3, 2)),
      snap("implement", 27, 0, 0, 0, 6),
      ...[2, 4, 6].map((d) => snap("merge", d, 2, 50, 2)),
      snap("merge", 27, 0, 0, 0, 2),
      ...[30, 32, 34].map((d) => snap("merge", d, 2, 50, 2)),
      snap("merge", 55, 0, 0, 0, 2),
    ];
    const history = computeFlowReviewHistory({
      shapeRef: SHAPE,
      stages,
      snapshots,
      everyDays: 28,
      liveHolds: [{ stageKey: "merge", roomsHeld: 2, cause: "awaiting-person" }],
      now: new Date(Date.parse(`${START}T00:00:00Z`) + 57 * 24 * H),
    });
    // implement: 6 held × 1h wait = 6h; merge: 2 held × 48h = 96h.
    expect(history!.receipts[0]!.bottleneck).toEqual({ stageKey: "merge", title: "Merge", roomsHeld: 2, waitMs: 48 * H, cause: "awaiting-person" });
    expect(history!.receipts[1]!.bottleneck).toEqual({ stageKey: "merge", title: "Merge", roomsHeld: 2, waitMs: 48 * H, cause: null });
  });

  it("returns nothing for a version without stage data, and no receipts before the baseline is complete", () => {
    expect(computeFlowReviewHistory({ shapeRef: SHAPE, stages, snapshots: [], everyDays: 7, now: new Date() })).toBeNull();
    const early = computeFlowReviewHistory({
      shapeRef: SHAPE,
      stages,
      snapshots: [snap("implement", 1, 2, 5, 1)],
      everyDays: 7,
      now: new Date(Date.parse(`${START}T00:00:00Z`) + 20 * 24 * H),
    });
    expect(early!.receipts).toEqual([]);
    expect(early!.firstReviewOn).toBe(on(29));
    expect(early!.baseline).toEqual({ exits: 2, stepDwellMs: null, flowEfficiency: null });
  });

  it("ignores other versions' queues", () => {
    const other = { ...snap("implement", 1, 50, 99, 1), queueKey: "wr:delivery-small@2.0.0:implement" };
    expect(computeFlowReviewHistory({ shapeRef: SHAPE, stages, snapshots: [other], everyDays: 7, now: new Date() })).toBeNull();
  });
});

describe("liveStageHolds", () => {
  const obs = (action: string, reason: string, stageKey: string | null) => ({ current: { action, reason, stageKey, cycleKey: null } });
  it("counts held rooms per step and names the cause most of them share; working and stepless rooms are not held", () => {
    expect(liveStageHolds([
      obs("pause", "conformance_pause", "merge"),
      obs("pause", "conformance_pause", "merge"),
      obs("attention", "role_stage", "merge"),
      obs("attention", "role_stage", "review"),
      obs("dispatch_agent", "agent_stage", "merge"),
      obs("pause", "conformance_pause", null),
      { current: null },
    ])).toEqual([
      { stageKey: "merge", roomsHeld: 3, cause: "conformance_pause" },
      { stageKey: "review", roomsHeld: 1, cause: "awaiting-person" },
    ]);
  });
});
