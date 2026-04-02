// apps/web/lib/agent-router-types.ts
// Core types for the unified MCP agent router.

export type SensitivityLevel = "public" | "internal" | "confidential" | "restricted";
export type CapabilityTier = "basic" | "routine" | "analytical" | "deep-thinker";
export type CostBand = "free" | "low" | "medium" | "high";

export type TaskRequest = {
  sensitivity: SensitivityLevel;
  minCapabilityTier: CapabilityTier;
  requiredTags?: string[];
  preferCheap?: boolean;
  /** Filter to a specific endpoint type (e.g., "llm" excludes service endpoints like Brave Search) */
  requiredEndpointType?: "llm" | "service";
};

export type EndpointCandidate = {
  endpointId: string;
  endpointType: "llm" | "service";
  sensitivityClearance: SensitivityLevel[];
  capabilityTier: CapabilityTier;
  costBand: CostBand;
  taskTags: string[];
  status: string;
  avgLatencyMs?: number;
  recentFailures?: number;
};

export type RouteResult = {
  endpointId: string;
  reason: string;
} | null;
