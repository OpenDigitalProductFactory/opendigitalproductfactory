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
import type { ActivityContract } from "./activity-contract";
import type { ActivityHarnessConfidenceOverride } from "./activity-harness-governance";
import { filterByPolicy } from "./pipeline";
import { checkModelCapacity, getEndpointRuntimeState } from "./rate-tracker";
import {
  applyCapacitySoftExclusion,
  type CapacitySnapshot,
} from "./capacity-routing-exclude";
import { cliSaturationPercent } from "./cli-concurrency";
import { usesCodexCli, usesCliAdapter } from "./provider-utils";
import { requiredToolChoiceExclusionReason } from "./execution-adapter-types";
import { isLocalProviderId } from "./provider-locality";
import { satisfiesMinimumCapabilities } from "./agent-capability-types";
import {
  endpointClearsSensitivity,
  endpointGenuinelyClearsSensitivity,
} from "./sensitivity-clearance";
import { QUALITY_TIERS, type QualityTier } from "./quality-tiers";
import {
  estimateSuccessProbability,
  rankByCostPerSuccess,
  firstUnmetDimension,
} from "./cost-ranking";
import { selectRecipeWithExploration } from "./champion-challenger";
import {
  selectEndpointPreference,
  type EndpointPreferences,
} from "./preference-finalization";
import {
  attachHarnessRecipeToPlan,
  buildPlanFromRecipe,
  buildDefaultPlan,
  resolveDefaultExecutionAdapter,
} from "./execution-plan";
import {
  applyHarnessConfidenceOverride,
  bindHarnessRecipeForActivity,
} from "./harness-recipe";

// ── Stage 3: Hard filter (V2 — contract-based) ──────────────────────────────

function getProviderConstraintExclusionReason(
  ep: EndpointManifest,
  contract: RequestContract,
): string | null {
  if (contract.deniedProviders?.includes(ep.providerId)) {
    return `Provider '${ep.providerId}' is excluded by the request denylist`;
  }

  if (
    contract.allowedProviders !== undefined &&
    !contract.allowedProviders.includes(ep.providerId)
  ) {
    return `Provider '${ep.providerId}' is outside the request allowlist`;
  }

  return null;
}

/**
 * Determine why an endpoint should be excluded based on a RequestContract,
 * or null if the endpoint is eligible.
 *
 * This is the V2 equivalent of `getExclusionReason()` from pipeline.ts,
 * adapted for RequestContract instead of TaskRequirementContract.
 */
/**
 * True when the endpoint's clearance covers the request's sensitivity.
 *
 * Business-data levels (public/internal/confidential/restricted) use exact
 * membership — the closed clearance model where a provider lists every level it
 * is cleared for. The `development` class (platform source-code generation) is
 * the one exception: it is the least-sensitive class, so any endpoint cleared for
 * `public` business content is cleared for it (source code ≤ public data). This
 * is what lets connected frontier cloud dev tools — cleared for public but never
 * internal business data — run Build Studio code-gen. An endpoint with no
 * clearance at all is never eligible.
 */
// The data-sensitivity fence predicates live in ./sensitivity-clearance (extracted
// so the break-glass override's second path did not push this module over its size
// ceiling; imported above for internal use). Re-exported so existing importers of
// pipeline-v2 are unaffected. (BI-4512E7D2)
export { endpointClearsSensitivity, endpointGenuinelyClearsSensitivity };

export function getExclusionReasonV2(
  ep: EndpointManifest,
  contract: RequestContract,
): string | null {
  // Provider policy is a hard fence. Deny is evaluated before allow so an
  // accidental overlap cannot broaden eligibility.
  const providerConstraintReason = getProviderConstraintExclusionReason(ep, contract);
  if (providerConstraintReason) return providerConstraintReason;

  // Account/transport compatibility is a hard platform fact, not a score.
  // Preserve the endpoint in the excluded trace so runtime-health previews
  // explain the incompatibility while a supported sibling model can win.
  if (ep.eligibilityExclusionReason) return ep.eligibilityExclusionReason;
  const toolChoiceExclusion = contract.toolChoice === "required"
    ? requiredToolChoiceExclusionReason(resolveDefaultExecutionAdapter(ep.providerId, contract.requiredModelClass)) : null;
  if (toolChoiceExclusion) return `${contract.terminalWriterToolName ? "required-terminal-writer-not-enforceable: " : ""}${toolChoiceExclusion}`;

  // EP-AGENT-CAP-002: Agent capability floor — hard filter, non-negotiable.
  // Must run BEFORE status/graceful-degradation checks so a tool-incapable
  // endpoint is never selected even in degraded mode.
  if (contract.minimumCapabilities && Object.keys(contract.minimumCapabilities).length > 0) {
    const check = satisfiesMinimumCapabilities(ep, contract.minimumCapabilities);
    if (!check.satisfied) {
      return `Agent requires capability '${check.missingCapability}' (EP-AGENT-CAP-002)`;
    }
  }

  // BI-16A1B4A3: name the dimension and the gap. The leading phrase is load
  // bearing — routing-exclusion-buckets classifies on it — so the detail is
  // appended rather than replacing it.
  const unmet = firstUnmetDimension(ep, contract.minimumDimensions);
  if (unmet) {
    return `Minimum quality dimensions not met (${unmet.dimension} ${unmet.actual} < ${unmet.minimum})`;
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

  // Sensitivity clearance. Exact-match membership, EXCEPT the development class
  // (platform source-code generation): an endpoint cleared for `public` business
  // content is cleared for development work too, since generating source code is
  // no more sensitive than public data. This keeps the operator's connected
  // frontier cloud dev tools (cleared for public/approved-cloud, never internal)
  // eligible for builds without weakening the internal/confidential/restricted
  // business-data gates. Content-based payload screening still runs downstream.
  if (!endpointClearsSensitivity(ep, contract.sensitivity)) {
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
  // ep.capabilities.toolUse directly: the capabilities JSON blob may lag the resolved
  // boolean. For local models the discovery adapter derives both from the shared
  // deriveLocalModelCapabilityPrior (@dpf/db/local-model-capabilities) — the same
  // prior the seed uses — so a coder model (qwen3-coder) resolves supportsToolUse: true
  // and an embedding model (nomic-embed) resolves false.
  // Tri-state: exclude ONLY on an explicit false (a real per-transport floor —
  // e.g. the chatgpt subscription backend, which supports Codex built-in tools
  // but not custom function tools). A null (UNKNOWN) endpoint is attempted and
  // then calibrated to true/false by the tool_call eval, so a capable model on
  // a provider whose discovery cannot report tool support is no longer excluded
  // outright with no recovery path (BI-DFC30977).
  if (contract.requiresTools && ep.supportsToolUse === false) {
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
  if (contract.residencyPolicy === "local_only" && !isLocalProviderId(ep.providerId)) {
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
  /**
   * BI-16A1B4A3 — true when no endpoint met the tier floor and below-floor
   * endpoints were kept so the turn could still run. Never silent: the caller
   * records it on the decision.
   */
  qualityFloorRelaxed: boolean;
}

function filterHardV2(
  endpoints: EndpointManifest[],
  contract: RequestContract,
  /**
   * Optional ProviderCapacityStatus snapshots (BI-3607DDDA). Soft-excludes
   * reauth/rate-limited/billing providers when a healthy peer remains.
   */
  capacityByProvider: ReadonlyMap<string, CapacitySnapshot> = new Map(),
  nowMs: number = Date.now(),
): HardFilterResultV2 {
  const eligible: EndpointManifest[] = [];
  const excluded: CandidateTrace[] = [];
  let qualityFloorRelaxed = false;

  // ── Tier quality floor — SOFT exclusion (BI-16A1B4A3) ────────────────────
  // Founder ruling 2026-08-26: the platform must never be unrunnable. The
  // bundled local model has to work when nothing else is available, even on
  // modest hardware.
  //
  // The floor used to be a HARD gate, and on a live install it excluded EVERY
  // endpoint: all of them cleared codegen and reasoning and failed only
  // toolFidelity — best on the box 82 against a frontier floor of 85, and the
  // highest-scoring endpoint's 80 had never actually been measured. A tier
  // preference silently became a total outage.
  //
  // So it takes the same contract the runtime circuit breaker and the capacity
  // snapshot already use: drop below-floor endpoints ONLY while an at-floor peer
  // remains. When nothing meets the floor, the turn proceeds against the best
  // available rather than failing.
  //
  // This is a QUALITY preference, never a safety gate. Sensitivity clearance,
  // agent capability floors, model class, status and context window stay hard —
  // they are evaluated below and are not relaxed by this.
  const hardContract: RequestContract = { ...contract, minimumDimensions: undefined };
  const belowFloor: Array<{ ep: EndpointManifest; reason: string }> = [];

  for (const ep of endpoints) {
    const reason = getExclusionReasonV2(ep, hardContract);
    if (reason === null) {
      const unmet = firstUnmetDimension(ep, contract.minimumDimensions);
      if (unmet) {
        belowFloor.push({
          ep,
          reason: `Minimum quality dimensions not met (${unmet.dimension} ${unmet.actual} < ${unmet.minimum})`,
        });
        continue;
      }
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

  // Apply the soft floor: keep below-floor endpoints only when no peer met it.
  if (eligible.length === 0 && belowFloor.length > 0) {
    qualityFloorRelaxed = true;
    for (const { ep } of belowFloor) eligible.push(ep);
  } else {
    for (const { ep, reason } of belowFloor) {
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

  // ── Runtime circuit breaker — SOFT exclusion (EP routing-resilience Slice A) ─
  // Endpoints whose runtime circuit is open (a recent hard failure that has not
  // yet cooled down) are excluded so the cost-per-success ranker stops
  // re-selecting a just-failed provider on every agentic-loop iteration. This is
  // the fix for the compounding 30s-wait incident (spec D1): routeAndCall
  // re-runs this pipeline each iteration, so once an endpoint is marked
  // unavailable it is skipped here without incurring another wait.
  //
  // SOFT: only drop cooled-down endpoints when at least one non-cooled endpoint
  // remains eligible. On a single-provider install (the cooled endpoint is the
  // only option) we keep it rather than fail the turn with "no eligible
  // endpoints" — graceful degradation over a hard lockout (spec risk R1).
  const cooled: Array<{ ep: EndpointManifest; reason: string }> = [];
  const live: EndpointManifest[] = [];
  for (const ep of eligible) {
    const runtime = getEndpointRuntimeState(ep.providerId, ep.modelId);
    if (runtime.unavailable) {
      cooled.push({ ep, reason: `runtime_cooldown:${runtime.reason ?? "unknown"}` });
    } else {
      live.push(ep);
    }
  }

  let afterRuntime: EndpointManifest[];
  if (cooled.length > 0 && live.length > 0) {
    for (const { ep, reason } of cooled) {
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
    afterRuntime = live;
  } else {
    // All eligible endpoints are cooled down (or none are) — keep `eligible` as-is
    // so the turn can still proceed against the least-bad option.
    afterRuntime = eligible;
  }

  // ── Persisted capacity snapshot — SOFT exclusion (BI-3607DDDA) ───────────
  // ProviderCapacityStatus records OBSERVED 401/rate-limit/billing from real
  // API responses. Without this, ModelProvider.status stays "active" and the
  // router keeps ranking a dead codex/OAuth provider #1 until it is manually
  // retired. Same soft contract as the runtime circuit: only drop when a peer
  // remains eligible.
  if (capacityByProvider.size > 0) {
    const cap = applyCapacitySoftExclusion({
      endpoints: afterRuntime,
      capacityByProvider,
      nowMs,
    });
    for (const { endpoint: ep, reason } of cap.excluded) {
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
    return { eligible: cap.eligible, excluded, qualityFloorRelaxed };
  }

  return { eligible: afterRuntime, excluded, qualityFloorRelaxed };
}

// ── Full pipeline: routeEndpointV2 ──────────────────────────────────────────

/**
 * Run the full V2 routing pipeline using RequestContract and cost-per-success
 * ranking, returning a RouteDecision with a complete audit trail.
 *
 * Stages:
 *   Stage 1: Explicit block overrides
 *   Stage 2: Policy filter (filterByPolicy)
 *   Stage 3: Hard filter (getExclusionReasonV2)
 *   Stage 4: Cost-per-success ranking
 *   Stage 5: Capacity penalty (EP-INF-004)
 *   Stage 6: Eligible preference finalization (pin/provider/model)
 *   Stage 7: Fallback chain and execution plan
 *   Stage 6: Select winner + build fallback chain
 */
export async function routeEndpointV2(
  endpoints: EndpointManifest[],
  contract: RequestContract,
  policyRules: PolicyRuleEval[],
  overrides: EndpointOverride[],
  /**
   * skipRecipe: skip execution-recipe selection (and its executionPlan build).
   * The recipe only shapes the executionPlan/provider settings — never the
   * selected endpoint — and `selectRecipeWithExploration` rolls Math.random()
   * for the challenger arm. A model-selection PREVIEW must be deterministic and
   * side-effect-free, so it routes with skipRecipe=true: same winner, no roll,
   * executionPlan omitted. The live `routeAndCall` path leaves it false.
   */
  opts?: {
    skipRecipe?: boolean;
    activityContract?: ActivityContract;
    activityHarnessConfidenceOverrides?: ActivityHarnessConfidenceOverride[];
    /** Preferences are evaluated only after the complete eligibility pipeline. */
    preferences?: EndpointPreferences;
    /**
     * Optional ProviderCapacityStatus map (providerId → snapshot). When
     * omitted, the pipeline loads fresh rows from the DB (BI-3607DDDA). Tests
     * pass an empty Map to skip IO.
     */
    capacityByProvider?: ReadonlyMap<string, CapacitySnapshot>;
    nowMs?: number;
  },
): Promise<RouteDecision> {
  const timestamp = new Date();
  const allCandidates: CandidateTrace[] = [];
  const allExcludedReasons: string[] = [];
  const sensitivity: SensitivityLevel = contract.sensitivity;

  const pinnedOverride = overrides.find(
    (o) => o.pinned && o.taskType === contract.taskType,
  );

  // ── Stage 1: Block — remove blocked endpoints ───────────────────────────
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

  // ── Stage 3: Hard filter (V2 — contract-based) + capacity soft exclude ──
  const nowMs = opts?.nowMs ?? Date.now();
  let capacityByProvider = opts?.capacityByProvider;
  if (!capacityByProvider) {
    try {
      const { prisma } = await import("@dpf/db");
      const rows = await prisma.providerCapacityStatus.findMany({
        select: { providerId: true, state: true, retryAt: true },
      });
      const map = new Map<string, CapacitySnapshot>();
      for (const row of rows) {
        map.set(row.providerId, {
          state: row.state,
          retryAtMs: row.retryAt ? row.retryAt.getTime() : null,
        });
      }
      capacityByProvider = map;
    } catch {
      capacityByProvider = new Map();
    }
  }
  const hardResult = filterHardV2(working, contract, capacityByProvider, nowMs);
  working = hardResult.eligible;

  for (const trace of hardResult.excluded) {
    allCandidates.push(trace);
    allExcludedReasons.push(
      `${trace.endpointId}: ${trace.excludedReason ?? "Hard constraint"}`,
    );
  }

  // ── No eligible endpoints ──────────────────────────────────────────────
  if (working.length === 0) {
    // The per-endpoint reasons are the only thing that explains WHY a route
    // died, and they were previously computed and then dropped on the floor:
    // callers surface just a count, and the operator-facing coworker copy
    // guesses ("your cloud providers are disconnected") — which sent a real
    // outage investigation down the wrong path entirely. Log them so the next
    // "No AI model can handle this request" is diagnosable from the portal
    // logs alone.
    console.warn(
      `[routing] no eligible endpoints task=${contract.taskType} sensitivity=${sensitivity} ` +
      `residency=${contract.residencyPolicy ?? "any_enabled"} ` +
      `minDims=${JSON.stringify(contract.minimumDimensions ?? {})} ` +
      `excluded=${allCandidates.length}`,
    );
    for (const line of allExcludedReasons) console.warn(`[routing]   ✗ ${line}`);
    // When an active, capable provider was dropped PURELY on sensitivity clearance
    // (gate 7 in getExclusionReasonV2 returns its reason only after status,
    // capability and quality gates have passed), the empty set is a data-governance
    // block, not an outage. Surface that so the coworker-facing copy names the real
    // lever (clear a business account / provision a local model) instead of sending
    // the operator to re-check already-connected providers. (BI-431524DF)
    const clearanceBlocked = allExcludedReasons.some((r) =>
      /Sensitivity clearance missing/i.test(r),
    );
    return {
      selectedEndpoint: null,
      selectedModelId: null,
      reason: `No eligible endpoints for task type '${contract.taskType}' with sensitivity '${sensitivity}'. ${allCandidates.length} endpoint(s) excluded.${clearanceBlocked ? ` No connected provider is cleared for '${sensitivity}' data.` : ""}`,
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
  // BI-15068745: blend live CLI slot saturation into utilization for CLI-backed
  // endpoints (their provider caps are invisible to the rate tracker), so the
  // scorer spreads concurrent load onto HTTP providers before the shared
  // sandbox jams. Only engages under real contention. See pipeline.ts + the
  // matching note; cli-concurrency.ts owns the saturation signal.
  for (const entry of ranked) {
    const cap = checkModelCapacity(
      entry.endpoint.providerId,
      entry.endpoint.modelId,
    );
    const cliBacked =
      usesCodexCli(entry.endpoint.providerId) ||
      usesCliAdapter(entry.endpoint.providerId);
    const utilizationPercent = cliBacked
      ? Math.max(cap.utilizationPercent, cliSaturationPercent())
      : cap.utilizationPercent;
    if (utilizationPercent > 80) {
      let factor = 1.0 - (utilizationPercent - 80) / 100;
      if (cliBacked) factor = Math.max(0.05, factor);
      entry.rankScore *= factor;
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

  // BI-654EE2E9: quality-tier preference among effectively-free endpoints.
  // When every provider is free, cost-per-success ranking collapses to
  // successProb and never reads qualityTier — so an "adequate" local model that
  // merely clears the tier floor can tie or beat a "frontier" cloud endpoint
  // whose curated dimension scores are absent. That let coworker reasoning and
  // identity inference run on local while free frontier providers sat idle.
  //
  // This makes a strictly-higher quality tier win, but ONLY:
  //   - as a SECONDARY key under the existing provider-tier preference (so the
  //     user_configured>bundled intent is preserved), and
  //   - among endpoints that are both free (estimatedCost 0/null), so the paid
  //     cost-per-success path is untouched.
  // Governance is unaffected: this only re-orders endpoints that ALREADY passed
  // every hard gate (policy, clearance, capability, capacity). It never routes
  // around a sensitivity-clearance or capability exclusion.
  const qualityRank = (ep: EndpointManifest): number => {
    const tier: QualityTier = ep.qualityTier ?? "adequate";
    const idx = QUALITY_TIERS.indexOf(tier);
    return idx === -1 ? QUALITY_TIERS.indexOf("adequate") : idx;
  };
  const isFree = (entry: (typeof ranked)[number]): boolean =>
    (entry.estimatedCost ?? 0) === 0;
  ranked.sort((a, b) => {
    const providerDelta = tierOrder(a.endpoint) - tierOrder(b.endpoint);
    if (providerDelta !== 0) return providerDelta;
    if (isFree(a) && isFree(b)) {
      const qualityDelta = qualityRank(a.endpoint) - qualityRank(b.endpoint);
      if (qualityDelta !== 0) return qualityDelta;
    }
    return 0; // preserve prior rankScore order (stable sort)
  });

  // ── Stage 6: Finalize eligible preferences ──────────────────────────────
  // Persisted endpoint pins and per-coworker provider/model assignments are
  // preferences, never authority. They can select only from the set that has
  // cleared override blocks, policy, contract, cooldown, and capacity fences.
  const preferenceSelection = selectEndpointPreference(
    ranked.map((entry) => ({
      endpointId: entry.endpoint.id,
      providerId: entry.endpoint.providerId,
      modelId: entry.endpoint.modelId,
      entry,
    })),
    {
      ...(pinnedOverride
        ? { pinnedEndpointId: pinnedOverride.endpointId }
        : {}),
      ...(opts?.preferences ?? {}),
    },
  );
  const winner = preferenceSelection.winner.entry;
  const rankedWithoutWinner = ranked.filter((entry) => entry !== winner);

  // ── Stage 7: Build fallback chain ───────────────────────────────────────
  // Select up to 3 fallbacks, preferring provider diversity.
  // If all top-ranked endpoints are from the same provider and that provider
  // goes down (or runs out of credits), retrying the same provider is useless.
  const fallbackEntries: typeof ranked = [];
  const seenProviders = new Set([winner.endpoint.providerId]);
  for (const candidate of rankedWithoutWinner) {
    if (fallbackEntries.length >= 3) break;
    // Prefer a new provider; if we haven't found 3 diverse ones, accept same-provider
    if (!seenProviders.has(candidate.endpoint.providerId)) {
      fallbackEntries.push(candidate);
      seenProviders.add(candidate.endpoint.providerId);
    }
  }
  // If we didn't fill 3 slots from diverse providers, fill remainder from same-provider
  if (fallbackEntries.length < 3) {
    for (const candidate of rankedWithoutWinner) {
      if (fallbackEntries.length >= 3) break;
      if (!fallbackEntries.includes(candidate)) {
        fallbackEntries.push(candidate);
      }
    }
  }

  // EP-INF-005b/006: Recipe lookup with exploration selection.
  // skipRecipe (preview) short-circuits this: no recipe, no challenger roll,
  // no executionPlan — the winner above is already fully determined.
  const { recipe, explorationMode } = opts?.skipRecipe
    ? { recipe: null, explorationMode: "champion" as const }
    : await selectRecipeWithExploration(
        winner.endpoint.providerId, winner.endpoint.modelId, contract,
      );
  const baseExecutionPlan = recipe
    ? buildPlanFromRecipe(recipe, contract)
    : opts?.skipRecipe
      ? undefined
      : buildDefaultPlan(winner.endpoint, contract);
  const executionPlan =
    baseExecutionPlan && opts?.activityContract
      ? attachHarnessRecipeToPlan(baseExecutionPlan, (() => {
          const hint = {
            providerId: winner.endpoint.providerId,
            modelId: winner.endpoint.modelId,
          };
          return applyHarnessConfidenceOverride(
            bindHarnessRecipeForActivity(opts.activityContract, hint),
            hint,
            opts.activityHarnessConfidenceOverrides,
          );
        })())
      : baseExecutionPlan;

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

  const preferenceReason = preferenceSelection.resolution
    ? ` Preferences: ${preferenceSelection.resolution.applied.length} applied, ` +
      `${preferenceSelection.resolution.unavailable.length} unavailable.`
    : "";
  // BI-16A1B4A3: a relaxed floor must never be silent — the owner is getting a
  // below-floor model and is entitled to know that is what happened.
  const degradedReason = hardResult.qualityFloorRelaxed
    ? " No endpoint met the quality floor for this work, so it ran on the best available rather than not running."
    : "";
  const reason =
    `Selected ${winner.endpoint.name} (${winner.endpoint.providerId}) for task type '${contract.taskType}' ` +
    `with rankScore ${winner.rankScore.toFixed(1)}. ` +
    `Budget: ${contract.budgetClass}, reasoning depth: ${contract.reasoningDepth}. ` +
    `${allCandidates.length} endpoint(s) excluded; ` +
    `${ranked.length} candidate(s) ranked.${preferenceReason}${degradedReason}`;

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
    ...(preferenceSelection.resolution
      ? { preferenceResolution: preferenceSelection.resolution }
      : {}),
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
