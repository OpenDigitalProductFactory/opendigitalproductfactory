import { describe, expect, it } from "vitest";
import {
  summarizeVariants,
  MIN_IMPRESSIONS_FOR_DECISION,
  type VariantMetrics,
} from "./variants";

function v(overrides: Partial<VariantMetrics> & { label: string }): VariantMetrics {
  return {
    variantId: `var_${overrides.label}`,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    status: "live",
    ...overrides,
  };
}

describe("summarizeVariants", () => {
  it("returns no winner for an empty set", () => {
    const s = summarizeVariants([]);
    expect(s.variants).toEqual([]);
    expect(s.winner).toBeNull();
    expect(s.decisive).toBe(false);
  });

  it("computes ctr, conversionRate, and efficiency", () => {
    const s = summarizeVariants([v({ label: "A", impressions: 1000, clicks: 100, conversions: 10 })]);
    const a = s.variants[0]!;
    expect(a.ctr).toBeCloseTo(0.1);
    expect(a.conversionRate).toBeCloseTo(0.1);
    expect(a.efficiency).toBeCloseTo(0.01);
  });

  it("ranks by conversions-per-impression, not raw CTR", () => {
    // B has higher CTR but A converts far better end-to-end.
    const s = summarizeVariants([
      v({ label: "A", impressions: 1000, clicks: 50, conversions: 25 }), // eff 0.025
      v({ label: "B", impressions: 1000, clicks: 200, conversions: 10 }), // eff 0.010, higher CTR
    ]);
    expect(s.variants.map((x) => x.label)).toEqual(["A", "B"]);
    expect(s.winner?.label).toBe("A");
    expect(s.decisive).toBe(true);
  });

  it("does not crown a winner below the impressions guard", () => {
    const thin = Math.floor(MIN_IMPRESSIONS_FOR_DECISION / 2);
    const s = summarizeVariants([
      v({ label: "A", impressions: thin, clicks: 20, conversions: 10 }),
      v({ label: "B", impressions: thin, clicks: 5, conversions: 1 }),
    ]);
    expect(s.winner).toBeNull();
    expect(s.decisive).toBe(false);
    expect(s.rationale).toMatch(/not enough data/i);
  });

  it("crowns a clear leader once it clears the guard", () => {
    const s = summarizeVariants([
      v({ label: "A", impressions: 500, clicks: 60, conversions: 30 }),
      v({ label: "B", impressions: 500, clicks: 40, conversions: 8 }),
    ]);
    expect(s.winner?.label).toBe("A");
    expect(s.decisive).toBe(true);
    expect(s.rationale).toMatch(/winner/i);
  });

  it("is not decisive when the top two are tied on the primary metric", () => {
    const s = summarizeVariants([
      v({ label: "A", impressions: 1000, clicks: 100, conversions: 20 }),
      v({ label: "B", impressions: 1000, clicks: 100, conversions: 20 }),
    ]);
    expect(s.winner).toBeNull();
    expect(s.decisive).toBe(false);
    expect(s.rationale).toMatch(/tied/i);
  });

  it("breaks an efficiency tie by CTR", () => {
    // Same efficiency (0.02) but A has higher CTR → A ranks first.
    const s = summarizeVariants([
      v({ label: "B", impressions: 1000, clicks: 50, conversions: 20 }),
      v({ label: "A", impressions: 1000, clicks: 150, conversions: 20 }),
    ]);
    expect(s.variants[0]!.label).toBe("A");
    expect(s.winner?.label).toBe("A");
    expect(s.decisive).toBe(true);
  });
});
