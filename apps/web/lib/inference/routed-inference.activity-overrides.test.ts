import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityContract } from "@/lib/routing/activity-contract";
import {
  ACTIVITY_HARNESS_CONFIDENCE_OVERRIDE_ACTION,
  activityHarnessProposalParameters,
} from "@/lib/routing/activity-harness-approval-source";
import { readRehydrationTokenMap } from "@/lib/govern/data/rehydration-token-vault";

const mocks = vi.hoisted(() => ({
  routeEndpointV2: vi.fn(),
  callWithFallbackChain: vi.fn(),
  loadEndpointManifests: vi.fn(),
  loadPolicyRules: vi.fn(),
  loadOverrides: vi.fn(),
  invalidateRoutingLoaderCache: vi.fn(),
  persistRouteDecision: vi.fn(),
  updateProviderSuitabilityReceipt: vi.fn(),
  inferContract: vi.fn(),
  getLocalOnlyInference: vi.fn(),
  resolveDispatchPosture: vi.fn(),
  logTokenUsage: vi.fn(),
  agentActionProposalFindMany: vi.fn(),
  loadProviderSuitabilitySourceContext: vi.fn(),
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
  invalidateRoutingLoaderCache: mocks.invalidateRoutingLoaderCache,
  persistRouteDecision: mocks.persistRouteDecision,
  // Mirror the real gating so the persistDecision:false test observes the
  // same contract the production helper enforces (BI-F4D3B9E9(c)).
  persistFailedRouteDecision: (
    decision: unknown,
    options?: { persistDecision?: boolean },
  ) => {
    if (options?.persistDecision === false) return;
    void mocks.persistRouteDecision(decision, options);
  },
  updateProviderSuitabilityReceipt: mocks.updateProviderSuitabilityReceipt,
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

vi.mock("@/lib/routing/provider-suitability/provider-onboarding-data", () => ({
  loadProviderSuitabilitySourceContext: mocks.loadProviderSuitabilitySourceContext,
}));

import { routeAndCall } from "./routed-inference";
import { previewRoute } from "./routed-inference";
import { ProviderReconciliationRequiredError } from "./provider-reconciliation";

describe("routeAndCall activity harness overrides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLocalOnlyInference.mockResolvedValue(false);
    mocks.persistRouteDecision.mockResolvedValue("route-log-1");
    mocks.updateProviderSuitabilityReceipt.mockResolvedValue(undefined);
    mocks.resolveDispatchPosture.mockResolvedValue(null);
    mocks.inferContract.mockImplementation(async (
      taskType: string,
      messages: Array<{ role: string; content: unknown }>,
      tools?: Array<Record<string, unknown>>,
      _outputSchema?: Record<string, unknown>,
      routeContext?: Record<string, unknown>,
    ) => ({
      contractId: "contract-1",
      contractFamily: "sync.test",
      taskType,
      modality: { input: ["text"], output: ["text"] },
      interactionMode: routeContext?.interactionMode ?? "sync",
      sensitivity: routeContext?.sensitivity ?? "internal",
      requiresTools: (tools?.length ?? 0) > 0,
      requiresStrictSchema: false,
      requiresStreaming: false,
      estimatedInputTokens: messages.length * 1000,
      estimatedOutputTokens: 400,
      reasoningDepth: "low",
      budgetClass: routeContext?.budgetClass ?? "minimize_cost",
      ...(routeContext?.allowedProviders !== undefined
        ? { allowedProviders: routeContext.allowedProviders }
        : {}),
      ...(routeContext?.deniedProviders !== undefined
        ? { deniedProviders: routeContext.deniedProviders }
        : {}),
      ...(routeContext?.residencyPolicy !== undefined
        ? { residencyPolicy: routeContext.residencyPolicy }
        : {}),
    }));
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
      inferenceMs: 1234,
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
    mocks.loadProviderSuitabilitySourceContext.mockResolvedValue({
      businessProfile: {
        organizationId: "org-1",
        archetypeId: "software-platform",
        archetypeCategory: "software-platform",
        operatesIn: ["us"],
        sellsTo: [],
        employsIn: [],
        dataResidency: [],
        riskPosture: "balanced",
      },
      handlesCardPayments: false,
      regulationResults: [],
      connections: [{
        label: "OpenAI business",
        status: "active",
        facts: {
          providerId: "openai",
          catalogProviderId: "openai",
          category: "direct",
          jurisdictions: ["us"],
          externalEgress: "provider-cloud",
          supportsZdr: true,
          supportsNoTraining: true,
          supportsRegionalRouting: false,
          supportedRegions: [],
          regionalEndpoints: [],
          providerConnectionId: "connection-openai-business",
          executionChannel: "direct-api",
          accountClass: "business-team",
          commercialBasis: "usage-metered",
          authMethod: "api-key",
          contractEvidence: {},
          entitlements: { noTraining: true },
          evidenceStatus: "operator-attested",
          lastReviewedAt: "2026-07-01T00:00:00.000Z",
        },
      }],
    });
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
    // BI-105E8A1E: the adapter's measured latency must reach the metering row so
    // the `compute` cost model can price local inference; it was dropped before.
    expect(mocks.logTokenUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inferenceMs: 1234 }),
    );
  });

  it("rebuilds the route once after provider model reconciliation", async () => {
    mocks.callWithFallbackChain
      .mockRejectedValueOnce(new ProviderReconciliationRequiredError(["openai"], []))
      .mockResolvedValueOnce({
        providerId: "openai",
        modelId: "gpt-4o-mini",
        content: "recovered",
        toolCalls: [],
        tokenUsage: { inputTokens: 12, outputTokens: 4 },
        inferenceMs: 12,
        downgraded: false,
        downgradeMessage: null,
      });

    const result = await routeAndCall(
      [{ role: "user", content: "Continue" }],
      "You help.",
      "internal",
      { taskType: "conversation", persistDecision: false },
    );

    expect(result.content).toBe("recovered");
    expect(mocks.invalidateRoutingLoaderCache).toHaveBeenCalledTimes(1);
    expect(mocks.loadEndpointManifests).toHaveBeenCalledTimes(2);
    expect(mocks.callWithFallbackChain).toHaveBeenCalledTimes(2);
  });

  it("does not loop when the rebuilt route also requests reconciliation", async () => {
    mocks.callWithFallbackChain.mockRejectedValue(
      new ProviderReconciliationRequiredError(["openai"], []),
    );

    await expect(routeAndCall(
      [{ role: "user", content: "Continue" }],
      "You help.",
      "internal",
      { taskType: "conversation", persistDecision: false },
    )).rejects.toBeInstanceOf(ProviderReconciliationRequiredError);

    expect(mocks.callWithFallbackChain).toHaveBeenCalledTimes(2);
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

  it("passes the same provider and model preferences to preview and live routing", async () => {
    const options = {
      taskType: "summarization",
      preferredProviderId: "openai",
      preferredModelId: "gpt-4o-mini",
      persistDecision: false,
    };

    await previewRoute(
      [{ role: "user", content: "Summarize this transcript." }],
      "internal",
      options,
    );
    const previewRoutingOptions = mocks.routeEndpointV2.mock.calls.at(-1)?.[4];

    await routeAndCall(
      [{ role: "user", content: "Summarize this transcript." }],
      "You summarize.",
      "internal",
      options,
    );
    const liveRoutingOptions = mocks.routeEndpointV2.mock.calls.at(-1)?.[4];

    expect(previewRoutingOptions).toMatchObject({
      skipRecipe: true,
      preferences: {
        preferredProviderId: "openai",
        preferredModelId: "gpt-4o-mini",
      },
    });
    expect(liveRoutingOptions).toMatchObject({
      preferences: previewRoutingOptions.preferences,
    });
  });

  it("binds the compiled policy to routeEndpointV2 and emits an account-scoped receipt", async () => {
    const result = await routeAndCall(
      [{ role: "user", content: "Summarize this customer update." }],
      "You summarize.",
      "internal",
      {
        taskType: "summarization",
        activityContract: makeActivity(),
        persistDecision: false,
      },
    );

    expect(mocks.routeEndpointV2).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        allowedProviders: ["openai"],
        deniedProviders: [],
      }),
      [],
      [],
      expect.any(Object),
    );
    expect(result.routeDecision.providerSuitabilityReceipt).toMatchObject({
      schemaVersion: "provider-suitability-route-receipt/v1",
      executionChannel: "direct-api",
      accountClass: "business-team",
      selectedProviderId: "openai",
    });
    expect(JSON.stringify(result.routeDecision.providerSuitabilityReceipt)).not.toContain("customer update");
  });

  it("screens restricted prompt content before route selection and narrows external dispatch to local-only", async () => {
    const result = await routeAndCall(
      [{ role: "user", content: "Summarize employee salary and disciplinary notes for Jane." }],
      "You summarize employee records.",
      "internal",
      {
        taskType: "summarization",
        persistDecision: false,
      },
    );

    expect(mocks.inferContract).toHaveBeenCalledWith(
      "summarization",
      expect.any(Array),
      undefined,
      undefined,
      expect.objectContaining({
        sensitivity: "restricted",
        residencyPolicy: "local_only",
      }),
    );
    expect(mocks.routeEndpointV2).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        sensitivity: "restricted",
        residencyPolicy: "local_only",
      }),
      [],
      [],
      expect.any(Object),
    );
    expect(result.routeDecision.inferenceDataScreenReceipt).toMatchObject({
      schemaVersion: "inference-data-screen/v1",
      policyEffect: "deny",
      routeEffect: "local-only",
      classifiedDataClasses: expect.arrayContaining(["employee-records"]),
      rawPayloadStored: false,
    });
    expect(JSON.stringify(result.routeDecision.inferenceDataScreenReceipt)).not.toContain("Jane");
    expect(mocks.callWithFallbackChain).toHaveBeenCalledWith(
      expect.objectContaining({
        inferenceDataScreenReceipt: expect.objectContaining({
          routeEffect: "local-only",
        }),
      }),
      expect.any(Array),
      expect.any(String),
      undefined,
      expect.any(Object),
      undefined,
      undefined,
      expect.any(Object),
      expect.objectContaining({
        messages: expect.any(Array),
        systemPrompt: expect.any(String),
      }),
    );
  });

  it("never exposes replaceable sensitive canaries to contract inference or provider dispatch", async () => {
    const rawEmail = "ada@example.com";
    const result = await routeAndCall(
      [{ role: "user", content: `Draft a neutral greeting for ${rawEmail}.` }],
      "Draft a greeting without private identifiers.",
      "internal",
      {
        taskType: "draft",
        sensitiveDetailUse: "replaceable",
        responseRehydration: {
          expectedActor: {
            principalId: "PRN-user",
            actingHumanUserId: "user-1",
            actingAgentId: null,
            delegationGrantId: null,
          },
          purpose: "coworker-assistance",
          surface: "private-customer",
          subject: { kind: "account", id: "account-1" },
        },
        persistDecision: false,
      },
    );

    const inferPayload = JSON.stringify(mocks.inferContract.mock.calls.at(-1));
    const dispatchPayload = JSON.stringify(mocks.callWithFallbackChain.mock.calls.at(-1));
    expect(inferPayload).not.toContain(rawEmail);
    expect(dispatchPayload).not.toContain(rawEmail);
    expect(inferPayload).toContain("[DPF_TOKEN_");
    expect(dispatchPayload).toContain("[DPF_TOKEN_");
    expect(result.routeDecision.inferenceDataScreenReceipt).toMatchObject({
      transformation: "tokenized",
      routeEffect: "allow",
      classifiedDataClasses: expect.arrayContaining(["customer-records"]),
      rawPayloadStored: false,
    });
    expect(result.rehydrationHandle).toMatch(/^rehydration_/);
    const stored = readRehydrationTokenMap(result.rehydrationHandle ?? "");
    expect(stored.status).toBe("available");
    if (stored.status === "available") {
      expect([...stored.tokens.values()][0]?.bindings[0]).toMatchObject({
        purpose: "coworker-assistance",
        surface: "private-customer",
        subject: { kind: "account", id: "account-1" },
      });
    }
  });

  it("intersects screen allowlists with provider suitability and unions denials before routing", async () => {
    mocks.loadProviderSuitabilitySourceContext.mockResolvedValueOnce(localAndCloudSuitabilitySource());

    await routeAndCall(
      [{ role: "user", content: "Customer email is alex@example.com; summarize the selected records." }],
      "You summarize governed customer records.",
      "internal",
      {
        taskType: "summarization",
        activityContract: makeActivity({
          activityClass: "code-edit",
          workloadClassHints: ["source-code"],
        }),
        allowedProviders: ["openai", "local"],
        deniedProviders: ["operator-denied"],
        persistDecision: false,
      },
    );

    expect(mocks.routeEndpointV2).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        sensitivity: "confidential",
        allowedProviders: ["local"],
        deniedProviders: ["openai", "operator-denied"],
        residencyPolicy: "local_only",
      }),
      [],
      [],
      expect.any(Object),
    );
  });

  it("explains a screen-blocked route without exposing raw payload values", async () => {
    mocks.routeEndpointV2.mockResolvedValueOnce({
      selectedEndpoint: null,
      selectedModelId: null,
      reason: "Residency policy 'local_only' requires a local provider",
      fitnessScore: 0,
      fallbackChain: [],
      candidates: [{
        endpointId: "openai:gpt-4o-mini",
        providerId: "openai",
        modelId: "gpt-4o-mini",
        fitnessScore: 0,
        estimatedCostUSD: null,
        estimatedLatencyMs: 100,
        policyRulesApplied: ["inference-dispatch"],
        excluded: true,
        excludedReason: "Residency policy 'local_only' requires a local provider",
      }],
      excludedCount: 1,
      excludedReasons: ["Residency policy 'local_only' requires a local provider"],
      policyRulesApplied: ["inference-dispatch"],
      taskType: "summarization",
      sensitivity: "confidential",
      timestamp: new Date("2026-06-28T21:00:00.000Z"),
    });

    let thrown: unknown;
    try {
      await routeAndCall(
        [{ role: "user", content: "Customer email is alex@example.com; summarize next action." }],
        "You summarize customer records.",
        "internal",
        {
          taskType: "summarization",
          persistDecision: false,
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toContain(
      "Sensitive-data routing blocked cloud dispatch for task 'summarization' because the payload includes customer records.",
    );
    expect(message).toContain("Use an eligible local/private model or an approved provider account");
    expect(message).toContain("Masking/tokenization is not available for this route yet");
    expect(message).not.toContain("alex@example.com");
    expect(mocks.callWithFallbackChain).not.toHaveBeenCalled();
  });

  it("applies the same pre-dispatch data screen to preview routing", async () => {
    const preview = await previewRoute(
      [{ role: "user", content: "Customer email is alex@example.com; summarize next action." }],
      "internal",
      {
        taskType: "summarization",
        screeningSystemPrompt: "You summarize customer records.",
      },
    );

    expect(mocks.routeEndpointV2).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        sensitivity: "confidential",
        residencyPolicy: "local_only",
      }),
      [],
      [],
      expect.objectContaining({ skipRecipe: true }),
    );
    expect(preview.decision.inferenceDataScreenReceipt).toMatchObject({
      routeEffect: "local-only",
      classifiedDataClasses: expect.arrayContaining(["customer-records"]),
      rawPayloadStored: false,
    });
    expect(JSON.stringify(preview.decision.inferenceDataScreenReceipt)).not.toContain("alex@example.com");
  });

  // ── BI-F4D3B9E9(c): the no-eligible-endpoints throw must persist the failed
  //    RouteDecision (with its per-endpoint excludedTrace) instead of dropping
  //    it — the live outage threw here on every turn and left no audit row,
  //    reducing diagnosis to a bare excluded-count in an error string. ────────
  it("persists the failed route decision before throwing NoEligibleEndpointsError", async () => {
    mocks.routeEndpointV2.mockResolvedValue({
      selectedEndpoint: null,
      selectedModelId: null,
      reason: "No eligible endpoints for task type 'conversation' with sensitivity 'restricted'. 1 endpoint(s) excluded.",
      fitnessScore: 0,
      fallbackChain: [],
      candidates: [
        {
          endpointId: "local:qwen3-coder",
          providerId: "local",
          modelId: "qwen3-coder",
          endpointName: "Qwen3 Coder",
          fitnessScore: 0,
          dimensionScores: {},
          costPerOutputMToken: 0,
          excluded: true,
          excludedReason: "Context window too small: 24576 < 30000",
        },
      ],
      excludedCount: 1,
      excludedReasons: ["local:qwen3-coder: Context window too small: 24576 < 30000"],
      policyRulesApplied: [],
      taskType: "conversation",
      sensitivity: "restricted",
      timestamp: new Date("2026-07-29T00:00:00.000Z"),
      executionPlan: null,
    });

    await expect(
      routeAndCall([{ role: "user", content: "hi" }], "system", "restricted", { taskType: "conversation" }),
    ).rejects.toThrow(/No eligible endpoints/);

    expect(mocks.persistRouteDecision).toHaveBeenCalledTimes(1);
    const [persistedDecision] = mocks.persistRouteDecision.mock.calls[0];
    expect(persistedDecision.selectedEndpoint).toBeNull();
    expect(persistedDecision.candidates[0]).toMatchObject({
      excluded: true,
      excludedReason: expect.stringContaining("Context window too small"),
    });
  });

  it("does not persist the failed decision when persistDecision is disabled", async () => {
    mocks.routeEndpointV2.mockResolvedValue({
      selectedEndpoint: null,
      selectedModelId: null,
      reason: "No eligible endpoints.",
      fitnessScore: 0,
      fallbackChain: [],
      candidates: [],
      excludedCount: 0,
      excludedReasons: [],
      policyRulesApplied: [],
      taskType: "conversation",
      sensitivity: "internal",
      timestamp: new Date("2026-07-29T00:00:00.000Z"),
      executionPlan: null,
    });

    await expect(
      routeAndCall([{ role: "user", content: "hi" }], "system", "internal", {
        taskType: "conversation",
        persistDecision: false,
      }),
    ).rejects.toThrow(/No eligible endpoints/);

    expect(mocks.persistRouteDecision).not.toHaveBeenCalled();
  });
});

function makeActivity(overrides: Partial<ActivityContract> = {}): ActivityContract {
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
    ...overrides,
  };
}

function localAndCloudSuitabilitySource() {
  return {
    businessProfile: {
      organizationId: "org-1",
      archetypeId: "software-platform",
      archetypeCategory: "software-platform",
      operatesIn: ["us"],
      sellsTo: [],
      employsIn: [],
      dataResidency: [],
      riskPosture: "balanced",
    },
    handlesCardPayments: false,
    regulationResults: [],
    connections: [
      {
        label: "Local model",
        status: "active",
        facts: {
          providerId: "local",
          catalogProviderId: "local",
          category: "local",
          jurisdictions: ["us"],
          externalEgress: "none",
          supportsZdr: true,
          supportsNoTraining: true,
          supportsRegionalRouting: false,
          supportedRegions: [],
          regionalEndpoints: [],
          providerConnectionId: "connection-local",
          executionChannel: "local-runtime",
          accountClass: "unknown",
          commercialBasis: "local-compute",
          authMethod: "local",
          contractEvidence: {},
          entitlements: { noTraining: true },
          evidenceStatus: "operator-attested",
          lastReviewedAt: "2026-07-01T00:00:00.000Z",
        },
      },
      {
        label: "OpenAI regular",
        status: "active",
        facts: {
          providerId: "openai",
          catalogProviderId: "openai",
          category: "direct",
          jurisdictions: ["us"],
          externalEgress: "provider-cloud",
          supportsZdr: false,
          supportsNoTraining: false,
          supportsRegionalRouting: false,
          supportedRegions: [],
          regionalEndpoints: [],
          providerConnectionId: "connection-openai-regular",
          executionChannel: "direct-api",
          accountClass: "regular",
          commercialBasis: "usage-metered",
          authMethod: "api-key",
          contractEvidence: {},
          entitlements: {},
          evidenceStatus: "operator-attested",
          lastReviewedAt: "2026-07-01T00:00:00.000Z",
        },
      },
    ],
  };
}
