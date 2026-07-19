import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EndpointManifest } from "./types";
import type { RequestContract } from "./request-contract";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";
import { getExclusionReasonV2, routeEndpointV2 } from "./pipeline-v2";

vi.mock("./champion-challenger", () => ({
  selectRecipeWithExploration: vi.fn().mockResolvedValue({
    recipe: null,
    explorationMode: "champion",
  }),
}));

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
    costPerOutputMToken: 10,
    profileSource: "seed",
    profileConfidence: "medium",
    retiredAt: null,
    modelClass: "chat",
    modelFamily: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: {
      ...EMPTY_CAPABILITIES,
      toolUse: true,
      structuredOutput: true,
      streaming: true,
    },
    pricing: { ...EMPTY_PRICING, inputPerMToken: 3, outputPerMToken: 15 },
    supportedParameters: [],
    deprecationDate: null,
    metadataSource: "inferred",
    metadataConfidence: "low",
    perRequestLimits: null,
    ...overrides,
  };
}

function makeContract(overrides: Partial<RequestContract> = {}): RequestContract {
  return {
    contractId: "provider-policy-test-contract",
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

const cheapModel = makeEndpoint({
  id: "ep-cheap",
  providerId: "openai",
  modelId: "gpt-4o-mini",
  name: "GPT-4o Mini",
  reasoning: 55,
  costPerOutputMToken: 0.6,
  pricing: { ...EMPTY_PRICING, inputPerMToken: 0.15, outputPerMToken: 0.6 },
});

const qualityModel = makeEndpoint({
  id: "ep-quality",
  providerId: "anthropic",
  modelId: "claude-sonnet-4-5",
  name: "Claude Sonnet",
  reasoning: 90,
  costPerOutputMToken: 15,
});

beforeEach(async () => {
  const { _resetAllTracking } = await import("./rate-tracker");
  _resetAllTracking();
});

describe("provider policy hard filters", () => {
  it("excludes providers outside an explicit allowlist", () => {
    const contract = makeContract({ allowedProviders: ["anthropic"] });
    expect(getExclusionReasonV2(cheapModel, contract)).toContain("allowlist");
    expect(getExclusionReasonV2(qualityModel, contract)).toBeNull();
  });

  it("lets an explicit denylist win when a provider is also allowed", () => {
    const contract = makeContract({
      allowedProviders: ["openai"],
      deniedProviders: ["openai"],
    });
    expect(getExclusionReasonV2(cheapModel, contract)).toContain("denylist");
  });

  it("treats an explicit empty allowlist as deny all", () => {
    const contract = makeContract({ allowedProviders: [] });
    expect(getExclusionReasonV2(qualityModel, contract)).toContain("allowlist");
  });

  it("enforces an allowlist before cost ranking", async () => {
    const decision = await routeEndpointV2(
      [cheapModel, qualityModel],
      makeContract({
        budgetClass: "minimize_cost",
        allowedProviders: ["anthropic"],
      }),
      [],
      [],
    );

    expect(decision.selectedEndpoint).toBe("ep-quality");
    expect(decision.candidates.find((candidate) => candidate.endpointId === "ep-cheap"))
      .toMatchObject({ excluded: true, excludedReason: expect.stringContaining("allowlist") });
  });

  it("enforces a denylist even when the denied provider is cheapest", async () => {
    const decision = await routeEndpointV2(
      [cheapModel, qualityModel],
      makeContract({
        budgetClass: "minimize_cost",
        deniedProviders: ["openai"],
      }),
      [],
      [],
    );

    expect(decision.selectedEndpoint).toBe("ep-quality");
    expect(decision.candidates.find((candidate) => candidate.endpointId === "ep-cheap"))
      .toMatchObject({ excluded: true, excludedReason: expect.stringContaining("denylist") });
  });

  it("returns no route when every provider is outside the effective allow set", async () => {
    const decision = await routeEndpointV2(
      [cheapModel, qualityModel],
      makeContract({ allowedProviders: [] }),
      [],
      [],
    );

    expect(decision.selectedEndpoint).toBeNull();
    expect(decision.selectedModelId).toBeNull();
    expect(decision.excludedCount).toBe(2);
  });

  it("never puts a disallowed provider back into the fallback chain", async () => {
    const secondAnthropic = makeEndpoint({
      id: "ep-anthropic-2",
      providerId: "anthropic",
      modelId: "claude-haiku",
    });
    const decision = await routeEndpointV2(
      [cheapModel, qualityModel, secondAnthropic],
      makeContract({ allowedProviders: ["anthropic"] }),
      [],
      [],
    );

    expect(decision.fallbackChain).not.toContain("ep-cheap");
    expect(decision.fallbackChain).toEqual(
      expect.arrayContaining(["ep-quality", "ep-anthropic-2"]),
    );
  });

  it("does not let a pinned override bypass a provider denylist", async () => {
    const decision = await routeEndpointV2(
      [cheapModel, qualityModel],
      makeContract({ deniedProviders: ["openai"] }),
      [],
      [{
        endpointId: "ep-cheap",
        taskType: "reasoning",
        pinned: true,
        blocked: false,
      }],
    );

    expect(decision.selectedEndpoint).toBe("ep-quality");
    expect(decision.candidates.find((candidate) => candidate.endpointId === "ep-cheap"))
      .toMatchObject({ excluded: true, excludedReason: expect.stringContaining("denylist") });
  });
});
