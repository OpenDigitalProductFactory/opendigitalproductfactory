import { describe, expect, it } from "vitest";
import {
  calibrateActivityHarnesses,
  type ActivityHarnessOutcomeSample,
} from "./activity-harness-calibration";

describe("calibrateActivityHarnesses", () => {
  it("keeps a new provisional harness in observation until enough linked samples exist", () => {
    const recommendations = calibrateActivityHarnesses([
      sample({ confidence: "provisional", successSignal: "valid" }),
      sample({ confidence: "provisional", successSignal: "valid" }),
    ]);

    expect(recommendations).toEqual([
      expect.objectContaining({
        activityClass: "code-edit",
        harnessRecipeKey: "glm.mixed.code-edit.provisional",
        providerId: "zai-coding",
        modelId: "glm-5.2",
        sampleCount: 2,
        linkedSampleCount: 2,
        successRate: 1,
        recommendation: "observe",
        recommendedConfidence: "provisional",
      }),
    ]);
  });

  it("promotes a provisional harness after enough strong linked outcomes", () => {
    const recommendations = calibrateActivityHarnesses(
      Array.from({ length: 10 }, () =>
        sample({
          confidence: "provisional",
          successSignal: "valid",
          costUsd: 0.01,
          tokenTotal: 1200,
        }),
      ),
    );

    expect(recommendations).toEqual([
      expect.objectContaining({
        recommendation: "promote",
        recommendedConfidence: "trusted",
        sampleCount: 10,
        linkedSampleCount: 10,
        successRate: 1,
        failureRate: 0,
        retryRate: 0,
        avgCostUsd: 0.01,
        avgTokenTotal: 1200,
      }),
    ]);
  });

  it("does not promote when evaluator quality is below the trust floor", () => {
    const recommendations = calibrateActivityHarnesses(
      Array.from({ length: 10 }, () =>
        sample({
          confidence: "provisional",
          successSignal: "valid",
          qualitySignal: 0.62,
        }),
      ),
    );

    expect(recommendations).toEqual([
      expect.objectContaining({
        recommendation: "keep",
        recommendedConfidence: "provisional",
        avgQualitySignal: 0.62,
      }),
    ]);
  });

  it("degrades a harness when failures and retries spike", () => {
    const recommendations = calibrateActivityHarnesses([
      sample({ confidence: "trusted", successSignal: "failed" }),
      sample({ confidence: "trusted", successSignal: "failed" }),
      sample({ confidence: "trusted", successSignal: "retried" }),
      sample({ confidence: "trusted", successSignal: "valid" }),
      sample({ confidence: "trusted", successSignal: "valid" }),
    ]);

    expect(recommendations).toEqual([
      expect.objectContaining({
        recommendation: "degrade",
        recommendedConfidence: "degraded",
        sampleCount: 5,
        failureRate: 0.4,
        retryRate: 0.2,
      }),
    ]);
  });

  it("groups calibration by activity, harness, provider, and model", () => {
    const recommendations = calibrateActivityHarnesses([
      sample({ harnessRecipeKey: "glm.mixed.code-edit.provisional", providerId: "zai-coding" }),
      sample({ harnessRecipeKey: "edge.plan.balanced", activityClass: "plan", providerId: "anthropic", modelId: "claude-sonnet" }),
    ]);

    expect(recommendations.map((r) => r.calibrationKey).sort()).toEqual([
      "code-edit|glm.mixed.code-edit.provisional|zai-coding|glm-5.2",
      "plan|edge.plan.balanced|anthropic|claude-sonnet",
    ]);
  });
});

function sample(
  overrides: Partial<ActivityHarnessOutcomeSample> = {},
): ActivityHarnessOutcomeSample {
  return {
    activityClass: "code-edit",
    harnessRecipeKey: "glm.mixed.code-edit.provisional",
    confidence: "provisional",
    providerId: "zai-coding",
    modelId: "glm-5.2",
    successSignal: "valid",
    evidenceStrength: "linked",
    tokenTotal: 1000,
    costUsd: 0.02,
    qualitySignal: null,
    ...overrides,
  };
}
