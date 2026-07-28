import { describe, expect, it } from "vitest";
import {
  buildValueEffortMatrix,
  groupByFunnelStage,
  itemEffort,
  itemValue,
  valueBand,
  type DemandItemView,
} from "./board";

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

describe("groupByFunnelStage", () => {
  it("keeps null-stage items explicitly unclassified and orders each column by score desc", () => {
    const cols = groupByFunnelStage([
      item({ itemId: "A", demandStage: "screened", demandScore: 5 }),
      item({ itemId: "B", demandStage: "screened", demandScore: 50 }),
      item({ itemId: "C" }), // null stage -> unclassified
      item({ itemId: "D", demandStage: "ready", demandScore: 1 }),
    ]);
    expect(cols.map((c) => c.stage)).toEqual(["unclassified", "raw", "screened", "shaped", "ready"]);
    expect(cols[0].items.map((i) => i.itemId)).toEqual(["C"]);
    expect(cols[2].items.map((i) => i.itemId)).toEqual(["B", "A"]); // 50 before 5
    expect(cols[4].items.map((i) => i.itemId)).toEqual(["D"]);
  });
});

describe("effort/value derivation", () => {
  it("derives effort from jobSize then t-shirt size", () => {
    expect(itemEffort(item({ itemId: "A", jobSize: 4 }))).toBe(4);
    expect(itemEffort(item({ itemId: "B", effortSize: "large" }))).toBe(8);
    expect(itemEffort(item({ itemId: "C" }))).toBeNull();
  });

  it("uses demandScore as value, else impact", () => {
    expect(itemValue(item({ itemId: "A", demandScore: 12 }))).toBe(12);
    expect(itemValue(item({ itemId: "B", impact: 3 }))).toBe(3);
    expect(itemValue(item({ itemId: "C" }))).toBeNull();
  });
});

describe("buildValueEffortMatrix", () => {
  it("splits items into quadrants around the population medians", () => {
    const m = buildValueEffortMatrix([
      item({ itemId: "QW", demandScore: 100, jobSize: 1 }), // high value, low effort
      item({ itemId: "BB", demandScore: 90, jobSize: 20 }), // high value, high effort
      item({ itemId: "FI", demandScore: 2, jobSize: 1 }), // low value, low effort
      item({ itemId: "TS", demandScore: 3, jobSize: 18 }), // low value, high effort
      item({ itemId: "NP" }), // unplottable
    ]);
    const q = Object.fromEntries(m.points.map((p) => [p.item.itemId, p.quadrant]));
    expect(q.QW).toBe("quick_win");
    expect(q.BB).toBe("big_bet");
    expect(q.FI).toBe("fill_in");
    expect(q.TS).toBe("time_sink");
    expect(m.unplotted.map((i) => i.itemId)).toEqual(["NP"]);
  });
});

describe("valueBand", () => {
  it("bands the score for the card front", () => {
    expect(valueBand(item({ itemId: "A", demandScore: 250 }))).toBe("high");
    expect(valueBand(item({ itemId: "B", demandScore: 40 }))).toBe("medium");
    expect(valueBand(item({ itemId: "C", demandScore: 2 }))).toBe("low");
    expect(valueBand(item({ itemId: "D" }))).toBe("unscored");
  });
});
