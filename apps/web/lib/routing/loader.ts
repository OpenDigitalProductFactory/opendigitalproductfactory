/**
 * EP-INF-001: Load routing data from the database.
 * Converts Prisma rows into the routing pipeline's type system.
 */
import { prisma } from "@dpf/db";
import type {
  EndpointManifest,
  TaskRequirementContract,
  PolicyRuleEval,
  EndpointOverride,
  SensitivityLevel,
} from "./types";
import type { QualityTier } from "./quality-tiers";
import type { ModelCardCapabilities, ModelCardPricing } from "./model-card-types";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";

/**
 * EP-MODEL-CAP-001-B: Source-priority tool use resolution.
 *
 * Precedence (highest to lowest):
 *   1. capabilityOverrides.toolUse — explicit admin field-level override
 *   2. capabilities.toolUse (discovery-owned profiles only)
 *   3. capabilities.toolUse (catalog-owned profiles only)
 *   4. profile.supportsToolUse — set by provider-sync null-backfill or admin
 *   5. provider.supportsToolUse — floor
 */
export function resolveToolUse(
  profile: {
    profileSource: string | null;
    capabilityOverrides: unknown;
    capabilities: unknown;
    supportsToolUse: boolean | null;
    provider: { supportsToolUse: boolean | null };
  },
): boolean | null {
  // 1. Admin field-level override
  const overrides = profile.capabilityOverrides as Record<string, unknown> | null;
  if (overrides !== null && overrides !== undefined && "toolUse" in overrides) {
    return overrides.toolUse as boolean;
  }

  const caps = profile.capabilities as Record<string, unknown> | null;
  const src = profile.profileSource ?? "seed";

  // 2. Discovery-owned: use adapter-extracted value
  if (src === "auto-discover" || src === "evaluated") {
    if (caps?.toolUse !== undefined && caps.toolUse !== null) return caps.toolUse as boolean;
  }

  // 3. Catalog-owned: use reconciled value
  if (src === "catalog" || src === "seed") {
    if (caps?.toolUse !== undefined && caps.toolUse !== null) return caps.toolUse as boolean;
  }

  // 4. Profile-level boolean (set by provider-sync null-backfill)
  if (profile.supportsToolUse !== null && profile.supportsToolUse !== undefined) {
    return profile.supportsToolUse;
  }

  // 5. Provider floor
  return profile.provider.supportsToolUse ?? null;
}

/**
 * Load all active/degraded endpoints as EndpointManifest objects.
 * Queries ModelProfile joined with ModelProvider — each manifest entry represents
 * a specific model, not just a provider.
 */
export async function loadEndpointManifests(): Promise<EndpointManifest[]> {
  const profiles = await prisma.modelProfile.findMany({
    where: {
      modelStatus: { in: ["active", "degraded"] },
      retiredAt: null,
      provider: {
        status: { in: ["active", "degraded"] },
        endpointType: "llm",
      },
    },
    include: {
      provider: true,
    },
  });

  return profiles.map((mp) => ({
    id: mp.id,
    providerId: mp.providerId,
    modelId: mp.modelId,
    name: mp.friendlyName || mp.modelId,
    endpointType: mp.provider.endpointType,
    // EP-INF-004: Derive status from worse of provider and model status
    status: (mp.modelStatus === "degraded" || mp.provider.status === "degraded"
      ? "degraded"
      : mp.provider.status) as EndpointManifest["status"],
    sensitivityClearance: mp.provider.sensitivityClearance as SensitivityLevel[],
    supportsToolUse: resolveToolUse(mp) ?? false,
    supportsStructuredOutput: mp.provider.supportsStructuredOutput,
    supportsStreaming: mp.provider.supportsStreaming,
    maxContextTokens: mp.maxContextTokens ?? mp.provider.maxContextTokens,
    maxOutputTokens: mp.maxOutputTokens ?? mp.provider.maxOutputTokens,
    modelRestrictions: mp.provider.modelRestrictions,
    reasoning: mp.reasoning,
    codegen: mp.codegen,
    toolFidelity: mp.toolFidelity,
    instructionFollowing: mp.instructionFollowingScore,
    structuredOutput: mp.structuredOutputScore,
    conversational: mp.conversational,
    contextRetention: mp.contextRetention,
    customScores: (mp.customScores as Record<string, number>) ?? {},
    avgLatencyMs: mp.provider.avgLatencyMs,
    recentFailureRate: mp.provider.recentFailureRate,
    costPerOutputMToken: (mp.pricing as any)?.outputPerMToken ?? mp.outputPricePerMToken ?? mp.provider.outputPricePerMToken,
    profileSource: mp.profileSource as EndpointManifest["profileSource"],
    profileConfidence: mp.profileConfidence as EndpointManifest["profileConfidence"],
    retiredAt: mp.retiredAt,
    qualityTier: (mp.qualityTier as QualityTier | null) ?? undefined,

    // EP-INF-003: ModelCard fields
    modelClass: mp.modelClass ?? "chat",
    modelFamily: mp.modelFamily ?? null,
    inputModalities: (mp.inputModalities as string[]) ?? ["text"],
    outputModalities: (mp.outputModalities as string[]) ?? ["text"],
    capabilities: (mp.capabilities as unknown as ModelCardCapabilities) ?? EMPTY_CAPABILITIES,
    pricing: (mp.pricing as unknown as ModelCardPricing) ?? EMPTY_PRICING,
    supportedParameters: (mp.supportedParameters as string[]) ?? [],
    deprecationDate: mp.deprecationDate ?? null,
    metadataSource: mp.metadataSource ?? "inferred",
    metadataConfidence: mp.metadataConfidence ?? "low",
    perRequestLimits: mp.perRequestLimits as any ?? null,
  }));
}

/**
 * Load a task requirement by task type.
 * Falls back to a permissive default if the task type isn't registered.
 */
export async function loadTaskRequirement(
  taskType: string,
): Promise<TaskRequirementContract> {
  const req = await prisma.taskRequirement.findUnique({
    where: { taskType },
  });

  if (req) {
    return {
      taskType: req.taskType,
      description: req.description,
      selectionRationale: req.selectionRationale,
      requiredCapabilities: req.requiredCapabilities as TaskRequirementContract["requiredCapabilities"],
      preferredMinScores: req.preferredMinScores as Record<string, number>,
      maxLatencyMs: req.maxLatencyMs ?? undefined,
      preferCheap: req.preferCheap,
    };
  }

  // Default for unknown task types — no hard requirements, prefer conversational
  return {
    taskType,
    description: `Unregistered task type: ${taskType}`,
    selectionRationale: "No specific requirements — using general-purpose routing",
    requiredCapabilities: {},
    preferredMinScores: { conversational: 40, reasoning: 40 },
    preferCheap: false,
  };
}

/**
 * Load active policy rules.
 */
export async function loadPolicyRules(): Promise<PolicyRuleEval[]> {
  const now = new Date();
  const rules = await prisma.policyRule.findMany({
    where: {
      effectiveFrom: { lte: now },
      OR: [
        { effectiveUntil: null },
        { effectiveUntil: { gt: now } },
      ],
    },
  });

  return rules.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    condition: r.condition as unknown as PolicyRuleEval["condition"],
  }));
}

/**
 * Load pinned/blocked overrides for a task type.
 */
export async function loadOverrides(taskType: string): Promise<EndpointOverride[]> {
  const perf = await prisma.endpointTaskPerformance.findMany({
    where: {
      taskType,
      OR: [{ pinned: true }, { blocked: true }],
    },
    select: {
      endpointId: true,
      taskType: true,
      pinned: true,
      blocked: true,
    },
  });

  return perf.map((p) => ({
    endpointId: p.endpointId,
    taskType: p.taskType,
    pinned: p.pinned,
    blocked: p.blocked,
  }));
}

/**
 * Persist a RouteDecision to the audit log.
 */
export async function persistRouteDecision(
  decision: import("./types").RouteDecision,
  agentMessageId?: string,
  shadowMode = false,
): Promise<string> {
  const record = await prisma.routeDecisionLog.create({
    data: {
      agentMessageId: agentMessageId ?? null,
      selectedEndpointId: decision.selectedEndpoint ?? "none",
      selectedModelId: decision.selectedModelId ?? null,
      taskType: decision.taskType,
      sensitivity: decision.sensitivity,
      reason: decision.reason,
      // Normalize to DB invariant 0..1 (pipeline scores are 0..100 or unbounded).
      fitnessScore: Math.min(Math.max(decision.fitnessScore / 100, 0), 1),
      candidateTrace: decision.candidates as any,
      excludedTrace: decision.candidates.filter((c) => c.excluded) as any,
      policyRulesApplied: decision.policyRulesApplied,
      fallbackChain: decision.fallbackChain,
      shadowMode,
    },
  });
  return record.id;
}
