import { describe, expect, it } from "vitest";

import type { QueueTelemetryRow } from "@/lib/queue/queue-metrics-rollup";

import { computePortfolioFlow, shapeItemType, type PortfolioFlowRoom } from "./portfolio-flow";

const now = new Date(Date.UTC(2026, 9, 7, 12));
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const SHAPE = "delivery-small@1.0.0";

const row = (capsuleId: string, stage: string, transition: string, h: number, outcome: string | null = null): QueueTelemetryRow => ({
  queueKey: `wr:${SHAPE}:${stage}`,
  itemKind: "workroom-stage",
  itemId: `${capsuleId}:run`,
  transition,
  outcome,
  occurredAt: hoursAgo(h),
});

/** A run: enter `reproduce` working, finish it, enter `merge` waiting on a person for `waitH`, then a stop. */
const run = (capsuleId: string, startH: number, waitH: number, outcome = "success") => [
  row(capsuleId, "reproduce", "enqueued", startH),
  row(capsuleId, "reproduce", "started", startH),
  row(capsuleId, "reproduce", "finished", startH - 2, "success"),
  row(capsuleId, "merge", "enqueued", startH - 2),
  row(capsuleId, "merge", "held", startH - 2),
  row(capsuleId, "merge", "released", startH - 2 - waitH),
  row(capsuleId, "merge", "finished", startH - 2 - waitH, outcome),
];

const room = (capsuleId: string, portfolioRole: string | null, action: string | null = null, reason: string | null = null, stageKey: string | null = null): PortfolioFlowRoom => ({
  capsuleId,
  portfolioRole,
  shapeRef: SHAPE,
  current: action ? { action, reason, stageKey, cycleKey: null } : null,
});

describe("computePortfolioFlow", () => {
  it("returns the four portfolios and an unplaced bucket, in a fixed order", () => {
    const flows = computePortfolioFlow({ rooms: [], rows: [], now });
    expect(flows.map((f) => f.key)).toEqual(["productsAndServicesSold", "manufactureAndDeliver", "forEmployees", "foundational", "unplaced"]);
  });

  it("measures flow time, efficiency and throughput from the rooms' runs", () => {
    const flows = computePortfolioFlow({
      rooms: [room("WC-1", "manufactureAndDeliver"), room("WC-2", "manufactureAndDeliver"), room("WC-3", "manufactureAndDeliver")],
      rows: [...run("WC-1", 100, 6), ...run("WC-2", 50, 2), ...run("WC-3", 40, 10, "failed")],
      now,
    });
    const md = flows.find((f) => f.key === "manufactureAndDeliver")!;
    // Runs: 8h, 4h, 12h → median 8h. Two reached success.
    expect(md.flowTime).toMatchObject({ p50Ms: 8 * 3_600_000, runs: 3 });
    expect(md.throughput.perWeek).toBeCloseTo(2 / 4);
    // Touch: 2h per run on reproduce; cycle: 2h + wait → (6) / (8+4+12)
    expect(md.flowEfficiency.value).toBeCloseTo(6 / 24);
  });

  it("counts live load, the mix, and each shape's bottleneck with its dominant cause", () => {
    const flows = computePortfolioFlow({
      rooms: [
        room("WC-1", "manufactureAndDeliver", "dispatch_agent", "agent_stage", "repair"),
        room("WC-2", "manufactureAndDeliver", "pause", "conformance_pause", "merge"),
        room("WC-3", "manufactureAndDeliver", "pause", "conformance_pause", "merge"),
        room("WC-4", "manufactureAndDeliver", "attention", "role_stage", "merge"),
        room("WC-5", "manufactureAndDeliver", "stop", "success", null),
      ],
      rows: [],
      now,
    });
    const md = flows.find((f) => f.key === "manufactureAndDeliver")!;
    expect(md.flowLoad).toBe(4);
    expect(md.distribution).toEqual({ feature: 4, defect: 0, risk: 0, debt: 0 });
    expect(md.shapes).toEqual([
      expect.objectContaining({ shapeKey: "delivery-small", roomsInFlow: 4, bottleneck: { stageKey: "merge", roomsHeld: 3, cause: "conformance_pause" } }),
    ]);
  });

  it("keeps rooms with no portfolio in their own bucket", () => {
    const flows = computePortfolioFlow({ rooms: [room("WC-9", null, "dispatch_agent", "agent_stage", "repair")], rows: [], now });
    expect(flows.find((f) => f.key === "unplaced")!.flowLoad).toBe(1);
    expect(flows.filter((f) => f.key !== "unplaced").every((f) => f.flowLoad === 0)).toBe(true);
  });

  it("compares with the prior window", () => {
    const flows = computePortfolioFlow({
      rooms: [room("WC-1", "foundational"), room("WC-2", "foundational")],
      rows: [...run("WC-1", 24 * 40, 4), ...run("WC-2", 24, 1)],
      now,
    });
    const f = flows.find((x) => x.key === "foundational")!;
    expect(f.flowTime.priorP50Ms).toBe(6 * 3_600_000);
    expect(f.flowTime.p50Ms).toBe(3 * 3_600_000);
  });
});

describe("shapeItemType", () => {
  it.each([
    ["delivery-break-fix", "defect"],
    ["delivery-medium", "feature"],
    ["dependency-advisory-watch", "risk"],
    ["credential-hygiene-watch", "risk"],
    ["estate-conformance-watch", "debt"],
    ["payables-watch", "feature"],
    ["cross-cutting-portfolio-standup", null],
  ])("%s → %s", (key, type) => expect(shapeItemType(key)).toBe(type));

  // BI-C9F1DE01: a room parked with no demand (its item inactive, a quiet
  // posture) keeps its run open with an idle hold. Live load does not count it,
  // so neither does a week's end.
  it("leaves a run parked in an idle hold out of flow load from the week it was parked", () => {
    const W = 7 * 24;
    const flows = computePortfolioFlow({
      rooms: [room("WC-3", "foundational"), room("WC-4", "foundational")],
      rows: [
        row("WC-3", "reproduce", "enqueued", 5 * W),
        row("WC-3", "reproduce", "held", 5 * W),
        row("WC-4", "reproduce", "enqueued", 5 * W),
        row("WC-4", "reproduce", "started", 5 * W),
        { ...row("WC-4", "reproduce", "held", 2 * W + 24), laneKey: "work_item_inactive" },
      ],
      now,
    });
    expect(flows.find((flow) => flow.key === "foundational")!.weeklyFlowLoad).toEqual([0, 0, 0, 2, 2, 1, 1, 1]);
  });

  it("draws a weekly trend for every measure, oldest week first", () => {
    const W = 7 * 24;
    const flows = computePortfolioFlow({
      rooms: [room("WC-1", "foundational"), room("WC-2", "foundational"), room("WC-3", "foundational")],
      rows: [
        // Finished this week: 4h, waits 2h on merge.
        ...run("WC-1", 30, 2),
        // Finished three weeks ago.
        ...run("WC-2", 3 * W + 10, 1),
        // Entered five weeks ago and still in flow.
        row("WC-3", "reproduce", "enqueued", 5 * W),
        row("WC-3", "reproduce", "held", 5 * W),
      ],
      now,
    });
    const f = flows.find((flow) => flow.key === "foundational")!;
    expect(f.weeklyThroughput).toEqual([0, 0, 0, 0, 1, 0, 0, 1]);
    // 2h worked on reproduce, 2h held on merge.
    expect(f.weeklyFlowEfficiency.at(-1)).toBeCloseTo(2 / 4);
    expect(f.weeklyFlowEfficiency[0]).toBeNull();
    // In flow at each week's end: only WC-3, from the first week end after it entered.
    expect(f.weeklyFlowLoad).toEqual([0, 0, 0, 1, 1, 1, 1, 1]);
    expect(f.weeklyFlowLoad).toHaveLength(8);
  });

  it("marks the week a shape version replaced an earlier one in the same portfolio", () => {
    const W = 7 * 24;
    const v2 = (r: QueueTelemetryRow) => ({ ...r, queueKey: r.queueKey.replace(SHAPE, "delivery-small@1.1.0") });
    const flows = computePortfolioFlow({
      rooms: [room("WC-1", "foundational"), room("WC-2", "foundational"), room("WC-3", "manufactureAndDeliver")],
      rows: [
        ...run("WC-1", 6 * W, 1),
        // v1.1.0 first runs 13 days ago in Foundational: the week before this one.
        ...run("WC-2", 2 * W - 24, 1).map(v2),
        // In Manufacturing it is the only version seen, so nothing is replaced.
        ...run("WC-3", 2 * W - 24, 1).map(v2),
      ],
      now,
    });
    const foundational = flows.find((f) => f.key === "foundational")!;
    expect(foundational.weeklyVersionChanges).toEqual([[], [], [], [], [], [], ["delivery-small@1.1.0"], []]);
    expect(flows.find((f) => f.key === "manufactureAndDeliver")!.weeklyVersionChanges.flat()).toEqual([]);
  });

  it("stops counting a cancelled run as in flow when it was cancelled, and keeps it out of flow time", () => {
    const W = 7 * 24;
    const flows = computePortfolioFlow({
      rooms: [room("WC-9", "forEmployees")],
      rows: [
        { ...row("WC-9", "reproduce", "enqueued", 3 * W + 24), itemId: "WC-9:2026-09-16" },
        { ...row("WC-9", "reproduce", "held", 3 * W + 24), itemId: "WC-9:2026-09-16" },
        { ...row("WC-9", "reproduce", "cancelled", 2 * W + 24, "cancelled"), itemId: "WC-9:2026-09-16" },
      ],
      now,
    });
    const f = flows.find((flow) => flow.key === "forEmployees")!;
    // Open across the end of the week three weeks ago; cancelled before the next week's end.
    expect(f.weeklyFlowLoad).toEqual([0, 0, 0, 0, 1, 0, 0, 0]);
    expect(f.flowTime.runs).toBe(0);
    expect(f.weeklyThroughput.every((n) => n === 0)).toBe(true);
  });

  it("gives flow load a change against four weeks ago only when the telemetry reaches that far back", () => {
    const W = 7 * 24;
    const old = computePortfolioFlow({
      rooms: [room("WC-5", "foundational")],
      rows: [row("WC-5", "reproduce", "enqueued", 6 * W), row("WC-5", "reproduce", "held", 6 * W)],
      now,
    }).find((flow) => flow.key === "foundational")!;
    expect(old.flowLoadPrior).toBe(1);
    const recent = computePortfolioFlow({
      rooms: [room("WC-6", "foundational")],
      rows: [row("WC-6", "reproduce", "enqueued", 24), row("WC-6", "reproduce", "held", 24)],
      now,
    }).find((flow) => flow.key === "foundational")!;
    expect(recent.flowLoadPrior).toBeNull();
  });

  it("counts a run entered before the telemetry window as in flow, but leaves its unknown start out of flow time", () => {
    const flows = computePortfolioFlow({
      rooms: [room("WC-7", "foundational")],
      // Only its later events are in the window: no enqueued row.
      rows: [row("WC-7", "reproduce", "released", 50), row("WC-7", "reproduce", "finished", 10, "success")],
      now,
    });
    const f = flows.find((flow) => flow.key === "foundational")!;
    expect(f.flowTime.runs).toBe(0);
    expect(f.weeklyThroughput.at(-1)).toBe(1);
  });
});
