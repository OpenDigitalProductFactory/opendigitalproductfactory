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
});
