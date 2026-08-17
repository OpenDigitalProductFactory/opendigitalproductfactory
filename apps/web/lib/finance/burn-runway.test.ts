import { describe, expect, it } from "vitest";
import { computeBurnRunway } from "./burn-runway";

const base = {
  totalCash: 30_000,
  paidBills: { total: 0, count: 0 },
  paidExpenses: { total: 0, count: 0 },
  paidInvoices: { total: 0, count: 0 },
  monthlyCommittedRecurring: 0,
};

describe("computeBurnRunway (BI-090221E7)", () => {
  it("reports unknown — never zero — when nothing is recorded", () => {
    const result = computeBurnRunway({ ...base, totalCash: null });
    expect(result.monthlyBurn).toBeNull();
    expect(result.burnBasis).toBe("unknown");
    expect(result.monthlyRevenue).toBeNull();
    expect(result.runwayMonths).toBeNull();
    expect(result.runwayState).toBe("unknown-burn");
    expect(result.preRevenueWithBurn).toBe(false);
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  it("measures burn from recorded spend plus commitments and computes runway", () => {
    const result = computeBurnRunway({
      ...base,
      paidBills: { total: 9_000, count: 6 }, // 3k/month over 90 days
      monthlyCommittedRecurring: 500,
    });
    expect(result.burnBasis).toBe("measured");
    expect(result.monthlyBurn).toBeCloseTo(3_500);
    // Pre-revenue with real burn — the state worth flagging out loud.
    expect(result.preRevenueWithBurn).toBe(true);
    expect(result.runwayState).toBe("measured");
    expect(result.runwayMonths).toBeCloseTo(30_000 / 3_500);
  });

  it("uses committed-only basis when only supplier contracts are known", () => {
    const result = computeBurnRunway({ ...base, monthlyCommittedRecurring: 250 });
    expect(result.burnBasis).toBe("committed-only");
    expect(result.monthlyBurn).toBe(250);
    expect(result.gaps.some((g) => g.includes("commitments"))).toBe(true);
  });

  it("does not fabricate runway when cash is unknown", () => {
    const result = computeBurnRunway({
      ...base,
      totalCash: null,
      paidBills: { total: 3_000, count: 2 },
    });
    expect(result.runwayState).toBe("unknown-cash");
    expect(result.runwayMonths).toBeNull();
  });

  it("reports cash-growing instead of a runway when net burn is non-positive", () => {
    const result = computeBurnRunway({
      ...base,
      paidBills: { total: 3_000, count: 2 },
      paidInvoices: { total: 12_000, count: 4 },
    });
    expect(result.runwayState).toBe("cash-growing");
    expect(result.runwayMonths).toBeNull();
    expect(result.preRevenueWithBurn).toBe(false);
    expect(result.monthlyRevenue).toBeCloseTo(4_000);
  });
});
