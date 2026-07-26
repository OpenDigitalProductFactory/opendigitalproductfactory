import { describe, expect, it, vi } from "vitest";

import {
  executeWorkPatternFactorial,
  type WorkPatternExperimentCellRequest,
} from "./work-pattern-experiment-adapter";

function cell(
  methodVariantKey: string,
  modelVariantKey: string,
): WorkPatternExperimentCellRequest {
  return {
    experimentRunId: "WPR-1",
    childTaskRunId: `TR-${methodVariantKey}-${modelVariantKey}`,
    cellKey: `${methodVariantKey}:${modelVariantKey}`,
    pairKey: "factorial",
    methodVariantKey,
    modelVariantKey,
    executionProfile: {
      patternKey: "review-loop",
      patternVersion: methodVariantKey === "candidate" ? 2 : 1,
      variantKey: methodVariantKey,
      activityKey: "build.review",
      riskClass: "internal-reversible",
      providerId: "preferred-provider",
      modelId: modelVariantKey,
      modelProfileId: `profile-${modelVariantKey}`,
      toolPackDigest: "tools-digest",
      promptOrSkillDigest: "prompt-digest",
      contextPolicyKey: "hermetic-fixture",
      recoveryPolicyKey: "bounded-retry",
      installScope: "canonical",
      taskCorpusKey: "corpus",
      taskCorpusVersion: "1",
      environmentKey: "shadow",
      sourceCommitSha: "abc123",
    },
    fixtureKey: "fixture-1",
    oracleKey: "oracle",
    oracleVersion: "1",
    resourcePolicyKey: "bounded-default",
  };
}

describe("executeWorkPatternFactorial", () => {
  it("executes a full 2x2 matrix in separate workspaces and retains interaction data", async () => {
    const requests = [
      cell("baseline", "model-a"),
      cell("baseline", "model-b"),
      cell("candidate", "model-a"),
      cell("candidate", "model-b"),
    ];
    const prepareWorkspace = vi.fn(async (request: WorkPatternExperimentCellRequest) => ({
      workspaceId: `workspace-${request.cellKey}`,
      workdir: `/shadow/${request.cellKey}`,
    }));
    const dispatch = vi.fn(async ({ request }: { request: WorkPatternExperimentCellRequest }) => ({
      success: true,
      providerId: "actual-provider",
      modelId: request.modelVariantKey,
      filesChanged: [`${request.cellKey}.ts`],
      toolCalls: 2,
      toolFailures: 0,
    }));

    const result = await executeWorkPatternFactorial(requests, {
      prepareWorkspace,
      dispatch,
      verify: vi.fn().mockResolvedValue({
        unitTests: "pass",
        productionBuild: "pass",
        uxVerification: "not-applicable",
        migration: "not-applicable",
      }),
    });

    expect(result.cells).toHaveLength(4);
    expect(new Set(result.cells.map((row) => row.workspaceId)).size).toBe(4);
    expect(result.factorial.methodVariants).toEqual(["baseline", "candidate"]);
    expect(result.factorial.modelVariants).toEqual(["model-a", "model-b"]);
    expect(result.factorial.interactionCells).toHaveLength(4);
  });

  it("stamps the provider/model actually used after fallback", async () => {
    const result = await executeWorkPatternFactorial([cell("baseline", "model-a")], {
      prepareWorkspace: vi.fn().mockResolvedValue({
        workspaceId: "workspace-1",
        workdir: "/shadow/1",
      }),
      dispatch: vi.fn().mockResolvedValue({
        success: true,
        providerId: "fallback-provider",
        modelId: "fallback-model",
        filesChanged: [],
        toolCalls: 1,
        toolFailures: 0,
      }),
      verify: vi.fn().mockResolvedValue({
        unitTests: "pass",
        productionBuild: "pass",
        uxVerification: "not-applicable",
        migration: "not-applicable",
      }),
    });

    expect(result.cells[0]).toMatchObject({
      actualProviderId: "fallback-provider",
      actualModelId: "fallback-model",
    });
  });

  it("never exposes delivery or live-mutation adapters to replay cells", async () => {
    const prohibited = {
      advanceFeatureBuild: vi.fn(),
      createPullRequest: vi.fn(),
      enqueueMerge: vi.fn(),
      release: vi.fn(),
      mutateLiveState: vi.fn(),
    };
    await executeWorkPatternFactorial([cell("baseline", "model-a")], {
      prepareWorkspace: vi.fn().mockResolvedValue({
        workspaceId: "workspace-1",
        workdir: "/shadow/1",
      }),
      dispatch: vi.fn().mockResolvedValue({
        success: true,
        providerId: "provider",
        modelId: "model-a",
        filesChanged: [],
        toolCalls: 0,
        toolFailures: 0,
      }),
      verify: vi.fn().mockResolvedValue({
        unitTests: "pass",
        productionBuild: "pass",
        uxVerification: "not-applicable",
        migration: "not-applicable",
      }),
      prohibited,
    });

    for (const adapter of Object.values(prohibited)) expect(adapter).not.toHaveBeenCalled();
  });

  it("persists only compact profiles and excludes prompts, tokens, and environment values", async () => {
    const request = {
      ...cell("baseline", "model-a"),
      prompt: "secret prompt",
      apiToken: "token-value",
      environment: { SECRET: "value" },
    } as WorkPatternExperimentCellRequest & Record<string, unknown>;
    const result = await executeWorkPatternFactorial([request], {
      prepareWorkspace: vi.fn().mockResolvedValue({
        workspaceId: "workspace-1",
        workdir: "/shadow/1",
      }),
      dispatch: vi.fn().mockResolvedValue({
        success: true,
        providerId: "provider",
        modelId: "model-a",
        filesChanged: [],
        toolCalls: 0,
        toolFailures: 0,
      }),
      verify: vi.fn().mockResolvedValue({
        unitTests: "pass",
        productionBuild: "pass",
        uxVerification: "not-applicable",
        migration: "not-applicable",
      }),
    });

    const persisted = JSON.stringify(result);
    expect(persisted).not.toContain("secret prompt");
    expect(persisted).not.toContain("token-value");
    expect(persisted).not.toContain('"SECRET"');
  });
});
