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

/**
 * Load all active/degraded endpoints as EndpointManifest objects.
 */
export async function loadEndpointManifests(): Promise<EndpointManifest[]> {
  const providers = await prisma.modelProvider.findMany({
    where: {
      status: { in: ["active", "degraded"] },
      endpointType: "llm",
      retiredAt: null,
    },
  });

  return providers.map((p) => ({
    id: p.providerId,
    providerId: p.providerId,
    name: p.name,
    endpointType: p.endpointType,
    status: p.status as EndpointManifest["status"],
    sensitivityClearance: p.sensitivityClearance as SensitivityLevel[],
    supportsToolUse: p.supportsToolUse,
    supportsStructuredOutput: p.supportsStructuredOutput,
    supportsStreaming: p.supportsStreaming,
    maxContextTokens: p.maxContextTokens,
    maxOutputTokens: p.maxOutputTokens,
    modelRestrictions: p.modelRestrictions,
    reasoning: p.reasoning,
    codegen: p.codegen,
    toolFidelity: p.toolFidelity,
    instructionFollowing: p.instructionFollowing,
    structuredOutput: p.structuredOutput,
    conversational: p.conversational,
    contextRetention: p.contextRetention,
    customScores: (p.customScores as Record<string, number>) ?? {},
    avgLatencyMs: p.avgLatencyMs,
    recentFailureRate: p.recentFailureRate,
    // Map DB field name to routing domain field name
    costPerOutputMToken: p.outputPricePerMToken,
    profileSource: p.profileSource as EndpointManifest["profileSource"],
    profileConfidence: p.profileConfidence as EndpointManifest["profileConfidence"],
    retiredAt: p.retiredAt,
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
