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
  admitDurableAsyncOperation: vi.fn(),
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

vi.mock("@/lib/inference/async-operation-runtime", () => ({
  admitPrismaDurableAsyncOperation: mocks.admitDurableAsyncOperation,
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
    mocks.admitDurableAsyncOperation.mockResolvedValue({
      operationId: "async-op-row-1",
      replayed: false,
    });
  });

  const durableAuthority = {
    request: {
      kind: "task-run" as const,
      taskRunId: "TR-BACKGROUND-1",
      requestKey: "research:background:1",
      requestDigest: "d".repeat(64),
    },
    actor: {
      userId: "user-1",
      agentId: null,
      principalId: null,
      isSuperuser: true,
    },
  };

  it("admits the platform operation before provider POST and returns its durable identity", async () => {
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
        durableAsyncOperation: durableAuthority,
      },
    );

    expect(mocks.admitDurableAsyncOperation).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "gemini",
      modelId: "model-under-test",
      contractFamily: "background.research",
      screenedRequestDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      screenedRequestContext: expect.objectContaining({
        version: 1,
        messages: [{ role: "user", content: "Research this topic." }],
        systemPrompt: "You research.",
        executionPlan: expect.objectContaining({ executionAdapter: "async" }),
      }),
      request: durableAuthority.request,
      actor: durableAuthority.actor,
    }));
    expect(mocks.callWithFallbackChain).not.toHaveBeenCalled();
    expect(mocks.logTokenUsage).toHaveBeenCalledWith({
      traceId: expect.any(String),
      agentId: "unknown",
      providerId: "gemini",
      contextKey: "thread-1",
      inputTokens: 0,
      outputTokens: 0,
      inferenceMs: 0,
    });
    expect(result).toMatchObject({
      asyncOperationId: "async-op-row-1",
      downgraded: false,
      downgradeMessage: null,
      downgradeReason: null,
    });
  });

  it("persists the durable admission before audit settlement and waits before returning accepted", async () => {
    let releaseAudit!: () => void;
    let outwardSettled = false;
    mocks.logTokenUsage.mockReturnValueOnce(new Promise<void>((resolve) => {
      releaseAudit = resolve;
    }));

    const pending = routeAndCall(
      [{ role: "user", content: "Research this topic." }],
      "You research.",
      "internal",
      {
        taskType: "research",
        interactionMode: "background",
        threadId: "thread-1",
        maxDurationMs: 60_000,
        persistDecision: false,
        durableAsyncOperation: durableAuthority,
      },
    ).finally(() => {
      outwardSettled = true;
    });

    await vi.waitFor(() => expect(mocks.logTokenUsage).toHaveBeenCalledOnce());
    expect(mocks.admitDurableAsyncOperation).toHaveBeenCalledOnce();
    expect(mocks.admitDurableAsyncOperation.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.logTokenUsage.mock.invocationCallOrder[0]);
    expect(outwardSettled).toBe(false);

    releaseAudit();
    await expect(pending).resolves.toMatchObject({ asyncOperationId: "async-op-row-1" });
  });

  it("keeps the durable operation but refuses outward acceptance when dispatch audit fails", async () => {
    mocks.logTokenUsage.mockRejectedValueOnce(new Error("token audit unavailable"));

    const pending = routeAndCall(
      [{ role: "user", content: "Research this topic." }],
      "You research.",
      "internal",
      {
        taskType: "research",
        interactionMode: "background",
        threadId: "thread-1",
        maxDurationMs: 60_000,
        persistDecision: false,
        durableAsyncOperation: durableAuthority,
      },
    );

    await expect(pending).rejects.toThrow("token audit unavailable");
    expect(mocks.admitDurableAsyncOperation).toHaveBeenCalledOnce();
    expect(mocks.admitDurableAsyncOperation.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.logTokenUsage.mock.invocationCallOrder[0]);
  });

  it("fails closed before provider dispatch when an async route lacks durable authority", async () => {
    await expect(routeAndCall(
      [{ role: "user", content: "Research this topic." }],
      "You research.",
      "internal",
      {
        taskType: "research",
        interactionMode: "background",
        persistDecision: false,
      },
    )).rejects.toThrow("ASYNC_OPERATION_AUTHORITY_REQUIRED");

    expect(mocks.admitDurableAsyncOperation).not.toHaveBeenCalled();
    expect(mocks.callWithFallbackChain).not.toHaveBeenCalled();
  });

  it("refuses an unsupported async protocol before durable admission", async () => {
    const selected = await mocks.routeEndpointV2();
    mocks.routeEndpointV2.mockResolvedValueOnce({
      ...selected,
      selectedEndpoint: "other:model-under-test",
      selectedModelId: "model-under-test",
      fallbackChain: ["other:model-under-test"],
      executionPlan: {
        ...selected.executionPlan,
        providerId: "other",
        executionAdapter: "async",
      },
    });

    await expect(routeAndCall(
      [{ role: "user", content: "Research this topic." }],
      "You research.",
      "internal",
      {
        taskType: "research",
        interactionMode: "background",
        persistDecision: false,
        durableAsyncOperation: durableAuthority,
      },
    )).rejects.toThrow("ASYNC_OPERATION_PROTOCOL_UNSUPPORTED");

    expect(mocks.admitDurableAsyncOperation).not.toHaveBeenCalled();
    expect(mocks.callWithFallbackChain).not.toHaveBeenCalled();
  });

  it("refuses an async execution plan outside background mode before provider dispatch", async () => {
    await expect(routeAndCall(
      [{ role: "user", content: "Research this topic." }],
      "You research.",
      "internal",
      {
        taskType: "research",
        interactionMode: "sync",
        persistDecision: false,
      },
    )).rejects.toThrow("ASYNC_OPERATION_BACKGROUND_REQUIRED");

    expect(mocks.admitDurableAsyncOperation).not.toHaveBeenCalled();
    expect(mocks.callWithFallbackChain).not.toHaveBeenCalled();
  });

  it("preserves background non-async dispatch behavior", async () => {
    mocks.routeEndpointV2.mockResolvedValueOnce({
      ...await mocks.routeEndpointV2(),
      executionPlan: {
        ...(await mocks.routeEndpointV2()).executionPlan,
        executionAdapter: "chat",
      },
    });
    mocks.callWithFallbackChain.mockResolvedValueOnce({
      providerId: "gemini",
      modelId: "model-under-test",
      content: "Done synchronously.",
      toolCalls: [],
      tokenUsage: { inputTokens: 2, outputTokens: 3 },
      inferenceMs: 25,
      downgraded: false,
      downgradeMessage: null,
      downgradeReason: null,
    });

    await expect(routeAndCall(
      [{ role: "user", content: "Research this topic." }],
      "You research.",
      "internal",
      {
        taskType: "research",
        interactionMode: "background",
        persistDecision: false,
      },
    )).resolves.toMatchObject({ content: "Done synchronously." });

    expect(mocks.callWithFallbackChain).toHaveBeenCalledOnce();
    expect(mocks.admitDurableAsyncOperation).not.toHaveBeenCalled();
  });

  it("never lets a durable-authority request fall through to direct background dispatch", async () => {
    const selected = await mocks.routeEndpointV2();
    mocks.routeEndpointV2.mockResolvedValueOnce({
      ...selected,
      executionPlan: {
        ...selected.executionPlan,
        executionAdapter: "chat",
      },
    });

    await expect(routeAndCall(
      [{ role: "user", content: "Research this topic." }],
      "You research.",
      "internal",
      {
        taskType: "research",
        interactionMode: "background",
        persistDecision: false,
        durableAsyncOperation: durableAuthority,
      },
    )).rejects.toThrow("ASYNC_OPERATION_EXECUTION_PLAN_REQUIRED");

    expect(mocks.callWithFallbackChain).not.toHaveBeenCalled();
    expect(mocks.admitDurableAsyncOperation).not.toHaveBeenCalled();
  });
});
