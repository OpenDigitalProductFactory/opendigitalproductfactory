/**
 * EP-INF-012: TaskRequirement-based endpoint router.
 *
 * Four-stage pipeline:
 *   Stage 0:   Policy filter   — compliance/governance exclusions
 *   Stage 0.5: Tier gate       — exclude endpoints below minimumTier (EP-INF-012)
 *   Stage 1:   Hard filter     — binary capability and status checks
 *   Stage 2:   Score           — weighted dimension fitness + cost blend
 *   Stage 3:   Rank            — fitness → cost → failure rate → latency
 *   Stage 4:   Select + Explain
 *
 * The tier gate (0.5) is the routing equivalent of the "thinking cap": simple tasks
 * (adequate) never compete against frontier endpoints, keeping cost optimised without
 * sacrificing quality for tasks that genuinely need it.
 */

import type { EndpointManifest, SensitivityLevel } from "./types";
import { TIER_MINIMUM_DIMENSIONS, QUALITY_TIERS } from "./quality-tiers";
import type { QualityTier } from "./quality-tiers";
import type {
  TaskRequirement,
  PolicyRule,
  CandidateTrace,
  TaskRouteDecision,
} from "./task-router-types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function evaluateCondition(
  endpoint: EndpointManifest,
  condition: PolicyRule["condition"],
): boolean {
  const endpointValue = (endpoint as unknown as Record<string, unknown>)[condition.field];
  switch (condition.operator) {
    case "in":
      return condition.value.includes(endpointValue);
    case "not_in":
      return !condition.value.includes(endpointValue);
  }
}

function getDimensionScore(endpoint: EndpointManifest, dimension: string): number {
  // Built-in named dimensions map directly to EndpointManifest fields.
  const directFields: Record<string, keyof EndpointManifest> = {
    reasoning: "reasoning",
    codegen: "codegen",
    toolFidelity: "toolFidelity",
    instructionFollowing: "instructionFollowing",
    structuredOutput: "structuredOutput",
    conversational: "conversational",
    contextRetention: "contextRetention",
  };
  if (dimension in directFields) {
    const val = endpoint[directFields[dimension]!];
    return typeof val === "number" ? val : 0;
  }
  return endpoint.customScores?.[dimension] ?? 0;
}

function calculateDimensionWeights(
  scores: Record<string, number>,
): Record<string, number> {
  const total = Object.values(scores).reduce((sum, s) => sum + s, 0);
  if (total === 0) return {};
  return Object.fromEntries(
    Object.entries(scores).map(([dim, score]) => [dim, score / total]),
  );
}

/**
 * Returns the ordinal rank of a tier (lower = worse).
 * Used to decide whether an endpoint clears the minimumTier gate.
 */
function tierRank(tier: QualityTier): number {
  return QUALITY_TIERS.indexOf(tier); // frontier=0, strong=1, adequate=2, basic=3
}

// ── Main ───────────────────────────────────────────────────────────────────────

export function routeTask(
  endpoints: EndpointManifest[],
  taskRequirement: TaskRequirement,
  sensitivity: SensitivityLevel,
  policyRules: PolicyRule[],
): TaskRouteDecision {
  const candidates: CandidateTrace[] = [];
  const excludedReasons: Record<string, number> = {};

  // ── Stage 0: Policy filter ────────────────────────────────────────────────
  const policyRulesApplied: string[] = [];
  const policyExcluded = new Map<string, string>(); // endpointId → reason

  for (const rule of policyRules) {
    if (!rule.isActive) continue;
    policyRulesApplied.push(rule.id);
    for (const endpoint of endpoints) {
      if (!policyExcluded.has(endpoint.id) && evaluateCondition(endpoint, rule.condition)) {
        policyExcluded.set(endpoint.id, `Excluded by policy: ${rule.name}`);
      }
    }
  }

  // ── Stage 0.5: Tier gate ──────────────────────────────────────────────────
  const tierGateExcluded = new Map<string, string>(); // endpointId → reason
  if (taskRequirement.minimumTier) {
    const minRank = tierRank(taskRequirement.minimumTier);
    for (const endpoint of endpoints) {
      const epTier = endpoint.qualityTier ?? "adequate";
      if (tierRank(epTier) > minRank) {
        tierGateExcluded.set(
          endpoint.id,
          `Excluded: tier '${epTier}' is below required '${taskRequirement.minimumTier}'`,
        );
      }
    }
  }

  // ── Stage 1: Hard filter ──────────────────────────────────────────────────
  for (const endpoint of endpoints) {
    let excluded = false;
    let reason = "";

    const policyReason = policyExcluded.get(endpoint.id);
    const tierReason = tierGateExcluded.get(endpoint.id);

    if (policyReason) {
      excluded = true;
      reason = policyReason;
    } else if (tierReason) {
      excluded = true;
      reason = tierReason;
    } else if (endpoint.status !== "active" && endpoint.status !== "degraded") {
      excluded = true;
      reason = `Excluded: status is '${endpoint.status}'`;
    } else if (endpoint.retiredAt) {
      excluded = true;
      reason = "Excluded: endpoint is retired";
    } else if (!endpoint.sensitivityClearance.includes(sensitivity)) {
      excluded = true;
      reason = `Excluded: sensitivity clearance insufficient for '${sensitivity}'`;
    } else if (taskRequirement.requiredCapabilities.supportsToolUse && !endpoint.supportsToolUse) {
      excluded = true;
      reason = "Excluded: task requires tool support";
    } else if (taskRequirement.requiredCapabilities.supportsStructuredOutput && !endpoint.supportsStructuredOutput) {
      excluded = true;
      reason = "Excluded: task requires structured output";
    } else if (
      taskRequirement.requiredCapabilities.minContextTokens !== undefined &&
      endpoint.maxContextTokens !== null &&
      endpoint.maxContextTokens < taskRequirement.requiredCapabilities.minContextTokens
    ) {
      excluded = true;
      reason = `Excluded: context window ${endpoint.maxContextTokens} < required ${taskRequirement.requiredCapabilities.minContextTokens}`;
    }

    if (excluded) {
      excludedReasons[reason] = (excludedReasons[reason] ?? 0) + 1;
    }

    candidates.push({
      endpointId: endpoint.id,
      providerId: endpoint.providerId,
      modelId: endpoint.modelId,
      endpointName: endpoint.name,
      fitnessScore: 0,
      dimensionScores: {},
      costPerOutputMToken: endpoint.costPerOutputMToken ?? 0,
      excluded,
      excludedReason: reason || undefined,
    });
  }

  // ── Stage 2: Score ────────────────────────────────────────────────────────
  const eligibleCandidates = candidates.filter((c) => !c.excluded);
  const eligibleEndpoints = endpoints.filter((e) =>
    eligibleCandidates.some((c) => c.endpointId === e.id),
  );

  if (eligibleEndpoints.length > 0) {
    const { preferredMinScores, preferCheap } = taskRequirement;
    const dimensionWeights = calculateDimensionWeights(preferredMinScores);

    const maxCost = preferCheap
      ? Math.max(...eligibleEndpoints.map((e) => e.costPerOutputMToken ?? 0), 0)
      : 0;

    for (const candidate of eligibleCandidates) {
      const endpoint = eligibleEndpoints.find((e) => e.id === candidate.endpointId)!;

      let qualityFitness = 0;
      for (const [dimension, weight] of Object.entries(dimensionWeights)) {
        const score = getDimensionScore(endpoint, dimension);
        qualityFitness += score * weight;
        candidate.dimensionScores[dimension] = score;
      }

      // Degraded endpoints take a 30% fitness penalty — they pass but score lower.
      const statusMultiplier = endpoint.status === "degraded" ? 0.7 : 1.0;
      let finalFitness = qualityFitness * statusMultiplier;

      if (preferCheap && maxCost > 0) {
        const costFactor = 1 - ((endpoint.costPerOutputMToken ?? 0) / maxCost);
        // Blend: 60% quality, 40% cost efficiency.
        finalFitness = 0.6 * finalFitness + 0.4 * costFactor * 100;
      }

      candidate.fitnessScore = finalFitness;
    }
  }

  // ── Stage 3: Rank ─────────────────────────────────────────────────────────
  const rankedCandidates = [...eligibleCandidates].sort((a, b) => {
    if (a.fitnessScore !== b.fitnessScore) return b.fitnessScore - a.fitnessScore;
    if (a.costPerOutputMToken !== b.costPerOutputMToken) return a.costPerOutputMToken - b.costPerOutputMToken;
    const epA = eligibleEndpoints.find((e) => e.id === a.endpointId)!;
    const epB = eligibleEndpoints.find((e) => e.id === b.endpointId)!;
    if ((epA.recentFailureRate ?? 0) !== (epB.recentFailureRate ?? 0)) {
      return (epA.recentFailureRate ?? 0) - (epB.recentFailureRate ?? 0);
    }
    return (epA.avgLatencyMs ?? 0) - (epB.avgLatencyMs ?? 0);
  });

  // ── Stage 4: Select + Explain ─────────────────────────────────────────────
  const selected = rankedCandidates[0] ?? null;
  const reason = selected
    ? `Selected ${selected.endpointName} (${selected.providerId}/${selected.modelId}) for '${taskRequirement.taskType}': fitness ${selected.fitnessScore.toFixed(1)}. ${taskRequirement.selectionRationale}`
    : "No suitable endpoint found that meets all criteria.";

  return {
    selectedEndpointId: selected?.endpointId ?? null,
    selectedProviderId: selected?.providerId ?? null,
    selectedModelId: selected?.modelId ?? null,
    reason,
    fallbackChain: rankedCandidates.slice(1, 4).map((c) => c.endpointId),
    candidates,
    excludedCount: candidates.length - rankedCandidates.length,
    excludedReasons,
    policyRulesApplied,
    taskType: taskRequirement.taskType,
    sensitivity,
    timestamp: new Date(),
  };
}
