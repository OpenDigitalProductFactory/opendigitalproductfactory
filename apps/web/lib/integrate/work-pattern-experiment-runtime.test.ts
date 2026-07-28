import { describe, expect, it, vi } from "vitest";

import {
  executePersistedWorkPatternExperimentCell,
  type PersistedWorkPatternRuntimeDeps,
} from "./work-pattern-experiment-runtime";
import type { WorkPatternExperimentCellRequest } from "./work-pattern-experiment-adapter";

function request(
  environmentKey: WorkPatternExperimentCellRequest["executionProfile"]["environmentKey"] = "shadow",
): WorkPatternExperimentCellRequest {
  return {
    experimentRunId: "WPR-1",
    childTaskRunId: "TR-CELL-1",
    cellKey: "baseline:model-a",
    pairKey: "pair",
    methodVariantKey: "baseline",
    modelVariantKey: "model-a",
    executionProfile: {
      patternKey: "review-loop",
      patternVersion: 1,
      variantKey: "baseline",
      activityKey: "build.review",
      riskClass: "internal-reversible",
      providerId: "preferred-provider",
      modelId: "preferred-model",
      modelProfileId: "profile",
      toolPackDigest: "tools",
      promptOrSkillDigest: "method-digest",
      contextPolicyKey: "hermetic",
      recoveryPolicyKey: "bounded",
      installScope: "canonical",
      taskCorpusKey: "corpus",
      taskCorpusVersion: "1",
      environmentKey,
      sourceCommitSha: "abc123",
    },
    fixtureKey: "fixture-1",
    oracleKey: "oracle",
    oracleVersion: "1",
    resourcePolicyKey: "bounded",
  };
}

function deps(): PersistedWorkPatternRuntimeDeps {
  return {
    loadContext: vi.fn().mockResolvedValue({
      taskRun: {
        taskRunId: "TR-CELL-1",
        currentAgentId: "agent-orchestrator",
        initiatingAgentId: "agent-orchestrator",
        a2aMetadata: { workPatternExperimentCell: { attempt: 1 } },
      },
      fixtureParts: {
        schemaVersion: 1,
        kind: "inference-replay-v1",
        messages: [{ role: "user", content: "Return READY." }],
        systemPrompt: "Follow the replay fixture exactly.",
        methodInstructions: {
          "method-digest": "Use the baseline method.",
        },
        oracle: { kind: "exact", expected: "READY" },
      },
    }),
    infer: vi.fn().mockResolvedValue({
      content: "READY",
      providerId: "fallback-provider",
      modelId: "fallback-model",
      inputTokens: 12,
      outputTokens: 1,
    }),
    markWorking: vi.fn().mockResolvedValue(undefined),
    updateTaskRun: vi.fn().mockResolvedValue(undefined),
    recordEvidence: vi.fn().mockImplementation(async (input) => input),
    executeBuildReplay: vi.fn(),
  };
}

describe("executePersistedWorkPatternExperimentCell", () => {
  it("runs an immutable replay autonomously and records compact assignment/outcome evidence", async () => {
    const runtime = deps();

    const result = await executePersistedWorkPatternExperimentCell(
      "TR-CELL-1",
      request(),
      runtime,
    );

    expect(result).toMatchObject({
      success: true,
      actualProviderId: "fallback-provider",
      actualModelId: "fallback-model",
      workspaceId: "TR-CELL-1:abc123",
    });
    expect(runtime.infer).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("Use the baseline method."),
        profile: expect.objectContaining({
          providerId: "preferred-provider",
          modelId: "preferred-model",
        }),
        agentId: "agent-orchestrator",
      }),
    );
    expect(runtime.recordEvidence).toHaveBeenCalledTimes(2);
    expect(runtime.recordEvidence).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        observationKind: "assignment",
        proposedDecision: request(),
      }),
    );
    expect(runtime.markWorking).toHaveBeenCalledWith({
      taskRunId: "TR-CELL-1",
      a2aMetadata: { workPatternExperimentCell: { attempt: 1 } },
    });
    expect(runtime.recordEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({
        observationKind: "outcome",
        orchestratingAgentId: "agent-orchestrator",
        actualDecision: {
          actualProviderId: "fallback-provider",
          actualModelId: "fallback-model",
        },
        outcome: expect.objectContaining({
          outputDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          inputTokens: 12,
          outputTokens: 1,
        }),
      }),
    );
    expect(runtime.updateTaskRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taskRunId: "TR-CELL-1",
        status: "completed",
        a2aMetadata: expect.objectContaining({
          workPatternExperimentResult: expect.objectContaining({ success: true }),
        }),
      }),
    );
  });

  it("fails closed before inference for authority-ceiling and unsupported fixture cases", async () => {
    const runtime = deps();
    await expect(
      executePersistedWorkPatternExperimentCell("TR-CELL-1", request("live"), runtime),
    ).rejects.toThrow("work_pattern_experiment_authority_ceiling");
    expect(runtime.infer).not.toHaveBeenCalled();

    vi.mocked(runtime.loadContext).mockResolvedValueOnce({
      taskRun: {
        taskRunId: "TR-CELL-1",
        currentAgentId: "agent-orchestrator",
        initiatingAgentId: null,
        a2aMetadata: {},
      },
      fixtureParts: { kind: "mutable-code-workspace" },
    });
    await expect(
      executePersistedWorkPatternExperimentCell("TR-CELL-1", request(), runtime),
    ).rejects.toThrow("work_pattern_experiment_fixture_unavailable");
    expect(runtime.infer).not.toHaveBeenCalled();
  });

  it("runs a hermetic code fixture through the build adapter and records a production-build pass", async () => {
    const runtime = deps();
    vi.mocked(runtime.loadContext).mockResolvedValueOnce({
      taskRun: {
        taskRunId: "TR-CELL-1",
        currentAgentId: "agent-orchestrator",
        initiatingAgentId: null,
        a2aMetadata: { workPatternExperimentCell: { attempt: 1 } },
      },
      fixtureParts: {
        schemaVersion: 1,
        kind: "build-replay-v1",
        objective: "Implement the bounded fixture.",
        targetFile: "apps/web/lib/fixtures/bounded.ts",
        testFiles: ["apps/web/lib/fixtures/bounded.test.ts"],
        methodInstructions: {
          "method-digest": "Use the baseline method.",
        },
      },
    });
    vi.mocked(runtime.executeBuildReplay).mockResolvedValueOnce({
      result: {
        experimentRunId: "WPR-1",
        childTaskRunId: "TR-CELL-1",
        cellKey: "baseline:model-a",
        pairKey: "pair",
        methodVariantKey: "baseline",
        modelVariantKey: "model-a",
        fixtureKey: "fixture-1",
        oracleKey: "oracle",
        oracleVersion: "1",
        resourcePolicyKey: "bounded",
        executionProfile: request().executionProfile,
        workspaceId: "TR-CELL-1:abc123",
        actualProviderId: "fallback-provider",
        actualModelId: "fallback-model",
        success: true,
        filesChanged: ["apps/web/lib/fixtures/bounded.ts"],
        toolCalls: 2,
        toolFailures: 0,
        buildGate: {
          unitTests: "pass",
          productionBuild: "pass",
          uxVerification: "not-applicable",
          migration: "not-applicable",
        },
      },
      outputDigest: "a".repeat(64),
      inputTokens: 25,
      outputTokens: 10,
    });

    const result = await executePersistedWorkPatternExperimentCell(
      "TR-CELL-1",
      request(),
      runtime,
    );

    expect(runtime.executeBuildReplay).toHaveBeenCalledWith({
      request: request(),
      fixtureParts: expect.objectContaining({ kind: "build-replay-v1" }),
      agentId: "agent-orchestrator",
    });
    expect(runtime.infer).not.toHaveBeenCalled();
    expect(result.buildGate.productionBuild).toBe("pass");
    expect(runtime.updateTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        a2aMetadata: expect.objectContaining({
          workPatternExperimentResult: expect.objectContaining({
            outputDigest: "a".repeat(64),
            buildGate: expect.objectContaining({ productionBuild: "pass" }),
          }),
        }),
      }),
    );
  });
});
