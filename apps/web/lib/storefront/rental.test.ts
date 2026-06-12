import { describe, expect, it } from "vitest";

import {
  RENTABLE_UNIT_STATUSES,
  RENTAL_AGREEMENT_STATUSES,
  RENTAL_VERIFICATION_STATUSES,
  RENTAL_CONDITION_PHASES,
  RENTAL_PRICING_MODELS,
  OCCUPYING_AGREEMENT_STATUSES,
  periodsOverlap,
  countOverlappingAgreements,
  availableCapacity,
  isClassAvailable,
  utilizationRate,
  occupancyPercent,
  hasUnitConflict,
  rentalDays,
  type AgreementPeriod,
} from "./rental";

const d = (iso: string) => new Date(iso);

describe("rental enum registry", () => {
  it("uses hyphenated, never underscored, string values", () => {
    const all = [
      ...RENTABLE_UNIT_STATUSES,
      ...RENTAL_AGREEMENT_STATUSES,
      ...RENTAL_VERIFICATION_STATUSES,
      ...RENTAL_CONDITION_PHASES,
      ...RENTAL_PRICING_MODELS,
    ];
    for (const v of all) {
      expect(v).not.toMatch(/_/);
      expect(v).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    }
  });

  it("occupying statuses are a subset of agreement statuses", () => {
    for (const s of OCCUPYING_AGREEMENT_STATUSES) {
      expect(RENTAL_AGREEMENT_STATUSES).toContain(s);
    }
    // Terminal statuses never occupy capacity.
    expect(OCCUPYING_AGREEMENT_STATUSES).not.toContain("returned");
    expect(OCCUPYING_AGREEMENT_STATUSES).not.toContain("closed");
    expect(OCCUPYING_AGREEMENT_STATUSES).not.toContain("cancelled");
  });
});

describe("periodsOverlap (half-open)", () => {
  it("detects genuine overlap", () => {
    expect(periodsOverlap(d("2026-06-01"), d("2026-06-05"), d("2026-06-04"), d("2026-06-08"))).toBe(true);
  });
  it("treats touching ends as non-overlapping (same-day turnaround)", () => {
    expect(periodsOverlap(d("2026-06-01"), d("2026-06-05"), d("2026-06-05"), d("2026-06-08"))).toBe(false);
  });
  it("disjoint periods do not overlap", () => {
    expect(periodsOverlap(d("2026-06-01"), d("2026-06-03"), d("2026-06-10"), d("2026-06-12"))).toBe(false);
  });
});

describe("countOverlappingAgreements", () => {
  const agreements: AgreementPeriod[] = [
    { status: "active", periodStart: d("2026-06-01"), periodEnd: d("2026-06-05") },
    { status: "reserved", periodStart: d("2026-06-04"), periodEnd: d("2026-06-09") },
    { status: "cancelled", periodStart: d("2026-06-02"), periodEnd: d("2026-06-06") }, // ignored
    { status: "closed", periodStart: d("2026-06-03"), periodEnd: d("2026-06-07") }, // ignored
  ];
  it("counts only occupying statuses that overlap the window", () => {
    expect(countOverlappingAgreements(agreements, d("2026-06-04"), d("2026-06-05"))).toBe(2);
  });
  it("excludes terminal statuses even when they overlap", () => {
    expect(countOverlappingAgreements(agreements, d("2026-06-06"), d("2026-06-07"))).toBe(1); // only the reserved one
  });
});

describe("availableCapacity — quantity pool", () => {
  const base = {
    serialized: false,
    serializedAvailableUnits: 0,
    windowStart: d("2026-06-04"),
    windowEnd: d("2026-06-05"),
  };
  it("subtracts overlapping occupying agreements from stock", () => {
    const agreements: AgreementPeriod[] = [
      { status: "active", periodStart: d("2026-06-01"), periodEnd: d("2026-06-06") },
      { status: "reserved", periodStart: d("2026-06-03"), periodEnd: d("2026-06-08") },
    ];
    expect(availableCapacity({ ...base, stockQuantity: 5, agreements })).toBe(3);
  });
  it("never goes negative when overbooked", () => {
    const agreements: AgreementPeriod[] = Array.from({ length: 4 }, () => ({
      status: "active" as const,
      periodStart: d("2026-06-01"),
      periodEnd: d("2026-06-10"),
    }));
    expect(availableCapacity({ ...base, stockQuantity: 2, agreements })).toBe(0);
    expect(isClassAvailable({ ...base, stockQuantity: 2, agreements })).toBe(false);
  });
});

describe("availableCapacity — serialized", () => {
  it("uses the available-unit count as the source of truth", () => {
    expect(
      availableCapacity({
        serialized: true,
        serializedAvailableUnits: 3,
        stockQuantity: 0,
        agreements: [],
        windowStart: d("2026-06-04"),
        windowEnd: d("2026-06-05"),
      }),
    ).toBe(3);
  });
});

describe("utilizationRate", () => {
  const agreements: AgreementPeriod[] = [
    { status: "active", periodStart: d("2026-06-01T00:00:00Z"), periodEnd: d("2026-06-10T00:00:00Z") },
    { status: "reserved", periodStart: d("2026-06-05T00:00:00Z"), periodEnd: d("2026-06-12T00:00:00Z") },
  ];
  it("reports the point-in-time occupied fraction", () => {
    expect(utilizationRate(agreements, 4, d("2026-06-06T00:00:00Z"))).toBeCloseTo(0.5);
  });
  it("is zero when capacity is zero", () => {
    expect(utilizationRate(agreements, 0, d("2026-06-06T00:00:00Z"))).toBe(0);
  });
  it("caps at 1 when overbooked", () => {
    expect(utilizationRate(agreements, 1, d("2026-06-06T00:00:00Z"))).toBe(1);
  });
});

describe("occupancyPercent (self-storage KPI)", () => {
  it("returns a 0..100 integer", () => {
    expect(occupancyPercent(200, 174)).toBe(87);
  });
  it("is zero with no units", () => {
    expect(occupancyPercent(0, 0)).toBe(0);
  });
  it("caps at 100", () => {
    expect(occupancyPercent(10, 12)).toBe(100);
  });
});

describe("hasUnitConflict (serialized double-booking guard)", () => {
  const agreements: AgreementPeriod[] = [
    { status: "active", rentableUnitId: "u1", periodStart: d("2026-06-01"), periodEnd: d("2026-06-05") },
    { status: "cancelled", rentableUnitId: "u1", periodStart: d("2026-06-04"), periodEnd: d("2026-06-09") },
  ];
  it("flags an overlapping occupying agreement on the same unit", () => {
    expect(
      hasUnitConflict({ rentableUnitId: "u1", agreements, windowStart: d("2026-06-03"), windowEnd: d("2026-06-06") }),
    ).toBe(true);
  });
  it("ignores cancelled agreements and other units", () => {
    expect(
      hasUnitConflict({ rentableUnitId: "u1", agreements, windowStart: d("2026-06-06"), windowEnd: d("2026-06-08") }),
    ).toBe(false);
    expect(
      hasUnitConflict({ rentableUnitId: "u2", agreements, windowStart: d("2026-06-03"), windowEnd: d("2026-06-06") }),
    ).toBe(false);
  });
});

describe("rentalDays", () => {
  it("ceils partial days", () => {
    expect(rentalDays(d("2026-06-01T08:00:00Z"), d("2026-06-03T10:00:00Z"))).toBe(3);
  });
  it("is zero for a non-positive span", () => {
    expect(rentalDays(d("2026-06-05"), d("2026-06-05"))).toBe(0);
  });
});
