/**
 * EP-INF-005a: Cost-per-success ranking for contract-based selection.
 * See: docs/superpowers/specs/2026-03-20-contract-based-selection-design.md §3
 */

import type { EndpointManifest } from "./types";
import type { ModelCardPricing } from "./model-card-types";
import type { RequestContract } from "./request-contract";
import { getDimensionsForTask } from "./production-feedback";
import { NON_ACTING_BRIDGE_CONFIG } from "./non-acting-bridge-config";

// ── Quality Floors ──────────────────────────────────────────────────────────

const REASONING_DEPTH_FLOORS: Record<string, number> = {
  minimal: 30,
  low: 45,
  medium: 60,
  high: 75,
};

// ── Dimension Score Lookup ───────────────────────────────────────────────────

function getDimensionScore(ep: EndpointManifest, dim: string): number {
  const scores: Record<string, number> = {
    reasoning: ep.reasoning,
    codegen: ep.codegen,
    toolFidelity: ep.toolFidelity,
    instructionFollowing: ep.instructionFollowing,
    structuredOutput: ep.structuredOutput,
    conversational: ep.conversational,
    contextRetention: ep.contextRetention,
  };
  return scores[dim] ?? 50;
}

export function satisfiesMinimumDimensions(
  endpoint: EndpointManifest,
  minimumDimensions: Readonly<Record<string, number>> | undefined,
): boolean {
  return firstUnmetDimension(endpoint, minimumDimensions) === null;
}

/**
 * BI-16A1B4A3 — which dimension actually failed, and by how much.
 *
 * "Minimum quality dimensions not met" is true but unactionable: on a live
 * install every endpoint cleared codegen and reasoning and failed only
 * toolFidelity, by three points, and nothing said so. An owner cannot act on a
 * floor whose failing dimension is never named, so the gap is reported.
 *
 * Returns null when the endpoint satisfies every declared minimum.
 */
export function firstUnmetDimension(
  endpoint: EndpointManifest,
  minimumDimensions: Readonly<Record<string, number>> | undefined,
): { dimension: string; actual: number; minimum: number } | null {
  if (!minimumDimensions) return null;
  for (const [dimension, minimum] of Object.entries(minimumDimensions)) {
    const actual = getDimensionScore(endpoint, dimension);
    if (actual < minimum) return { dimension, actual, minimum };
  }
  return null;
}

// ── Average Relevant Dimensions ─────────────────────────────────────────────

/**
 * Compute the weighted average of dimension scores relevant to a task type.
 * Returns 50 (neutral) when the task type has no mapped dimensions.
 */
export function averageRelevantDimensions(
  endpoint: EndpointManifest,
  taskType: string,
): number {
  const mappings = getDimensionsForTask(taskType);
  if (mappings.length === 0) return 50;

  let totalScore = 0;
  let totalWeight = 0;
  for (const { dimension, weight } of mappings) {
    totalScore += getDimensionScore(endpoint, dimension) * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? totalScore / totalWeight : 50;
}

// ── Estimated Cost ──────────────────────────────────────────────────────────

/**
 * Estimate the cost of a request against a model's pricing.
 * Returns null when pricing is unknown (not zero — null means unknown).
 * Returns 0 for free models.
 */
export function estimateCost(
  endpoint: { pricing: ModelCardPricing },
  contract: { estimatedInputTokens: number; estimatedOutputTokens: number },
): number | null {
  const p = endpoint.pricing;
  if (p.inputPerMToken === null || p.outputPerMToken === null) return null;

  const inputCost = (contract.estimatedInputTokens / 1_000_000) * p.inputPerMToken;
  const outputCost = (contract.estimatedOutputTokens / 1_000_000) * p.outputPerMToken;
  return inputCost + outputCost;
}

// ── Estimated Success Probability ───────────────────────────────────────────

/**
 * DPF2-REMOVABLE BRIDGE INPUT.
 *
 * The aggregated non-acting penalty for *this exact endpoint and task*. The
 * caller derives it from the failed non-acting RouteOutcome rows for the route
 * (toolSuccess=false with NON_ACTING_BRIDGE_CONFIG.nonActingProviderErrorCode);
 * this module only consumes failureCount + lastFailureAt to compute a
 * time-decayed penalty. Remove at the DPF2 cutover together with the rest of
 * the non-acting bridge (see non-acting-bridge-config.ts).
 */
export interface EndpointActionFailurePenalty {
  /** Number of recorded non-acting failures for this endpoint+task. */
  failureCount: number;
  /** When the most recent non-acting failure was recorded. */
  lastFailureAt: Date;
}

export interface EstimateSuccessProbabilityOptions {
  /**
   * Aggregated non-acting penalty for this candidate endpoint+task (derived
   * from the route's non-acting RouteOutcome rows), or null/undefined when none
   * is recorded. Only applied for `tool-action`-class contracts.
   */
  actionFailureTally?: EndpointActionFailurePenalty | null;
  /** Reference time (ms epoch) for decay; defaults to Date.now(). Testability hook. */
  now?: number;
}

/**
 * DPF2-REMOVABLE. Time-decayed, endpoint-scoped penalty factor for a recorded
 * non-acting failure. Returns a multiplier in [penaltyFloor, 1]:
 *
 *   factor = 1 - penaltyBaseWeight * failureCount
 *              * exp(-ageMs * ln2 / penaltyDecayHalfLifeMs)
 *
 * The factor is 1 (no penalty) when the task type is not non-acting-eligible,
 * when there is no tally, or when the recorded failure has fully decayed. It
 * multiplies — never replaces — the base success probability, so the
 * provider-wide recentFailureRate and the rankByCostPerSuccess formula are
 * untouched; only this one endpoint's successProb moves, and it recovers on its
 * own as the failure ages past the half-life.
 */
function endpointActionPenaltyFactor(
  contract: RequestContract,
  options: EstimateSuccessProbabilityOptions | undefined,
): number {
  const tally = options?.actionFailureTally;
  if (!tally || tally.failureCount <= 0) return 1;

  // Non-acting detection/penalty is restricted to tool-action-class tasks.
  const eligible = NON_ACTING_BRIDGE_CONFIG.eligibleTaskTypes as readonly string[];
  if (!eligible.includes(contract.taskType)) return 1;

  const { penaltyBaseWeight, penaltyDecayHalfLifeMs, penaltyFloor } = NON_ACTING_BRIDGE_CONFIG;
  const now = options?.now ?? Date.now();
  const ageMs = Math.max(0, now - tally.lastFailureAt.getTime());
  const decay = Math.exp((-ageMs * Math.LN2) / penaltyDecayHalfLifeMs);
  const factor = 1 - penaltyBaseWeight * tally.failureCount * decay;

  return Math.min(1, Math.max(penaltyFloor, factor));
}

/**
 * Estimate the probability that a model will succeed at a request.
 * Uses capability checks, quality floors, and historical failure rate.
 *
 * When a non-acting penalty is supplied (bridge, tool-action only; derived from
 * the route's failed non-acting RouteOutcome rows), the base probability is
 * further multiplied by a time-decayed, endpoint-scoped penalty so routing
 * steers away from the exact endpoint that recently refused to act, and
 * recovers automatically once the penalty decays.
 */
export function estimateSuccessProbability(
  endpoint: EndpointManifest,
  contract: RequestContract,
  options?: EstimateSuccessProbabilityOptions,
): number {
  // Hard capability check — missing required capability = 0
  // Use !== true (not !value) because ModelCardCapabilities fields are boolean | null.
  // null means unknown = conservative exclusion.
  if (contract.requiresTools && endpoint.capabilities.toolUse !== true) return 0;
  if (contract.requiresStrictSchema && endpoint.capabilities.structuredOutput !== true) return 0;
  if (contract.requiresStreaming && endpoint.capabilities.streaming !== true) return 0;

  // Per-dimension minimum thresholds — hard exclude models below any threshold
  if (!satisfiesMinimumDimensions(endpoint, contract.minimumDimensions)) {
    return 0;
  }

  // Quality floor based on reasoning depth
  const qualityFloor = REASONING_DEPTH_FLOORS[contract.reasoningDepth] ?? 45;
  const avgScore = averageRelevantDimensions(endpoint, contract.taskType);
  if (avgScore < qualityFloor) return 0.3;

  // Base probability from historical success rate, discounted by profile confidence.
  // Low-confidence profiles (inferred from model name) are slightly deprioritized
  // versus medium/high-confidence profiles (from curated catalogs or evaluations).
  const confidenceMultiplier: Record<string, number> = {
    high: 1.0,
    medium: 0.95,
    low: 0.85,
  };
  const confFactor = confidenceMultiplier[endpoint.profileConfidence] ?? 0.9;
  const base = Math.max(1.0 - endpoint.recentFailureRate, 0.1) * confFactor;

  // Endpoint-scoped, time-decayed non-acting penalty (bridge; tool-action only).
  // Multiplies the base — leaves recentFailureRate and the ranker formula alone.
  return base * endpointActionPenaltyFactor(contract, options);
}

// ── Cost-Per-Success Ranking ────────────────────────────────────────────────

/**
 * Rank candidates by cost-per-success, respecting the contract's budget class.
 * Returns candidates sorted descending by rankScore (highest = best).
 */
// Capability tier is a strong prior on quality. When cost cannot differentiate
// candidates (all free) or the budget prioritizes quality, a higher-tier
// endpoint must outrank a lower-tier one — otherwise an active FRONTIER provider
// (Claude / Codex) ties an ADEQUATE local model on success-probability alone and
// the stable sort silently keeps local, stranding the good providers the
// operator configured. The scorer previously ignored tier entirely. (BI-654EE2E9.)
const TIER_QUALITY_MULTIPLIER: Record<string, number> = {
  frontier: 1.0,
  strong: 0.85,
  adequate: 0.6,
  basic: 0.4,
};

function tierQualityMultiplier(endpoint: EndpointManifest): number {
  const tier = (endpoint.qualityTier ?? "adequate") as string;
  return TIER_QUALITY_MULTIPLIER[tier] ?? TIER_QUALITY_MULTIPLIER.adequate;
}

export function rankByCostPerSuccess(
  candidates: Array<{ endpoint: EndpointManifest; successProb: number }>,
  contract: RequestContract,
): Array<{ endpoint: EndpointManifest; rankScore: number; estimatedCost: number | null }> {
  const ranked = candidates.map((c) => {
    const cost = estimateCost(c.endpoint, contract);
    const tierFactor = tierQualityMultiplier(c.endpoint);

    let rankScore: number;
    if (contract.budgetClass === "quality_first") {
      // Rank by quality — success probability weighted by capability tier.
      rankScore = c.successProb * 100 * tierFactor;
    } else if (cost === null) {
      // Unknown cost — penalized, ranked by quality only
      rankScore = c.successProb * 50 * tierFactor;
    } else if (cost === 0) {
      // Free endpoints (local AND subscription frontier) — cost cannot rank them,
      // so quality does: success probability weighted by capability tier, so a
      // free frontier provider beats a free adequate one instead of tying it.
      rankScore = c.successProb * 100 * tierFactor;
    } else {
      // Cost-per-success: lower is better
      const costPerSuccess = cost / c.successProb;
      // Invert so higher = better for sorting, scale for comparability
      rankScore = 1000 / costPerSuccess;

      if (contract.budgetClass === "balanced") {
        // Blend cost efficiency with quality
        rankScore = rankScore * 0.7 + c.successProb * 100 * 0.3;
      }
      // minimize_cost: pure cost-per-success (no quality blend)
    }

    return { endpoint: c.endpoint, rankScore, estimatedCost: cost };
  });

  ranked.sort((a, b) => b.rankScore - a.rankScore);
  return ranked;
}
