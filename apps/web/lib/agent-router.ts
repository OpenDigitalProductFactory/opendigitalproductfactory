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
import type { PerformanceProfile } from "./agent-router-data";

const TIER_ORDER: Record<CapabilityTier, number> = {
  "basic": 1,
  "routine": 2,
  "analytical": 3,
  "deep-thinker": 4,
};

const COST_WEIGHT: Record<CostBand, number> = {
  "free": 1,
  "low": 2,
  "medium": 3,
  "high": 4,
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
    const aCost = COST_WEIGHT[a.costBand];
    const bCost = COST_WEIGHT[b.costBand];

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

// ─── Performance-Weighted Routing ───────────────────────────────────────────

const MIN_EVALUATIONS = 5;

function avgEffectiveScore(perf: PerformanceProfile): number {
  if (perf.avgHumanScore !== null && perf.avgHumanScore > 0) {
    return 0.6 * perf.avgHumanScore + 0.4 * perf.avgOrchestratorScore;
  }
  return perf.avgOrchestratorScore;
}

/**
 * Route using performance profiles — selects the endpoint with the best
 * quality/cost ratio. Supports pinned overrides and blocked exclusions.
 * Falls back to tier-based scoring for cold-start endpoints.
 */
export function routeWithPerformance(
  endpoints: EndpointCandidate[],
  profiles: PerformanceProfile[],
  request: TaskRequest & { taskType: string },
): RouteResult {
  const eligible = filterEligible(endpoints, request);
  if (eligible.length === 0) return null;

  const profileMap = new Map(profiles.map((p) => [p.endpointId, p]));

  // Pinned override
  const pinned = eligible.find((ep) => profileMap.get(ep.endpointId)?.pinned);
  if (pinned) return { endpointId: pinned.endpointId, reason: "pinned" };

  // Block filter
  const unblocked = eligible.filter((ep) => !profileMap.get(ep.endpointId)?.blocked);
  if (unblocked.length === 0) return null;

  // Score
  const scored = unblocked.map((ep) => {
    const perf = profileMap.get(ep.endpointId);
    let score: number;
    if (perf && perf.evaluationCount >= MIN_EVALUATIONS) {
      score = avgEffectiveScore(perf) / COST_WEIGHT[ep.costBand];
    } else {
      score = TIER_ORDER[ep.capabilityTier] / COST_WEIGHT[ep.costBand];
    }
    return { ep, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const latDiff = (a.ep.avgLatencyMs ?? Infinity) - (b.ep.avgLatencyMs ?? Infinity);
    if (latDiff !== 0) return latDiff;
    const failDiff = (a.ep.recentFailures ?? 0) - (b.ep.recentFailures ?? 0);
    if (failDiff !== 0) return failDiff;
    return a.ep.endpointId.localeCompare(b.ep.endpointId);
  });

  const best = scored[0]!;
  return { endpointId: best.ep.endpointId, reason: `score=${best.score.toFixed(2)}` };
}
