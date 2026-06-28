import { describe, expect, it, vi } from "vitest";

import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";
import { routeEndpointV2 } from "./pipeline-v2";
import type { ActivityContract } from "./activity-contract";
import type { ActivityHarnessConfidenceOverride } from "./activity-harness-governance";
import type { EndpointManifest } from "./types";
import type { RequestContract } from "./request-contract";

vi.mock("./champion-challenger", () => ({
  selectRecipeWithExploration: vi.fn().mockResolvedValue({
    recipe: null,
    explorationMode: "champion",
  }),
}));

describe("routeEndpointV2 activity harness execution plans", () => {
  it("attaches an activity harness recipe to the selected executionPlan", async () => {
    const decision = await routeEndpointV2(
      [makeEndpoint({ providerId: "zai", modelId: "glm-5.2", modelFamily: "glm" })],
      makeContract({ taskType: "analysis" }),
      [],
      [],
      { activityContract: makeActivity() },
    );

    expect(decision.executionPlan?.harness).toMatchObject({
      recipeKey: "glm.edge.code-edit.provisional",
      activityClass: "code-edit",
      activityConfidence: "provisional",
      providerFamily: "zai",
      modelFamily: "glm",
      executionAdapterHint: "opencode",
      promptStrategy: "glm-center-distribution-packet",
      contextAssembler: "minimal-ranked-context",
    });
  });

  it("applies an approved activity harness confidence override to live execution plans", async () => {
    const activity = makeActivity({
      activityClass: "summarize",
      distributionShape: "center",
      riskClass: "low",
      successShape: "text",
      evaluationPolicy: {
        evaluator: "human-acceptance",
        minimumSignal: "accepted",
      },
    });
    const override: ActivityHarnessConfidenceOverride = {
      calibrationKey: "summarize|center.summarize.cheap-structured|openai|gpt-4o-mini",
      proposalId: "harness-action:summarize:center.summarize.cheap-structured:openai:gpt-4o-mini:promote",
      activityClass: "summarize",
      harnessRecipeKey: "center.summarize.cheap-structured",
      providerId: "openai",
      modelId: "gpt-4o-mini",
      confidence: "trusted",
      approvedBy: "operator",
      approvedAt: "2026-06-28T21:00:00.000Z",
    };

    const decision = await routeEndpointV2(
      [makeEndpoint({
        id: "ep-cheap",
        providerId: "openai",
        modelId: "gpt-4o-mini",
        costPerOutputMToken: 0.6,
      })],
      makeContract({ taskType: "summarization", budgetClass: "minimize_cost" }),
      [],
      [],
      {
        activityContract: activity,
        activityHarnessConfidenceOverrides: [override],
      },
    );

    expect(decision.executionPlan?.harness).toMatchObject({
      recipeKey: "center.summarize.cheap-structured",
      activityClass: "summarize",
      activityConfidence: "trusted",
    });
  });
});

function makeEndpoint(overrides: Partial<EndpointManifest> = {}): EndpointManifest {
  return {
    id: "ep-default",
    providerId: "test",
    modelId: "test-model",
    name: "Default Endpoint",
    endpointType: "chat",
    status: "active",
    providerTier: "user_configured",
    sensitivityClearance: ["public", "internal"],
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 128000,
    maxOutputTokens: 4096,
    modelRestrictions: [],
    reasoning: 70,
    codegen: 70,
    toolFidelity: 70,
    instructionFollowing: 70,
    structuredOutput: 70,
    conversational: 70,
    contextRetention: 70,
    customScores: {},
    avgLatencyMs: 1000,
    recentFailureRate: 0,
    costPerOutputMToken: 10.0,
    profileSource: "seed",
    profileConfidence: "medium",
    retiredAt: null,
    modelClass: "chat",
    modelFamily: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, structuredOutput: true, streaming: true },
    pricing: { ...EMPTY_PRICING, inputPerMToken: 3.0, outputPerMToken: 15.0 },
    supportedParameters: [],
    deprecationDate: null,
    metadataSource: "seed",
    metadataConfidence: "medium",
    perRequestLimits: null,
    ...overrides,
  };
}

function makeContract(overrides: Partial<RequestContract> = {}): RequestContract {
  return {
    contractId: "test-contract",
    contractFamily: "sync.test",
    taskType: "reasoning",
    modality: { input: ["text"], output: ["text"] },
    interactionMode: "sync",
    sensitivity: "internal",
    requiresTools: false,
    requiresStrictSchema: false,
    requiresStreaming: false,
    estimatedInputTokens: 1000,
    estimatedOutputTokens: 500,
    reasoningDepth: "medium",
    budgetClass: "balanced",
    ...overrides,
  };
}

function makeActivity(overrides: Partial<ActivityContract> = {}): ActivityContract {
  return {
    activityId: "task-123:build",
    parentRef: { workCaseId: "task-123" },
    activityClass: "code-edit",
    title: "Build feature slice",
    distributionShape: "edge",
    riskClass: "high",
    successShape: "patch",
    contextPolicy: "work-case-packet",
    tokenEnvelope: {
      maxInputTokens: 64000,
      maxOutputTokens: 8192,
      compression: "strict-packet",
    },
    evaluationPolicy: {
      evaluator: "tool-success",
      minimumSignal: "no-regression",
    },
    requestContractHints: {
      taskType: "analysis",
      budgetClass: "quality_first",
    },
    ...overrides,
  };
}
