import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRun, send, findUnique, findMany } = vi.hoisted(() => ({
  createRun: vi.fn(),
  send: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    taskRun: { findUnique, findMany },
  },
}));
vi.mock("@/lib/queue/functions/work-pattern-experiment", () => ({
  enqueueWorkPatternExperiment: send,
}));
vi.mock("./work-pattern-experiment-store", () => ({
  createPrismaWorkPatternExperimentPersistence: vi.fn().mockReturnValue({}),
  createOrResumeWorkPatternExperiment: createRun,
}));

import {
  scheduleNextWorkPatternExperimentReplicate,
  scheduleReviewedWorkPatternExperiment,
} from "./work-pattern-experiment-scheduler";

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

  it("creates exactly the next replicate from a completed valid build run and stops at eight", async () => {
    const approved = candidate();
    approved.cells[0]!.executionRequest.executionProfile.activityKey = "build.implement";
    findUnique.mockResolvedValueOnce({
      userId: "user-1",
      currentAgentId: "agent-1",
      initiatingAgentId: "agent-1",
      status: "completed",
      a2aMetadata: {
        workPatternExperiment: {
          schemaVersion: 1,
          experimentDefinitionKey: "definition",
          experimentRunId: "WPR-1",
          replicate: 1,
          patternKey: approved.definition.patternKey,
          activityKey: "build.implement",
          riskClass: "internal-reversible",
          methodVariants: approved.definition.methodVariants,
          modelVariants: approved.definition.modelVariants,
          requiredCellKeys: [approved.cells[0]!.executionRequest.cellKey],
          taskCorpusKey: approved.definition.taskCorpusKey,
          taskCorpusVersion: approved.definition.taskCorpusVersion,
          oracleKey: approved.definition.oracleKey,
          oracleVersion: approved.definition.oracleVersion,
          promotionPolicyKey: approved.definition.promotionPolicyKey,
          promotionPolicyVersion: approved.definition.promotionPolicyVersion,
          installScope: approved.definition.installScope,
          lifecycle: "completed",
        },
      },
    });
    findMany.mockResolvedValueOnce(approved.cells.map((cell) => ({
      a2aMetadata: {
        workPatternExperimentCell: {
          schemaVersion: 1,
          experimentRunId: "WPR-1",
          experimentDefinitionKey: "definition",
          cellKey: cell.executionRequest.cellKey,
          pairKey: "pair",
          methodVariantKey: cell.methodVariantKey,
          modelVariantKey: cell.modelVariantKey,
          attempt: 1,
          executionRequest: cell.executionRequest,
        },
      },
    })));
    createRun.mockResolvedValueOnce({
      parent: { taskRunId: "TR-PARENT-2" },
      manifest: { experimentRunId: "WPR-2" },
    });

    await expect(scheduleNextWorkPatternExperimentReplicate({
      parentTaskRunId: "TR-PARENT-1",
      promotionResult: {
        decisions: [{
          decision: "continue",
          reasons: ["minimum_valid_pairs_not_met"],
        }],
      },
    })).resolves.toEqual({
      scheduled: true,
      parentTaskRunId: "TR-PARENT-2",
      replicate: 2,
    });
    expect(createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        replicate: 2,
        activityKey: "build.implement",
      }),
      expect.any(Object),
    );
    expect(send).toHaveBeenCalledWith("WPR-2", "TR-PARENT-2");

    findUnique.mockResolvedValueOnce({
      id: "parent-8",
      userId: "user-1",
      buildId: null,
      currentAgentId: "agent-1",
      initiatingAgentId: "agent-1",
      status: "completed",
      a2aMetadata: {
        workPatternExperiment: {
          schemaVersion: 1,
          experimentDefinitionKey: "definition",
          experimentRunId: "WPR-8",
          replicate: 8,
          patternKey: approved.definition.patternKey,
          activityKey: "build.implement",
          riskClass: "internal-reversible",
          methodVariants: approved.definition.methodVariants,
          modelVariants: approved.definition.modelVariants,
          requiredCellKeys: [approved.cells[0]!.executionRequest.cellKey],
          taskCorpusKey: approved.definition.taskCorpusKey,
          taskCorpusVersion: approved.definition.taskCorpusVersion,
          oracleKey: approved.definition.oracleKey,
          oracleVersion: approved.definition.oracleVersion,
          promotionPolicyKey: approved.definition.promotionPolicyKey,
          promotionPolicyVersion: approved.definition.promotionPolicyVersion,
          installScope: approved.definition.installScope,
          lifecycle: "completed",
        },
      },
    });
    await expect(scheduleNextWorkPatternExperimentReplicate({
      parentTaskRunId: "TR-PARENT-8",
      promotionResult: {
        decisions: [{
          decision: "continue",
          reasons: ["minimum_valid_pairs_not_met"],
        }],
      },
    })).resolves.toEqual({
      scheduled: false,
      reason: "replicate_limit_reached",
    });
    expect(createRun).toHaveBeenCalledTimes(1);
  });
});
