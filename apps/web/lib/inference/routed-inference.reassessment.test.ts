import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadEndpointManifests: vi.fn(), loadPolicyRules: vi.fn(), loadOverrides: vi.fn(),
  routeEndpointV2: vi.fn(), inferContract: vi.fn(), resolveLocalRoutingRuntime: vi.fn(),
  resolveDispatchPosture: vi.fn(), getLocalOnlyInference: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/routing/loader", () => ({ ...mocks, invalidateRoutingLoaderCache: vi.fn() }));
vi.mock("@/lib/routing/pipeline-v2", () => ({ routeEndpointV2: mocks.routeEndpointV2 }));
vi.mock("@/lib/routing/fallback", () => ({ callWithFallbackChain: vi.fn() }));
vi.mock("./routed-token-usage", () => ({}));
vi.mock("./async-operation-routed-admission", () => ({}));
vi.mock("@/lib/routing/request-contract", () => ({ inferContract: mocks.inferContract }));
vi.mock("@/lib/inference/local-model-context-reconcile", () => ({ resolveLocalRoutingRuntime: mocks.resolveLocalRoutingRuntime }));
vi.mock("@/lib/golden-triangle/dispatch", () => ({ resolveDispatchPosture: mocks.resolveDispatchPosture }));
vi.mock("@/lib/inference/local-only", () => ({ getLocalOnlyInference: mocks.getLocalOnlyInference, getLocalOnlyInferenceFresh: mocks.getLocalOnlyInference }));
vi.mock("@/lib/inference/data-screening/routed-screening", () => ({
  createRoutedInferenceScreen: (input: Record<string, unknown>) => ({ screenInput: input,
    screen: { routeContext: input.routeContext, receipt: {} } }),
}));
import { prepareReassessmentRoute } from "./routed-inference";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "../routing/model-card-types";
import type { EndpointManifest } from "../routing/types";
import type { RequestContract } from "../routing/request-contract";

const http = { id: "http:model", providerId: "anthropic", providerConnectionId: "provider-default-anthropic",
  providerConnectionVersion: "a".repeat(64), accountAuthMethod: "api_key", executionChannel: "direct-api", modelId: "model" };
const cli = { ...http, id: "cli:model", providerId: "anthropic-sub", providerConnectionId: "provider-default-anthropic-sub",
  accountAuthMethod: "oauth2_authorization_code", executionChannel: "subscription-cli" };
const plan = { ...http, recipeId: "recipe-1", contractFamily: "sync.reasoning", executionAdapter: "chat", maxTokens: 8192,
  providerSettings: {}, toolPolicy: {}, responsePolicy: {} };
describe("restricted review routing qualification", () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.getLocalOnlyInference.mockResolvedValue(false); mocks.resolveDispatchPosture.mockResolvedValue(null);
    mocks.loadEndpointManifests.mockResolvedValue([cli, http]); mocks.loadPolicyRules.mockResolvedValue([]); mocks.loadOverrides.mockResolvedValue([]);
    mocks.inferContract.mockResolvedValue({ contractId: "contract", contractFamily: "sync.reasoning", sensitivity: "development",
      residencyPolicy: "approved_cloud", requiresTools: true, reasoningDepth: "high", minContextTokens: 30000 });
    mocks.routeEndpointV2.mockResolvedValue({ selectedEndpoint: http.id, selectedModelId: "model", executionPlan: plan,
      policyRulesApplied: [], fallbackChain: [http.id], candidates: [] });
  });
  it("hard fences existing HTTP accounts before normal ranking and performs no runtime read", async () => {
    const result = await prepareReassessmentRoute([], "review", "development", { preferredProviderId: cli.providerId });
    expect(result.contract.allowedProviderConnectionIds).toEqual([http.providerConnectionId]);
    const contract = mocks.routeEndpointV2.mock.calls[0][1];
    expect(contract).toMatchObject({ minContextTokens: 30000, residencyPolicy: "approved_cloud", sensitivity: "development",
      allowedProviderConnectionIds: [http.providerConnectionId] });
    expect(mocks.routeEndpointV2.mock.calls[0][4].preferences.preferredProviderId).toBe(cli.providerId);
    expect(mocks.loadEndpointManifests.mock.calls[0]).toHaveLength(1);
    expect(mocks.resolveLocalRoutingRuntime).not.toHaveBeenCalled();
    expect(result.executionPlan).toEqual(plan);
  });
  it("intersects normal account policy so a preferred connected account cannot widen it", async () => {
    mocks.inferContract.mockResolvedValue({ sensitivity: "confidential", allowedProviderConnectionIds: ["other-account"] });
    await prepareReassessmentRoute([], "review", "confidential");
    expect(mocks.routeEndpointV2.mock.calls[0][1].allowedProviderConnectionIds).toEqual([]);
  });
  it("refuses before routing if no existing restricted account can be bound", async () => {
    mocks.loadEndpointManifests.mockResolvedValue([cli, { ...http, providerConnectionVersion: undefined }]);
    await expect(prepareReassessmentRoute([], "review", "development")).rejects.toThrow(/restricted|composition/i);
    expect(mocks.routeEndpointV2).not.toHaveBeenCalled();
  });
  it("cannot preference an excluded CLI account back through the actual V2 hard filter", async () => {
    const { routeEndpointV2 } = await vi.importActual<typeof import("../routing/pipeline-v2")>("../routing/pipeline-v2");
    const manifest = (identity: typeof http): EndpointManifest => ({
      ...identity, name: identity.id, endpointType: "chat", status: "active", providerTier: "user_configured",
      sensitivityClearance: ["development"], supportsToolUse: true, supportsStructuredOutput: true, supportsStreaming: true,
      maxContextTokens: 200000, maxOutputTokens: 8192, modelRestrictions: [], reasoning: 90, codegen: 90, toolFidelity: 90,
      instructionFollowing: 90, structuredOutput: 90, conversational: 90, contextRetention: 90, customScores: {}, avgLatencyMs: 1,
      recentFailureRate: 0, costPerOutputMToken: 1, profileSource: "evaluated", profileConfidence: "high", retiredAt: null,
      modelClass: "chat", modelFamily: null, inputModalities: ["text"], outputModalities: ["text"],
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true }, pricing: { ...EMPTY_PRICING, inputPerMToken: 1, outputPerMToken: 1 },
      supportedParameters: [], deprecationDate: null, metadataSource: "inferred", metadataConfidence: "high", perRequestLimits: null,
    });
    const contract: RequestContract = { contractId: "request", contractFamily: "sync.reasoning", taskType: "reasoning",
      sensitivity: "development", modality: { input: ["text"], output: ["text"] }, interactionMode: "sync", requiresTools: true,
      requiresStrictSchema: false, requiresStreaming: false, estimatedInputTokens: 1000, estimatedOutputTokens: 500,
      reasoningDepth: "high", budgetClass: "balanced", allowedProviderConnectionIds: [http.providerConnectionId] };
    const decision = await routeEndpointV2([manifest(cli), manifest(http)], contract, [], [], {
      skipRecipe: true, capacityByProvider: new Map(), preferences: { preferredProviderId: cli.providerId },
    });
    expect(decision.selectedEndpoint).toBe(http.id);
    expect(decision.candidates.find(candidate => candidate.endpointId === cli.id)?.excludedReason).toContain("account");
  });
});
