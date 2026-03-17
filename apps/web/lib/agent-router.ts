// apps/web/lib/agent-router.ts
// Unified MCP agent router — sensitivity x capability x cost matching.
// Replaces ai-provider-priority.ts failover logic for the coworker architecture.

import type {
  EndpointCandidate,
  TaskRequest,
  RouteResult,
  CapabilityTier,
  CostBand,
  SensitivityLevel,
} from "./agent-router-types";

const TIER_ORDER: Record<CapabilityTier, number> = {
  "basic": 1,
  "routine": 2,
  "analytical": 3,
  "deep-thinker": 4,
};

const COST_ORDER: Record<CostBand, number> = {
  "free": 0,
  "low": 1,
  "medium": 2,
  "high": 3,
};

// ─── Filter ──────────────────────────────────────────────────────────────────

/**
 * Filter endpoints to those eligible for the given task request.
 * Checks: status=active, sensitivity clearance, capability tier >= min, required tags.
 */
export function filterEligible(
  endpoints: EndpointCandidate[],
  request: TaskRequest,
): EndpointCandidate[] {
  return endpoints.filter((ep) => {
    // Must be active
    if (ep.status !== "active") return false;

    // Must be cleared for the request's sensitivity level
    if (!ep.sensitivityClearance.includes(request.sensitivity)) return false;

    // Capability tier must meet or exceed the minimum
    if (TIER_ORDER[ep.capabilityTier] < TIER_ORDER[request.minCapabilityTier]) return false;

    // Must have all required tags (if specified)
    if (request.requiredTags && request.requiredTags.length > 0) {
      const hasAllTags = request.requiredTags.every((tag) => ep.taskTags.includes(tag));
      if (!hasAllTags) return false;
    }

    return true;
  });
}

// ─── Rank ────────────────────────────────────────────────────────────────────

/**
 * Sort eligible endpoints by preference.
 * - preferCheap=true: cost asc, then tier desc
 * - preferCheap=false: tier desc, then cost asc
 * Tiebreakers: latency asc, failures asc, alphabetical endpointId.
 */
export function rankEndpoints(
  endpoints: EndpointCandidate[],
  preferCheap: boolean,
): EndpointCandidate[] {
  return [...endpoints].sort((a, b) => {
    const aTier = TIER_ORDER[a.capabilityTier];
    const bTier = TIER_ORDER[b.capabilityTier];
    const aCost = COST_ORDER[a.costBand];
    const bCost = COST_ORDER[b.costBand];

    // Tiebreaker values computed once
    const aLatency = a.avgLatencyMs ?? Number.MAX_SAFE_INTEGER;
    const bLatency = b.avgLatencyMs ?? Number.MAX_SAFE_INTEGER;
    const aFailures = a.recentFailures ?? 0;
    const bFailures = b.recentFailures ?? 0;

    if (preferCheap) {
      // Cheapest-first: cost → latency → failures → tier → alphabetical
      if (aCost !== bCost) return aCost - bCost;
      if (aLatency !== bLatency) return aLatency - bLatency;
      if (aFailures !== bFailures) return aFailures - bFailures;
      if (aTier !== bTier) return bTier - aTier;
    } else {
      // Highest-tier-first: tier → cost → latency → failures → alphabetical
      if (aTier !== bTier) return bTier - aTier;
      if (aCost !== bCost) return aCost - bCost;
      if (aLatency !== bLatency) return aLatency - bLatency;
      if (aFailures !== bFailures) return aFailures - bFailures;
    }

    // Tiebreaker 3: alphabetical endpointId
    return a.endpointId.localeCompare(b.endpointId);
  });
}

// ─── Route ───────────────────────────────────────────────────────────────────

/**
 * Core routing: filter eligible endpoints, rank them, return the best match.
 * Returns null when no endpoint qualifies.
 */
export function routeTask(
  endpoints: EndpointCandidate[],
  request: TaskRequest,
): RouteResult {
  const eligible = filterEligible(endpoints, request);
  if (eligible.length === 0) return null;

  const ranked = rankEndpoints(eligible, request.preferCheap ?? false);
  const best = ranked[0]!;

  return {
    endpointId: best.endpointId,
    reason: `${best.capabilityTier} tier, ${best.costBand} cost, cleared for ${request.sensitivity}`,
  };
}

/**
 * Route primary inference — selects the highest-tier eligible endpoint.
 * Used for the main LLM call in a conversation turn.
 */
export function routePrimary(
  endpoints: EndpointCandidate[],
  sensitivity: SensitivityLevel,
): RouteResult {
  return routeTask(endpoints, {
    sensitivity,
    minCapabilityTier: "basic",
    preferCheap: false,
  });
}

/**
 * Route a sub-task — selects the cheapest eligible endpoint.
 * Used for tool calls, summarization, data extraction, etc.
 */
export function routeSubtask(
  endpoints: EndpointCandidate[],
  sensitivity: SensitivityLevel,
  options?: { minCapabilityTier?: CapabilityTier; requiredTags?: string[] },
): RouteResult {
  return routeTask(endpoints, {
    sensitivity,
    minCapabilityTier: options?.minCapabilityTier ?? "basic",
    requiredTags: options?.requiredTags,
    preferCheap: true,
  });
}
