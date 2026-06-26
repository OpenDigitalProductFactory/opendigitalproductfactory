import { describe, expect, it } from "vitest";

import {
  assessThresholdCalibration,
  MIN_SAMPLES_FOR_CALIBRATION,
  summarizePhaseDurationBaseline,
  TOO_LOOSE_RATIO,
  type PhaseDurationStats,
} from "./phase-duration-baseline";

describe("summarizePhaseDurationBaseline", () => {
  it("computes per-phase count/p50/p95/max with nearest-rank percentiles", () => {
    const samples = [
      ...Array.from({ length: 10 }, (_, i) => ({ phase: "build", durationMs: (i + 1) * 1000 })), // 1000..10000
      { phase: "ideate", durationMs: 500 },
    ];
    const out = summarizePhaseDurationBaseline(samples);

    expect(out.build!.count).toBe(10);
    expect(out.build!.p50Ms).toBe(5000); // ceil(0.5*10)=5 → idx 4
    expect(out.build!.p95Ms).toBe(10000); // ceil(0.95*10)=10 → idx 9
    expect(out.build!.maxMs).toBe(10000);
    expect(out.ideate!.count).toBe(1);
    expect(out.ideate!.p95Ms).toBe(500);
  });

  it("drops non-finite/negative durations and omits phases left empty", () => {
    const out = summarizePhaseDurationBaseline([
      { phase: "build", durationMs: -5 },
      { phase: "build", durationMs: Number.NaN },
      { phase: "plan", durationMs: 2000 },
    ]);
    expect(out.build).toBeUndefined();
    expect(out.plan!.count).toBe(1);
  });

  it("returns an empty object for no samples", () => {
    expect(summarizePhaseDurationBaseline([])).toEqual({});
  });
});

describe("assessThresholdCalibration", () => {
  const stats = (over: Partial<PhaseDurationStats> = {}): PhaseDurationStats => ({
    count: 50,
    p50Ms: 1000,
    p95Ms: 2000,
    maxMs: 3000,
    ...over,
  });

  it("withholds a verdict below the sample floor", () => {
    const r = assessThresholdCalibration({
      stats: stats({ count: MIN_SAMPLES_FOR_CALIBRATION - 1 }),
      seededTotalTimeoutMs: 10_000,
    });
    expect(r.verdict).toBe("insufficient-data");
    expect(r.ratio).toBeNull();
  });

  it("withholds a verdict when stats are missing", () => {
    expect(
      assessThresholdCalibration({ stats: undefined, seededTotalTimeoutMs: 10_000 }).verdict,
    ).toBe("insufficient-data");
  });

  it("flags too-tight when p95 exceeds the seeded total-timeout", () => {
    const r = assessThresholdCalibration({ stats: stats({ p95Ms: 12_000 }), seededTotalTimeoutMs: 10_000 });
    expect(r.verdict).toBe("too-tight");
    expect(r.ratio).toBeCloseTo(1.2, 5);
  });

  it("flags too-loose when p95 is far under the seeded total-timeout", () => {
    const r = assessThresholdCalibration({ stats: stats({ p95Ms: 1000 }), seededTotalTimeoutMs: 10_000 }); // 0.1
    expect(r.verdict).toBe("too-loose");
    expect(r.ratio!).toBeLessThan(TOO_LOOSE_RATIO);
  });

  it("reads ok when p95 sits comfortably within the timeout", () => {
    const r = assessThresholdCalibration({ stats: stats({ p95Ms: 5000 }), seededTotalTimeoutMs: 10_000 }); // 0.5
    expect(r.verdict).toBe("ok");
  });

  it("guards against a non-positive timeout", () => {
    expect(
      assessThresholdCalibration({ stats: stats(), seededTotalTimeoutMs: 0 }).verdict,
    ).toBe("insufficient-data");
  });
});
