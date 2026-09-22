import { describe, expect, it } from "vitest";

import { mergeAutonomyPolicy, OPERATOR_OWNED_AUTONOMY_POLICY_KEYS } from "./seed-decision-perspective";

describe("mergeAutonomyPolicy (BI-397157EA)", () => {
  it("refreshes seed keys but keeps the operator's decreed room default and Golden Triangle", () => {
    const existing = {
      allowRecommendation: false,
      workroomPostureDefault: { actionBoundary: "preauthorized", proactivityLevel: "assertive", declaredBy: "u-1", declaredAt: "2026-09-18T11:34:48.959Z" },
      goldenTriangle: { preset: "balanced", costWeight: 0.33, timeWeight: 0.33, qualityWeight: 0.34 },
    };
    const seeded = { allowRecommendation: true, allowArbitration: false, maxRiskForArbitration: "low" };
    const merged = mergeAutonomyPolicy(existing, seeded) as Record<string, unknown>;
    expect(merged.allowRecommendation).toBe(true);
    expect(merged.allowArbitration).toBe(false);
    expect(merged.workroomPostureDefault).toEqual(existing.workroomPostureDefault);
    expect(merged.goldenTriangle).toEqual(existing.goldenTriangle);
    expect(OPERATOR_OWNED_AUTONOMY_POLICY_KEYS).toEqual(["workroomPostureDefault", "goldenTriangle"]);
  });

  it("returns the seed unchanged when nothing operator-owned exists yet", () => {
    const seeded = { allowRecommendation: true };
    expect(mergeAutonomyPolicy(null, seeded)).toEqual(seeded);
    expect(mergeAutonomyPolicy({ allowRecommendation: false }, seeded)).toEqual(seeded);
  });
});
