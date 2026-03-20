/**
 * EP-INF-001 Phase 3: Routing pipeline tests (TDD red phase).
 * See: docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md
 */

import { describe, expect, it } from "vitest";
import type {
  EndpointManifest,
  TaskRequirementContract,
  PolicyRuleEval,
  EndpointOverride,
} from "./types";
import { filterHard, filterByPolicy, routeEndpoint } from "./pipeline";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";

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
    profileConfidence: "medium",
    retiredAt: null,
    // EP-INF-003: ModelCard fields
    modelClass: "chat",
    modelFamily: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: EMPTY_CAPABILITIES,
    pricing: EMPTY_PRICING,
    supportedParameters: [],
    deprecationDate: null,
    metadataSource: "inferred",
    metadataConfidence: "low",
    perRequestLimits: null,
    ...overrides,
  };
}

function makeRequirement(overrides: Partial<TaskRequirementContract> = {}): TaskRequirementContract {
  return {
    taskType: "default",
    description: "Default test requirement",
    selectionRationale: "General purpose",
    requiredCapabilities: {},
    preferredMinScores: {},
    preferCheap: false,
    ...overrides,
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const sonnet = makeEndpoint({
  id: "ep-sonnet",
  providerId: "anthropic",
  modelId: "claude-sonnet-4-5",
  name: "Claude Sonnet",
  reasoning: 88,
  codegen: 91,
  toolFidelity: 85,
});

const llama = makeEndpoint({
  id: "ep-llama",
  providerId: "ollama",
  modelId: "llama3.1",
  name: "Llama 3.1",
  sensitivityClearance: ["public", "internal", "confidential", "restricted"],
  reasoning: 55,
  codegen: 50,
  toolFidelity: 40,
  supportsToolUse: true,
  costPerOutputMToken: null,
});

const noTools = makeEndpoint({
  id: "ep-no-tools",
  modelId: "basic-model",
  name: "No Tools Endpoint",
  supportsToolUse: false,
  toolFidelity: 0,
});

const retired = makeEndpoint({
  id: "ep-retired",
  modelId: "old-model",
  name: "Retired Endpoint",
  retiredAt: new Date("2026-01-01"),
});

const codeGenReq: TaskRequirementContract = {
  taskType: "codegen",
  description: "Code generation task",
  selectionRationale: "Needs strong codegen and instruction following",
  requiredCapabilities: {
    supportsToolUse: true,
  },
  preferredMinScores: {
    codegen: 75,
    instructionFollowing: 60,
  },
  preferCheap: false,
};

const greetingReq: TaskRequirementContract = {
  taskType: "greeting",
  description: "Simple greeting task",
  selectionRationale: "Conversational, prefer cheap",
  requiredCapabilities: {},
  preferredMinScores: {
    conversational: 40,
  },
  preferCheap: true,
};

// ── filterHard ───────────────────────────────────────────────────────────────

describe("filterHard", () => {
  it("excludes endpoints with status 'disabled'", () => {
    const disabled = makeEndpoint({ id: "ep-disabled", status: "disabled" });
    const { eligible, excluded } = filterHard(
      [disabled, sonnet],
      codeGenReq,
      "public"
    );
    expect(eligible.map((e) => e.id)).not.toContain("ep-disabled");
    expect(excluded.some((e) => e.endpointId === "ep-disabled")).toBe(true);
  });

  it("excludes endpoints without required sensitivity clearance", () => {
    // sonnet only has "public" and "internal", asking for "confidential"
    const { eligible, excluded } = filterHard(
      [sonnet, llama],
      codeGenReq,
      "confidential"
    );
    expect(eligible.map((e) => e.id)).not.toContain("ep-sonnet");
    expect(excluded.some((e) => e.endpointId === "ep-sonnet")).toBe(true);
    // llama has all four levels, so it should pass
    expect(eligible.map((e) => e.id)).toContain("ep-llama");
  });

  it("excludes endpoints missing required capabilities (tool support)", () => {
    const { eligible, excluded } = filterHard(
      [noTools, sonnet],
      codeGenReq,
      "public"
    );
    expect(eligible.map((e) => e.id)).not.toContain("ep-no-tools");
    expect(excluded.some((e) => e.endpointId === "ep-no-tools")).toBe(true);
  });

  it("excludes retired endpoints", () => {
    const { eligible, excluded } = filterHard(
      [retired, sonnet],
      greetingReq,
      "public"
    );
    expect(eligible.map((e) => e.id)).not.toContain("ep-retired");
    expect(excluded.some((e) => e.endpointId === "ep-retired")).toBe(true);
  });

  it("allows degraded endpoints through", () => {
    const degraded = makeEndpoint({
      id: "ep-degraded",
      status: "degraded",
    });
    const { eligible } = filterHard([degraded], greetingReq, "public");
    expect(eligible.map((e) => e.id)).toContain("ep-degraded");
  });
});

// ── filterByPolicy ────────────────────────────────────────────────────────────

describe("filterByPolicy", () => {
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

  it("excludes endpoints matching a policy rule (providerId equals 'anthropic')", () => {
    const { eligible, excluded, applied } = filterByPolicy(
      [sonnet, llama],
      [blockAnthropicRule]
    );
    expect(eligible.map((e) => e.id)).not.toContain("ep-sonnet");
    expect(excluded.some((e) => e.endpointId === "ep-sonnet")).toBe(true);
    expect(applied).toContain("rule-block-anthropic");
  });

  it("passes all endpoints when no rules match", () => {
    const noMatchRule: PolicyRuleEval = {
      id: "rule-no-match",
      name: "No Match",
      description: "Block nonexistent provider",
      condition: {
        field: "providerId",
        operator: "equals",
        value: "nonexistent-provider",
      },
    };
    const { eligible, excluded } = filterByPolicy(
      [sonnet, llama],
      [noMatchRule]
    );
    expect(eligible).toHaveLength(2);
    expect(excluded).toHaveLength(0);
  });
});

// ── routeEndpoint ─────────────────────────────────────────────────────────────

describe("routeEndpoint", () => {
  it("selects best endpoint for code-gen (sonnet should win)", () => {
    const decision = routeEndpoint(
      [sonnet, llama],
      codeGenReq,
      "public",
      [],
      []
    );
    expect(decision.selectedEndpoint).toBe("ep-sonnet");
  });

  it("returns null selectedEndpoint when no endpoints survive filtering", () => {
    // Only retired endpoint — will be filtered out
    const decision = routeEndpoint(
      [retired],
      codeGenReq,
      "public",
      [],
      []
    );
    expect(decision.selectedEndpoint).toBeNull();
  });

  it("produces a fallback chain with at least one entry", () => {
    const decision = routeEndpoint(
      [sonnet, llama],
      codeGenReq,
      "public",
      [],
      []
    );
    expect(decision.fallbackChain.length).toBeGreaterThanOrEqual(1);
  });

  it("respects pinned override (forces llama for code-gen despite lower scores)", () => {
    const pinnedOverride: EndpointOverride = {
      endpointId: "ep-llama",
      taskType: "codegen",
      pinned: true,
      blocked: false,
    };
    const decision = routeEndpoint(
      [sonnet, llama],
      codeGenReq,
      "public",
      [],
      [pinnedOverride]
    );
    expect(decision.selectedEndpoint).toBe("ep-llama");
  });

  it("respects blocked override (blocks sonnet, llama wins)", () => {
    const blockedOverride: EndpointOverride = {
      endpointId: "ep-sonnet",
      taskType: "codegen",
      pinned: false,
      blocked: true,
    };
    const decision = routeEndpoint(
      [sonnet, llama],
      codeGenReq,
      "public",
      [],
      [blockedOverride]
    );
    expect(decision.selectedEndpoint).toBe("ep-llama");
  });

  it("includes policy rules applied in the decision", () => {
    const policyRule: PolicyRuleEval = {
      id: "rule-block-anthropic",
      name: "Block Anthropic",
      description: "Exclude all Anthropic endpoints",
      condition: {
        field: "providerId",
        operator: "equals",
        value: "anthropic",
      },
    };
    const decision = routeEndpoint(
      [sonnet, llama],
      codeGenReq,
      "public",
      [policyRule],
      []
    );
    expect(decision.policyRulesApplied).toContain("rule-block-anthropic");
  });
});

// ── filterHard – EP-INF-003 modelClass filter ────────────────────────────────

describe("filterHard – EP-INF-003 modelClass filter", () => {
  it("excludes embedding models from chat routing", () => {
    const embedding = makeEndpoint({
      id: "embed-1", modelId: "text-embedding-3-small", modelClass: "embedding",
    });
    const chat = makeEndpoint({
      id: "chat-1", modelId: "gpt-4o", modelClass: "chat",
    });
    const result = filterHard([embedding, chat], makeRequirement(), "internal");
    expect(result.eligible).toHaveLength(1);
    expect(result.eligible[0].modelId).toBe("gpt-4o");
    expect(result.excluded[0].excludedReason).toContain("modelClass");
  });

  it("excludes image_gen models from chat routing", () => {
    const imageGen = makeEndpoint({
      id: "img-1", modelId: "dall-e-3", modelClass: "image_gen",
    });
    const result = filterHard([imageGen], makeRequirement(), "internal");
    expect(result.eligible).toHaveLength(0);
  });

  it("allows reasoning models for chat routing", () => {
    const reasoning = makeEndpoint({
      id: "r-1", modelId: "o4-mini", modelClass: "reasoning",
    });
    const result = filterHard([reasoning], makeRequirement(), "internal");
    expect(result.eligible).toHaveLength(1);
  });
});
