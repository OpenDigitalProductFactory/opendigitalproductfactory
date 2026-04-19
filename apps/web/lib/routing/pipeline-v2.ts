/**
 * EP-INF-005a: Contract-based routing pipeline v2.
 *
 * Uses RequestContract and cost-per-success ranking instead of
 * TaskRequirementContract and dimension scoring.
 *
 * See: docs/superpowers/specs/2026-03-20-contract-based-selection-design.md
 */

import type {
  EndpointManifest,
  RouteDecision,
  CandidateTrace,
  PolicyRuleEval,
  EndpointOverride,
  SensitivityLevel,
} from "./types";
import type { RequestContract } from "./request-contract";
import { filterByPolicy } from "./pipeline";
import { checkModelCapacity } from "./rate-tracker";
import { satisfiesMinimumCapabilities } from "./agent-capability-types";
import {
  estimateSuccessProbability,
  rankByCostPerSuccess,
} from "./cost-ranking";
import { computeFitness } from "./scoring";
import { selectRecipeWithExploration } from "./champion-challenger";
import { buildPlanFromRecipe, buildDefaultPlan } from "./execution-plan";

// ── Stage 3: Hard filter (V2 — contract-based) ──────────────────────────────

/**
 * Determine why an endpoint should be excluded based on a RequestContract,
 * or null if the endpoint is eligible.
 *
 * This is the V2 equivalent of `getExclusionReason()` from pipeline.ts,
 * adapted for RequestContract instead of TaskRequirementContract.
 */
export function getExclusionReasonV2(
  ep: EndpointManifest,
  contract: RequestContract,
): string | null {
  // EP-AGENT-CAP-002: Agent capability floor — hard filter, non-negotiable.
  // Must run BEFORE status/graceful-degradation checks so a tool-incapable
  // endpoint is never selected even in degraded mode.
  if (contract.minimumCapabilities && Object.keys(contract.minimumCapabilities).length > 0) {
    const check = satisfiesMinimumCapabilities(ep, contract.minimumCapabilities);
    if (!check.satisfied) {
      return `Agent requires capability '${check.missingCapability}' (EP-AGENT-CAP-002)`;
    }
  }

  // Status check — only active and degraded pass
  if (ep.status !== "active" && ep.status !== "degraded") {
    return `Status is '${ep.status}'`;
  }

  // EP-INF-009c: Model class filter — exact match when requiredModelClass is set,
  // otherwise default to general-purpose text models.
  const modelClass = (ep as unknown as Record<string, unknown>).modelClass ?? "chat";
  if (contract.requiredModelClass) {
    if (modelClass !== contract.requiredModelClass) {
      return `modelClass "${modelClass}" does not match required "${contract.requiredModelClass}"`;
    }
  } else {
    if (modelClass !== "chat" && modelClass !== "reasoning" && modelClass !== "code") {
      return `modelClass "${modelClass}" is not eligible for general-purpose text tasks`;
    }
  }

  // Sensitivity clearance
  if (!ep.sensitivityClearance.includes(contract.sensitivity)) {
    return `Sensitivity clearance missing for '${contract.sensitivity}'`;
  }

  // Context window check
  if (
    contract.minContextTokens !== undefined &&
    contract.minContextTokens !== null &&
    ep.maxContextTokens !== null &&
    ep.maxContextTokens < contract.minContextTokens
  ) {
    return `Context window too small: ${ep.maxContextTokens} < ${contract.minContextTokens}`;
  }

  // Required capabilities — tools.
  // Use ep.supportsToolUse (the resolved fallback chain from loader.ts) rather than
  // ep.capabilities.toolUse directly, because the capabilities JSON blob may not
  // have toolUse set even when the model is known to support tools (e.g. gemma4
  // via TOOL_CAPABLE_FAMILIES in adapter-ollama.ts writes supportsToolUse: true
  // to the ModelProfile but doesn't populate capabilities.toolUse in the JSON blob).
  if (contract.requiresTools && !ep.supportsToolUse) {
    return "Missing required capability: toolUse";
  }

  // Required capabilities — structured output
  if (contract.requiresStrictSchema && ep.capabilities.structuredOutput !== true) {
    return "Missing required capability: structuredOutput";
  }

  // Required capabilities — streaming
  if (contract.requiresStreaming && ep.capabilities.streaming !== true) {
    return "Missing required capability: streaming";
  }

  // Modality — image input
  if (
    contract.modality.input.includes("image") &&
    ep.capabilities.imageInput !== true
  ) {
    return "Missing required capability: image input (imageInput)";
  }

  // Modality — file/pdf input
  if (
    contract.modality.input.includes("file") &&
    ep.capabilities.pdfInput !== true
  ) {
    return "Missing required capability: file/pdf input (pdfInput)";
  }

  // EP-INF-008b: Specialized capability requirements
  if (contract.requiresCodeExecution && ep.capabilities.codeExecution !== true) {
    return "Missing required capability: codeExecution";
  }

  if (contract.requiresWebSearch && ep.capabilities.webSearch !== true) {
    return "Missing required capability: webSearch";
  }

  if (contract.requiresComputerUse && ep.capabilities.computerUse !== true) {
    return "Missing required capability: computerUse";
  }

  // Residency policy
  if (contract.residencyPolicy === "local_only" && ep.providerId !== "local" && ep.providerId !== "ollama") {
    return "Residency policy 'local_only' requires a local provider (Docker Model Runner or Ollama)";
  }

  // Rate limit pre-flight check
  const capacity = checkModelCapacity(ep.providerId, ep.modelId);
  if (!capacity.available) {
    return `rate limit reached: ${capacity.reason}`;
  }

  return null;
}

// ── Internal: hard filter using V2 exclusion ────────────────────────────────

interface HardFilterResultV2 {
  eligible: EndpointManifest[];
  excluded: CandidateTrace[];
}

function filterHardV2(
  endpoints: EndpointManifest[],
  contract: RequestContract,
): HardFilterResultV2 {
  const eligible: EndpointManifest[] = [];
  const excluded: CandidateTrace[] = [];

  for (const ep of endpoints) {
    const reason = getExclusionReasonV2(ep, contract);
    if (reason === null) {
      eligible.push(ep);
    } else {
      excluded.push({
        endpointId: ep.id,
        providerId: ep.providerId,
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

// ── Full pipeline: routeEndpointV2 ──────────────────────────────────────────

/**
 * Run the full V2 routing pipeline using RequestContract and cost-per-success
 * ranking, returning a RouteDecision with a complete audit trail.
 *
 * Stages:
 *   Stage 1: Pin/Block overrides
 *   Stage 2: Policy filter (filterByPolicy)
 *   Stage 3: Hard filter (getExclusionReasonV2)
 *   Stage 4: Cost-per-success ranking
 *   Stage 5: Capacity penalty (EP-INF-004)
 *   Stage 6: Select winner + build fallback chain
 */
export async function routeEndpointV2(
  endpoints: EndpointManifest[],
  contract: RequestContract,
  policyRules: PolicyRuleEval[],
  overrides: EndpointOverride[],
): Promise<RouteDecision> {
  const timestamp = new Date();
  const allCandidates: CandidateTrace[] = [];
  const allExcludedReasons: string[] = [];
  const sensitivity: SensitivityLevel = contract.sensitivity;

  // ── Stage 1: Pin check ──────────────────────────────────────────────────
  const pinnedOverride = overrides.find(
    (o) => o.pinned && o.taskType === contract.taskType,
  );

  if (pinnedOverride) {
    const pinnedEp = endpoints.find((e) => e.id === pinnedOverride.endpointId);
    if (pinnedEp) {
      // Use legacy computeFitness for pin override scoring
      const dummyReq = {
        taskType: contract.taskType,
        description: "",
        selectionRationale: "",
        requiredCapabilities: {},
        preferredMinScores: {},
        preferCheap: false,
      };
      const { fitness, dimensionScores } = computeFitness(
        pinnedEp,
        dummyReq,
        endpoints,
      );

      for (const ep of endpoints) {
        if (ep.id === pinnedEp.id) continue;
        const result = computeFitness(ep, dummyReq, endpoints);
        allCandidates.push({
          endpointId: ep.id,
          providerId: ep.providerId,
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
        reason: `Pinned override: ${pinnedEp.name} (${pinnedEp.providerId}) forced for task type '${contract.taskType}'. Fitness: ${fitness.toFixed(1)}.`,
        fitnessScore: fitness,
        fallbackChain: [],
        candidates: [
          {
            endpointId: pinnedEp.id,
            providerId: pinnedEp.providerId,
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
        taskType: contract.taskType,
        sensitivity,
        timestamp,
      };
    }
  }

  // ── Stage 1b: Block — remove blocked endpoints ──────────────────────────
  const blockedIds = new Set(
    overrides
      .filter((o) => o.blocked && o.taskType === contract.taskType)
      .map((o) => o.endpointId),
  );

  let working = endpoints.filter((ep) => {
    if (blockedIds.has(ep.id)) {
      allCandidates.push({
        endpointId: ep.id,
        providerId: ep.providerId,
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

  // ── Stage 2: Policy filter ──────────────────────────────────────────────
  const policyResult = filterByPolicy(working, policyRules);
  working = policyResult.eligible;

  for (const trace of policyResult.excluded) {
    allCandidates.push(trace);
    allExcludedReasons.push(
      `${trace.endpointId}: ${trace.excludedReason ?? "Policy exclusion"}`,
    );
  }

  // ── Stage 3: Hard filter (V2 — contract-based) ──────────────────────────
  const hardResult = filterHardV2(working, contract);
  working = hardResult.eligible;

  for (const trace of hardResult.excluded) {
    allCandidates.push(trace);
    allExcludedReasons.push(
      `${trace.endpointId}: ${trace.excludedReason ?? "Hard constraint"}`,
    );
  }

  // ── No eligible endpoints ──────────────────────────────────────────────
  if (working.length === 0) {
    return {
      selectedEndpoint: null,
      selectedModelId: null,
      reason: `No eligible endpoints for task type '${contract.taskType}' with sensitivity '${sensitivity}'. ${allCandidates.length} endpoint(s) excluded.`,
      fitnessScore: 0,
      fallbackChain: [],
      candidates: allCandidates,
      excludedCount: allCandidates.length,
      excludedReasons: allExcludedReasons,
      policyRulesApplied: policyResult.applied,
      taskType: contract.taskType,
      sensitivity,
      timestamp,
    };
  }

  // ── Stage 4: Cost-per-success ranking ──────────────────────────────────
  const candidates = working.map((ep) => ({
    endpoint: ep,
    successProb: estimateSuccessProbability(ep, contract),
  }));

  const ranked = rankByCostPerSuccess(candidates, contract);

  // ── Stage 5: Capacity penalty (EP-INF-004) ────────────────────────────
  for (const entry of ranked) {
    const cap = checkModelCapacity(
      entry.endpoint.providerId,
      entry.endpoint.modelId,
    );
    if (cap.utilizationPercent > 80) {
      entry.rankScore *= 1.0 - (cap.utilizationPercent - 80) / 100;
    }
  }
  ranked.sort((a, b) => b.rankScore - a.rankScore);

  // ── Stage 5b: Provider-tier preference ─────────────────────────────────
  // Architectural principle: when the user has configured an external
  // provider (OAuth completed or API key saved), that explicit action
  // signals the user's preference. Bundled local defaults remain available
  // as fallback, but never win over a user-configured endpoint — otherwise
  // fresh installs silently route to the bundled default because paid
  // providers have no pricing/eval metadata yet and are penalized by
  // cost-per-success ranking.
  //
  // Stable-sort puts user_configured ahead of bundled while preserving
  // rankScore order within each tier. No-op when only one tier is present.
  const tierOrder = (ep: EndpointManifest): number =>
    ep.providerTier === "user_configured" ? 0 : 1;
  ranked.sort((a, b) => tierOrder(a.endpoint) - tierOrder(b.endpoint));

  // ── Stage 6: Select winner + build fallback chain ──────────────────────
  const winner = ranked[0]!;
  // Select up to 3 fallbacks, preferring provider diversity.
  // If all top-ranked endpoints are from the same provider and that provider
  // goes down (or runs out of credits), retrying the same provider is useless.
  const fallbackEntries: typeof ranked = [];
  const seenProviders = new Set([winner.endpoint.providerId]);
  for (const candidate of ranked.slice(1)) {
    if (fallbackEntries.length >= 3) break;
    // Prefer a new provider; if we haven't found 3 diverse ones, accept same-provider
    if (!seenProviders.has(candidate.endpoint.providerId)) {
      fallbackEntries.push(candidate);
      seenProviders.add(candidate.endpoint.providerId);
    }
  }
  // If we didn't fill 3 slots from diverse providers, fill remainder from same-provider
  if (fallbackEntries.length < 3) {
    for (const candidate of ranked.slice(1)) {
      if (fallbackEntries.length >= 3) break;
      if (!fallbackEntries.includes(candidate)) {
        fallbackEntries.push(candidate);
      }
    }
  }

  // EP-INF-005b/006: Recipe lookup with exploration selection
  const { recipe, explorationMode } = await selectRecipeWithExploration(
    winner.endpoint.providerId, winner.endpoint.modelId, contract,
  );
  const executionPlan = recipe
    ? buildPlanFromRecipe(recipe, contract)
    : buildDefaultPlan(winner.endpoint, contract);

  // Build full candidate trace (eligible endpoints, with rankScore as fitnessScore)
  const eligibleTraces: CandidateTrace[] = ranked.map(
    ({ endpoint: ep, rankScore, estimatedCost }) => ({
      endpointId: ep.id,
      providerId: ep.providerId,
      modelId: ep.modelId,
      endpointName: ep.name,
      fitnessScore: rankScore,
      dimensionScores: {
        rankScore,
        ...(estimatedCost !== null ? { estimatedCost } : {}),
      },
      costPerOutputMToken: ep.costPerOutputMToken,
      excluded: false,
    }),
  );

  const fallbackChain = fallbackEntries.map((e) => e.endpoint.id);
  // Always include winner in fallback chain too
  const fullFallbackChain = [winner.endpoint.id, ...fallbackChain];

  const reason =
    `Selected ${winner.endpoint.name} (${winner.endpoint.providerId}) for task type '${contract.taskType}' ` +
    `with rankScore ${winner.rankScore.toFixed(1)}. ` +
    `Budget: ${contract.budgetClass}, reasoning depth: ${contract.reasoningDepth}. ` +
    `${allCandidates.length} endpoint(s) excluded; ` +
    `${ranked.length} candidate(s) ranked.`;

  return {
    selectedEndpoint: winner.endpoint.id,
    selectedModelId: winner.endpoint.modelId,
    reason,
    fitnessScore: winner.rankScore,
    fallbackChain: fullFallbackChain,
    candidates: [...eligibleTraces, ...allCandidates],
    excludedCount: allCandidates.length,
    excludedReasons: allExcludedReasons,
    policyRulesApplied: policyResult.applied,
    taskType: contract.taskType,
    sensitivity,
    timestamp,
    selectedRecipeId: recipe?.id,
    selectedRecipeVersion: recipe?.version,
    executionPlan,
    explorationMode,
    challengerRecipeId: explorationMode === "challenger" ? recipe?.id : undefined,
  };
}
