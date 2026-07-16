import { describe, expect, it } from "vitest";
import { formatImpactCounts, formatChangeTotal } from "./format";
import type { ImpactCategoryCounts } from "./types";

function counts(overrides: Partial<ImpactCategoryCounts> = {}): ImpactCategoryCounts {
  return { breaking: 0, feature: 0, fix: 0, performance: 0, other: 0, total: 0, ...overrides };
}

describe("formatImpactCounts", () => {
  it("joins non-zero categories in severity order", () => {
    expect(
      formatImpactCounts(
        counts({ breaking: 1, feature: 5, performance: 2, fix: 3, other: 1, total: 12 }),
      ),
    ).toBe("1 breaking · 5 new · 2 perf · 3 fixes · 1 other");
  });

  it("singularizes a lone fix", () => {
    expect(formatImpactCounts(counts({ fix: 1, total: 1 }))).toBe("1 fix");
  });

  it("omits zero categories", () => {
    expect(formatImpactCounts(counts({ feature: 2, total: 2 }))).toBe("2 new");
  });

  it("falls back to a bare change total when no category is set", () => {
    expect(formatImpactCounts(counts({ total: 4 }))).toBe("4 changes");
    expect(formatImpactCounts(counts({ total: 1 }))).toBe("1 change");
  });
});

describe("formatChangeTotal", () => {
  it("pluralizes the total", () => {
    expect(formatChangeTotal(counts({ total: 0 }))).toBe("0 changes");
    expect(formatChangeTotal(counts({ total: 1 }))).toBe("1 change");
    expect(formatChangeTotal(counts({ total: 9 }))).toBe("9 changes");
  });
});
