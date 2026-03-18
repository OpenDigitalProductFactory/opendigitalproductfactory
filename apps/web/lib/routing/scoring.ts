/**
 * EP-INF-001 Phase 3: Routing fitness scoring.
 * Pure function — no DB access, no side effects.
 * See: docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md
 */

import type { EndpointManifest, TaskRequirementContract } from "./types";
import { BUILTIN_DIMENSIONS } from "./types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FitnessResult {
  fitness: number;
  dimensionScores: Record<string, number>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Retrieve a named capability score from an endpoint.
 * Checks built-in dimension fields first, then falls back to customScores.
 */
export function getDimensionScore(
  endpoint: EndpointManifest,
  dimension: string
): number {
  if ((BUILTIN_DIMENSIONS as readonly string[]).includes(dimension)) {
    const value = (endpoint as unknown as Record<string, unknown>)[dimension];
    if (typeof value === "number") return value;
  }
  return endpoint.customScores[dimension] ?? 0;
}

// ── normalizeWeights ─────────────────────────────────────────────────────────

/**
 * Normalise a preferredMinScores map so values sum to 1.
 * Empty input returns empty output.
 */
export function normalizeWeights(
  preferredMinScores: Record<string, number>
): Record<string, number> {
  const entries = Object.entries(preferredMinScores);
  if (entries.length === 0) return {};

  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (total === 0) return Object.fromEntries(entries.map(([k]) => [k, 0]));

  return Object.fromEntries(entries.map(([k, v]) => [k, v / total]));
}

// ── computeFitness ───────────────────────────────────────────────────────────

/**
 * Score an endpoint against a task requirement.
 *
 * Formula:
 *   qualityFitness  = Σ (endpointScore × weight)     (weighted average across preferred dimensions)
 *   if preferCheap  = 0.6 × qualityFitness + 0.4 × costFactor×100
 *   statusMultiplier: active=1.0, degraded=0.7, everything else=0
 *
 * costFactor: (1 - cost/maxCostInPool) × 100. Null cost (local) → cost=0 (best).
 */
export function computeFitness(
  endpoint: EndpointManifest,
  requirement: TaskRequirementContract,
  allEndpoints: EndpointManifest[]
): FitnessResult {
  const weights = normalizeWeights(requirement.preferredMinScores);

  // Build dimension trace (raw endpoint values for each required dimension)
  const dimensionScores: Record<string, number> = {};
  for (const dim of Object.keys(weights)) {
    dimensionScores[dim] = getDimensionScore(endpoint, dim);
  }

  // Quality fitness: weighted sum of dimension scores
  let qualityFitness = 0;
  for (const [dim, weight] of Object.entries(weights)) {
    qualityFitness += dimensionScores[dim] * weight;
  }

  let score: number;

  if (requirement.preferCheap) {
    // Determine max cost across the pool (null cost = 0, i.e. free/local)
    const costs = allEndpoints.map((ep) => ep.costPerOutputMToken ?? 0);
    const maxCost = Math.max(...costs);

    const endpointCost = endpoint.costPerOutputMToken ?? 0;
    const costFactor = maxCost > 0 ? (1 - endpointCost / maxCost) * 100 : 100;

    score = 0.6 * qualityFitness + 0.4 * costFactor;
  } else {
    score = qualityFitness;
  }

  // Status multiplier
  const statusMultiplier =
    endpoint.status === "active"
      ? 1.0
      : endpoint.status === "degraded"
        ? 0.7
        : 0;

  return {
    fitness: score * statusMultiplier,
    dimensionScores,
  };
}
