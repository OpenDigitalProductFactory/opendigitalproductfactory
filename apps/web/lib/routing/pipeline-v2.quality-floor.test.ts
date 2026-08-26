// apps/web/lib/routing/pipeline-v2.quality-floor.test.ts
//
// BI-16A1B4A3 — the quality floor must name the dimension it failed on.
//
// Split out of pipeline-v2.test.ts, which is at its module-size ceiling.

import { describe, expect, it } from "vitest";
import type { EndpointManifest } from "./types";
import type { RequestContract } from "./request-contract";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";
import { getExclusionReasonV2 } from "./pipeline-v2";

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


describe("getExclusionReasonV2 — quality floor names the gap (BI-16A1B4A3)", () => {
  // Live repro: every endpoint cleared codegen and reasoning and failed only
  // toolFidelity, by three points — and the reason said none of that.
  it("names the failing dimension, its value, and the floor", () => {
    const endpoint = makeEndpoint({ codegen: 97, reasoning: 95, toolFidelity: 80 });
    const reason = getExclusionReasonV2(
      endpoint,
      makeContract({ minimumDimensions: { codegen: 85, toolFidelity: 85, reasoning: 85 } }),
    );

    expect(reason).toContain("Minimum quality dimensions not met");
    expect(reason).toContain("toolFidelity");
    expect(reason).toContain("80");
    expect(reason).toContain("85");
  });

  it("still passes an endpoint that clears every declared minimum", () => {
    const endpoint = makeEndpoint({ codegen: 97, reasoning: 95, toolFidelity: 90 });
    expect(
      getExclusionReasonV2(
        endpoint,
        makeContract({ minimumDimensions: { codegen: 85, toolFidelity: 85, reasoning: 85 } }),
      ),
    ).toBeNull();
  });
});
