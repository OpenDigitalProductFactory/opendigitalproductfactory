import { beforeEach, describe, expect, it, vi } from "vitest";
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

// BI-CCF1ACBB: RouteAndCallOptions already carried threadId; this is the site
// that built the fallback-chain attribution without it, so every telemetry row
// landed with threadId NULL and the per-thread cost ledger read zero.
// Scaffold mirrors routed-inference.activity-overrides.test.ts (kept separate
// so that baselined file does not grow).
describe("routeAndCall thread attribution", () => {
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

  it("forwards options.threadId into the fallback-chain attribution", async () => {
    await routeAndCall(
      [{ role: "user", content: "Summarize this transcript." }],
      "You summarize.",
      "internal",
      { taskType: "summarization", budgetClass: "minimize_cost", persistDecision: false, agentId: "agt_1", threadId: "thread-42" },
    );

    expect(mocks.callWithFallbackChain).toHaveBeenCalledTimes(1);
    // callWithFallbackChain(decision, messages, systemPrompt, tools, plan, previousResponseId, mcpSession, attribution)
    expect(mocks.callWithFallbackChain.mock.calls[0]?.[7]).toMatchObject({ agentId: "agt_1", threadId: "thread-42" });
  });

  it("passes threadId as null when the caller does not know the thread", async () => {
    await routeAndCall(
      [{ role: "user", content: "Summarize this transcript." }],
      "You summarize.",
      "internal",
      { taskType: "summarization", budgetClass: "minimize_cost", persistDecision: false },
    );

    expect(mocks.callWithFallbackChain.mock.calls[0]?.[7]).toMatchObject({ threadId: null });
  });
});
