import { prisma } from "@dpf/db";
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
import type { UserContext } from "./permissions";
import type { RemoteTaskSubmitAuth } from "./mcp-task-submit-types";
import type { RemoteTaskSubmitParams } from "./mcp-task-submit-params";
import type { RequestContract } from "./routing/request-contract";
import type { ToolDefinition } from "./mcp-tool-types";
import type { RouteSensitivity } from "./agent-sensitivity";
import type { InitiativeReviewBinding } from "./mcp-task-review-contract";
import { narrowInitiativeReviewTools, requiredToolNames, requiresInitiativeReviewEffort } from "./mcp-task-review-contract";
import { deriveEffortWarrant } from "./tak/effort-warrant";
import { createInitiativeReviewTerminalToolPolicy, enterTerminalWriterPhase } from "./tak/terminal-tool-policy";
import { loadReviewerProfile } from "./backlog/initiative-readiness/reviewer-profile";
import { loadPirEvidenceContext } from "./pir-evidence-context";
import { remoteTaskConversation } from "./mcp-task-conversation";
import { coworkerBriefSpans } from "./tak/coworker-prompt-provenance";
import { resolveEffectiveAgentRouteConfig } from "./tak/agent-route-config";
import { lookupPinnedModelFamily } from "./routing/model-successor";
import { DEFAULT_MINIMUM_CONTEXT_TOKENS, resolveTurnMinimumCapabilities, type AgentMinimumCapabilities } from "./routing/agent-capability-types";
import { captureTaskExecutionFence } from "./shared/task-execution-fence";
import { reassessmentToolSurfaceDigest } from "./routing/reassessment-execution-scope";
import { engagementProviderIdentityRefs, narrowEngagementTools } from "./coworker-service-catalog/engagement-task-binding";

type PreparationPorts = {
  resolveAgent(input: { agentId: string; routeContext: string; userContext: UserContext }): Promise<{
    agentId?: string | null; systemPrompt: string; sensitivity?: RouteSensitivity | null; [key: string]: unknown;
  }>;
  resolveTools(input: { userContext: UserContext; agentId: string; mode: "advise" | "act"; externalAccessEnabled: boolean;
    routeContext: string; intentQuery: string; requiredToolNames: readonly string[]; restrictedReviewBinding?: InitiativeReviewBinding;
  }): Promise<{ tools: ToolDefinition[]; toolsForProvider: Record<string, unknown>[]; deferredTools: ToolDefinition[] }>;
};

/** Normal and restricted work share the same reviewer, criteria, preferences
 * and schemas. Restricted resolution narrows before any local runtime probes. */
export async function prepareRemoteReviewAttempt(input: {
  parsed: RemoteTaskSubmitParams; userContext: UserContext; restricted: boolean;
  resumeKind?: "capacity" | "terminal-writer"; terminalWriterContext?: string;
  validateResolvedAgent?: (agentId: string) => void;
}, ports: PreparationPorts) {
  const { parsed, userContext } = input;
  const agent = await ports.resolveAgent({
    agentId: parsed.agentId,
    routeContext: parsed.routeContext,
    userContext,
  });
  const modelRoutingAgentId = agent.agentId ?? parsed.agentId;
  const resolvedAgentId = parsed.engagementBinding ? modelRoutingAgentId : resolveCanonicalAgentId(modelRoutingAgentId);
  if (parsed.engagementBinding && !engagementProviderIdentityRefs(parsed.engagementBinding.providerAgentId).includes(resolvedAgentId)) {
    throw new Error("Engagement provider identity changed during runtime resolution.");
  }
  input.validateResolvedAgent?.(resolvedAgentId);
  const requestedAgentId = parsed.agentId;
  const requestedCanonicalAgentId = resolveCanonicalAgentId(requestedAgentId);
  let routingConfig: {
    minimumTier: string;
    budgetClass: string;
    pinnedProviderId: string | null;
    pinnedModelId: string | null;
    residencyPolicy: string | null;
  } | null = null;
  // Aliases select assignments; canonical requests prefer stored slugs for routing.
  const configAgentIds = requestedAgentId === requestedCanonicalAgentId
    ? [modelRoutingAgentId, requestedAgentId]
    : [requestedAgentId, modelRoutingAgentId];
  for (const configAgentId of new Set(configAgentIds)) {
    routingConfig = await prisma.agentModelConfig?.findUnique({
    where: { agentId: configAgentId },
    select: {
      minimumTier: true,
      budgetClass: true,
      pinnedProviderId: true,
      pinnedModelId: true,
      residencyPolicy: true,
    },
    }).catch(() => null) ?? null;
    if (routingConfig) break;
  }
  const modelRequirements = routingConfig
    ? {
      defaultMinimumTier: routingConfig.minimumTier,
      defaultBudgetClass: routingConfig.budgetClass,
      ...(routingConfig.pinnedProviderId
      ? { preferredProviderId: routingConfig.pinnedProviderId }
      : {}),
      ...(routingConfig.pinnedModelId
      ? { preferredModelId: routingConfig.pinnedModelId }
      : {}),
      // BI-8CFA1CA8: residency is explicit policy, never inferred from routing.
      ...(routingConfig.residencyPolicy
      ? {
        residencyPolicy:
          routingConfig.residencyPolicy as RequestContract["residencyPolicy"],
        }
      : {}),
    }
    : null;
  const toolMode = parsed.riskClass === "read" ? "advise" : "act";
  const exactRequiredToolNames = requiredToolNames(parsed.authorityScope);
  const resolvedTools = await ports.resolveTools({
    userContext,
    agentId: resolvedAgentId,
    mode: toolMode,
    externalAccessEnabled: true,
    routeContext: parsed.routeContext,
    intentQuery: parsed.prompt,
    requiredToolNames: exactRequiredToolNames,
    ...(input.restricted ? { restrictedReviewBinding: parsed.initiativeReviewBinding } : {}),
  });
  const reviewProfile = parsed.initiativeReviewBinding?.gate === "spec-approval"
    ? await loadReviewerProfile(prisma, parsed.initiativeReviewBinding.itemId) : null;
  const reviewTools = narrowInitiativeReviewTools(
    resolvedTools,
    exactRequiredToolNames,
    parsed.initiativeReviewBinding,
    parsed.prompt,
    reviewProfile,
  );
  const tools = parsed.engagementBinding ? narrowEngagementTools(reviewTools, exactRequiredToolNames) : reviewTools;
  const effortWarrant = requiresInitiativeReviewEffort(exactRequiredToolNames)
    ? deriveEffortWarrant({
      reasoningDepth: "high",
      availableToolNames: [
      ...tools.tools.map((tool) => tool.name),
      ...tools.deferredTools.map((tool) => tool.name),
      ],
      messageChars: parsed.prompt.length,
    })
    : undefined;
  const baseTerminalToolPolicy = parsed.initiativeReviewBinding
    ? createInitiativeReviewTerminalToolPolicy(
      parsed.initiativeReviewBinding.writerToolName,
      exactRequiredToolNames,
      parsed.initiativeReviewBinding.artifactRef,
    )
    : null;
  const terminalToolPolicy = baseTerminalToolPolicy && input.resumeKind === "terminal-writer"
    ? enterTerminalWriterPhase(baseTerminalToolPolicy)
    : baseTerminalToolPolicy;
  const conversation = remoteTaskConversation({
    systemPrompt: `${agent.systemPrompt}\n${await loadPirEvidenceContext(prisma, parsed.initiativeReviewBinding)}`,
    prompt: parsed.prompt,
    resumeKind: input.resumeKind,
    terminalWriterContext: input.terminalWriterContext,
  });
  return { agent, resolvedAgentId, modelRequirements, tools, effortWarrant, terminalToolPolicy, conversation };
}

export async function preparePresentReassessmentInput(input: {
  turn: Awaited<ReturnType<typeof prepareRemoteReviewAttempt>>; parsed: RemoteTaskSubmitParams; token: RemoteTaskSubmitAuth;
  threadId: string; taskRunId: string; requestDigest: string;
}, ports: { resolveSensitivity(parsed: RemoteTaskSubmitParams, token: RemoteTaskSubmitAuth, fallback: RouteSensitivity): Promise<RouteSensitivity> }) {
  const { turn, parsed, token } = input;
  if (!turn.effortWarrant) throw new Error("reassessment-current-bounds-unproven");
  const config = await prisma.agentModelConfig.findUnique({ where: { agentId: turn.resolvedAgentId } });
  const effective = resolveEffectiveAgentRouteConfig({ agentModelConfig: config, modelRequirements: turn.modelRequirements });
  effective.preferredModelFamily ??= await lookupPinnedModelFamily(prisma, effective.preferredProviderId, effective.preferredModelId);
  const minimumCapabilities = resolveTurnMinimumCapabilities(config?.minimumCapabilities as AgentMinimumCapabilities | null,
    { allowToolFreeInference: false, hasProviderTools: turn.tools.toolsForProvider.length > 0, requireTools: false });
  return { messages: turn.conversation.chatHistory, systemPrompt: turn.conversation.systemPrompt,
    sensitivity: await ports.resolveSensitivity(parsed, token, turn.agent.sensitivity ?? "internal"),
    options: { ...effective, tools: turn.tools.toolsForProvider, systemPromptInstructionSpans: coworkerBriefSpans(turn.agent.systemPrompt),
      taskType: "external-mcp", requiresStreaming: false, minimumCapabilities,
      agentMinimumContextTokens: config?.minimumContextTokens ?? DEFAULT_MINIMUM_CONTEXT_TOKENS,
      agentId: turn.resolvedAgentId, routeContext: parsed.routeContext, threadId: input.threadId,
      agentDisplayName: typeof turn.agent.displayName === "string" && turn.agent.displayName.trim() ? turn.agent.displayName.trim() : turn.resolvedAgentId,
      mcpSession: { userId: token.userId, agentId: turn.resolvedAgentId, threadId: input.threadId, routeContext: parsed.routeContext,
        taskRunId: input.taskRunId, taskExecutionFence: captureTaskExecutionFence({}, input.requestDigest) } },
    effortWarrant: turn.effortWarrant, toolSurfaceDigest: reassessmentToolSurfaceDigest(turn.tools.toolsForProvider) };
}
