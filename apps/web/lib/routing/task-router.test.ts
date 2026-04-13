import { describe, it, expect } from "vitest";
import { routeTask } from "./task-router";
import { BUILT_IN_TASK_REQUIREMENTS } from "./task-requirements";
import type { EndpointManifest } from "./types";
import type { TaskRequirement, PolicyRule } from "./task-router-types";

// ── Shared mock factories ──────────────────────────────────────────────────────

function makeEndpoint(overrides: Partial<EndpointManifest>): EndpointManifest {
  return {
    id: "ep-default",
    providerId: "mock-provider",
    modelId: "mock-model",
    name: "Mock Endpoint",
    endpointType: "llm",
    status: "active",
    sensitivityClearance: ["internal", "confidential"],
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 8000,
    maxOutputTokens: 4096,
    modelRestrictions: [],
    reasoning: 80,
    codegen: 80,
    toolFidelity: 80,
    instructionFollowing: 80,
    structuredOutput: 80,
    conversational: 80,
    contextRetention: 80,
    customScores: {},
    avgLatencyMs: 1000,
    recentFailureRate: 0.02,
    costPerOutputMToken: 3.0,
    profileSource: "seed",
    profileConfidence: "high",
    retiredAt: null,
    qualityTier: "strong",
    modelClass: "chat",
    modelFamily: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: { toolUse: true, streaming: true, structuredOutput: true } as any,
    pricing: {} as any,
    supportedParameters: [],
    deprecationDate: null,
    metadataSource: "seed",
    metadataConfidence: "high",
    perRequestLimits: null,
    ...overrides,
  };
}

// ── Stage 0: Policy filter ────────────────────────────────────────────────────

describe("routeTask — Stage 0: Policy Filter", () => {
  const endpoints = [
    makeEndpoint({ id: "ep-cloud", name: "Cloud Model", providerId: "anthropic", qualityTier: "frontier" }),
    makeEndpoint({ id: "ep-local", name: "Local Model", providerId: "local-ollama", qualityTier: "adequate" }),
  ];

  const noCloudRule: PolicyRule = {
    id: "policy-no-cloud",
    name: "No Cloud Providers",
    description: "On-premise only.",
    isActive: true,
    action: "exclude",
    condition: { field: "providerId", operator: "in", value: ["anthropic", "openai"] },
  };

  const inactiveRule: PolicyRule = {
    id: "policy-inactive",
    name: "Inactive Rule",
    description: "Should be ignored.",
    isActive: false,
    action: "exclude",
    condition: { field: "id", operator: "in", value: ["ep-local"] },
  };

  const task = BUILT_IN_TASK_REQUIREMENTS["status-query"]!;

  it("excludes endpoints that match an active policy rule", () => {
    const decision = routeTask(endpoints, task, "internal", [noCloudRule]);
    const cloud = decision.candidates.find((c) => c.endpointId === "ep-cloud")!;
    expect(cloud.excluded).toBe(true);
    expect(cloud.excludedReason).toMatch(/Excluded by policy: No Cloud Providers/);
    expect(decision.policyRulesApplied).toContain("policy-no-cloud");
  });

  it("does not apply inactive policy rules", () => {
    const decision = routeTask(endpoints, task, "internal", [inactiveRule]);
    const local = decision.candidates.find((c) => c.endpointId === "ep-local")!;
    expect(local.excluded).toBe(false);
    expect(decision.policyRulesApplied).not.toContain("policy-inactive");
  });
});

// ── Stage 0.5: Tier gate ──────────────────────────────────────────────────────

describe("routeTask — Stage 0.5: Tier Gate", () => {
  const frontierEndpoint = makeEndpoint({ id: "ep-frontier", name: "Frontier", qualityTier: "frontier" });
  const strongEndpoint   = makeEndpoint({ id: "ep-strong",   name: "Strong",   qualityTier: "strong"   });
  const adequateEndpoint = makeEndpoint({ id: "ep-adequate", name: "Adequate", qualityTier: "adequate" });
  const basicEndpoint    = makeEndpoint({ id: "ep-basic",    name: "Basic",    qualityTier: "basic"    });

  const allEndpoints = [frontierEndpoint, strongEndpoint, adequateEndpoint, basicEndpoint];

  it("excludes endpoints below minimumTier=frontier", () => {
    const task: TaskRequirement = { ...BUILT_IN_TASK_REQUIREMENTS["code-gen"]!, minimumTier: "frontier" };
    const decision = routeTask(allEndpoints, task, "internal", []);
    expect(decision.candidates.find((c) => c.endpointId === "ep-strong")?.excluded).toBe(true);
    expect(decision.candidates.find((c) => c.endpointId === "ep-adequate")?.excluded).toBe(true);
    expect(decision.candidates.find((c) => c.endpointId === "ep-basic")?.excluded).toBe(true);
    expect(decision.candidates.find((c) => c.endpointId === "ep-frontier")?.excluded).toBe(false);
  });

  it("excludes endpoints below minimumTier=strong but keeps frontier", () => {
    const task: TaskRequirement = { ...BUILT_IN_TASK_REQUIREMENTS["web-search"]!, minimumTier: "strong" };
    const decision = routeTask(allEndpoints, task, "internal", []);
    expect(decision.candidates.find((c) => c.endpointId === "ep-frontier")?.excluded).toBe(false);
    expect(decision.candidates.find((c) => c.endpointId === "ep-strong")?.excluded).toBe(false);
    expect(decision.candidates.find((c) => c.endpointId === "ep-adequate")?.excluded).toBe(true);
    expect(decision.candidates.find((c) => c.endpointId === "ep-basic")?.excluded).toBe(true);
  });

  it("allows all endpoints when minimumTier=adequate", () => {
    const task: TaskRequirement = { ...BUILT_IN_TASK_REQUIREMENTS["greeting"]!, minimumTier: "adequate" };
    const decision = routeTask(allEndpoints, task, "internal", []);
    expect(decision.candidates.filter((c) => c.excluded)).toHaveLength(1); // only basic
    expect(decision.candidates.find((c) => c.endpointId === "ep-basic")?.excluded).toBe(true);
  });

  it("excludes nothing when no minimumTier is set", () => {
    const task: TaskRequirement = { ...BUILT_IN_TASK_REQUIREMENTS["greeting"]!, minimumTier: undefined };
    const decision = routeTask(allEndpoints, task, "internal", []);
    expect(decision.candidates.every((c) => !c.excluded)).toBe(true);
  });

  it("tier exclusion reason is descriptive", () => {
    const task: TaskRequirement = { ...BUILT_IN_TASK_REQUIREMENTS["code-gen"]!, minimumTier: "frontier" };
    const decision = routeTask(allEndpoints, task, "internal", []);
    const strong = decision.candidates.find((c) => c.endpointId === "ep-strong")!;
    expect(strong.excludedReason).toContain("strong");
    expect(strong.excludedReason).toContain("frontier");
  });
});

// ── Stage 1: Hard filter ──────────────────────────────────────────────────────

describe("routeTask — Stage 1: Hard Filter", () => {
  const toolTask = BUILT_IN_TASK_REQUIREMENTS["tool-action"]!;
  const contextTask: TaskRequirement = {
    ...BUILT_IN_TASK_REQUIREMENTS["reasoning"]!,
    requiredCapabilities: { minContextTokens: 4000 },
  };

  const endpoints = [
    makeEndpoint({ id: "ep-active",      name: "Active",               status: "active",   qualityTier: "frontier" }),
    makeEndpoint({ id: "ep-inactive",    name: "Inactive",             status: "disabled", qualityTier: "frontier" }),
    makeEndpoint({ id: "ep-retired",     name: "Retired",              retiredAt: new Date(), qualityTier: "frontier" }),
    makeEndpoint({ id: "ep-noclearance", name: "No Clearance",         sensitivityClearance: ["internal"], qualityTier: "frontier" }),
    makeEndpoint({ id: "ep-notool",      name: "No Tool Support",      supportsToolUse: false, qualityTier: "frontier" }),
    makeEndpoint({ id: "ep-smallctx",   name: "Small Context",         maxContextTokens: 2000, qualityTier: "frontier" }),
    makeEndpoint({ id: "ep-degraded",   name: "Degraded",              status: "degraded", qualityTier: "frontier" }),
  ];

  it("excludes inactive and retired endpoints", () => {
    const decision = routeTask(endpoints, toolTask, "internal", []);
    expect(decision.candidates.find((c) => c.endpointId === "ep-inactive")?.excluded).toBe(true);
    expect(decision.candidates.find((c) => c.endpointId === "ep-retired")?.excluded).toBe(true);
  });

  it("excludes endpoints with insufficient sensitivity clearance", () => {
    const decision = routeTask(endpoints, toolTask, "confidential", []);
    const c = decision.candidates.find((c) => c.endpointId === "ep-noclearance")!;
    expect(c.excluded).toBe(true);
    expect(c.excludedReason).toMatch(/sensitivity/);
  });

  it("excludes endpoints without tool support when task requires it", () => {
    const decision = routeTask(endpoints, toolTask, "internal", []);
    const c = decision.candidates.find((c) => c.endpointId === "ep-notool")!;
    expect(c.excluded).toBe(true);
    expect(c.excludedReason).toMatch(/tool support/);
  });

  it("excludes endpoints with context window too small", () => {
    const decision = routeTask(endpoints, contextTask, "internal", []);
    const c = decision.candidates.find((c) => c.endpointId === "ep-smallctx")!;
    expect(c.excluded).toBe(true);
    expect(c.excludedReason).toMatch(/context window/);
  });

  it("includes active and degraded endpoints that pass all checks", () => {
    const decision = routeTask(endpoints, toolTask, "internal", []);
    expect(decision.candidates.find((c) => c.endpointId === "ep-active")?.excluded).toBe(false);
    expect(decision.candidates.find((c) => c.endpointId === "ep-degraded")?.excluded).toBe(false);
  });
});

// ── Stage 2 & 3: Score & Rank ─────────────────────────────────────────────────

const scoringEndpoints: EndpointManifest[] = [
  makeEndpoint({ id: "ep-quality",  name: "Quality King",    reasoning: 95, codegen: 92, instructionFollowing: 90, costPerOutputMToken: 15.0, recentFailureRate: 0.01, avgLatencyMs: 800,  qualityTier: "frontier" }),
  makeEndpoint({ id: "ep-cost",     name: "Cost Saver",      reasoning: 70, codegen: 65, instructionFollowing: 70, costPerOutputMToken: 0.8,  recentFailureRate: 0.05, avgLatencyMs: 1200, qualityTier: "frontier" }),
  makeEndpoint({ id: "ep-balanced", name: "Balanced Choice", reasoning: 85, codegen: 80, instructionFollowing: 82, costPerOutputMToken: 3.0,  recentFailureRate: 0.02, avgLatencyMs: 900,  qualityTier: "frontier" }),
  makeEndpoint({ id: "ep-degraded", name: "Degraded King",   reasoning: 95, codegen: 92, instructionFollowing: 90, costPerOutputMToken: 15.0, recentFailureRate: 0.25, avgLatencyMs: 2500, qualityTier: "frontier", status: "degraded" }),
  makeEndpoint({ id: "ep-tiebreak", name: "Tie Breaker",     reasoning: 85, codegen: 80, instructionFollowing: 82, costPerOutputMToken: 3.0,  recentFailureRate: 0.01, avgLatencyMs: 850,  qualityTier: "frontier" }),
];

const qualityTask: TaskRequirement = {
  ...BUILT_IN_TASK_REQUIREMENTS["code-gen"]!,
  preferCheap: false,
  preferredMinScores: { codegen: 80, instructionFollowing: 70 },
  minimumTier: undefined, // disable tier gate so all endpoints compete
};

const cheapTask: TaskRequirement = { ...qualityTask, preferCheap: true };

describe("routeTask — Stage 2 & 3: Score & Rank", () => {
  it("selects highest quality endpoint when preferCheap=false", () => {
    const decision = routeTask(scoringEndpoints, qualityTask, "internal", []);
    expect(decision.selectedEndpointId).toBe("ep-quality");
  });

  it("selects cheapest-viable endpoint when preferCheap=true", () => {
    // Algorithm: 60% quality + 40% cost efficiency blend.
    // ep-tiebreak (quality≈81, cost=$3) beats ep-cost (quality≈67, cost=$0.8)
    // because the 60% quality weight outweighs the cost advantage of ep-cost.
    const decision = routeTask(scoringEndpoints, cheapTask, "internal", []);
    expect(decision.selectedEndpointId).toBe("ep-tiebreak");
  });

  it("applies 30% penalty to degraded endpoints", () => {
    const decision = routeTask(scoringEndpoints, qualityTask, "internal", []);
    const degraded = decision.candidates.find((c) => c.endpointId === "ep-degraded")!;
    const quality  = decision.candidates.find((c) => c.endpointId === "ep-quality")!;
    expect(degraded.fitnessScore).toBeLessThan(quality.fitnessScore);
    expect(degraded.fitnessScore).toBeCloseTo(quality.fitnessScore * 0.7, 1);
  });

  it("breaks ties by failure rate then latency", () => {
    const decision = routeTask(scoringEndpoints, qualityTask, "internal", []);
    // ep-tiebreak and ep-balanced share identical dimension scores and cost.
    // ep-tiebreak has lower recentFailureRate (0.01 vs 0.02) → appears first in fallbackChain.
    // Use fallbackChain (ranked order) not decision.candidates (insertion order).
    const fallback = [decision.selectedEndpointId!, ...decision.fallbackChain];
    const tiebreakerRank = fallback.indexOf("ep-tiebreak");
    const balancedRank   = fallback.indexOf("ep-balanced");
    expect(tiebreakerRank).toBeLessThan(balancedRank);
  });

  it("decision includes providerId and modelId on selected candidate", () => {
    const decision = routeTask(scoringEndpoints, qualityTask, "internal", []);
    expect(decision.selectedProviderId).toBeTruthy();
    expect(decision.selectedModelId).toBeTruthy();
  });
});

// ── Snapshot regression ───────────────────────────────────────────────────────

describe("routeTask — Regression Snapshots", () => {
  it("produces a stable decision for quality-first task", () => {
    const decision = routeTask(scoringEndpoints, qualityTask, "internal", []);
    const stable = {
      ...decision,
      timestamp: "mock-timestamp",
      candidates: decision.candidates.map((c) => ({
        ...c,
        fitnessScore: parseFloat(c.fitnessScore.toFixed(2)),
      })),
    };
    expect(stable).toMatchSnapshot();
  });

  it("produces a stable decision for cost-first task", () => {
    const decision = routeTask(scoringEndpoints, cheapTask, "internal", []);
    const stable = {
      ...decision,
      timestamp: "mock-timestamp",
      candidates: decision.candidates.map((c) => ({
        ...c,
        fitnessScore: parseFloat(c.fitnessScore.toFixed(2)),
      })),
    };
    expect(stable).toMatchSnapshot();
  });
});
