// apps/web/lib/routing/pipeline-v2.quality-floor.test.ts
//
// BI-16A1B4A3 — the quality floor must name the dimension it failed on.
//
// Split out of pipeline-v2.test.ts, which is at its module-size ceiling.

import { describe, expect, it } from "vitest";
import type { EndpointManifest } from "./types";
import type { RequestContract } from "./request-contract";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";
import { getExclusionReasonV2, routeEndpointV2 } from "./pipeline-v2";

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

// BI-16A1B4A3 — founder ruling 2026-08-26: the platform must never be
// unrunnable; the bundled local model has to work when nothing else does.
describe("routeEndpointV2 — the quality floor never makes the system unrunnable", () => {
  const floor = { codegen: 85, toolFidelity: 85, reasoning: 85 };

  it("runs on a below-floor local endpoint rather than failing when nothing meets the floor", async () => {
    // The live shape: everything clears codegen and reasoning and misses only
    // toolFidelity, by a few points.
    const local = makeEndpoint({
      id: "local-1",
      providerId: "local",
      name: "qwen3.8-27b",
      codegen: 96,
      reasoning: 90,
      toolFidelity: 82,
    });

    const decision = await routeEndpointV2(
      [local],
      makeContract({ minimumDimensions: floor }),
      [],
      [],
      { skipRecipe: true, capacityByProvider: new Map() },
    );

    expect(decision.selectedEndpoint).toBe("local-1");
    expect(decision.reason).toMatch(/no endpoint met the quality floor/i);
  });

  it("still prefers an at-floor endpoint and excludes the below-floor one", async () => {
    const strong = makeEndpoint({
      id: "strong-1",
      providerId: "codex",
      name: "at-floor",
      codegen: 96,
      reasoning: 95,
      toolFidelity: 90,
    });
    const weak = makeEndpoint({
      id: "weak-1",
      providerId: "local",
      name: "below-floor",
      codegen: 96,
      reasoning: 90,
      toolFidelity: 82,
    });

    const decision = await routeEndpointV2(
      [strong, weak],
      makeContract({ minimumDimensions: floor }),
      [],
      [],
      { skipRecipe: true, capacityByProvider: new Map() },
    );

    expect(decision.selectedEndpoint).toBe("strong-1");
    expect(decision.reason).not.toMatch(/no endpoint met the quality floor/i);
  });

  it("does not relax a hard gate — an uncleared endpoint stays excluded", async () => {
    const uncleared = makeEndpoint({
      id: "uncleared-1",
      providerId: "local",
      codegen: 96,
      reasoning: 90,
      toolFidelity: 82,
      sensitivityClearance: [],
    });

    const decision = await routeEndpointV2(
      [uncleared],
      makeContract({ minimumDimensions: floor, sensitivity: "restricted" }),
      [],
      [],
      { skipRecipe: true, capacityByProvider: new Map() },
    );

    expect(decision.selectedEndpoint).toBeNull();
  });
});
