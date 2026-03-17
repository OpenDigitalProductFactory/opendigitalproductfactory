// apps/web/lib/agent-router.test.ts
// TDD RED → GREEN tests for the unified MCP agent router.

import { describe, expect, it } from "vitest";
import { routeTask, routePrimary, routeSubtask } from "./agent-router";
import type { EndpointCandidate, TaskRequest } from "./agent-router-types";

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
    // Only ollama-llama (analytical) and ollama-phi (basic) have restricted clearance + active
    // Highest tier = analytical → ollama-llama
    expect(result).not.toBeNull();
    expect(result!.endpointId).toBe("ollama-llama");
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
