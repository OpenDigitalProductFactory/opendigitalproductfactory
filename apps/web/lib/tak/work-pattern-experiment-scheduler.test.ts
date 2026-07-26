import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRun, send } = vi.hoisted(() => ({
  createRun: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/queue/functions/work-pattern-experiment", () => ({
  enqueueWorkPatternExperiment: send,
}));
vi.mock("./work-pattern-experiment-store", () => ({
  createPrismaWorkPatternExperimentPersistence: vi.fn().mockReturnValue({}),
  createOrResumeWorkPatternExperiment: createRun,
}));

import { scheduleReviewedWorkPatternExperiment } from "./work-pattern-experiment-scheduler";

function candidate(environmentKey = "shadow") {
  const executionProfile = {
    patternKey: "review-loop",
    patternVersion: 1,
    variantKey: "baseline",
    activityKey: "build.review",
    riskClass: "internal-reversible",
    providerId: "provider",
    modelId: "model",
    modelProfileId: "profile",
    toolPackDigest: "tools",
    promptOrSkillDigest: "prompt",
    contextPolicyKey: "hermetic",
    recoveryPolicyKey: "bounded",
    installScope: "canonical",
    taskCorpusKey: "corpus",
    taskCorpusVersion: "1",
    environmentKey,
    sourceCommitSha: "abc123",
  };
  return {
    definition: {
      patternKey: "review-loop",
      taskCorpusKey: "corpus",
      taskCorpusVersion: "1",
      oracleKey: "oracle",
      oracleVersion: "1",
      methodVariants: [{ methodVariantKey: "baseline", patternVersion: 1 }],
      modelVariants: [{ modelVariantKey: "model-a", modelProfileId: "profile" }],
      installScope: "canonical",
      promotionPolicyKey: "bounded",
      promotionPolicyVersion: 1,
    },
    activityKey: "build.review",
    riskClass: "internal-reversible",
    pairKey: "pair",
    cells: [
      {
        methodVariantKey: "baseline",
        modelVariantKey: "model-a",
        executionRequest: {
          experimentRunId: "WPR-1",
          childTaskRunId: "TR-CELL-1",
          cellKey: "baseline:model-a",
          pairKey: "pair",
          methodVariantKey: "baseline",
          modelVariantKey: "model-a",
          executionProfile,
          fixtureKey: "fixture",
          oracleKey: "oracle",
          oracleVersion: "1",
          resourcePolicyKey: "bounded",
        },
      },
    ],
  };
}

describe("scheduleReviewedWorkPatternExperiment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createRun.mockResolvedValue({
      parent: { taskRunId: "TR-PARENT" },
      manifest: { experimentRunId: "WPR-1" },
    });
  });

  it("autonomously schedules an approved evidence-cleared shadow candidate", async () => {
    await expect(
      scheduleReviewedWorkPatternExperiment({
        action: "approve",
        candidate: candidate(),
        reviewerUserId: "user-1",
        orchestratingAgentId: "agent-1",
      }),
    ).resolves.toEqual({ scheduled: true, parentTaskRunId: "TR-PARENT" });

    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        orchestratingAgentId: "agent-1",
        cells: [
          expect.objectContaining({
            executionRequest: expect.objectContaining({ fixtureKey: "fixture" }),
          }),
        ],
      }),
      expect.objectContaining({ resolveOwnerUserId: expect.any(Function) }),
    );
    expect(send).toHaveBeenCalledWith("WPR-1", "TR-PARENT");
  });

  it("does not schedule deferred or non-shadow candidates", async () => {
    await expect(
      scheduleReviewedWorkPatternExperiment({
        action: "defer",
        candidate: candidate(),
        reviewerUserId: "user-1",
        orchestratingAgentId: "agent-1",
      }),
    ).resolves.toEqual({ scheduled: false, reason: "review_not_approved" });
    await expect(
      scheduleReviewedWorkPatternExperiment({
        action: "approve",
        candidate: candidate("live"),
        reviewerUserId: "user-1",
        orchestratingAgentId: "agent-1",
      }),
    ).resolves.toEqual({
      scheduled: false,
      reason: "no_evidence_cleared_experiment",
    });
    expect(createRun).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
