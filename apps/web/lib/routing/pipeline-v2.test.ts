/**
 * EP-INF-005a: Contract-based pipeline v2 tests (TDD).
 * See: docs/superpowers/specs/2026-03-20-contract-based-selection-design.md
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import type { EndpointManifest, EndpointOverride, PolicyRuleEval } from "./types";
import type { RequestContract } from "./request-contract";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";
import { routeEndpointV2, getExclusionReasonV2 } from "./pipeline-v2";

// Mock champion-challenger so selectRecipeWithExploration returns null recipe (no DB in unit tests)
vi.mock("./champion-challenger", () => ({
  selectRecipeWithExploration: vi.fn().mockResolvedValue({
    recipe: null,
    explorationMode: "champion",
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEndpoint(overrides: Partial<EndpointManifest> = {}): EndpointManifest {
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

// ── Test fixtures ────────────────────────────────────────────────────────────

const cheapModel = makeEndpoint({
  id: "ep-cheap",
  providerId: "openai",
  modelId: "gpt-4o-mini",
  name: "GPT-4o Mini",
  reasoning: 55,
  codegen: 55,
  toolFidelity: 60,
  instructionFollowing: 65,
  structuredOutput: 60,
  conversational: 65,
  contextRetention: 60,
  costPerOutputMToken: 0.6,
  pricing: { ...EMPTY_PRICING, inputPerMToken: 0.15, outputPerMToken: 0.6 },
  capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, structuredOutput: true, streaming: true },
});

const qualityModel = makeEndpoint({
  id: "ep-quality",
  providerId: "anthropic",
  modelId: "claude-sonnet-4-5",
  name: "Claude Sonnet",
  reasoning: 90,
  codegen: 91,
  toolFidelity: 85,
  instructionFollowing: 88,
  structuredOutput: 85,
  conversational: 88,
  contextRetention: 85,
  costPerOutputMToken: 15.0,
  pricing: { ...EMPTY_PRICING, inputPerMToken: 3.0, outputPerMToken: 15.0 },
  capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, structuredOutput: true, streaming: true, imageInput: true },
});

const localModel = makeEndpoint({
  id: "ep-local",
  providerId: "ollama",
  modelId: "llama3.1",
  name: "Llama 3.1 Local",
  reasoning: 55,
  codegen: 50,
  toolFidelity: 40,
  instructionFollowing: 55,
  structuredOutput: 45,
  conversational: 55,
  contextRetention: 50,
  sensitivityClearance: ["public", "internal", "confidential", "restricted"],
  costPerOutputMToken: null,
  pricing: { ...EMPTY_PRICING, inputPerMToken: 0, outputPerMToken: 0 },
  capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true },
});

// ── Reset rate tracker between tests ─────────────────────────────────────────

beforeEach(async () => {
  const { _resetAllTracking } = await import("./rate-tracker");
  _resetAllTracking();
});

// ── getExclusionReasonV2 ─────────────────────────────────────────────────────

describe("getExclusionReasonV2", () => {
  it("excludes retired/disabled status models", () => {
    const retired = makeEndpoint({ id: "ep-retired", status: "retired" });
    const disabled = makeEndpoint({ id: "ep-disabled", status: "disabled" });
    const contract = makeContract();

    expect(getExclusionReasonV2(retired, contract)).toContain("Status");
    expect(getExclusionReasonV2(disabled, contract)).toContain("Status");
  });

  it("excludes non-chat/reasoning model classes", () => {
    const embedding = makeEndpoint({ modelClass: "embedding" });
    const contract = makeContract();
    expect(getExclusionReasonV2(embedding, contract)).toContain("modelClass");
  });

  it("excludes models lacking required image input capability", () => {
    const noImage = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true },
    });
    const contract = makeContract({
      modality: { input: ["text", "image"], output: ["text"] },
    });
    expect(getExclusionReasonV2(noImage, contract)).toContain("image");
  });

  it("excludes models lacking structuredOutput when requiresStrictSchema=true", () => {
    const noSchema = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true },
    });
    const contract = makeContract({ requiresStrictSchema: true });
    expect(getExclusionReasonV2(noSchema, contract)).toContain("structuredOutput");
  });

  it("excludes models lacking tool use when requiresTools=true", () => {
    const noTools = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, streaming: true },
      supportsToolUse: false,
    });
    const contract = makeContract({ requiresTools: true });
    expect(getExclusionReasonV2(noTools, contract)).toContain("toolUse");
  });

  it("excludes models lacking streaming when requiresStreaming=true", () => {
    const noStreaming = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true },
    });
    const contract = makeContract({ requiresStreaming: true });
    expect(getExclusionReasonV2(noStreaming, contract)).toContain("streaming");
  });

  it("handles residencyPolicy local_only (excludes non-ollama)", () => {
    const cloudModel = makeEndpoint({ providerId: "openai" });
    const contract = makeContract({ residencyPolicy: "local_only" });
    expect(getExclusionReasonV2(cloudModel, contract)).toContain("local_only");
  });

  it("allows ollama models for local_only residency", () => {
    const contract = makeContract({ residencyPolicy: "local_only" });
    expect(getExclusionReasonV2(localModel, contract)).toBeNull();
  });

  it("excludes models lacking pdf input for file modality", () => {
    const noPdf = makeEndpoint({
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true },
    });
    const contract = makeContract({
      modality: { input: ["text", "file"], output: ["text"] },
    });
    expect(getExclusionReasonV2(noPdf, contract)).toContain("pdf");
  });

  it("excludes when sensitivity clearance is missing", () => {
    const publicOnly = makeEndpoint({
      sensitivityClearance: ["public"],
    });
    const contract = makeContract({ sensitivity: "confidential" });
    expect(getExclusionReasonV2(publicOnly, contract)).toContain("Sensitivity");
  });

  it("excludes when context window is too small", () => {
    const smallContext = makeEndpoint({
      maxContextTokens: 4096,
    });
    const contract = makeContract({ minContextTokens: 100000 });
    expect(getExclusionReasonV2(smallContext, contract)).toContain("Context window");
  });

  it("returns null for eligible endpoint", () => {
    const ep = makeEndpoint();
    const contract = makeContract();
    expect(getExclusionReasonV2(ep, contract)).toBeNull();
  });

  it("allows code-class endpoints in the default general-purpose eligibility set", () => {
    const codeEndpoint = makeEndpoint({ modelClass: "code" });
    const contract = makeContract({ taskType: "unknown" });
    expect(getExclusionReasonV2(codeEndpoint, contract)).toBeNull();
  });

  it("does not exclude code-class endpoints for coding-oriented requests", () => {
    const codeEndpoint = makeEndpoint({ modelClass: "code" });
    const contract = makeContract({ taskType: "code-gen" });
    expect(getExclusionReasonV2(codeEndpoint, contract)).toBeNull();
  });
});

// ── getExclusionReasonV2 – EP-INF-009c: requiredModelClass ───────────────────

describe("getExclusionReasonV2 – requiredModelClass (EP-INF-009c)", () => {
  it("allows matching modelClass when requiredModelClass is set", () => {
    const embedding = makeEndpoint({ modelClass: "embedding" });
    const contract = makeContract({ requiredModelClass: "embedding" as any });
    expect(getExclusionReasonV2(embedding, contract)).toBeNull();
  });

  it("excludes non-matching modelClass when requiredModelClass is set", () => {
    const chat = makeEndpoint({ modelClass: "chat" });
    const contract = makeContract({ requiredModelClass: "image_gen" as any });
    expect(getExclusionReasonV2(chat, contract)).toContain("does not match");
  });

  it("allows image_gen models when requiredModelClass is image_gen", () => {
    const imageGen = makeEndpoint({ modelClass: "image_gen" });
    const contract = makeContract({ requiredModelClass: "image_gen" as any });
    expect(getExclusionReasonV2(imageGen, contract)).toBeNull();
  });

  it("excludes embedding models from default chat routing (no requiredModelClass)", () => {
    const embedding = makeEndpoint({ modelClass: "embedding" });
    const contract = makeContract(); // no requiredModelClass
    expect(getExclusionReasonV2(embedding, contract)).toContain("modelClass");
  });

  it("still allows chat, reasoning, and code when no requiredModelClass", () => {
    const chat = makeEndpoint({ modelClass: "chat" });
    const reasoning = makeEndpoint({ modelClass: "reasoning" });
    const code = makeEndpoint({ modelClass: "code" });
    const contract = makeContract();
    expect(getExclusionReasonV2(chat, contract)).toBeNull();
    expect(getExclusionReasonV2(reasoning, contract)).toBeNull();
    expect(getExclusionReasonV2(code, contract)).toBeNull();
  });

  it("allows audio models when requiredModelClass is audio", () => {
    const audio = makeEndpoint({ modelClass: "audio" });
    const contract = makeContract({ requiredModelClass: "audio" as any });
    expect(getExclusionReasonV2(audio, contract)).toBeNull();
  });
});

// ── getExclusionReasonV2 – capability-based exclusion (EP-INF-008b) ──────────

describe("getExclusionReasonV2 – capability-based exclusion (EP-INF-008b)", () => {
  it("excludes model without codeExecution when contract requires it", () => {
    const ep = makeEndpoint({ capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true, codeExecution: false } as any });
    const contract = makeContract({ requiresCodeExecution: true });
    expect(getExclusionReasonV2(ep, contract)).toMatch(/codeExecution/);
  });

  it("includes model with codeExecution when contract requires it", () => {
    const ep = makeEndpoint({ capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true, codeExecution: true } as any });
    const contract = makeContract({ requiresCodeExecution: true });
    expect(getExclusionReasonV2(ep, contract)).toBeNull();
  });

  it("excludes model without webSearch when contract requires it", () => {
    const ep = makeEndpoint({ capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true, webSearch: false } as any });
    const contract = makeContract({ requiresWebSearch: true });
    expect(getExclusionReasonV2(ep, contract)).toMatch(/webSearch/);
  });

  it("includes model with webSearch when contract requires it", () => {
    const ep = makeEndpoint({ capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true, webSearch: true } as any });
    const contract = makeContract({ requiresWebSearch: true });
    expect(getExclusionReasonV2(ep, contract)).toBeNull();
  });

  it("excludes model without computerUse when contract requires it", () => {
    const ep = makeEndpoint({ capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true, computerUse: false } as any });
    const contract = makeContract({ requiresComputerUse: true });
    expect(getExclusionReasonV2(ep, contract)).toMatch(/computerUse/);
  });

  it("does not check capabilities when contract does not require them", () => {
    const ep = makeEndpoint({ capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true, codeExecution: false, webSearch: false, computerUse: false } as any });
    const contract = makeContract(); // no requiresCodeExecution/webSearch/computerUse
    expect(getExclusionReasonV2(ep, contract)).toBeNull();
  });
});

// ── routeEndpointV2 ─────────────────────────────────────────────────────────

describe("routeEndpointV2", () => {
  it("produces valid RouteDecision with selectedEndpoint and selectedModelId", async () => {
    const decision = await routeEndpointV2(
      [qualityModel, cheapModel],
      makeContract(),
      [],
      [],
    );
    expect(decision.selectedEndpoint).toBeTruthy();
    expect(decision.selectedModelId).toBeTruthy();
    expect(decision.taskType).toBe("reasoning");
    expect(decision.timestamp).toBeInstanceOf(Date);
    expect(decision.candidates.length).toBeGreaterThan(0);
  });

  it("excludes models lacking required image input capability", async () => {
    const contract = makeContract({
      modality: { input: ["text", "image"], output: ["text"] },
    });
    // qualityModel has imageInput: true, cheapModel does not
    const decision = await routeEndpointV2(
      [qualityModel, cheapModel],
      contract,
      [],
      [],
    );
    expect(decision.selectedEndpoint).toBe("ep-quality");
    // cheapModel should be excluded
    const cheapCandidate = decision.candidates.find(c => c.endpointId === "ep-cheap");
    expect(cheapCandidate?.excluded).toBe(true);
  });

  it("excludes models lacking structuredOutput when requiresStrictSchema=true", async () => {
    const noSchemaModel = makeEndpoint({
      id: "ep-no-schema",
      capabilities: { ...EMPTY_CAPABILITIES, toolUse: true, streaming: true },
      pricing: { ...EMPTY_PRICING, inputPerMToken: 1.0, outputPerMToken: 5.0 },
    });
    const contract = makeContract({ requiresStrictSchema: true });
    const decision = await routeEndpointV2(
      [noSchemaModel, qualityModel],
      contract,
      [],
      [],
    );
    expect(decision.selectedEndpoint).toBe("ep-quality");
    const excluded = decision.candidates.find(c => c.endpointId === "ep-no-schema");
    expect(excluded?.excluded).toBe(true);
    expect(excluded?.excludedReason).toContain("structuredOutput");
  });

  it("handles residencyPolicy local_only (excludes non-ollama)", async () => {
    const contract = makeContract({ residencyPolicy: "local_only" });
    const decision = await routeEndpointV2(
      [qualityModel, cheapModel, localModel],
      contract,
      [],
      [],
    );
    expect(decision.selectedEndpoint).toBe("ep-local");
    // Cloud models should be excluded
    const cloudExcluded = decision.candidates.filter(
      c => c.excluded && c.excludedReason?.includes("local_only"),
    );
    expect(cloudExcluded.length).toBe(2);
  });

  it("prefers cheaper model for minimize_cost budget", async () => {
    const contract = makeContract({ budgetClass: "minimize_cost" });
    const decision = await routeEndpointV2(
      [qualityModel, cheapModel],
      contract,
      [],
      [],
    );
    // With minimize_cost, the cheap model should be selected
    expect(decision.selectedEndpoint).toBe("ep-cheap");
  });

  it("prefers quality model for quality_first budget", async () => {
    const contract = makeContract({ budgetClass: "quality_first" });
    const decision = await routeEndpointV2(
      [qualityModel, cheapModel],
      contract,
      [],
      [],
    );
    // With quality_first, the quality model should be selected
    expect(decision.selectedEndpoint).toBe("ep-quality");
  });

  it("penalizes null pricing (not treated as free)", async () => {
    const nullPricing = makeEndpoint({
      id: "ep-null-pricing",
      pricing: EMPTY_PRICING,
      costPerOutputMToken: null,
      reasoning: 70,
    });
    const knownPricing = makeEndpoint({
      id: "ep-known-pricing",
      pricing: { ...EMPTY_PRICING, inputPerMToken: 1.0, outputPerMToken: 5.0 },
      costPerOutputMToken: 5.0,
      reasoning: 70,
    });
    const contract = makeContract({ budgetClass: "balanced" });
    const decision = await routeEndpointV2(
      [nullPricing, knownPricing],
      contract,
      [],
      [],
    );
    // The null-pricing model should be penalized (ranked lower)
    // Find both in candidates and compare rank scores
    const nullCandidate = decision.candidates.find(c => c.endpointId === "ep-null-pricing");
    const knownCandidate = decision.candidates.find(c => c.endpointId === "ep-known-pricing");
    expect(knownCandidate!.fitnessScore).toBeGreaterThan(nullCandidate!.fitnessScore);
  });

  it("returns null selectedEndpoint when no eligible candidates", async () => {
    const retired = makeEndpoint({ id: "ep-retired", status: "retired" });
    const disabled = makeEndpoint({ id: "ep-disabled", status: "disabled" });
    const decision = await routeEndpointV2(
      [retired, disabled],
      makeContract(),
      [],
      [],
    );
    expect(decision.selectedEndpoint).toBeNull();
    expect(decision.selectedModelId).toBeNull();
    expect(decision.excludedCount).toBe(2);
  });

  it("builds fallback chain from next 3 candidates", async () => {
    const ep1 = makeEndpoint({
      id: "ep-1", reasoning: 90, pricing: { ...EMPTY_PRICING, inputPerMToken: 3.0, outputPerMToken: 15.0 },
    });
    const ep2 = makeEndpoint({
      id: "ep-2", reasoning: 80, pricing: { ...EMPTY_PRICING, inputPerMToken: 2.0, outputPerMToken: 10.0 },
    });
    const ep3 = makeEndpoint({
      id: "ep-3", reasoning: 70, pricing: { ...EMPTY_PRICING, inputPerMToken: 1.0, outputPerMToken: 5.0 },
    });
    const ep4 = makeEndpoint({
      id: "ep-4", reasoning: 60, pricing: { ...EMPTY_PRICING, inputPerMToken: 0.5, outputPerMToken: 2.0 },
    });
    const ep5 = makeEndpoint({
      id: "ep-5", reasoning: 50, pricing: { ...EMPTY_PRICING, inputPerMToken: 0.3, outputPerMToken: 1.0 },
    });
    const contract = makeContract({ budgetClass: "quality_first" });
    const decision = await routeEndpointV2(
      [ep1, ep2, ep3, ep4, ep5],
      contract,
      [],
      [],
    );
    // Winner + up to 3 fallbacks
    expect(decision.fallbackChain.length).toBeLessThanOrEqual(4);
    expect(decision.fallbackChain.length).toBeGreaterThanOrEqual(2);
    // Winner is first in fallback chain
    expect(decision.fallbackChain[0]).toBe(decision.selectedEndpoint);
  });

  it("excludes retired/disabled status models", async () => {
    const retired = makeEndpoint({ id: "ep-retired", status: "retired" });
    const active = makeEndpoint({
      id: "ep-active",
      pricing: { ...EMPTY_PRICING, inputPerMToken: 1.0, outputPerMToken: 5.0 },
    });
    const decision = await routeEndpointV2(
      [retired, active],
      makeContract(),
      [],
      [],
    );
    expect(decision.selectedEndpoint).toBe("ep-active");
    const retiredCandidate = decision.candidates.find(c => c.endpointId === "ep-retired");
    expect(retiredCandidate?.excluded).toBe(true);
  });

  // ── Pin/Block override tests ───────────────────────────────────────────

  it("respects pinned override", async () => {
    const pinOverride: EndpointOverride = {
      endpointId: "ep-cheap",
      taskType: "reasoning",
      pinned: true,
      blocked: false,
    };
    const decision = await routeEndpointV2(
      [qualityModel, cheapModel],
      makeContract(),
      [],
      [pinOverride],
    );
    expect(decision.selectedEndpoint).toBe("ep-cheap");
  });

  it("respects blocked override", async () => {
    const blockOverride: EndpointOverride = {
      endpointId: "ep-quality",
      taskType: "reasoning",
      pinned: false,
      blocked: true,
    };
    const decision = await routeEndpointV2(
      [qualityModel, cheapModel],
      makeContract(),
      [],
      [blockOverride],
    );
    expect(decision.selectedEndpoint).toBe("ep-cheap");
    const blockedCandidate = decision.candidates.find(c => c.endpointId === "ep-quality");
    expect(blockedCandidate?.excluded).toBe(true);
    expect(blockedCandidate?.excludedReason).toContain("Blocked");
  });

  it("applies policy rules", async () => {
    const blockAnthropicRule: PolicyRuleEval = {
      id: "rule-block-anthropic",
      name: "Block Anthropic",
      description: "Exclude all Anthropic endpoints",
      condition: {
        field: "providerId",
        operator: "equals",
        value: "anthropic",
      },
    };
    const decision = await routeEndpointV2(
      [qualityModel, cheapModel],
      makeContract(),
      [blockAnthropicRule],
      [],
    );
    expect(decision.selectedEndpoint).toBe("ep-cheap");
    expect(decision.policyRulesApplied).toContain("rule-block-anthropic");
  });

  // ── EP-INF-005b: Execution plan integration ────────────────────────────

  it("includes executionPlan in RouteDecision", async () => {
    const ep = makeEndpoint({
      id: "ep-plan-test",
      pricing: { ...EMPTY_PRICING, inputPerMToken: 1.0, outputPerMToken: 5.0 },
    });
    const decision = await routeEndpointV2([ep], makeContract(), [], []);
    expect(decision.executionPlan).toBeDefined();
    expect(decision.executionPlan?.maxTokens).toBe(4096); // default plan
    expect(decision.executionPlan?.recipeId).toBeNull();   // no recipe in DB
  });

  // ── EP-INF-006: Exploration integration ──────────────────────────────

  it("includes explorationMode in RouteDecision", async () => {
    const ep = makeEndpoint({
      id: "ep-explore-test",
      pricing: { ...EMPTY_PRICING, inputPerMToken: 1.0, outputPerMToken: 5.0 },
    });
    const decision = await routeEndpointV2([ep], makeContract(), [], []);
    expect(decision.explorationMode).toBe("champion");
  });
});
