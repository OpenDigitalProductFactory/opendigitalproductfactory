import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityContract } from "@/lib/routing/activity-contract";
import {
  ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
  activityHarnessProposalParameters,
} from "@/lib/routing/activity-harness-approval-source";

const mocks = vi.hoisted(() => ({
  routeEndpointV2: vi.fn(),
  callWithFallbackChain: vi.fn(),
  loadEndpointManifests: vi.fn(),
  loadPolicyRules: vi.fn(),
  loadOverrides: vi.fn(),
  persistRouteDecision: vi.fn(),
  inferContract: vi.fn(),
  getLocalOnlyInference: vi.fn(),
  resolveDispatchPosture: vi.fn(),
  logTokenUsage: vi.fn(),
  agentActionProposalFindMany: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    agentActionProposal: {
      findMany: mocks.agentActionProposalFindMany,
    },
  },
}));

vi.mock("@/lib/routing/loader", () => ({
  loadEndpointManifests: mocks.loadEndpointManifests,
  loadPolicyRules: mocks.loadPolicyRules,
  loadOverrides: mocks.loadOverrides,
  persistRouteDecision: mocks.persistRouteDecision,
}));

vi.mock("@/lib/routing/request-contract", () => ({
  inferContract: mocks.inferContract,
}));

vi.mock("@/lib/routing/pipeline-v2", () => ({
  routeEndpointV2: mocks.routeEndpointV2,
}));

vi.mock("@/lib/routing/fallback", () => ({
  callWithFallbackChain: mocks.callWithFallbackChain,
}));

vi.mock("@/lib/inference/local-only", () => ({
  getLocalOnlyInference: mocks.getLocalOnlyInference,
}));

vi.mock("@/lib/golden-triangle/dispatch", () => ({
  resolveDispatchPosture: mocks.resolveDispatchPosture,
}));

vi.mock("@/lib/ai-inference", () => ({
  logTokenUsage: mocks.logTokenUsage,
}));

import { routeAndCall } from "./routed-inference";
import { previewRoute } from "./routed-inference";

describe("routeAndCall activity harness overrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLocalOnlyInference.mockResolvedValue(false);
    mocks.resolveDispatchPosture.mockResolvedValue(null);
    mocks.inferContract.mockResolvedValue({
      contractId: "contract-1",
      contractFamily: "sync.test",
      taskType: "summarization",
      modality: { input: ["text"], output: ["text"] },
      interactionMode: "sync",
      sensitivity: "internal",
      requiresTools: false,
      requiresStrictSchema: false,
      requiresStreaming: false,
      estimatedInputTokens: 1000,
      estimatedOutputTokens: 400,
      reasoningDepth: "low",
      budgetClass: "minimize_cost",
    });
    mocks.loadEndpointManifests.mockResolvedValue([
      {
        id: "openai:gpt-4o-mini",
        providerId: "openai",
        modelId: "gpt-4o-mini",
        providerTier: "user_configured",
        status: "active",
        maxContextTokens: 128000,
      },
    ]);
    mocks.loadPolicyRules.mockResolvedValue([]);
    mocks.loadOverrides.mockResolvedValue([]);
    mocks.routeEndpointV2.mockResolvedValue({
      selectedEndpoint: "openai:gpt-4o-mini",
      selectedModelId: "gpt-4o-mini",
      reason: "selected",
      fitnessScore: 1,
      fallbackChain: ["openai:gpt-4o-mini"],
      candidates: [],
      excludedCount: 0,
      excludedReasons: [],
      policyRulesApplied: [],
      taskType: "summarization",
      sensitivity: "internal",
      timestamp: new Date("2026-06-28T21:00:00.000Z"),
      executionPlan: {
        providerId: "openai",
        modelId: "gpt-4o-mini",
        recipeId: null,
        contractFamily: "sync.test",
        executionAdapter: "chat",
        maxTokens: 4096,
        providerSettings: {},
        toolPolicy: {},
        responsePolicy: {},
      },
    });
    mocks.callWithFallbackChain.mockResolvedValue({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      content: "ok",
      toolCalls: [],
      tokenUsage: { inputTokens: 12, outputTokens: 4 },
      downgraded: false,
      downgradeMessage: null,
    });
    mocks.agentActionProposalFindMany.mockResolvedValue([
      {
        proposalId: "AP-ROUTE-1",
        actionType: ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
        parameters: activityHarnessProposalParameters({
          proposalId: "harness-action:summarize:center.summarize.cheap-structured:openai:gpt-4o-mini:promote",
          activityClass: "summarize",
          harnessRecipeKey: "center.summarize.cheap-structured",
          providerId: "openai",
          modelId: "gpt-4o-mini",
          confidence: "trusted",
        }),
        status: "approved",
        decidedById: "user-1",
        decidedAt: new Date("2026-06-28T21:00:00.000Z"),
      },
    ]);
  });

  it("loads approved activity harness confidence overrides for live activity routing", async () => {
    await routeAndCall(
      [{ role: "user", content: "Summarize this transcript." }],
      "You summarize.",
      "internal",
      {
        taskType: "summarization",
        budgetClass: "minimize_cost",
        activityContract: makeActivity(),
        persistDecision: false,
      },
    );

    expect(mocks.agentActionProposalFindMany).toHaveBeenCalledWith({
      where: {
        actionType: ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
        status: { in: ["approve", "approved", "executed"] },
      },
      orderBy: { decidedAt: "desc" },
      take: 40,
      select: {
        proposalId: true,
        actionType: true,
        parameters: true,
        status: true,
        decidedById: true,
        decidedAt: true,
      },
    });
    expect(mocks.routeEndpointV2).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      [],
      [],
      expect.objectContaining({
        activityContract: expect.objectContaining({ activityClass: "summarize" }),
        activityHarnessConfidenceOverrides: [
          expect.objectContaining({
            activityClass: "summarize",
            harnessRecipeKey: "center.summarize.cheap-structured",
            providerId: "openai",
            modelId: "gpt-4o-mini",
            confidence: "trusted",
          }),
        ],
      }),
    );
  });

  it("keeps preview routing deterministic by not loading approved overrides", async () => {
    await previewRoute(
      [{ role: "user", content: "Summarize this transcript." }],
      "internal",
      {
        taskType: "summarization",
        budgetClass: "minimize_cost",
        activityContract: makeActivity(),
      },
    );

    expect(mocks.agentActionProposalFindMany).not.toHaveBeenCalled();
    expect(mocks.routeEndpointV2).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      [],
      [],
      expect.objectContaining({
        skipRecipe: true,
        activityContract: expect.objectContaining({ activityClass: "summarize" }),
        activityHarnessConfidenceOverrides: [],
      }),
    );
  });
});

function makeActivity(): ActivityContract {
  return {
    activityId: "request:REQ-1:01:summarize",
    parentRef: { taskRunId: "TASK-1" },
    activityClass: "summarize",
    title: "Distill source material",
    distributionShape: "center",
    riskClass: "low",
    successShape: "text",
    contextPolicy: "retrieval",
    tokenEnvelope: {
      maxInputTokens: 64000,
      maxOutputTokens: 2000,
      compression: "summarize",
    },
    evaluationPolicy: {
      evaluator: "human-acceptance",
      minimumSignal: "accepted",
    },
    requestContractHints: {},
  };
}
