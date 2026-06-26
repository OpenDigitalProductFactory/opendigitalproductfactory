import { describe, expect, it } from "vitest";

import {
  assessSkillQuality,
  ELEVATED_FAILURE_RATE,
  MIN_INVOCATIONS_FOR_QUALITY,
  REGRESSING_FAILURE_RATE,
} from "./quality";

describe("assessSkillQuality", () => {
  it("returns insufficient-data with a null rate when there are no invocations", () => {
    const r = assessSkillQuality({ invoked: 0, failed: 0 });
    expect(r.verdict).toBe("insufficient-data");
    expect(r.failureRate).toBeNull();
  });

  it("withholds a verdict on small samples even when every invocation failed", () => {
    // (MIN-1)/(MIN-1) = 100%, but the sample is below MIN — a noise guard, not
    // a regression. This is the bug the lifecycle classifier cannot have today
    // because it never looks at failures at all.
    const n = MIN_INVOCATIONS_FOR_QUALITY - 1;
    const r = assessSkillQuality({ invoked: n, failed: n });
    expect(r.verdict).toBe("insufficient-data");
    expect(r.failureRate).toBe(1);
  });

  it("flags regressing when at least half of a trustworthy sample failed", () => {
    const r = assessSkillQuality({ invoked: 10, failed: 5 });
    expect(r.verdict).toBe("regressing");
    expect(r.failureRate).toBe(REGRESSING_FAILURE_RATE);
    expect(r.reason).toMatch(/50%/);
  });

  it("flags elevated-failures between the elevated and regressing thresholds", () => {
    const r = assessSkillQuality({ invoked: 10, failed: 3 }); // 30%
    expect(r.verdict).toBe("elevated-failures");
    expect(r.failureRate).toBeCloseTo(0.3, 5);
  });

  it("treats the elevated boundary as inclusive", () => {
    const r = assessSkillQuality({ invoked: 100, failed: 20 }); // exactly 20%
    expect(r.verdict).toBe("elevated-failures");
  });

  it("reads just below the elevated boundary as healthy", () => {
    const r = assessSkillQuality({ invoked: 100, failed: 19 }); // 19%
    expect(r.verdict).toBe("healthy");
  });

  it("is healthy with a clear reason when nothing failed", () => {
    const r = assessSkillQuality({ invoked: 50, failed: 0 });
    expect(r.verdict).toBe("healthy");
    expect(r.failureRate).toBe(0);
    expect(r.reason).toMatch(/no failures/);
  });

  it("clamps a dropped-terminal anomaly (failed > invoked) to a 100% rate", () => {
    const r = assessSkillQuality({ invoked: 6, failed: 9 });
    expect(r.failureRate).toBe(1);
    expect(r.verdict).toBe("regressing");
  });

  it("normalizes negative/fractional inputs defensively", () => {
    const r = assessSkillQuality({ invoked: -3, failed: -1 });
    expect(r.verdict).toBe("insufficient-data");
    expect(r.failureRate).toBeNull();
  });

  it("orders the thresholds so callers can render bands", () => {
    expect(ELEVATED_FAILURE_RATE).toBeLessThan(REGRESSING_FAILURE_RATE);
  });
});
