import { describe, expect, it } from "vitest";
import {
  estimateSubscriptionUnitCost,
  estimatedCallCostUsd,
  mergeWindowObservations,
  monthlyFeeFromContract,
  estimateSubscriptionPlan,
  listPriceFor,
  LOCAL_INSTALL,
  resetWindowHoursFor,
  windowsFromHourlyBuckets,
  type PeerUsageStatus,
  type UsageBucket,
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

// BI-6361A930: token-equivalent value at list price, and usage combined across
// the installs that share a plan.
describe("token-equivalent value at list price", () => {
  const now = new Date("2026-11-13T00:00:00Z");
  const hourOf = (daysAgo: number) => Math.floor((now.getTime() - daysAgo * 86_400_000) / 3_600_000);
  const prices = new Map([
    ["anthropic", { inputPerMToken: 3, outputPerMToken: 15 }],
    ["anthropic-sub", { inputPerMToken: 0, outputPerMToken: 0 }],
    ["openai", { inputPerMToken: 2.5, outputPerMToken: 10 }],
    ["chatgpt", { inputPerMToken: 0, outputPerMToken: 0 }],
    ["codex", { inputPerMToken: 1.5, outputPerMToken: 6 }],
    ["gemini", { inputPerMToken: 1.25, outputPerMToken: 5 }],
  ]);
  const local = (providerId: string, daysAgo: number, inputTokens: number, outputTokens: number, limitHits = 0): UsageBucket =>
    ({ install: LOCAL_INSTALL, providerId, hour: hourOf(daysAgo), inputTokens, outputTokens, limitHits });
  const peer = (providerId: string, daysAgo: number, inputTokens: number, outputTokens: number, limitHits = 0): UsageBucket =>
    ({ install: "inst_dev", providerId, hour: hourOf(daysAgo), inputTokens, outputTokens, limitHits });
  const peerCurrent: PeerUsageStatus = { linkId: "link_1", install: "inst_dev", state: "current", reason: null, lastSuccessAt: now.toISOString() };

  it("prices a $0 subscription provider at its pay-per-token sibling, and a priced provider at its own price", () => {
    expect(listPriceFor("anthropic-sub", prices)).toEqual({ inputPerMToken: 3, outputPerMToken: 15, sourceProviderId: "anthropic" });
    expect(listPriceFor("chatgpt", prices)).toEqual({ inputPerMToken: 2.5, outputPerMToken: 10, sourceProviderId: "openai" });
    expect(listPriceFor("codex", prices)).toEqual({ inputPerMToken: 1.5, outputPerMToken: 6, sourceProviderId: "codex" });
    expect(listPriceFor("xai", prices)).toBeNull();
  });

  it("values a plan's usage at list price and reports savings against the fee", () => {
    // 30 days: 2M input + 18M output on anthropic-sub = 2*3 + 18*15 = $276.
    const plan = estimateSubscriptionPlan({
      monthlyFeeUsd: 200, coveredProviderIds: ["anthropic-sub"], listPrices: prices, now, peers: [],
      buckets: [local("anthropic-sub", 30, 1_000_000, 9_000_000), local("anthropic-sub", 1, 1_000_000, 9_000_000)],
    });
    expect(plan.value.status).toBe("priced");
    expect(plan.value.periodValueUsd).toBeCloseTo(276, 6);
    expect(plan.value.monthlyValueUsd).toBeCloseTo(276 * K, 6);
    expect(plan.value.monthlySavingsUsd).toBeCloseTo(276 * K - 200, 6);
    expect(plan.estimate.status).toBe("estimated");
    expect(plan.estimate.usdPerMillionTokens?.point).toBeCloseTo(200 / (20 * K), 6);
  });

  it("marks the value partial and names a provider with no list price", () => {
    const plan = estimateSubscriptionPlan({
      monthlyFeeUsd: 20, coveredProviderIds: ["xai", "codex"], listPrices: prices, now, peers: [],
      buckets: [local("xai", 30, 5_000_000, 1_000_000), local("codex", 30, 1_000_000, 1_000_000)],
    });
    expect(plan.value.status).toBe("partial");
    expect(plan.value.unpricedProviderIds).toEqual(["xai"]);
    expect(plan.value.periodValueUsd).toBeCloseTo(7.5, 6);
  });

  it("combines a plan shared by two installs, attributes each install's use, and counts the fee once", () => {
    const plan = estimateSubscriptionPlan({
      monthlyFeeUsd: 500, coveredProviderIds: ["chatgpt", "codex"], listPrices: prices, now, peers: [peerCurrent],
      buckets: [
        local("chatgpt", 30, 10_000_000, 1_000_000), // $25 + $10 = $35
        peer("chatgpt", 30, 20_000_000, 2_000_000), // $50 + $20 = $70
        peer("codex", 2, 1_000_000, 1_000_000, 2), // $1.5 + $6 = $7.5, limited
      ],
    });
    expect(plan.estimate.monthlyFeeUsd).toBe(500);
    expect(plan.value.periodValueUsd).toBeCloseTo(112.5, 6);
    expect(plan.installs.map((i) => [i.install, i.tokens, i.periodValueUsd])).toEqual([
      [LOCAL_INSTALL, 11_000_000, 35],
      ["inst_dev", 24_000_000, 77.5],
    ]);
    // Effective cost spreads the one fee over both installs' tokens.
    expect(plan.estimate.capacity?.lowTokens).toBeCloseTo(35_000_000 * K, 0);
    expect(plan.estimate.limitedWindows).toBe(1);
    expect(plan.usageCoverage).toBe("complete");
  });

  it("estimates a plan used only on the peer", () => {
    const plan = estimateSubscriptionPlan({
      monthlyFeeUsd: 20, coveredProviderIds: ["gemini"], listPrices: prices, now, peers: [peerCurrent],
      buckets: [peer("gemini", 30, 8_000_000, 2_000_000)],
    });
    expect(plan.estimate.status).toBe("estimated");
    expect(plan.value.periodValueUsd).toBeCloseTo(20, 6);
    expect(plan.installs).toEqual([expect.objectContaining({ install: "inst_dev", tokens: 10_000_000 })]);
    expect(plan.estimate.usdPerMillionTokens?.point).toBeCloseTo(20 / (10 * K), 6);
  });

  it("says the peer's usage is missing and lowers confidence to low", () => {
    const windows = Array.from({ length: 10 }, (_, d) => local("anthropic-sub", 28 - d * 2, 0, 2_000_000, 3));
    const missing: PeerUsageStatus = { linkId: "link_1", install: "inst_dev", state: "missing", reason: "unreachable", lastSuccessAt: null };
    const complete = estimateSubscriptionPlan({ monthlyFeeUsd: 200, coveredProviderIds: ["anthropic-sub"], listPrices: prices, now, peers: [peerCurrent], buckets: windows });
    const partial = estimateSubscriptionPlan({ monthlyFeeUsd: 200, coveredProviderIds: ["anthropic-sub"], listPrices: prices, now, peers: [missing], buckets: windows });
    expect(complete.estimate.confidence).toBe("high");
    expect(partial.estimate.confidence).toBe("low");
    expect(partial.usageCoverage).toBe("peer-missing");
  });

  it("lowers confidence one step when the peer's usage is stale", () => {
    const windows = Array.from({ length: 10 }, (_, d) => local("anthropic-sub", 28 - d * 2, 0, 2_000_000, 3));
    const stale: PeerUsageStatus = { linkId: "link_1", install: "inst_dev", state: "stale", reason: "unreachable", lastSuccessAt: "2026-11-10T00:00:00Z" };
    const plan = estimateSubscriptionPlan({ monthlyFeeUsd: 200, coveredProviderIds: ["anthropic-sub"], listPrices: prices, now, peers: [stale], buckets: windows });
    expect(plan.estimate.confidence).toBe("medium");
    expect(plan.usageCoverage).toBe("peer-stale");
  });

  it("re-buckets hours into the plan's reset windows", () => {
    expect(windowsFromHourlyBuckets([
      { hour: 10, inputTokens: 1, outputTokens: 2, limitHits: 0 },
      { hour: 14, inputTokens: 3, outputTokens: 4, limitHits: 1 },
      { hour: 15, inputTokens: 5, outputTokens: 0, limitHits: 0 },
    ], 5)).toEqual([{ tokens: 10, limitHits: 1 }, { tokens: 5, limitHits: 0 }]);
  });
});
