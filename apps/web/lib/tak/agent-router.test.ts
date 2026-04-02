// apps/web/lib/agent-router.test.ts
// TDD RED → GREEN tests for the unified MCP agent router.

import { describe, expect, it } from "vitest";
import { routeTask, routePrimary, routeSubtask, routeWithPerformance } from "./agent-router";
import type { EndpointCandidate, TaskRequest } from "./agent-router-types";
import type { PerformanceProfile } from "./agent-router-data";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ollamaLlama: EndpointCandidate = {
  endpointId: "ollama-llama",
  endpointType: "llm",
  sensitivityClearance: ["public", "internal", "confidential", "restricted"],
  capabilityTier: "analytical",
  costBand: "free",
  taskTags: ["reasoning", "summarization"],
  status: "active",
  avgLatencyMs: 200,
  recentFailures: 0,
};

const ollamaPhi: EndpointCandidate = {
  endpointId: "ollama-phi",
  endpointType: "llm",
  sensitivityClearance: ["public", "internal", "confidential", "restricted"],
  capabilityTier: "basic",
  costBand: "free",
  taskTags: ["summarization", "data-extraction"],
  status: "active",
  avgLatencyMs: 100,
  recentFailures: 0,
};

const openrouter: EndpointCandidate = {
  endpointId: "openrouter",
  endpointType: "llm",
  sensitivityClearance: ["public", "internal"],
  capabilityTier: "deep-thinker",
  costBand: "medium",
  taskTags: ["reasoning", "code-gen"],
  status: "active",
  avgLatencyMs: 500,
  recentFailures: 0,
};

const braveSearch: EndpointCandidate = {
  endpointId: "brave-search",
  endpointType: "service",
  sensitivityClearance: ["public", "internal"],
  capabilityTier: "basic",
  costBand: "low",
  taskTags: ["web-search"],
  status: "active",
  avgLatencyMs: 300,
  recentFailures: 0,
};

const inactiveProvider: EndpointCandidate = {
  endpointId: "inactive-provider",
  endpointType: "llm",
  sensitivityClearance: ["public", "internal", "confidential", "restricted"],
  capabilityTier: "deep-thinker",
  costBand: "free",
  taskTags: ["reasoning"],
  status: "inactive",
  avgLatencyMs: 150,
  recentFailures: 0,
};

const ALL_ENDPOINTS = [ollamaLlama, ollamaPhi, openrouter, braveSearch, inactiveProvider];

// ─── routeTask ───────────────────────────────────────────────────────────────

describe("routeTask", () => {
  it("filters out endpoints not cleared for page sensitivity", () => {
    const request: TaskRequest = {
      sensitivity: "confidential",
      minCapabilityTier: "basic",
    };
    const result = routeTask(ALL_ENDPOINTS, request);
    // openrouter and brave-search are only public+internal, so they should be excluded.
    // inactive-provider is inactive. Only ollama-llama and ollama-phi remain.
    expect(result).not.toBeNull();
    expect(result!.endpointId).not.toBe("openrouter");
    expect(result!.endpointId).not.toBe("brave-search");
    expect(result!.endpointId).not.toBe("inactive-provider");
  });

  it("filters by required task tags — only matching endpoints returned", () => {
    const request: TaskRequest = {
      sensitivity: "public",
      minCapabilityTier: "basic",
      requiredTags: ["web-search"],
    };
    const result = routeTask(ALL_ENDPOINTS, request);
    // Only brave-search has the web-search tag
    expect(result).not.toBeNull();
    expect(result!.endpointId).toBe("brave-search");
  });

  it("excludes inactive endpoints", () => {
    const request: TaskRequest = {
      sensitivity: "restricted",
      minCapabilityTier: "deep-thinker",
    };
    // inactive-provider is deep-thinker + restricted-cleared but inactive
    const result = routeTask(ALL_ENDPOINTS, request);
    // No deep-thinker with restricted clearance + active exists
    expect(result).toBeNull();
  });

  it("returns null when no endpoints match", () => {
    const request: TaskRequest = {
      sensitivity: "restricted",
      minCapabilityTier: "deep-thinker",
      requiredTags: ["code-gen"],
    };
    const result = routeTask(ALL_ENDPOINTS, request);
    expect(result).toBeNull();
  });

  it("prefers cheapest cost band meeting capability tier (when preferCheap=true)", () => {
    const request: TaskRequest = {
      sensitivity: "public",
      minCapabilityTier: "basic",
      requiredTags: ["reasoning"],
      preferCheap: true,
    };
    // Eligible: ollama-llama (free, analytical), openrouter (medium, deep-thinker)
    // inactive-provider is excluded. preferCheap → cheapest first → ollama-llama
    const result = routeTask(ALL_ENDPOINTS, request);
    expect(result).not.toBeNull();
    expect(result!.endpointId).toBe("ollama-llama");
  });

  it("tiebreaker: prefers lowest latency", () => {
    const request: TaskRequest = {
      sensitivity: "public",
      minCapabilityTier: "basic",
      requiredTags: ["summarization"],
      preferCheap: true,
    };
    // Eligible: ollama-llama (free, 200ms), ollama-phi (free, 100ms)
    // Both are free — tiebreaker by latency → ollama-phi wins
    const result = routeTask(ALL_ENDPOINTS, request);
    expect(result).not.toBeNull();
    expect(result!.endpointId).toBe("ollama-phi");
  });

  it("filters by requiredEndpointType", () => {
    const request: TaskRequest = {
      sensitivity: "public",
      minCapabilityTier: "basic",
      requiredEndpointType: "llm",
    };
    // brave-search is a service endpoint → excluded
    const result = routeTask(ALL_ENDPOINTS, request);
    expect(result).not.toBeNull();
    expect(result!.endpointId).not.toBe("brave-search");
  });
});

// ─── routePrimary ────────────────────────────────────────────────────────────

describe("routePrimary", () => {
  it("selects highest-tier eligible endpoint", () => {
    const result = routePrimary(ALL_ENDPOINTS, "public");
    // Highest tier with public clearance + active: openrouter (deep-thinker)
    expect(result).not.toBeNull();
    expect(result!.endpointId).toBe("openrouter");
  });

  it("falls back when highest tier not cleared", () => {
    const result = routePrimary(ALL_ENDPOINTS, "restricted");
    // Only ollama-llama (analytical, LLM) has restricted clearance + active + analytical+ tier
    // ollama-phi is basic tier (below analytical minimum) → excluded
    expect(result).not.toBeNull();
    expect(result!.endpointId).toBe("ollama-llama");
  });

  it("excludes service endpoints from primary routing", () => {
    // Even if brave-search were the only option for a sensitivity level, it shouldn't be selected
    const result = routePrimary([braveSearch], "public");
    expect(result).toBeNull(); // No LLM endpoints available
  });

  it("excludes basic-tier LLMs from primary routing", () => {
    const result = routePrimary([ollamaPhi], "public");
    expect(result).toBeNull(); // ollama-phi is basic tier, below analytical minimum
  });
});

// ─── routeSubtask ────────────────────────────────────────────────────────────

describe("routeSubtask", () => {
  it("selects cheapest eligible endpoint", () => {
    const result = routeSubtask(ALL_ENDPOINTS, "public");
    // All active + public-cleared: ollama-llama (free,200ms), ollama-phi (free,100ms),
    // openrouter (medium,500ms), brave-search (low,300ms)
    // Cheapest = free. Two free → tiebreaker latency → ollama-phi (100ms)
    expect(result).not.toBeNull();
    expect(result!.endpointId).toBe("ollama-phi");
  });
});

// ─── routeWithPerformance ───────────────────────────────────────────────────

describe("routeWithPerformance", () => {
  const profiles: PerformanceProfile[] = [
    {
      endpointId: "ollama-llama", taskType: "summarization",
      evaluationCount: 20, avgOrchestratorScore: 4.0, avgHumanScore: null,
      successCount: 18, recentScores: [4, 4, 4, 3, 5],
      instructionPhase: "practicing", currentInstructions: null,
      pinned: false, blocked: false,
    },
    {
      endpointId: "ollama-phi", taskType: "summarization",
      evaluationCount: 15, avgOrchestratorScore: 3.5, avgHumanScore: null,
      successCount: 12, recentScores: [3, 4, 3, 4, 3],
      instructionPhase: "learning", currentInstructions: "Be concise",
      pinned: false, blocked: false,
    },
  ];

  it("selects endpoint with best quality/cost ratio", () => {
    const result = routeWithPerformance(ALL_ENDPOINTS, profiles, {
      sensitivity: "internal", minCapabilityTier: "basic", taskType: "summarization",
    });
    expect(result?.endpointId).toBe("ollama-llama"); // 4.0/1 > 3.5/1
  });

  it("respects pinned override", () => {
    const pinnedProfiles = profiles.map((p) =>
      p.endpointId === "ollama-phi" ? { ...p, pinned: true } : p
    );
    const result = routeWithPerformance(ALL_ENDPOINTS, pinnedProfiles, {
      sensitivity: "internal", minCapabilityTier: "basic", taskType: "summarization",
    });
    expect(result?.endpointId).toBe("ollama-phi");
  });

  it("excludes blocked endpoints", () => {
    const blockedProfiles = profiles.map((p) =>
      p.endpointId === "ollama-llama" ? { ...p, blocked: true } : p
    );
    const result = routeWithPerformance(ALL_ENDPOINTS, blockedProfiles, {
      sensitivity: "internal", minCapabilityTier: "basic", taskType: "summarization",
    });
    expect(result?.endpointId).toBe("ollama-phi");
  });

  it("falls back to tier for cold-start endpoints", () => {
    const result = routeWithPerformance(ALL_ENDPOINTS, [], {
      sensitivity: "internal", minCapabilityTier: "basic", taskType: "summarization",
    });
    // ollama-llama (analytical=3/free=1=3.0) beats openrouter (deep-thinker=4/medium=3=1.33)
    expect(result?.endpointId).toBe("ollama-llama");
  });
});
