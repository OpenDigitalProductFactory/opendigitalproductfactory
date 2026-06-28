import { describe, expect, it } from "vitest";
import {
  applyApprovedActivityHarnessActions,
  buildActivityHarnessActionProposals,
} from "./activity-harness-governance";
import type { ActivityHarnessCalibration } from "./activity-harness-calibration";

describe("buildActivityHarnessActionProposals", () => {
  it("creates approval-required promotion proposals from promote recommendations", () => {
    const proposals = buildActivityHarnessActionProposals([
      calibration({
        recommendation: "promote",
        recommendedConfidence: "trusted",
        sampleCount: 12,
        linkedSampleCount: 12,
        successRate: 0.92,
        avgQualitySignal: 0.91,
      }),
    ]);

    expect(proposals).toEqual([
      expect.objectContaining({
        proposalId: "harness-action:code-edit:glm.mixed.code-edit.provisional:zai-coding:glm-5.2:promote",
        action: "promote",
        approvalRequired: true,
        status: "proposed",
        activityClass: "code-edit",
        harnessRecipeKey: "glm.mixed.code-edit.provisional",
        providerId: "zai-coding",
        modelId: "glm-5.2",
        currentConfidence: "provisional",
        recommendedConfidence: "trusted",
        evidence: {
          sampleCount: 12,
          linkedSampleCount: 12,
          successRate: 0.92,
          failureRate: 0,
          retryRate: 0,
          avgQualitySignal: 0.91,
          avgCostUsd: 0.02,
          avgTokenTotal: 1000,
        },
      }),
    ]);
    expect(proposals[0]?.summary).toContain("approval");
  });

  it("creates approval-required degradation proposals from degrade recommendations", () => {
    const proposals = buildActivityHarnessActionProposals([
      calibration({
        recommendation: "degrade",
        recommendedConfidence: "degraded",
        failureRate: 0.4,
        retryRate: 0.2,
      }),
    ]);

    expect(proposals).toEqual([
      expect.objectContaining({
        action: "degrade",
        approvalRequired: true,
        status: "proposed",
        recommendedConfidence: "degraded",
      }),
    ]);
  });

  it("does not create action proposals for observe or keep recommendations", () => {
    const proposals = buildActivityHarnessActionProposals([
      calibration({ recommendation: "observe" }),
      calibration({ recommendation: "keep" }),
    ]);

    expect(proposals).toEqual([]);
  });
});

describe("applyApprovedActivityHarnessActions", () => {
  it("turns approved action proposals into confidence overrides", () => {
    const [proposal] = buildActivityHarnessActionProposals([
      calibration({
        recommendation: "promote",
        recommendedConfidence: "trusted",
        sampleCount: 12,
        linkedSampleCount: 12,
        successRate: 0.92,
      }),
    ]);

    const overrides = applyApprovedActivityHarnessActions([
      {
        proposal: proposal!,
        decision: "approved",
        decidedBy: "operator-1",
        decidedAt: new Date("2026-06-28T20:30:00.000Z"),
      },
    ]);

    expect(overrides).toEqual([
      {
        calibrationKey: "code-edit|glm.mixed.code-edit.provisional|zai-coding|glm-5.2",
        proposalId: proposal!.proposalId,
        activityClass: "code-edit",
        harnessRecipeKey: "glm.mixed.code-edit.provisional",
        providerId: "zai-coding",
        modelId: "glm-5.2",
        confidence: "trusted",
        approvedBy: "operator-1",
        approvedAt: "2026-06-28T20:30:00.000Z",
      },
    ]);
  });

  it("ignores pending and rejected action proposals", () => {
    const [proposal] = buildActivityHarnessActionProposals([
      calibration({ recommendation: "degrade", recommendedConfidence: "degraded" }),
    ]);

    const overrides = applyApprovedActivityHarnessActions([
      { proposal: proposal!, decision: "pending" },
      {
        proposal: proposal!,
        decision: "rejected",
        decidedBy: "operator-1",
        decidedAt: new Date("2026-06-28T20:30:00.000Z"),
      },
    ]);

    expect(overrides).toEqual([]);
  });
});

function calibration(
  overrides: Partial<ActivityHarnessCalibration> = {},
): ActivityHarnessCalibration {
  return {
    calibrationKey: "code-edit|glm.mixed.code-edit.provisional|zai-coding|glm-5.2",
    activityClass: "code-edit",
    harnessRecipeKey: "glm.mixed.code-edit.provisional",
    providerId: "zai-coding",
    modelId: "glm-5.2",
    currentConfidence: "provisional",
    recommendedConfidence: "provisional",
    recommendation: "observe",
    sampleCount: 3,
    linkedSampleCount: 3,
    successRate: 1,
    failureRate: 0,
    retryRate: 0,
    avgCostUsd: 0.02,
    avgTokenTotal: 1000,
    avgQualitySignal: null,
    rationale: "Keep observing.",
    ...overrides,
  };
}
