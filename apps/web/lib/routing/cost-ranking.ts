/**
 * EP-INF-005a: Cost-per-success ranking for contract-based selection.
 * See: docs/superpowers/specs/2026-03-20-contract-based-selection-design.md §3
 */

import type { EndpointManifest } from "./types";
import type { ModelCardPricing } from "./model-card-types";
import type { RequestContract } from "./request-contract";
import { getDimensionsForTask } from "./production-feedback";

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
 * Estimate the probability that a model will succeed at a request.
 * Uses capability checks, quality floors, and historical failure rate.
 */
export function estimateSuccessProbability(
  endpoint: EndpointManifest,
  contract: RequestContract,
): number {
  // Hard capability check — missing required capability = 0
  // Use !== true (not !value) because ModelCardCapabilities fields are boolean | null.
  // null means unknown = conservative exclusion.
  if (contract.requiresTools && endpoint.capabilities.toolUse !== true) return 0;
  if (contract.requiresStrictSchema && endpoint.capabilities.structuredOutput !== true) return 0;
  if (contract.requiresStreaming && endpoint.capabilities.streaming !== true) return 0;

  // Per-dimension minimum thresholds — hard exclude models below any threshold
  if (contract.minimumDimensions) {
    for (const [dim, min] of Object.entries(contract.minimumDimensions)) {
      if (getDimensionScore(endpoint, dim) < min) return 0;
    }
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
  return Math.max(1.0 - endpoint.recentFailureRate, 0.1) * confFactor;
}

// ── Cost-Per-Success Ranking ────────────────────────────────────────────────

/**
 * Rank candidates by cost-per-success, respecting the contract's budget class.
 * Returns candidates sorted descending by rankScore (highest = best).
 */
export function rankByCostPerSuccess(
  candidates: Array<{ endpoint: EndpointManifest; successProb: number }>,
  contract: RequestContract,
): Array<{ endpoint: EndpointManifest; rankScore: number; estimatedCost: number | null }> {
  const ranked = candidates.map((c) => {
    const cost = estimateCost(c.endpoint, contract);

    let rankScore: number;
    if (contract.budgetClass === "quality_first") {
      // Rank by success probability only
      rankScore = c.successProb * 100;
    } else if (cost === null) {
      // Unknown cost — penalized, ranked by quality only
      rankScore = c.successProb * 50;
    } else if (cost === 0) {
      // Free model (local) — ranked by quality
      rankScore = c.successProb * 100;
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
