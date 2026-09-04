import { beforeEach, describe, expect, it, vi } from "vitest";

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
  createAsyncOperation: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: { agentActionProposal: { findMany: vi.fn() } },
}));

vi.mock("@/lib/routing/loader", () => ({
  loadEndpointManifests: mocks.loadEndpointManifests,
  loadPolicyRules: mocks.loadPolicyRules,
  loadOverrides: mocks.loadOverrides,
  invalidateRoutingLoaderCache: vi.fn(),
  persistRouteDecision: mocks.persistRouteDecision,
  persistFailedRouteDecision: vi.fn(),
  updateProviderSuitabilityReceipt: vi.fn(),
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

vi.mock("@/lib/async-inference", () => ({
  createAsyncOperation: mocks.createAsyncOperation,
}));

vi.mock("@/lib/ai-inference", () => ({
  logTokenUsage: mocks.logTokenUsage,
}));

import { routeAndCall } from "./routed-inference";

describe("routeAndCall background starts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLocalOnlyInference.mockResolvedValue(false);
    mocks.resolveDispatchPosture.mockResolvedValue(null);
    mocks.loadPolicyRules.mockResolvedValue([]);
    mocks.loadOverrides.mockResolvedValue([]);
    mocks.loadEndpointManifests.mockResolvedValue([{
      id: "gemini:model-under-test",
      providerId: "gemini",
      modelId: "model-under-test",
      providerTier: "user_configured",
      status: "active",
      maxContextTokens: 128000,
    }]);
    mocks.inferContract.mockImplementation(async (
      taskType: string,
      messages: Array<{ role: string; content: unknown }>,
      _tools?: Array<Record<string, unknown>>,
      _outputSchema?: Record<string, unknown>,
      routeContext?: Record<string, unknown>,
    ) => ({
      contractId: "contract-background-1",
      contractFamily: "background.research",
      taskType,
      modality: { input: ["text"], output: ["text"] },
      interactionMode: "background",
      sensitivity: routeContext?.sensitivity ?? "internal",
      requiresTools: false,
      requiresStrictSchema: false,
      requiresStreaming: false,
      estimatedInputTokens: messages.length * 1000,
      estimatedOutputTokens: 400,
      reasoningDepth: "high",
      budgetClass: "balanced",
    }));
    mocks.routeEndpointV2.mockResolvedValue({
      selectedEndpoint: "gemini:model-under-test",
      selectedModelId: "model-under-test",
      reason: "selected",
      fitnessScore: 1,
      fallbackChain: ["gemini:model-under-test"],
      candidates: [],
      excludedCount: 0,
      excludedReasons: [],
      policyRulesApplied: [],
      taskType: "research",
      sensitivity: "internal",
      timestamp: new Date("2026-09-04T00:00:00.000Z"),
      executionPlan: {
        providerId: "gemini",
        modelId: "model-under-test",
        recipeId: null,
        contractFamily: "background.research",
        executionAdapter: "async",
        maxTokens: 0,
        providerSettings: {},
        toolPolicy: {},
        responsePolicy: {},
      },
    });
    mocks.callWithFallbackChain.mockResolvedValue({
      providerId: "gemini",
      modelId: "model-under-test",
      content: "",
      toolCalls: [],
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
      inferenceMs: 25,
      downgraded: true,
      downgradeMessage: "Preferred model is ineligible; using Gemini.",
      downgradeReason: "not-eligible",
      asyncOperation: {
        status: "accepted",
        providerOperationId: "interaction-provider-op-1",
      },
    });
    mocks.createAsyncOperation.mockResolvedValue("async-op-row-1");
  });

  it("persists the typed provider handle, dispatch audit, and exact downgrade reason", async () => {
    const result = await routeAndCall(
      [{ role: "user", content: "Research this topic." }],
      "You research.",
      "internal",
      {
        taskType: "research",
        interactionMode: "background",
        threadId: "thread-1",
        maxDurationMs: 60_000,
        persistDecision: false,
      },
    );

    expect(mocks.createAsyncOperation).toHaveBeenCalledWith({
      providerId: "gemini",
      modelId: "model-under-test",
      operationId: "interaction-provider-op-1",
      contractFamily: "background.research",
      requestContext: { taskType: "research", sensitivity: "internal", messages: 1 },
      threadId: "thread-1",
      maxDurationMs: 60_000,
    });
    expect(mocks.logTokenUsage).toHaveBeenCalledWith({
      traceId: expect.any(String),
      agentId: "unknown",
      providerId: "gemini",
      contextKey: "thread-1",
      inputTokens: 0,
      outputTokens: 0,
      inferenceMs: 25,
    });
    expect(result).toMatchObject({
      asyncOperationId: "async-op-row-1",
      downgraded: true,
      downgradeMessage: "Preferred model is ineligible; using Gemini.",
      downgradeReason: "not-eligible",
    });
  });
});
