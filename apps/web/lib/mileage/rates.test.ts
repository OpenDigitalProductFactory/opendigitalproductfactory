import { describe, expect, it } from "vitest";
import {
  metresToMiles,
  reimbursableAmount,
  resolveRateForDate,
  type ResolvableRate,
} from "./rates";

function rate(over: Partial<ResolvableRate> = {}): ResolvableRate {
  return {
    id: "rate_statutory_2026",
    purposeKind: "business",
    amountPerMile: 0.725,
    currency: "USD",
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    isOrgOverride: false,
    ...over,
  };
}

describe("resolveRateForDate", () => {
  it("prices a trip at the rate in force on the day it was driven", () => {
    const y2025 = rate({
      id: "rate_2025",
      amountPerMile: 0.7,
      effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-01-01T00:00:00.000Z"), // clock-bomb-guard: allow effective-dating fixture — resolveRateForDate is given an explicit trip date and never reads the wall clock
    });
    const y2026 = rate({ id: "rate_2026", amountPerMile: 0.725 });

    // The load-bearing behaviour: a 2025 trip keeps its 2025 rate forever.
    expect(resolveRateForDate([y2025, y2026], new Date("2025-06-15T12:00:00.000Z"))?.id).toBe(
      "rate_2025",
    );
    expect(resolveRateForDate([y2025, y2026], new Date("2026-06-15T12:00:00.000Z"))?.id).toBe(
      "rate_2026",
    );
  });

  it("treats effectiveTo as exclusive so adjacent rates never both match", () => {
    const closing = rate({
      id: "closing",
      effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-01-01T00:00:00.000Z"), // clock-bomb-guard: allow effective-dating fixture — resolveRateForDate is given an explicit trip date and never reads the wall clock
    });
    const opening = rate({ id: "opening", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") });

    const onBoundary = resolveRateForDate([closing, opening], new Date("2026-01-01T00:00:00.000Z"));
    expect(onBoundary?.id).toBe("opening");
  });

  it("lets an organization override beat the statutory rate for the same day", () => {
    const statutory = rate({ id: "statutory", amountPerMile: 0.725 });
    const override = rate({ id: "org", amountPerMile: 0.6, isOrgOverride: true });

    expect(resolveRateForDate([statutory, override], new Date("2026-03-01T00:00:00.000Z"))?.id).toBe(
      "org",
    );
  });

  it("does not cross purposes", () => {
    const business = rate({ id: "business" });
    const charitable = rate({ id: "charitable", purposeKind: "charitable", amountPerMile: 0.14 });

    expect(
      resolveRateForDate([business, charitable], new Date("2026-03-01T00:00:00.000Z"), "charitable")
        ?.id,
    ).toBe("charitable");
  });

  it("returns null rather than a zero rate when nothing covers the date", () => {
    const future = rate({ effectiveFrom: new Date("2027-01-01T00:00:00.000Z") });
    // A caller must treat this as "cannot price yet" — pricing at zero would
    // silently under-reimburse a real drive.
    expect(resolveRateForDate([future], new Date("2026-06-01T00:00:00.000Z"))).toBeNull();
  });
});

describe("reimbursableAmount", () => {
  it("converts metres to miles and prices to whole cents", () => {
    // 10 miles exactly at 0.725 = 7.25
    expect(reimbursableAmount(16093.44, 0.725)).toBe(7.25);
  });

  it("rounds only at the money boundary, not per mile", () => {
    const metres = 100_000; // ~62.137 miles
    const expected = Math.round((metresToMiles(metres) * 0.725 + Number.EPSILON) * 100) / 100;
    expect(reimbursableAmount(metres, 0.725)).toBe(expected);
    expect(reimbursableAmount(metres, 0.725)).toBeCloseTo(45.05, 2);
  });

  it("prices a zero-distance trip at zero", () => {
    expect(reimbursableAmount(0, 0.725)).toBe(0);
  });
});
