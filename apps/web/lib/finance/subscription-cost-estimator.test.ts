import { describe, expect, it } from "vitest";
import {
  estimateSubscriptionUnitCost,
  estimatedCallCostUsd,
  mergeWindowObservations,
  monthlyFeeFromContract,
  resetWindowHoursFor,
  type WindowObservation,
} from "./subscription-cost-estimator";

const M = 1_000_000;
/** 30 observed days scaled to an average month. */
const K = 30.44 / 30;
const used = (tokens: number, n: number): WindowObservation[] => Array.from({ length: n }, () => ({ tokens, limitHits: 0 }));
const limited = (tokens: number, n: number): WindowObservation[] => Array.from({ length: n }, () => ({ tokens, limitHits: 3 }));

describe("monthly fee", () => {
  it("normalises the recorded payment to one month", () => {
    expect(monthlyFeeFromContract({ monthlyCommittedAmount: 200, billingCadence: "monthly" })).toBe(200);
    expect(monthlyFeeFromContract({ monthlyCommittedAmount: 600, billingCadence: "quarterly" })).toBe(200);
    expect(monthlyFeeFromContract({ monthlyCommittedAmount: 2400, billingCadence: "annual" })).toBe(200);
  });
  it("is missing when nothing usable is recorded", () => {
    expect(monthlyFeeFromContract({ monthlyCommittedAmount: null, billingCadence: "monthly" })).toBeNull();
    expect(monthlyFeeFromContract({ monthlyCommittedAmount: 0, billingCadence: "monthly" })).toBeNull();
    expect(monthlyFeeFromContract({ monthlyCommittedAmount: 20, billingCadence: "weekly" })).toBeNull();
  });
  it("uses the shortest stated reset window of the plan's providers", () => {
    expect(resetWindowHoursFor(["chatgpt", "codex"])).toBe(5);
    expect(resetWindowHoursFor(["something-new"])).toBe(5);
  });
});

describe("effective cost = fee / usable capacity", () => {
  it("says the fee is not recorded and gives no cost", () => {
    const e = estimateSubscriptionUnitCost({ monthlyFeeUsd: null, windowHours: 5, observedDays: 30, windows: limited(M, 10) });
    expect(e).toMatchObject({ status: "fee-missing", usdPerMillionTokens: null, capacity: null });
    expect(estimatedCallCostUsd(e, 1000)).toBeNull();
  });

  it("does not convert a fee in another currency", () => {
    expect(estimateSubscriptionUnitCost({ monthlyFeeUsd: 200, currency: "EUR", windowHours: 5, observedDays: 30, windows: used(M, 4) }).status)
      .toBe("currency-unsupported");
  });

  it("has no estimate without usage", () => {
    expect(estimateSubscriptionUnitCost({ monthlyFeeUsd: 200, windowHours: 5, observedDays: 30, windows: [] }).status).toBe("no-usage");
  });

  it("treats a never-limited plan's cost as a low-confidence ceiling", () => {
    // 20 windows x 1M tokens over 30 days, about 20.3M tokens a month.
    const e = estimateSubscriptionUnitCost({ monthlyFeeUsd: 200, windowHours: 5, observedDays: 30, windows: used(M, 20) });
    expect(e).toMatchObject({ status: "estimated", confidence: "low", ceilingOnly: true });
    expect(e.capacity?.highTokens).toBeNull();
    expect(e.usdPerMillionTokens?.point).toBeCloseTo(10 / K, 6);
    expect(e.usdPerMillionTokens?.low).toBeNull();
  });

  it("derives capacity from limited windows and reports a band with confidence", () => {
    // 60 active windows over 30 days, 10 limited at 2M tokens, the rest using 1M.
    const windows = [...limited(2 * M, 10), ...used(M, 50)];
    const e = estimateSubscriptionUnitCost({ monthlyFeeUsd: 200, windowHours: 5, observedDays: 30, windows });
    expect(e).toMatchObject({ status: "estimated", confidence: "high", ceilingOnly: false, activeWindows: 60, limitedWindows: 10 });
    expect(e.capacity?.lowTokens).toBeCloseTo(70 * M * K, 0); // what was used
    expect(e.capacity?.pointTokens).toBeCloseTo(120 * M * K, 0); // 2M a window x 60 active windows
    const band = e.usdPerMillionTokens!;
    expect(band.point).toBeCloseTo(200 / (120 * K), 6);
    expect(band.high).toBeCloseTo(200 / (70 * K), 6);
    expect(band.low!).toBeLessThanOrEqual(band.point);
    expect(band.point).toBeLessThanOrEqual(band.high);
    expect(estimatedCallCostUsd(e, 120 * M * K)).toBeCloseTo(200, 6);
  });

  it("prices a strict-reset plan dearer than a generous-reset one with the same fee and usage", () => {
    const fee = 200, days = 30;
    // Generous: limits clear within the window, so limited windows still hold real work.
    const generous = [...limited(2 * M, 10), ...used(M, 50)];
    // Strict: the same work, plus a multi-day lockout that limits 14 windows with no usage at all.
    const strict = [...limited(2 * M, 10), ...used(M, 50), ...limited(0, 14)];
    const g = estimateSubscriptionUnitCost({ monthlyFeeUsd: fee, windowHours: 5, observedDays: days, windows: generous });
    const s = estimateSubscriptionUnitCost({ monthlyFeeUsd: fee, windowHours: 5, observedDays: days, windows: strict });
    expect(s.capacity!.pointTokens).toBeLessThan(g.capacity!.pointTokens);
    expect(s.usdPerMillionTokens!.point).toBeGreaterThan(g.usdPerMillionTokens!.point);
  });

  it("never estimates capacity below what was actually used", () => {
    const e = estimateSubscriptionUnitCost({ monthlyFeeUsd: 200, windowHours: 5, observedDays: 30, windows: [...used(5 * M, 10), ...limited(0, 5)] });
    expect(e.capacity!.pointTokens).toBeCloseTo(50 * M * K, 0);
    expect(e.usdPerMillionTokens!.point).toBeCloseTo(e.usdPerMillionTokens!.high, 9);
  });

  it("lowers confidence when the record is short or thin", () => {
    expect(estimateSubscriptionUnitCost({ monthlyFeeUsd: 200, windowHours: 5, observedDays: 8, windows: limited(M, 2) }).confidence).toBe("medium");
    expect(estimateSubscriptionUnitCost({ monthlyFeeUsd: 200, windowHours: 5, observedDays: 3, windows: limited(M, 6) }).confidence).toBe("low");
  });

  it("pools usage and limit hits by window", () => {
    expect(mergeWindowObservations([{ window: 1, tokens: 10 }, { window: 1, tokens: 5 }, { window: 2, tokens: 7 }], [{ window: 2, hits: 1 }, { window: 3, hits: 2 }]))
      .toEqual([{ tokens: 15, limitHits: 0 }, { tokens: 7, limitHits: 1 }, { tokens: 0, limitHits: 2 }]);
  });
});
