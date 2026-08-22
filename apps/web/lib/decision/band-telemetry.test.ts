import { describe, expect, it } from "vitest";

import { computeBandTelemetry, isBetterTuned, type BandTelemetryRow } from "./band-telemetry";

const row = (over: Partial<BandTelemetryRow>): BandTelemetryRow => ({
  margin: 0.5,
  verdict: "proceed",
  bandUpper: 0.2,
  recommendedOptionId: null,
  chosenOptionId: null,
  ...over,
});

describe("BI-3217C098 — the margin histogram", () => {
  it("buckets real margins and marks which buckets sit inside the uncertain band", () => {
    const t = computeBandTelemetry([
      row({ margin: 0.05 }), row({ margin: 0.1 }), row({ margin: 0.8 }),
    ], { bucketCount: 4 });

    expect(t.scored).toBe(3);
    expect(t.buckets.reduce((n, b) => n + b.count, 0)).toBe(3);
    expect(t.buckets[0]!.insideUncertainBand).toBe(true);
    expect(t.buckets.at(-1)!.insideUncertainBand).toBe(false);
  });

  it("keeps the band visible even when every decision cleared it", () => {
    const t = computeBandTelemetry([row({ margin: 0.9 }), row({ margin: 0.95 })], { bucketCount: 5 });
    expect(t.buckets.some((b) => b.insideUncertainBand)).toBe(true);
  });

  it("reports how many rows it could actually score, so a thin sample is never mistaken for a picture", () => {
    const t = computeBandTelemetry([row({ margin: null, verdict: null }), row({ margin: 0.4 })]);
    expect(t.total).toBe(2);
    expect(t.scored).toBe(1);
  });

  it("reports the share that landed in the uncertain band — the number to drive down", () => {
    const t = computeBandTelemetry([
      row({ verdict: "uncertain", margin: 0.05 }),
      row({ verdict: "proceed", margin: 0.6 }),
      row({ verdict: "decline", margin: 0.6 }),
      row({ verdict: "proceed", margin: 0.7 }),
    ]);
    expect(t.uncertainShare).toBe(0.25);
  });
});

describe("BI-3217C098 — reversal rate keeps the assurances honest", () => {
  it("counts a reversal only where the pick and the choice are both known", () => {
    const t = computeBandTelemetry([
      row({ verdict: "proceed", recommendedOptionId: "a", chosenOptionId: "a" }),
      row({ verdict: "proceed", recommendedOptionId: "a", chosenOptionId: "b" }),
      // Unjudgeable: no human choice recorded. Must not count as agreement.
      row({ verdict: "proceed", recommendedOptionId: "a", chosenOptionId: null }),
    ]);
    const proceed = t.reversals.find((r) => r.verdict === "proceed")!;
    expect(proceed.judged).toBe(2);
    expect(proceed.reversed).toBe(1);
    expect(proceed.rate).toBe(0.5);
  });

  it("reports null rather than zero when nothing could be judged", () => {
    const t = computeBandTelemetry([row({ verdict: "decline" })]);
    expect(t.reversals.find((r) => r.verdict === "decline")!.rate).toBeNull();
  });
});

describe("BI-3217C098 — narrowing the bar is not improvement", () => {
  const population = (uncertain: number, assured: number, reversed: number): BandTelemetryRow[] => [
    ...Array.from({ length: uncertain }, () => row({ verdict: "uncertain", margin: 0.05 })),
    ...Array.from({ length: assured - reversed }, () => row({ verdict: "proceed", margin: 0.6, recommendedOptionId: "a", chosenOptionId: "a" })),
    ...Array.from({ length: reversed }, () => row({ verdict: "proceed", margin: 0.6, recommendedOptionId: "a", chosenOptionId: "b" })),
  ];

  it("calls a smaller uncertain band with steady confident calls an improvement", () => {
    const before = computeBandTelemetry(population(6, 4, 1));
    const after = computeBandTelemetry(population(2, 8, 2));
    expect(isBetterTuned(before, after).improved).toBe(true);
  });

  it("REFUSES to call it improvement when confident calls are reversed more often", () => {
    const before = computeBandTelemetry(population(6, 4, 0));
    const after = computeBandTelemetry(population(2, 8, 4));
    const verdict = isBetterTuned(before, after);
    expect(verdict.improved).toBe(false);
    expect(verdict.reason).toContain("the separation did not");
  });

  it("refuses to judge a shrunken band when no confident call can be checked", () => {
    const before = computeBandTelemetry([row({ verdict: "uncertain", margin: 0.05 }), row({ verdict: "proceed", margin: 0.6 })]);
    const after = computeBandTelemetry([row({ verdict: "proceed", margin: 0.6 }), row({ verdict: "proceed", margin: 0.7 })]);
    expect(isBetterTuned(before, after).improved).toBe(false);
  });

  it("does not call a growing uncertain band an improvement", () => {
    const before = computeBandTelemetry(population(2, 8, 1));
    const after = computeBandTelemetry(population(6, 4, 1));
    expect(isBetterTuned(before, after).improved).toBe(false);
  });
});
