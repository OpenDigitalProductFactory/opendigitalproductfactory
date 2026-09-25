import { describe, expect, it } from "vitest";

import { LARGE_ITEM_FLOOR_POINTS, decideInvestmentAdmission, wipAllowance } from "./investment-admission";

const base = { inFlightPoints: 0, itemPoints: 3, allowance: 10, startKind: "autonomous" as const, breakFix: false, alreadyInFlight: false };

describe("decideInvestmentAdmission (BI-3430B3A4)", () => {
  it("admits ten small items and two large items alike when their points are equal (AC-1)", () => {
    const tenSmall = decideInvestmentAdmission({ ...base, allowance: 20, inFlightPoints: 9, itemPoints: 1 });
    const twoLarge = decideInvestmentAdmission({ ...base, allowance: 20, inFlightPoints: 8, itemPoints: 8 });
    expect(tenSmall.verdict).toBe("admit");
    expect(twoLarge.verdict).toBe("admit");
    // ...and both are refused alike once the points no longer fit.
    expect(decideInvestmentAdmission({ ...base, allowance: 10, inFlightPoints: 10, itemPoints: 1 }).verdict).toBe("refuse");
    expect(decideInvestmentAdmission({ ...base, allowance: 10, inFlightPoints: 8, itemPoints: 8 }).verdict).toBe("refuse");
  });

  it("refuses an autonomous start past the allowance and says why (AC-2)", () => {
    const d = decideInvestmentAdmission({ ...base, inFlightPoints: 9, itemPoints: 3 });
    expect(d).toMatchObject({ verdict: "refuse" });
    expect(d.reason).toContain("12 of 10 points");
  });

  it("lets a person start past the allowance with a warning (AC-3)", () => {
    expect(decideInvestmentAdmission({ ...base, startKind: "human", inFlightPoints: 9, itemPoints: 3 })).toMatchObject({ verdict: "warn" });
  });

  it("counts break-fix work but never blocks it", () => {
    expect(decideInvestmentAdmission({ ...base, breakFix: true, inFlightPoints: 50 })).toMatchObject({ verdict: "admit" });
  });

  it("admits an item already in flight: it is not a new start", () => {
    expect(decideInvestmentAdmission({ ...base, alreadyInFlight: true, inFlightPoints: 50 })).toMatchObject({ verdict: "admit" });
  });

  it("does not let an unsized item slip past the limit", () => {
    expect(decideInvestmentAdmission({ ...base, itemPoints: null }).verdict).toBe("refuse");
    expect(decideInvestmentAdmission({ ...base, startKind: "human", itemPoints: null }).verdict).toBe("warn");
  });
});

describe("wipAllowance", () => {
  it("uses the period's override first, then throughput x two weeks, then the one-large-item floor", () => {
    expect(wipAllowance({ override: 30, weeklyThroughput: 40 })).toEqual({ points: 30, source: "override" });
    expect(wipAllowance({ override: null, weeklyThroughput: 12 })).toEqual({ points: 24, source: "throughput" });
    expect(wipAllowance({ override: null, weeklyThroughput: 2 })).toEqual({ points: LARGE_ITEM_FLOOR_POINTS, source: "floor" });
    expect(wipAllowance({ override: null, weeklyThroughput: null })).toEqual({ points: 8, source: "floor" });
  });
});
