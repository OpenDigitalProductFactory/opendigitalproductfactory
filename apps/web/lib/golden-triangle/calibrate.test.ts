import { describe, expect, it } from "vitest";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";

import { suggestCalibration } from "./calibrate";
import type { GoldenTriangleReceipt } from "./receipt";

const ASSURED: GoldenTrianglePreference = { preset: "assured", qualityWeight: 0.8, costWeight: 0.1, timeWeight: 0.1 };
const BALANCED: GoldenTrianglePreference = { preset: "balanced", qualityWeight: 0.34, costWeight: 0.33, timeWeight: 0.33 };

type ActualOver = Partial<GoldenTriangleReceipt["actual"]>;

/** Build a receipt; `matched` toggles matchedRequest, the rest overrides `actual`. */
function r(matched = true, actual: ActualOver = {}): GoldenTriangleReceipt {
  return {
    preset: "assured",
    requested: { minimumTier: "frontier" },
    actual: {
      modelId: "claude-opus",
      tier: "frontier",
      costUsd: 0.1,
      latencyMs: 1000,
      fallbackOccurred: false,
      verificationPassed: null,
      accepted: null,
      ...actual,
    },
    deviations: [],
    matchedRequest: matched,
    summary: "s",
  };
}

function fill(n: number, one: GoldenTriangleReceipt): GoldenTriangleReceipt[] {
  return Array.from({ length: n }, () => one);
}

describe("suggestCalibration", () => {
  it("stays quiet below the minimum sample", () => {
    const s = suggestCalibration(ASSURED, fill(3, r()));
    expect(s.kind).toBe("none");
    expect(s.headline).toMatch(/Not enough history/);
    expect(s.sampleSize).toBe(3);
  });

  it("flags reliability when runs fail over often", () => {
    const runs = [...fill(2, r(false, { fallbackOccurred: true })), ...fill(3, r(true))];
    const s = suggestCalibration(ASSURED, runs);
    expect(s.kind).toBe("address-reliability");
    expect(s.detail).toMatch(/backup provider/);
  });

  it("suggests raising quality when runs land below the requested tier", () => {
    const runs = [...fill(2, r(false)), ...fill(3, r(true))]; // 2/5 below tier, no failover
    expect(suggestCalibration(ASSURED, runs).kind).toBe("raise-quality");
  });

  it("suggests raising quality when verification/acceptance fails often", () => {
    const runs = [...fill(2, r(true, { accepted: false })), ...fill(3, r(true))];
    expect(suggestCalibration(ASSURED, runs).kind).toBe("raise-quality");
  });

  it("offers descent (save cost) when a quality-leaning posture always runs clean", () => {
    const s = suggestCalibration(ASSURED, fill(6, r(true)));
    expect(s.kind).toBe("loosen-quality");
    expect(s.headline).toMatch(/room to save/);
  });

  it("does not push descent on a balanced posture that is already well-fitted", () => {
    const s = suggestCalibration(BALANCED, fill(6, r(true)));
    expect(s.kind).toBe("none");
    expect(s.headline).toMatch(/well-fitted/);
  });

  it("prioritises reliability over an under-provisioning signal", () => {
    const runs = [
      ...fill(2, r(false, { fallbackOccurred: true })), // failover 2/5
      ...fill(2, r(false)), // below tier 2/5
      r(true),
    ];
    expect(suggestCalibration(ASSURED, runs).kind).toBe("address-reliability");
  });
});
