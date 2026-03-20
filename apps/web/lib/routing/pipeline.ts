/**
 * EP-INF-001 Phase 3: Routing pipeline — filter, score, rank, select.
 * Pure function — no DB access, no side effects.
 * See: docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md
 */

import type {
  EndpointManifest,
  TaskRequirementContract,
  PolicyRuleEval,
  PolicyCondition,
  CandidateTrace,
  RouteDecision,
  EndpointOverride,
  SensitivityLevel,
} from "./types";
import { computeFitness } from "./scoring";

// ── Stage 0: Policy filter ────────────────────────────────────────────────────

/**
 * Test whether an endpoint matches a policy condition.
 */
function matchesCondition(
  ep: EndpointManifest,
  condition: PolicyCondition
): boolean {
  const fieldValue = (ep as unknown as Record<string, unknown>)[condition.field];

  switch (condition.operator) {
    case "equals":
      return fieldValue === condition.value;

    case "not_equals":
      return fieldValue !== condition.value;

    case "includes": {
      const arr = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
      if (Array.isArray(condition.value)) {
        return condition.value.some((v) => arr.includes(v));
      }
      return arr.includes(condition.value);
    }

    case "not_includes": {
      const arr = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
      if (Array.isArray(condition.value)) {
        return !condition.value.some((v) => arr.includes(v));
      }
      return !arr.includes(condition.value);
    }

    default:
      return false;
  }
}

export interface PolicyFilterResult {
  eligible: EndpointManifest[];
  excluded: CandidateTrace[];
  applied: string[];
}

/**
 * Stage 0: Filter endpoints by policy rules.
 * Each rule that matches at least one endpoint is tracked in `applied`.
 */
export function filterByPolicy(
  endpoints: EndpointManifest[],
  rules: PolicyRuleEval[]
): PolicyFilterResult {
  const excluded: CandidateTrace[] = [];
  const applied: string[] = [];
  let eligible = [...endpoints];

  for (const rule of rules) {
    const beforeIds = new Set(eligible.map((e) => e.id));
    const remaining = eligible.filter(
      (ep) => !matchesCondition(ep, rule.condition)
    );
    const afterIds = new Set(remaining.map((e) => e.id));

    // Identify which endpoints were removed by this rule
    const removedByRule = eligible.filter((ep) => !afterIds.has(ep.id));

    if (removedByRule.length > 0) {
      applied.push(rule.id);
      for (const ep of removedByRule) {
        excluded.push({
          endpointId: ep.id,
          modelId: ep.modelId,
          endpointName: ep.name,
          fitnessScore: 0,
          dimensionScores: {},
          costPerOutputMToken: ep.costPerOutputMToken,
          excluded: true,
          excludedReason: `Policy rule: ${rule.name}`,
        });
      }
    }

    // Suppress unused variable warning
    void beforeIds;
    eligible = remaining;
  }

  return { eligible, excluded, applied };
}

// ── Stage 1: Hard filter ──────────────────────────────────────────────────────

/**
 * Determine why an endpoint should be excluded, or null if eligible.
 */
export function getExclusionReason(
  ep: EndpointManifest,
  req: TaskRequirementContract,
  sensitivity: SensitivityLevel
): string | null {
  // EP-INF-003: Model class must be compatible with task
  const modelClass = (ep as any).modelClass ?? "chat";
  if (modelClass !== "chat" && modelClass !== "reasoning") {
    return `modelClass "${modelClass}" is not eligible for chat/reasoning tasks`;
  }

  // Status check — only active and degraded pass
  if (ep.status !== "active" && ep.status !== "degraded") {
    return `Status is '${ep.status}'`;
  }

  // Lifecycle: retired endpoints are excluded
  if (ep.retiredAt !== null) {
    return `Endpoint retired at ${ep.retiredAt.toISOString()}`;
  }

  // Sensitivity clearance
  if (!ep.sensitivityClearance.includes(sensitivity)) {
    return `Sensitivity clearance missing for '${sensitivity}'`;
  }

  // Required capabilities
  const caps = req.requiredCapabilities;

  if (caps.supportsToolUse && !ep.supportsToolUse) {
    return "Missing required capability: supportsToolUse";
  }

  if (caps.supportsStructuredOutput && !ep.supportsStructuredOutput) {
    return "Missing required capability: supportsStructuredOutput";
  }

  if (caps.supportsStreaming && !ep.supportsStreaming) {
    return "Missing required capability: supportsStreaming";
  }

  // Context window check
  if (
    caps.minContextTokens !== undefined &&
    caps.minContextTokens !== null &&
    (ep.maxContextTokens === null || ep.maxContextTokens < caps.minContextTokens)
  ) {
    return `Context window too small: ${ep.maxContextTokens ?? 0} < ${caps.minContextTokens}`;
  }

  // Latency check
  if (
    req.maxLatencyMs !== undefined &&
    ep.avgLatencyMs !== null &&
    ep.avgLatencyMs > req.maxLatencyMs
  ) {
    return `Average latency ${ep.avgLatencyMs}ms exceeds maximum ${req.maxLatencyMs}ms`;
  }

  return null;
}

export interface HardFilterResult {
  eligible: EndpointManifest[];
  excluded: CandidateTrace[];
}

/**
 * Stage 1: Hard filter — remove any endpoint that fails a hard constraint.
 */
export function filterHard(
  endpoints: EndpointManifest[],
  requirement: TaskRequirementContract,
  sensitivity: SensitivityLevel
): HardFilterResult {
  const eligible: EndpointManifest[] = [];
  const excluded: CandidateTrace[] = [];

  for (const ep of endpoints) {
    const reason = getExclusionReason(ep, requirement, sensitivity);
    if (reason === null) {
      eligible.push(ep);
    } else {
      excluded.push({
        endpointId: ep.id,
        modelId: ep.modelId,
        endpointName: ep.name,
        fitnessScore: 0,
        dimensionScores: {},
        costPerOutputMToken: ep.costPerOutputMToken,
        excluded: true,
        excludedReason: reason,
      });
    }
  }

  return { eligible, excluded };
}

// ── Full pipeline: routeEndpoint ──────────────────────────────────────────────

/**
 * Run the full routing pipeline and return a RouteDecision with a complete
 * audit trail.
 *
 * Stages:
 *   Pin check  → immediate return for pinned override
 *   Block      → remove blocked endpoints
 *   Stage 0    → filterByPolicy
 *   Stage 1    → filterHard
 *   Stage 2+3  → score + rank (computeFitness, tiebreak by cost/failure/latency)
 *   Stage 4    → select winner + build fallback chain
 */
export function routeEndpoint(
  endpoints: EndpointManifest[],
  requirement: TaskRequirementContract,
  sensitivity: SensitivityLevel,
  policyRules: PolicyRuleEval[],
  overrides: EndpointOverride[]
): RouteDecision {
  const timestamp = new Date();
  const allCandidates: CandidateTrace[] = [];
  const allExcludedReasons: string[] = [];

  // ── Pin check ──────────────────────────────────────────────────────────────
  const pinnedOverride = overrides.find(
    (o) => o.pinned && o.taskType === requirement.taskType
  );

  if (pinnedOverride) {
    const pinnedEp = endpoints.find((e) => e.id === pinnedOverride.endpointId);
    if (pinnedEp) {
      const { fitness, dimensionScores } = computeFitness(
        pinnedEp,
        requirement,
        endpoints
      );

      for (const ep of endpoints) {
        if (ep.id === pinnedEp.id) continue;
        const result = computeFitness(ep, requirement, endpoints);
        allCandidates.push({
          endpointId: ep.id,
          modelId: ep.modelId,
          endpointName: ep.name,
          fitnessScore: result.fitness,
          dimensionScores: result.dimensionScores,
          costPerOutputMToken: ep.costPerOutputMToken,
          excluded: true,
          excludedReason: "Overridden by pinned endpoint",
        });
      }

      return {
        selectedEndpoint: pinnedEp.id,
        selectedModelId: pinnedEp.modelId,
        reason: `Pinned override: ${pinnedEp.name} (${pinnedEp.providerId}) forced for task type '${requirement.taskType}'. Fitness: ${fitness.toFixed(1)}.`,
        fitnessScore: fitness,
        fallbackChain: [],
        candidates: [
          {
            endpointId: pinnedEp.id,
            modelId: pinnedEp.modelId,
            endpointName: pinnedEp.name,
            fitnessScore: fitness,
            dimensionScores,
            costPerOutputMToken: pinnedEp.costPerOutputMToken,
            excluded: false,
          },
          ...allCandidates,
        ],
        excludedCount: allCandidates.length,
        excludedReasons: ["Overridden by pinned endpoint"],
        policyRulesApplied: [],
        taskType: requirement.taskType,
        sensitivity,
        timestamp,
      };
    }
  }

  // ── Block: remove blocked endpoints ───────────────────────────────────────
  const blockedIds = new Set(
    overrides
      .filter((o) => o.blocked && o.taskType === requirement.taskType)
      .map((o) => o.endpointId)
  );

  let working = endpoints.filter((ep) => {
    if (blockedIds.has(ep.id)) {
      allCandidates.push({
        endpointId: ep.id,
        modelId: ep.modelId,
        endpointName: ep.name,
        fitnessScore: 0,
        dimensionScores: {},
        costPerOutputMToken: ep.costPerOutputMToken,
        excluded: true,
        excludedReason: "Blocked by override",
      });
      allExcludedReasons.push(`${ep.id}: Blocked by override`);
      return false;
    }
    return true;
  });

  // ── Stage 0: Policy filter ─────────────────────────────────────────────────
  const policyResult = filterByPolicy(working, policyRules);
  working = policyResult.eligible;

  for (const trace of policyResult.excluded) {
    allCandidates.push(trace);
    allExcludedReasons.push(
      `${trace.endpointId}: ${trace.excludedReason ?? "Policy exclusion"}`
    );
  }

  // ── Stage 1: Hard filter ───────────────────────────────────────────────────
  const hardResult = filterHard(working, requirement, sensitivity);
  working = hardResult.eligible;

  for (const trace of hardResult.excluded) {
    allCandidates.push(trace);
    allExcludedReasons.push(
      `${trace.endpointId}: ${trace.excludedReason ?? "Hard constraint"}`
    );
  }

  // ── No eligible endpoints ──────────────────────────────────────────────────
  if (working.length === 0) {
    return {
      selectedEndpoint: null,
      selectedModelId: null,
      reason: `No eligible endpoints for task type '${requirement.taskType}' with sensitivity '${sensitivity}'. ${allCandidates.length} endpoint(s) excluded.`,
      fitnessScore: 0,
      fallbackChain: [],
      candidates: allCandidates,
      excludedCount: allCandidates.length,
      excludedReasons: allExcludedReasons,
      policyRulesApplied: policyResult.applied,
      taskType: requirement.taskType,
      sensitivity,
      timestamp,
    };
  }

  // ── Stage 2+3: Score and rank ──────────────────────────────────────────────
  const scored = working.map((ep) => {
    const { fitness, dimensionScores } = computeFitness(ep, requirement, working);
    return { ep, fitness, dimensionScores };
  });

  // Sort by fitness desc; tiebreakers: lower cost wins, lower failure rate wins,
  // lower latency wins
  scored.sort((a, b) => {
    if (b.fitness !== a.fitness) return b.fitness - a.fitness;

    // Tiebreak 1: cost (null = 0, i.e. free wins)
    const aCost = a.ep.costPerOutputMToken ?? 0;
    const bCost = b.ep.costPerOutputMToken ?? 0;
    if (aCost !== bCost) return aCost - bCost;

    // Tiebreak 2: failure rate (lower is better)
    if (a.ep.recentFailureRate !== b.ep.recentFailureRate) {
      return a.ep.recentFailureRate - b.ep.recentFailureRate;
    }

    // Tiebreak 3: latency (lower is better, null treated as high)
    const aLat = a.ep.avgLatencyMs ?? Number.MAX_SAFE_INTEGER;
    const bLat = b.ep.avgLatencyMs ?? Number.MAX_SAFE_INTEGER;
    return aLat - bLat;
  });

  // ── Stage 4: Select winner + build fallback chain ──────────────────────────
  const winner = scored[0]!; // guaranteed non-empty — empty case handled above
  const fallbackEntries = scored.slice(1, 4); // up to 3 fallbacks

  // Build full candidate trace (eligible endpoints only, scored)
  const eligibleTraces: CandidateTrace[] = scored.map(({ ep, fitness, dimensionScores }) => ({
    endpointId: ep.id,
    modelId: ep.modelId,
    endpointName: ep.name,
    fitnessScore: fitness,
    dimensionScores,
    costPerOutputMToken: ep.costPerOutputMToken,
    excluded: false,
  }));

  const fallbackChain = fallbackEntries.map((e) => e.ep.id);
  // Always include winner in fallback chain too
  const fullFallbackChain = [winner.ep.id, ...fallbackChain];

  // Build dimension score summary string
  const dimSummary = Object.entries(winner.dimensionScores)
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");

  const reason =
    `Selected ${winner.ep.name} (${winner.ep.providerId}) for task type '${requirement.taskType}' ` +
    `with fitness ${winner.fitness.toFixed(1)}. ` +
    `Dimension scores: [${dimSummary}]. ` +
    `Rationale: ${requirement.selectionRationale}. ` +
    `${allCandidates.length} endpoint(s) excluded; ` +
    `${scored.length} candidate(s) scored.`;

  return {
    selectedEndpoint: winner.ep.id,
    selectedModelId: winner.ep.modelId,
    reason,
    fitnessScore: winner.fitness,
    fallbackChain: fullFallbackChain,
    candidates: [...eligibleTraces, ...allCandidates],
    excludedCount: allCandidates.length,
    excludedReasons: allExcludedReasons,
    policyRulesApplied: policyResult.applied,
    taskType: requirement.taskType,
    sensitivity,
    timestamp,
  };
}
