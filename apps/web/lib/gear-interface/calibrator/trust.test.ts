// apps/web/lib/gear-interface/calibrator/trust.test.ts
//
// Pure unit tests for the frequentist trust scorer. No DB, no prisma mock —
// the scorer is a pure function over a row slice.

import { describe, it, expect } from "vitest";
import { computeFrequentistTrust, computeBayesianTrust, type ScorableRow } from "./trust";

function row(
  torqueTechnical: number,
  graderType: "automated" | "human" | "deliberation" | "runtime-check" = "automated",
  recordedAt: Date = new Date(),
): ScorableRow {
  return { torqueTechnical, graderType, recordedAt };
}

describe("computeFrequentistTrust", () => {
  it("returns the fail-closed empty reading when no rows are provided", () => {
    const t = computeFrequentistTrust([]);
    expect(t.score).toBeNull();
    expect(t.sampleSize).toBe(0);
    expect(t.confidence).toBe(0);
    expect(t.lastSeenAt).toBeNull();
    expect(t.recentFailureCount).toBe(0);
    expect(t.humanGradedCount).toBe(0);
  });

  it("computes the mean torqueTechnical when rows are all automated", () => {
    const t = computeFrequentistTrust([row(1), row(1), row(0.5), row(0)]);
    expect(t.score).toBeCloseTo((1 + 1 + 0.5 + 0) / 4, 6);
    expect(t.sampleSize).toBe(4);
    expect(t.recentFailureCount).toBe(1);
    expect(t.humanGradedCount).toBe(0);
  });

  it("weights human-graded rows higher by default (HITL is the training signal)", () => {
    const t = computeFrequentistTrust([row(1, "human"), row(0, "automated")]);
    // weighted: (1*1.5 + 0*1.0) / (1.5 + 1.0) = 0.6
    expect(t.score).toBeCloseTo(0.6, 6);
    expect(t.humanGradedCount).toBe(1);
  });

  it("respects a custom humanGradeWeight=1.0 (HITL parity)", () => {
    const t = computeFrequentistTrust(
      [row(1, "human"), row(0, "automated")],
      { humanGradeWeight: 1.0 },
    );
    expect(t.score).toBeCloseTo(0.5, 6);
  });

  it("limits the score to the most recent rollingWindow rows", () => {
    // 30 rows: 20 most-recent are all torque=1, 10 oldest are all torque=0.
    // With rollingWindow=20 the score should be ~1.0.
    const recent = Array.from({ length: 20 }, () => row(1));
    const older = Array.from({ length: 10 }, () => row(0));
    const t = computeFrequentistTrust([...recent, ...older], { rollingWindow: 20 });
    expect(t.score).toBeCloseTo(1.0, 6);
    expect(t.sampleSize).toBe(20);
  });

  it("counts recentFailureCount as torque<0.5 within the window", () => {
    const t = computeFrequentistTrust([row(0), row(0.2), row(0.5), row(1)]);
    // 0 and 0.2 are <0.5; 0.5 is NOT <0.5; 1 is fine
    expect(t.recentFailureCount).toBe(2);
  });

  it("ramps confidence linearly to 1.0 at confidenceAdequateSampleSize", () => {
    const five = computeFrequentistTrust(Array.from({ length: 5 }, () => row(1)), {
      confidenceAdequateSampleSize: 20,
    });
    expect(five.confidence).toBeCloseTo(0.25, 6);
    const twenty = computeFrequentistTrust(Array.from({ length: 20 }, () => row(1)), {
      confidenceAdequateSampleSize: 20,
    });
    expect(twenty.confidence).toBe(1);
    const fifty = computeFrequentistTrust(Array.from({ length: 50 }, () => row(1)), {
      confidenceAdequateSampleSize: 20,
      rollingWindow: 50,
    });
    expect(fifty.confidence).toBe(1); // capped at 1.0
  });

  it("picks the latest recordedAt as lastSeenAt across the window", () => {
    const a = new Date("2026-05-24T10:00:00Z");
    const b = new Date("2026-05-24T15:00:00Z");
    const c = new Date("2026-05-24T12:00:00Z");
    const t = computeFrequentistTrust([row(1, "automated", a), row(1, "automated", b), row(1, "automated", c)]);
    expect(t.lastSeenAt?.toISOString()).toBe(b.toISOString());
  });
});

describe("computeBayesianTrust scaffolding", () => {
  it("returns the same shape as frequentist for now (Phase 1 placeholder)", () => {
    const rows = [row(1), row(1), row(0.5)];
    const freq = computeFrequentistTrust(rows);
    const bayes = computeBayesianTrust(rows);
    expect(bayes.score).toBe(freq.score);
    expect(bayes.sampleSize).toBe(freq.sampleSize);
    expect(bayes.confidence).toBe(freq.confidence);
  });
});
