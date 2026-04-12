/**
 * EP-INF-005a: Cost-per-success ranking tests (TDD).
 * See: docs/superpowers/specs/2026-03-20-contract-based-selection-design.md §3, §5
 */

import { describe, expect, it } from "vitest";
import type { EndpointManifest } from "./types";
import type { RequestContract } from "./request-contract";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";
import {
  estimateCost,
  estimateSuccessProbability,
  averageRelevantDimensions,
  rankByCostPerSuccess,
} from "./cost-ranking";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEndpoint(overrides: Partial<EndpointManifest>): EndpointManifest {
  return {
    id: "ep-default",
    providerId: "test",
    modelId: "test-model",
    name: "Default Endpoint",
    endpointType: "chat",
    status: "active",
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
    profileConfidence: "high",
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
    contractFamily: "sync.code-gen",
    taskType: "code-gen",
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

// ── estimateCost ─────────────────────────────────────────────────────────────

describe("estimateCost", () => {
  it("calculates cost from input/output token estimates and pricing", () => {
    const ep = makeEndpoint({
      pricing: { ...EMPTY_PRICING, inputPerMToken: 3.0, outputPerMToken: 15.0 },
    });
    const contract = makeContract({
      estimatedInputTokens: 1_000_000,
      estimatedOutputTokens: 1_000_000,
    });
    const cost = estimateCost(ep, contract);
    // (1M / 1M) * 3.0 + (1M / 1M) * 15.0 = 18.0
    expect(cost).toBe(18.0);
  });

  it("returns correct cost for smaller token counts", () => {
    const ep = makeEndpoint({
      pricing: { ...EMPTY_PRICING, inputPerMToken: 3.0, outputPerMToken: 15.0 },
    });
    const contract = makeContract({
      estimatedInputTokens: 1000,
      estimatedOutputTokens: 500,
    });
    const cost = estimateCost(ep, contract);
    // (1000 / 1M) * 3.0 + (500 / 1M) * 15.0 = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105);
  });

  it("returns null when pricing has null inputPerMToken", () => {
    const ep = makeEndpoint({
      pricing: { ...EMPTY_PRICING, inputPerMToken: null, outputPerMToken: 15.0 },
    });
    const cost = estimateCost(ep, makeContract());
    expect(cost).toBeNull();
  });

  it("returns null when pricing has null outputPerMToken", () => {
    const ep = makeEndpoint({
      pricing: { ...EMPTY_PRICING, inputPerMToken: 3.0, outputPerMToken: null },
    });
    const cost = estimateCost(ep, makeContract());
    expect(cost).toBeNull();
  });

  it("returns null when all pricing is null (EMPTY_PRICING)", () => {
    const ep = makeEndpoint({ pricing: EMPTY_PRICING });
    const cost = estimateCost(ep, makeContract());
    expect(cost).toBeNull();
  });

  it("returns 0 for free models (pricing = 0)", () => {
    const ep = makeEndpoint({
      pricing: { ...EMPTY_PRICING, inputPerMToken: 0, outputPerMToken: 0 },
    });
    const cost = estimateCost(ep, makeContract());
    expect(cost).toBe(0);
  });
});

// ── estimateSuccessProbability ────────────────────────────────────────────────

describe("estimateSuccessProbability", () => {
  it("returns 0 when required tool capability is missing (null)", () => {
    const ep = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: null },
    });
    const contract = makeContract({ requiresTools: true });
    expect(estimateSuccessProbability(ep, contract)).toBe(0);
  });

  it("returns 0 when required tool capability is false", () => {
    const ep = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: false },
    });
    const contract = makeContract({ requiresTools: true });
    expect(estimateSuccessProbability(ep, contract)).toBe(0);
  });

  it("does not exclude when tool capability is true and required", () => {
    const ep = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, structuredOutput: true, streaming: true },
    });
    const contract = makeContract({ requiresTools: true, reasoningDepth: "low" });
    // 70 average score > 45 (low floor), 0% failure rate => 1.0
    expect(estimateSuccessProbability(ep, contract)).toBe(1.0);
  });

  it("returns 0 when required structuredOutput is missing (null)", () => {
    const ep = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, structuredOutput: null },
    });
    const contract = makeContract({ requiresStrictSchema: true });
    expect(estimateSuccessProbability(ep, contract)).toBe(0);
  });

  it("returns 0 when required streaming is missing (null)", () => {
    const ep = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, streaming: null },
    });
    const contract = makeContract({ requiresStreaming: true });
    expect(estimateSuccessProbability(ep, contract)).toBe(0);
  });

  it("returns 0.3 when average dimension score is below quality floor", () => {
    const ep = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, structuredOutput: true, streaming: true },
      // code-gen maps to codegen(w=1.0) + instructionFollowing(w=0.5)
      codegen: 40,
      instructionFollowing: 40,
    });
    const contract = makeContract({
      taskType: "code-gen",
      reasoningDepth: "medium", // floor = 60
    });
    // avg = (40*1.0 + 40*0.5) / 1.5 = 60/1.5 = 40 < 60
    expect(estimateSuccessProbability(ep, contract)).toBe(0.3);
  });

  it("returns base rate from failure rate when above floor", () => {
    const ep = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, structuredOutput: true, streaming: true },
      recentFailureRate: 0.15,
      codegen: 80,
      instructionFollowing: 80,
    });
    const contract = makeContract({
      taskType: "code-gen",
      reasoningDepth: "medium", // floor = 60
    });
    // avg = (80*1.0 + 80*0.5) / 1.5 = 120/1.5 = 80 >= 60
    // success prob = max(1.0 - 0.15, 0.1) = 0.85
    expect(estimateSuccessProbability(ep, contract)).toBeCloseTo(0.85);
  });

  it("floors success probability at 0.1 even with high failure rate", () => {
    const ep = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, structuredOutput: true, streaming: true },
      recentFailureRate: 0.95,
    });
    const contract = makeContract({ reasoningDepth: "low" }); // floor = 45, defaults have 70 scores
    expect(estimateSuccessProbability(ep, contract)).toBe(0.1);
  });

  it("handles unknown task type (empty dimensions) by returning 50 average, above low floor", () => {
    const ep = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, structuredOutput: true, streaming: true },
      recentFailureRate: 0.05,
    });
    const contract = makeContract({
      taskType: "unknown-task-type",
      reasoningDepth: "low", // floor = 45
    });
    // getDimensionsForTask("unknown-task-type") returns []
    // averageRelevantDimensions returns 50 (neutral) for empty
    // 50 >= 45 => above floor
    // success prob = max(1.0 - 0.05, 0.1) = 0.95
    expect(estimateSuccessProbability(ep, contract)).toBeCloseTo(0.95);
  });

  it("returns 0.3 for unknown task type when reasoning depth is high (floor=75)", () => {
    const ep = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, structuredOutput: true, streaming: true },
    });
    const contract = makeContract({
      taskType: "unknown-task-type",
      reasoningDepth: "high", // floor = 75
    });
    // getDimensionsForTask returns [] => averageRelevantDimensions returns 50
    // 50 < 75 => below floor => 0.3
    expect(estimateSuccessProbability(ep, contract)).toBe(0.3);
  });

  it("applies confidence multiplier — low confidence reduces probability", () => {
    const highConf = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, structuredOutput: true, streaming: true },
      profileConfidence: "high",
      recentFailureRate: 0,
    });
    const lowConf = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, structuredOutput: true, streaming: true },
      profileConfidence: "low",
      recentFailureRate: 0,
    });
    const contract = makeContract({ reasoningDepth: "low" });
    const highProb = estimateSuccessProbability(highConf, contract);
    const lowProb = estimateSuccessProbability(lowConf, contract);
    expect(highProb).toBeGreaterThan(lowProb);
    expect(highProb).toBeCloseTo(1.0);
    expect(lowProb).toBeCloseTo(0.85);
  });
});

// ── averageRelevantDimensions ────────────────────────────────────────────────

describe("averageRelevantDimensions", () => {
  it("computes weighted average for code-gen (codegen + instructionFollowing)", () => {
    const ep = makeEndpoint({ codegen: 90, instructionFollowing: 60 });
    // code-gen: codegen(w=1.0) + instructionFollowing(w=0.5)
    // = (90*1.0 + 60*0.5) / (1.0 + 0.5) = (90 + 30) / 1.5 = 80
    expect(averageRelevantDimensions(ep, "code-gen")).toBeCloseTo(80);
  });

  it("returns 50 for unknown task type", () => {
    const ep = makeEndpoint({});
    expect(averageRelevantDimensions(ep, "completely-unknown")).toBe(50);
  });

  it("computes single dimension for reasoning task", () => {
    const ep = makeEndpoint({ reasoning: 85 });
    // reasoning: reasoning(w=1.0) only
    expect(averageRelevantDimensions(ep, "reasoning")).toBe(85);
  });
});

// ── rankByCostPerSuccess ─────────────────────────────────────────────────────

describe("rankByCostPerSuccess", () => {
  const cheap = makeEndpoint({
    id: "ep-cheap",
    pricing: { ...EMPTY_PRICING, inputPerMToken: 0.5, outputPerMToken: 1.5 },
  });
  const expensive = makeEndpoint({
    id: "ep-expensive",
    pricing: { ...EMPTY_PRICING, inputPerMToken: 15.0, outputPerMToken: 60.0 },
  });
  const freeModel = makeEndpoint({
    id: "ep-free",
    pricing: { ...EMPTY_PRICING, inputPerMToken: 0, outputPerMToken: 0 },
  });
  const nullPricing = makeEndpoint({
    id: "ep-null",
    pricing: EMPTY_PRICING,
  });

  it("minimize_cost: cheapest above floor wins", () => {
    const contract = makeContract({ budgetClass: "minimize_cost" });
    const result = rankByCostPerSuccess(
      [
        { endpoint: expensive, successProb: 0.9 },
        { endpoint: cheap, successProb: 0.85 },
      ],
      contract,
    );
    expect(result[0]!.endpoint.id).toBe("ep-cheap");
    expect(result[0]!.estimatedCost).not.toBeNull();
    expect(result[1]!.endpoint.id).toBe("ep-expensive");
  });

  it("quality_first: highest successProb wins regardless of cost", () => {
    const contract = makeContract({ budgetClass: "quality_first" });
    const result = rankByCostPerSuccess(
      [
        { endpoint: cheap, successProb: 0.8 },
        { endpoint: expensive, successProb: 0.95 },
      ],
      contract,
    );
    expect(result[0]!.endpoint.id).toBe("ep-expensive");
    // rankScore = successProb * 100
    expect(result[0]!.rankScore).toBeCloseTo(95);
    expect(result[1]!.rankScore).toBeCloseTo(80);
  });

  it("balanced: blends cost efficiency with quality", () => {
    const contract = makeContract({ budgetClass: "balanced" });
    const result = rankByCostPerSuccess(
      [
        { endpoint: cheap, successProb: 0.85 },
        { endpoint: expensive, successProb: 0.9 },
      ],
      contract,
    );
    // Both should have rankScores that blend 0.7 * costEfficiency + 0.3 * quality
    expect(result.length).toBe(2);
    // Cheap model should have better cost efficiency, expensive has slightly better quality
    // The exact winner depends on token estimates, but both should have valid scores
    expect(result[0]!.rankScore).toBeGreaterThan(0);
    expect(result[1]!.rankScore).toBeGreaterThan(0);
  });

  it("null pricing: penalized with rankScore = successProb * 50", () => {
    const contract = makeContract({ budgetClass: "minimize_cost" });
    const result = rankByCostPerSuccess(
      [
        { endpoint: cheap, successProb: 0.85 },
        { endpoint: nullPricing, successProb: 0.85 },
      ],
      contract,
    );
    // Null pricing endpoint should be penalized
    const nullResult = result.find((r) => r.endpoint.id === "ep-null")!;
    const cheapResult = result.find((r) => r.endpoint.id === "ep-cheap")!;
    expect(nullResult.rankScore).toBe(0.85 * 50); // 42.5
    expect(nullResult.estimatedCost).toBeNull();
    // Cheap should rank higher (known cost, high efficiency)
    expect(cheapResult.rankScore).toBeGreaterThan(nullResult.rankScore);
  });

  it("free model (cost=0): ranked by quality (successProb * 100)", () => {
    const contract = makeContract({ budgetClass: "minimize_cost" });
    const result = rankByCostPerSuccess(
      [
        { endpoint: freeModel, successProb: 0.7 },
        { endpoint: cheap, successProb: 0.85 },
      ],
      contract,
    );
    const freeResult = result.find((r) => r.endpoint.id === "ep-free")!;
    expect(freeResult.rankScore).toBe(0.7 * 100); // 70
    expect(freeResult.estimatedCost).toBe(0);
  });

  it("sorts descending by rankScore", () => {
    const contract = makeContract({ budgetClass: "quality_first" });
    const result = rankByCostPerSuccess(
      [
        { endpoint: cheap, successProb: 0.5 },
        { endpoint: expensive, successProb: 0.9 },
        { endpoint: freeModel, successProb: 0.7 },
      ],
      contract,
    );
    expect(result[0]!.rankScore).toBeGreaterThanOrEqual(result[1]!.rankScore);
    expect(result[1]!.rankScore).toBeGreaterThanOrEqual(result[2]!.rankScore);
  });

  it("quality_first ignores cost — null pricing not penalized", () => {
    const contract = makeContract({ budgetClass: "quality_first" });
    const result = rankByCostPerSuccess(
      [
        { endpoint: nullPricing, successProb: 0.95 },
        { endpoint: cheap, successProb: 0.85 },
      ],
      contract,
    );
    // quality_first: rankScore = successProb * 100 for ALL, regardless of pricing
    expect(result[0]!.endpoint.id).toBe("ep-null");
    expect(result[0]!.rankScore).toBeCloseTo(95);
  });
});
