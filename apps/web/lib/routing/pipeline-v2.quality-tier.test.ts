/**
 * BI-654EE2E9: quality-tier preference among free endpoints.
 *
 * When every provider is free, cost-per-success ranking collapses to successProb
 * and never reads qualityTier — so an "adequate" local model could out-rank a
 * "frontier" cloud one. pipeline-v2 Stage 5b now applies a quality-tier
 * preference among free endpoints, under the existing provider-tier key.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import type { EndpointManifest } from "./types";
import type { RequestContract } from "./request-contract";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";
import { routeEndpointV2 } from "./pipeline-v2";

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
    metadataSource: "inferred",
    metadataConfidence: "low",
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

const freeFrontierCloud = makeEndpoint({
  id: "ep-cloud-frontier",
  providerId: "anthropic-sub",
  modelId: "claude-opus-4",
  name: "Claude (subscription)",
  providerTier: "user_configured",
  qualityTier: "frontier",
  sensitivityClearance: ["public", "internal"],
  reasoning: 40, codegen: 40, toolFidelity: 40, instructionFollowing: 40,
  structuredOutput: 40, conversational: 40, contextRetention: 40,
  costPerOutputMToken: 0,
  pricing: { ...EMPTY_PRICING, inputPerMToken: 0, outputPerMToken: 0 },
});

const freeAdequateLocalBundled = makeEndpoint({
  id: "ep-local-adequate",
  providerId: "local",
  modelId: "qwen3",
  name: "Qwen (local)",
  providerTier: "bundled",
  qualityTier: "adequate",
  sensitivityClearance: ["public", "internal", "confidential", "restricted"],
  reasoning: 65, codegen: 65, toolFidelity: 65, instructionFollowing: 65,
  structuredOutput: 65, conversational: 65, contextRetention: 65,
  costPerOutputMToken: 0,
  pricing: { ...EMPTY_PRICING, inputPerMToken: 0, outputPerMToken: 0 },
});

beforeEach(async () => {
  const { _resetAllTracking } = await import("./rate-tracker");
  _resetAllTracking();
});

describe("quality-tier preference among free endpoints (BI-654EE2E9)", () => {
  it("routes a free frontier cloud endpoint ahead of a free adequate local one", async () => {
    const result = await routeEndpointV2(
      [freeAdequateLocalBundled, freeFrontierCloud],
      makeContract(),
      [],
      [],
      { capacityByProvider: new Map() },
    );
    expect(result.selectedEndpoint).toBe("ep-cloud-frontier");
  });

  it("prefers the higher quality tier even when both share a provider tier (local misclassified user_configured)", async () => {
    const misclassifiedLocal = makeEndpoint({
      ...freeAdequateLocalBundled,
      providerTier: "user_configured", // both user_configured — Stage 5b is a no-op
    });
    const result = await routeEndpointV2(
      [misclassifiedLocal, freeFrontierCloud],
      makeContract(),
      [],
      [],
      { capacityByProvider: new Map() },
    );
    expect(result.selectedEndpoint).toBe("ep-cloud-frontier");
  });

  it("does not disturb ranking when a cheaper lower-tier endpoint is genuinely paid", async () => {
    const paidCheapAdequate = makeEndpoint({
      ...freeAdequateLocalBundled,
      id: "ep-paid-adequate",
      providerTier: "user_configured",
      costPerOutputMToken: 0.5,
      pricing: { ...EMPTY_PRICING, inputPerMToken: 0.1, outputPerMToken: 0.5 },
    });
    const paidFrontier = makeEndpoint({
      ...freeFrontierCloud,
      id: "ep-paid-frontier",
      costPerOutputMToken: 20,
      pricing: { ...EMPTY_PRICING, inputPerMToken: 5, outputPerMToken: 20 },
    });
    const result = await routeEndpointV2(
      [paidCheapAdequate, paidFrontier],
      makeContract({ budgetClass: "minimize_cost" }),
      [],
      [],
      { capacityByProvider: new Map() },
    );
    expect(result.selectedEndpoint).toBe("ep-paid-adequate");
  });
});
