import { describe, expect, it } from "vitest";

import { placeInFlow, groupByFlowLane, FLOW_LANES, type FlowLane } from "./flow";
import { type DemandItemView } from "./board";

function item(partial: Partial<DemandItemView> & { itemId: string }): DemandItemView {
  return {
    title: partial.itemId,
    status: "open",
    workType: "feature",
    epicId: null,
    demandStage: null,
    demandScore: null,
    demandScoreFramework: null,
    effortSize: null,
    jobSize: null,
    impact: null,
    investmentBucket: null,
    estimateAiJobSize: null,
    estimateHumanJobSize: null,
    estimateSource: null,
    estimateAgreed: null,
    claimStatus: null,
    claimedByAgentId: null,
    ...partial,
  };
}

describe("placeInFlow", () => {
  it("places by demandStage in the funnel when not yet executing", () => {
    expect(placeInFlow(item({ itemId: "A" }))).toBe("unclassified");
    expect(placeInFlow(item({ itemId: "B", demandStage: "raw" }))).toBe("funnel_raw");
    expect(placeInFlow(item({ itemId: "C", demandStage: "screened" }))).toBe("funnel_screened");
    expect(placeInFlow(item({ itemId: "D", demandStage: "shaped" }))).toBe("funnel_shaped");
  });

  it("places a ready (funded) item on the bet seam", () => {
    expect(placeInFlow(item({ itemId: "E", demandStage: "ready" }))).toBe("bet");
  });

  it("lets execution status win over funnel stage (one item, downstream face)", () => {
    // Being built = downstream, regardless of how far it got in the funnel.
    expect(placeInFlow(item({ itemId: "F", status: "in-progress", demandStage: "ready" }))).toBe("in_progress");
    expect(placeInFlow(item({ itemId: "G", status: "in-progress", demandStage: "screened" }))).toBe("in_progress");
  });

  it("keeps legacy execution with no demand stage visible for classification", () => {
    expect(placeInFlow(item({ itemId: "H", status: "in-progress" }))).toBe("unclassified");
  });

  it("does not coerce an unknown stored stage into raw demand", () => {
    expect(
      placeInFlow(
        item({
          itemId: "I",
          status: "in-progress",
          demandStage: "legacy-stage",
        }),
      ),
    ).toBe("unclassified");
  });
});

describe("groupByFlowLane", () => {
  it("returns all lanes in river order, even when empty", () => {
    const cols = groupByFlowLane([]);
    expect(cols.map((c) => c.lane)).toEqual(FLOW_LANES);
    expect(cols.every((c) => c.items.length === 0)).toBe(true);
  });

  it("assigns each item to exactly one lane and orders by score desc", () => {
    const cols = groupByFlowLane([
      item({ itemId: "low", demandStage: "screened", demandScore: 5 }),
      item({ itemId: "high", demandStage: "screened", demandScore: 50 }),
      item({ itemId: "bet1", demandStage: "ready", demandScore: 20 }),
      item({ itemId: "exec", status: "in-progress", demandStage: "ready", demandScore: 99 }),
      item({ itemId: "rawItem" }),
    ]);
    const byLane = Object.fromEntries(cols.map((c) => [c.lane, c.items.map((i) => i.itemId)])) as Record<FlowLane, string[]>;
    expect(byLane.unclassified).toEqual(["rawItem"]);
    expect(byLane.funnel_screened).toEqual(["high", "low"]); // 50 before 5
    expect(byLane.bet).toEqual(["bet1"]);
    expect(byLane.in_progress).toEqual(["exec"]); // status wins over demandStage=ready
    // Every input item placed exactly once across all lanes.
    expect(cols.reduce((n, c) => n + c.items.length, 0)).toBe(5);
  });

  it("tags each lane with its river half (two visual languages)", () => {
    const cols = groupByFlowLane([]);
    const halfByLane = Object.fromEntries(cols.map((c) => [c.lane, c.half]));
    expect(halfByLane.funnel_raw).toBe("funnel");
    expect(halfByLane.unclassified).toBe("classification");
    expect(halfByLane.bet).toBe("bet");
    expect(halfByLane.in_progress).toBe("board");
  });
});
