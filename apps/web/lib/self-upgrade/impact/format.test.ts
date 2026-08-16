import { describe, expect, it } from "vitest";
import { formatImpactCounts, formatChangeTotal } from "./format";
import type { ImpactCategoryCounts } from "./types";

function counts(overrides: Partial<ImpactCategoryCounts> = {}): ImpactCategoryCounts {
  return {
    breaking: 0,
    security: 0,
    feature: 0,
    fix: 0,
    performance: 0,
    dependency: 0,
    documentation: 0,
    maintenance: 0,
    other: 0,
    total: 0,
    ...overrides,
  };
}

describe("formatImpactCounts", () => {
  it("joins non-zero categories in severity order", () => {
    expect(
      formatImpactCounts(
        counts({
          breaking: 1,
          security: 2,
          feature: 5,
          performance: 2,
          fix: 3,
          dependency: 4,
          documentation: 1,
          maintenance: 2,
          other: 1,
          total: 21,
        }),
      ),
    ).toBe(
      "1 breaking · 2 security · 5 new · 2 perf · 3 fixes · 4 dependency · 1 docs · 2 internal · 1 other",
    );
  });

  it("names dependency and documentation changes instead of lumping them as other", () => {
    expect(
      formatImpactCounts(counts({ dependency: 4, documentation: 1, total: 5 })),
    ).toBe("4 dependency · 1 docs");
  });

  // Summaries persisted under the earlier five-key taxonomy replay from JSON
  // with the new keys absent — they must still render, not print NaN.
  it("treats keys missing from a legacy persisted summary as zero", () => {
    const legacy = { breaking: 0, feature: 1, fix: 2, performance: 0, other: 3, total: 6 };
    expect(formatImpactCounts(legacy as unknown as ImpactCategoryCounts)).toBe(
      "1 new · 2 fixes · 3 other",
    );
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
