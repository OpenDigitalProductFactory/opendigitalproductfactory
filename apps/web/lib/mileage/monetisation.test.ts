import { describe, expect, it } from "vitest";
import { mileageLogTotals, priceTrips, type PriceableTrip } from "./monetisation";
import type { ResolvableRate } from "./rates";

const RATE_2026: ResolvableRate = {
  id: "rate_2026",
  purposeKind: "business",
  amountPerMile: 0.725,
  currency: "USD",
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  effectiveTo: null,
  isOrgOverride: false,
};

function trip(over: Partial<PriceableTrip> = {}): PriceableTrip {
  return {
    id: "cuid_trip",
    tripId: "TRIP-1",
    startedAt: new Date("2026-08-19T16:00:00.000Z"),
    distanceMetres: 16093.44, // 10 miles
    classification: "business",
    startPlaceLabel: null,
    endPlaceLabel: null,
    customerAccountId: null,
    ...over,
  };
}

describe("priceTrips", () => {
  it("prices a business drive onto an expense line", () => {
    const result = priceTrips([trip()], [RATE_2026]);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.amount).toBe(7.25);
    expect(result.lines[0]?.category).toBe("mileage");
    // The rate is recorded on the line so the money stays reproducible.
    expect(result.lines[0]?.mileageRateId).toBe("rate_2026");
    expect(result.totalAmount).toBe(7.25);
  });

  it("does not reimburse commute or personal drives", () => {
    const result = priceTrips(
      [
        trip({ tripId: "TRIP-C", classification: "commute" }),
        trip({ tripId: "TRIP-P", classification: "personal" }),
      ],
      [RATE_2026],
    );
    expect(result.lines).toHaveLength(0);
    expect(result.skipped.map((s) => s.reason)).toEqual(["not-business", "not-business"]);
  });

  it("accounts for every trip — a skipped drive is reported, never dropped", () => {
    const trips = [
      trip({ tripId: "TRIP-1" }),
      trip({ tripId: "TRIP-2", classification: "personal" }),
      trip({ tripId: "TRIP-3", distanceMetres: 0 }),
    ];
    const result = priceTrips(trips, [RATE_2026]);
    const accountedFor = [
      ...result.lines.map((l) => l.tripId),
      ...result.skipped.map((s) => s.tripId),
    ];
    expect(accountedFor.sort()).toEqual(["TRIP-1", "TRIP-2", "TRIP-3"]);
  });

  it("refuses to price at zero when no rate covers the trip date", () => {
    const result = priceTrips([trip({ startedAt: new Date("2025-06-01T00:00:00.000Z") })], [
      RATE_2026,
    ]);
    expect(result.lines).toHaveLength(0);
    expect(result.skipped[0]?.reason).toBe("no-rate-in-force");
  });

  it("prices a historical trip at its own year's rate", () => {
    const rate2025: ResolvableRate = {
      ...RATE_2026,
      id: "rate_2025",
      amountPerMile: 0.7,
      effectiveFrom: new Date("2025-01-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-01-01T00:00:00.000Z"), // clock-bomb-guard: allow effective-dating fixture — resolveRateForDate is given an explicit trip date and never reads the wall clock
    };
    const result = priceTrips(
      [trip({ startedAt: new Date("2025-09-01T00:00:00.000Z") })],
      [rate2025, RATE_2026],
    );
    expect(result.lines[0]?.amount).toBe(7);
    expect(result.lines[0]?.mileageRateId).toBe("rate_2025");
  });

  it("carries customer attribution through to the line for job costing", () => {
    const result = priceTrips([trip({ customerAccountId: "cuid_account" })], [RATE_2026]);
    expect(result.lines[0]?.customerAccountId).toBe("cuid_account");
  });

  it("describes a line with place labels when they resolved", () => {
    const result = priceTrips(
      [trip({ startPlaceLabel: "Depot", endPlaceLabel: "Site 4" })],
      [RATE_2026],
    );
    expect(result.lines[0]?.description).toBe("10.0 mi — Depot to Site 4");
  });
});

describe("mileageLogTotals", () => {
  it("reports commute separately from personal", () => {
    const totals = mileageLogTotals([
      trip({ classification: "business" }),
      trip({ classification: "commute" }),
      trip({ classification: "personal" }),
      trip({ classification: "unclassified" }),
    ]);
    // A taxpayer must be able to show commute was excluded, not merely absent.
    expect(totals.businessMiles).toBe(10);
    expect(totals.commuteMiles).toBe(10);
    expect(totals.personalMiles).toBe(10);
    expect(totals.unclassifiedMiles).toBe(10);
    expect(totals.totalMiles).toBe(40);
  });
});
