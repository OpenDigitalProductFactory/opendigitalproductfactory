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
import type { ModelCardCapabilities, ModelCardPricing } from "./model-card-types";
import { EMPTY_CAPABILITIES, EMPTY_PRICING } from "./model-card-types";

/**
 * Load all active/degraded endpoints as EndpointManifest objects.
 * Queries ModelProfile joined with ModelProvider — each manifest entry represents
 * a specific model, not just a provider.
 */
export async function loadEndpointManifests(): Promise<EndpointManifest[]> {
  const profiles = await prisma.modelProfile.findMany({
    where: {
      modelStatus: "active",
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
    status: mp.provider.status as EndpointManifest["status"],
    sensitivityClearance: mp.provider.sensitivityClearance as SensitivityLevel[],
    supportsToolUse: (mp.capabilities as any)?.toolUse ?? mp.supportsToolUse ?? mp.provider.supportsToolUse,
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
      fitnessScore: decision.fitnessScore,
      candidateTrace: decision.candidates as any,
      excludedTrace: decision.candidates.filter((c) => c.excluded) as any,
      policyRulesApplied: decision.policyRulesApplied,
      fallbackChain: decision.fallbackChain,
      shadowMode,
    },
  });
  return record.id;
}
