import { describe, expect, it } from "vitest";
import {
  assessAccountHealth,
  computeArr,
  computeMrr,
  monthlyRecurringValue,
} from "./retain-metrics";

describe("monthlyRecurringValue", () => {
  it("normalises each period to a monthly figure", () => {
    expect(monthlyRecurringValue(1200, "annual")).toBe(100);
    expect(monthlyRecurringValue(1200, "annually")).toBe(100);
    expect(monthlyRecurringValue(300, "quarterly")).toBe(100);
    expect(monthlyRecurringValue(100, "monthly")).toBe(100);
    expect(monthlyRecurringValue(100, "unknown-term")).toBe(100); // defaults to monthly
  });
  it("returns 0 for non-positive or invalid amounts", () => {
    expect(monthlyRecurringValue(0, "monthly")).toBe(0);
    expect(monthlyRecurringValue(-50, "monthly")).toBe(0);
    expect(monthlyRecurringValue(Number.NaN, "monthly")).toBe(0);
  });
});

describe("computeMrr / computeArr", () => {
  it("a schedule supersedes only the subscription it renews (via subscriptionId)", () => {
    const mrr = computeMrr({
      subscriptions: [{ id: "sub-a", status: "active", billingCadence: "annual", totalValue: 12000 }],
      schedules: [{ status: "active", frequency: "monthly", amount: 500, subscriptionId: "sub-a" }],
    });
    expect(mrr).toBe(500); // sub-a is covered by its schedule; only the schedule counts
    expect(computeArr(mrr)).toBe(6000);
  });
  it("keeps a standalone add-on subscription that no active schedule covers", () => {
    const mrr = computeMrr({
      subscriptions: [
        { id: "sub-a", status: "active", billingCadence: "annual", totalValue: 12000 }, // scheduled
        { id: "sub-b", status: "active", billingCadence: "monthly", totalValue: 200 }, // standalone add-on
      ],
      schedules: [{ status: "active", frequency: "monthly", amount: 500, subscriptionId: "sub-a" }],
    });
    expect(mrr).toBe(700); // schedule 500 + uncovered sub-b 200
  });
  it("falls back to subscription contract value when no active schedule exists", () => {
    const mrr = computeMrr({
      subscriptions: [{ id: "sub-a", status: "active", billingCadence: "annual", totalValue: 12000 }],
      schedules: [{ status: "cancelled", frequency: "monthly", amount: 500, subscriptionId: "sub-a" }],
    });
    expect(mrr).toBe(1000); // 12000 / 12 (cancelled schedule doesn't cover)
  });
  it("ignores non-active rows", () => {
    expect(
      computeMrr({
        subscriptions: [{ id: "s", status: "expired", billingCadence: "monthly", totalValue: 999 }],
        schedules: [],
      }),
    ).toBe(0);
  });
});

describe("assessAccountHealth", () => {
  const base = {
    status: "active",
    renewalInDays: 200,
    autoRenew: true,
    lastActivityInDays: 5,
    hasActiveRecurring: true,
  };

  it("is healthy when everything is nominal", () => {
    const r = assessAccountHealth(base);
    expect(r.band).toBe("healthy");
    expect(r.suggestAtRisk).toBe(false);
  });

  it("flags at-risk on an overdue renewal and suggests the transition", () => {
    const r = assessAccountHealth({ ...base, renewalInDays: -3 });
    expect(r.band).toBe("at-risk");
    expect(r.suggestAtRisk).toBe(true);
    expect(r.reasons.join()).toMatch(/overdue/i);
  });

  it("flags at-risk on a near manual renewal (auto-renew off)", () => {
    expect(assessAccountHealth({ ...base, renewalInDays: 20, autoRenew: false }).band).toBe("at-risk");
    // auto-renew ON at the same proximity is only a watch
    expect(assessAccountHealth({ ...base, renewalInDays: 20, autoRenew: true }).band).toBe("watch");
  });

  it("flags at-risk on long disengagement", () => {
    expect(assessAccountHealth({ ...base, lastActivityInDays: 120 }).band).toBe("at-risk");
    expect(assessAccountHealth({ ...base, lastActivityInDays: 50 }).band).toBe("watch");
  });

  it("treats an already at_risk/suspended status as authoritative and does not re-suggest", () => {
    expect(assessAccountHealth({ ...base, status: "at_risk" }).suggestAtRisk).toBe(false);
    expect(assessAccountHealth({ ...base, status: "suspended" }).band).toBe("at-risk");
  });

  it("watches an account with no active recurring commitment", () => {
    expect(assessAccountHealth({ ...base, hasActiveRecurring: false }).band).toBe("watch");
  });
});
