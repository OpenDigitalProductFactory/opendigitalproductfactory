// apps/web/lib/gear-interface/governor/governor.test.ts
//
// Unit tests for the Autonomy Governor verdict logic + autonomy-tier mapping.

import { describe, it, expect } from "vitest";
import { decideAutonomyTier, evaluateVerdict } from "./index";
import type { TrustReading } from "../calibrator";

function trust(overrides: Partial<TrustReading> = {}): TrustReading {
  return {
    score: 1.0,
    sampleSize: 20,
    confidence: 1.0,
    lastSeenAt: new Date(),
    recentFailureCount: 0,
    humanGradedCount: 0,
    ...overrides,
  };
}

describe("decideAutonomyTier — spec §6.2 mapping", () => {
  it("allow-auto with operator-notify ⇒ auto-confirm", () => {
    expect(decideAutonomyTier("allow-auto", "operator-notify")).toBe("auto-confirm");
  });
  it("allow-auto with silent ⇒ auto-silent", () => {
    expect(decideAutonomyTier("allow-auto", "silent")).toBe("auto-silent");
  });
  it("allow-with-notify ⇒ hitl-fallback", () => {
    expect(decideAutonomyTier("allow-with-notify")).toBe("hitl-fallback");
  });
  it("require-hitl / escalate / block all map to hitl-required", () => {
    expect(decideAutonomyTier("require-hitl")).toBe("hitl-required");
    expect(decideAutonomyTier("escalate")).toBe("hitl-required");
    expect(decideAutonomyTier("block")).toBe("hitl-required");
  });
});

describe("evaluateVerdict — fail-closed behavior", () => {
  it("returns require-hitl when no calibration data", () => {
    const v = evaluateVerdict(trust({ score: null, sampleSize: 0, confidence: 0 }), "hitl-required");
    expect(v.verdict).toBe("require-hitl");
    expect(v.graduationEligible).toBe(false);
    expect(v.rationale).toContain("no calibration data");
  });

  it("returns require-hitl when trust has zero samples even if score is set", () => {
    const v = evaluateVerdict(trust({ score: 1, sampleSize: 0 }), "hitl-required");
    expect(v.verdict).toBe("require-hitl");
  });
});

describe("evaluateVerdict — block threshold", () => {
  it("blocks when score is below block threshold AND sample is adequate", () => {
    const v = evaluateVerdict(trust({ score: 0.2, sampleSize: 10 }), "hitl-required");
    expect(v.verdict).toBe("block");
    expect(v.graduationEligible).toBe(false);
  });

  it("does NOT block on small sample sizes even with low score", () => {
    const v = evaluateVerdict(trust({ score: 0.1, sampleSize: 2 }), "hitl-required");
    expect(v.verdict).not.toBe("block");
  });
});

describe("evaluateVerdict — escalate on recent failures", () => {
  it("escalates when recentFailureCount crosses threshold", () => {
    const v = evaluateVerdict(
      trust({ score: 0.9, sampleSize: 20, recentFailureCount: 4 }),
      "hitl-required",
    );
    expect(v.verdict).toBe("escalate");
    expect(v.graduationEligible).toBe(false);
  });
});

describe("evaluateVerdict — graduation eligibility", () => {
  it("graduates hitl-required → hitl-fallback when defaults are met", () => {
    const v = evaluateVerdict(
      trust({ score: 0.9, sampleSize: 15, recentFailureCount: 0, confidence: 0.75 }),
      "hitl-required",
    );
    expect(v.verdict).toBe("allow-with-notify");
    expect(v.graduationEligible).toBe(true);
    expect(v.rationale).toContain("hitl-required → hitl-fallback");
  });

  it("does NOT graduate hitl-required when sample size is below threshold", () => {
    const v = evaluateVerdict(
      trust({ score: 1, sampleSize: 5, confidence: 0.25 }),
      "hitl-required",
    );
    expect(v.verdict).toBe("require-hitl");
    expect(v.graduationEligible).toBe(false);
    expect(v.rationale).toContain("samples 5 <");
  });

  it("graduates hitl-fallback → auto-confirm when stricter thresholds are met", () => {
    const v = evaluateVerdict(
      trust({ score: 0.96, sampleSize: 20, recentFailureCount: 0, confidence: 1.0 }),
      "hitl-fallback",
    );
    expect(v.verdict).toBe("allow-auto");
    expect(v.graduationEligible).toBe(true);
  });

  it("does NOT graduate hitl-fallback when one recent failure shows up", () => {
    const v = evaluateVerdict(
      trust({ score: 0.96, sampleSize: 25, recentFailureCount: 1, confidence: 1.0 }),
      "hitl-fallback",
    );
    expect(v.verdict).toBe("allow-with-notify"); // stays at the current tier's verdict
    expect(v.graduationEligible).toBe(false);
  });

  it("auto-silent stays at the top with no further elevation", () => {
    const v = evaluateVerdict(
      trust({ score: 1, sampleSize: 100, confidence: 1.0 }),
      "auto-silent",
    );
    expect(v.verdict).toBe("allow-auto");
    expect(v.graduationEligible).toBe(false);
    expect(v.rationale).toContain("top autonomy tier");
  });
});

describe("evaluateVerdict — threshold override", () => {
  it("respects an injected stricter threshold", () => {
    const v = evaluateVerdict(
      trust({ score: 0.9, sampleSize: 15, confidence: 1.0 }),
      "hitl-required",
      { minScore: 0.99, minSampleSize: 100, maxRecentFailures: 0, minConfidence: 1.0 },
    );
    expect(v.graduationEligible).toBe(false);
  });
});
