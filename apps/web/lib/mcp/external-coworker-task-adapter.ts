import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { Prisma } from "@dpf/db";
import type { RemoteTaskSubmitAuth } from "@/lib/mcp-task-submit-types";
import { parseEngagementTaskBinding, engagementInputDigest, buildEngagementTaskPrompt, ENGAGEMENT_READ_TOOLS } from "@/lib/coworker-service-catalog/engagement-task-binding";
import { reconcileEngagementTaskResult } from "@/lib/coworker-service-catalog/engagement-fulfillment";
import type { UserContext } from "@/lib/permissions";
import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import type { InitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import { immutablePageReaderForArtifact } from "@/lib/tak/terminal-tool-policy";
import {
  parseInitiativeReviewBinding,
  submitRemoteCoworkerTask,
  validateInitiativeReviewAuthorityScope,
} from "@/lib/mcp-task-submit";
import { validateObjectiveMappingRequestKey } from "@/lib/mcp-task-objective-mapping-request-key";

export type ExternalCoworkerTaskInput = {
  collaborationKind: "handoff" | "summon";
  targetAgent: string;
  objective: string;
  requestKey?: string;
  title?: string;
  requiredToolNames?: unknown;
  initiativeReviewBinding?: unknown;
  reviewRecovery?: unknown;
  userId: string;
  context?: ToolExecutionContext;
};

const RECONNECT_ACTION =
  "Reconnect through the DPF MCP endpoint with an authorized OAuth access token or write-capable personal access token, then retry with requestKey.";

function verifiedExternalContext(context: ToolExecutionContext | undefined): {
  tokenId: string;
  source: "pat" | "oauth";
  capability: "read" | "write";
  userContext: UserContext;
} | null {
  if (
    (context?.authSource !== "pat" && context?.authSource !== "oauth")
    || typeof context.apiTokenId !== "string"
    || context.apiTokenId.trim().length === 0
    || !context.userContext
  ) {
    return null;
  }
  return {
    tokenId: context.apiTokenId,
    source: context.authSource,
    capability: context.tokenScope === "write" || context.tokenScope === "admin" ? "write" : "read",
    userContext: context.userContext,
  };
}

type InitiativeReviewPacket = {
  binding: InitiativeReviewBinding;
  authorityScope: string[];
};

function initiativeReviewPacket(input: ExternalCoworkerTaskInput): InitiativeReviewPacket | string | null {
  const hasBinding = input.initiativeReviewBinding !== undefined;
  const hasRequiredTools = input.requiredToolNames !== undefined;
  if (!hasBinding && !hasRequiredTools) return null;
  if (!hasBinding || !hasRequiredTools || !Array.isArray(input.requiredToolNames)) {
    return "initiativeReviewBinding and requiredToolNames must be supplied together";
  }

  const binding = parseInitiativeReviewBinding(input.initiativeReviewBinding);
  if (!binding) return "initiativeReviewBinding is not a valid immutable repository binding";
  const names = [...new Set(input.requiredToolNames.flatMap((value) =>
    typeof value === "string" && value.trim() ? [value.trim()] : []))];
  const pageReader = immutablePageReaderForArtifact(binding.artifactRef);
  const allowedReaders = new Set([pageReader, "search_source_at_version"]);
  if (
    names.length < 2
    || names.length > 4
    || !names.includes(binding.writerToolName)
    || !names.includes(pageReader)
    || names.some((name) => name !== binding.writerToolName && !allowedReaders.has(name))
  ) {
    return `requiredToolNames must contain the bound writer and ${pageReader}; search_source_at_version is the only optional extra tool`;
  }

  const authorityScope = [
    ...(input.context?.tokenGrantScopes ?? []).filter((scope) =>
      !scope.startsWith("tool:") && !scope.startsWith("backlog-item:")),
    `backlog-item:${binding.itemId}`,
    ...names.map((name) => `tool:${name}`),
  ];
  const scopeError = validateInitiativeReviewAuthorityScope(binding, authorityScope);
  return scopeError ? scopeError : { binding, authorityScope };
}

/**
 * Bridges threadless, token-authenticated collaboration calls onto the existing
 * governed autonomous-task owner. The caller never supplies a portal thread or
 * a reviewer principal: the token and target coworker remain server-owned.
 */
export async function dispatchExternalCoworkerTask(input: ExternalCoworkerTaskInput): Promise<ToolResult> {
  const verified = verifiedExternalContext(input.context);
  if (!verified) {
    return {
      success: false,
      error: "external_handoff_context_required",
      message: `External coworker handoff requires verified OAuth or PAT context. ${RECONNECT_ACTION}`,
      data: { action: RECONNECT_ACTION },
    };
  }

  const requestKey = input.requestKey?.trim();
  if (!requestKey) {
    return {
      success: false,
      error: "missing_requestKey",
      message: "External coworker handoff requires requestKey so retries are token-bound and idempotent.",
      data: { action: "Retry with a stable requestKey for this immutable review request." },
    };
  }

  const reviewPacket = initiativeReviewPacket(input);
  if (typeof reviewPacket === "string") {
    return {
      success: false,
      error: "invalid_initiative_review_packet",
      message: reviewPacket,
      data: { action: "Use the exact server-issued readiness packet without adding tools or changing immutable identity." },
    };
  }
  if (reviewPacket?.binding.gate === "objective-mapping") {
    const binding = reviewPacket.binding;
    const currentPacketValid = binding.workroomRef && binding.eligibleEvidenceActivityIds
      ? validateObjectiveMappingRequestKey({
        targetAgent: input.targetAgent,
        objective: input.objective,
        questionPacketSummary: input.title?.trim() ?? "",
        requiredToolNames: input.requiredToolNames as string[],
        binding: {
          ...binding,
          gate: "objective-mapping",
          eligibleEvidenceActivityIds: binding.eligibleEvidenceActivityIds,
          workroomRef: binding.workroomRef,
        },
        requestKey,
      })
      : /^initiative-readiness:BI-[A-Za-z0-9-]+:objective-mapping:[a-f0-9]{40}$/u.test(requestKey);
    if (!currentPacketValid) {
      return {
        success: false,
        error: "invalid_objective_mapping_request_key",
        message: "Objective-mapping requires the exact versioned requestKey and Workroom binding from the server-issued readiness packet.",
        data: { action: "Refresh readiness and submit the exact packet without changing its key, summary, binding, or evidence set." },
      };
    }
  }

  let outcome: Awaited<ReturnType<typeof submitRemoteCoworkerTask>>;
  try {
    outcome = await submitRemoteCoworkerTask({
      token: {
        tokenId: verified.tokenId,
        userId: input.userId,
        capability: verified.capability,
        source: verified.source,
      },
      userContext: verified.userContext,
      params: {
        agentId: input.targetAgent,
        routeContext: input.context?.routeContext ?? "/build",
        title: input.title?.trim() || `${input.collaborationKind === "summon" ? "Summon" : "Request"} ${input.targetAgent}`,
        objective: input.objective,
        prompt: input.objective,
        idempotencyKey: requestKey,
        riskClass: "bounded-write",
        authorityScope: reviewPacket?.authorityScope ?? input.context?.tokenGrantScopes ?? [],
        ...(reviewPacket ? { initiativeReviewBinding: reviewPacket.binding } : {}),
        collaborationKind: input.collaborationKind,
        ...(input.reviewRecovery !== undefined ? { reviewRecovery: input.reviewRecovery } : {}),
      },
    });
  } catch (error) {
    return {
      success: false,
      error: "remote_handoff_failed",
      message: error instanceof Error ? error.message : "The governed external coworker task could not be submitted.",
      data: { action: "Retry the same immutable packet and requestKey; if it repeats, inspect the MCP task service." },
    };
  }

  if (outcome.kind === "invalid_params") {
    return { success: false, error: "invalid_params", message: outcome.message };
  }

  const result = outcome.result;
  const structured = result["structuredContent"];
  if (result["isError"] === true) {
    const error = structured && typeof structured === "object" && "error" in structured
      ? String((structured as Record<string, unknown>)["error"])
      : "external_handoff_failed";
    const content = Array.isArray(result["content"])
      ? result["content"].find((item) => item && typeof item === "object" && "text" in item)
      : null;
    return {
      success: false,
      error,
      message: content && typeof content === "object" ? String((content as Record<string, unknown>)["text"] ?? error) : error,
      data: result,
    };
  }

  const taskRunId = typeof result["taskRunId"] === "string" ? result["taskRunId"] : undefined;
  return {
    success: true,
    entityId: taskRunId,
    message: `${input.collaborationKind === "summon" ? "Summoned" : "Handed off to"} ${input.targetAgent} through governed external work.`,
    data: result,
  };
}


const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value === value.trim();

/** Resume the original engagement through the existing governed durable task runner. */
export async function fulfillCoworkerEngagement(engagementId: string, locator: unknown, userId: string, context?: ToolExecutionContext, db?: Prisma.TransactionClient): Promise<ToolResult> {
  if (!context?.agentId || !context.apiTokenId || !context.userContext
    || (context.authSource !== "oauth" && context.authSource !== "pat")) return { success: false, error: "engagement_verified_context_required", message: "An authenticated coworker connection is required to fulfill this request." };
  const prisma = db ?? (await import("@dpf/db")).prisma;
  const engagement = await prisma.coworkerEngagement.findFirst({ where: { engagementId, requestedByUserId: userId, requestedByAgentId: context.agentId } });
  if (!engagement) return { success: false, error: "engagement_not_found", message: "No engagement owned by this caller was found." };
  if (locator === undefined) {
    const binding = parseEngagementTaskBinding(record(record(engagement.metadata).fulfillment).binding);
    const credential = await prisma.mcpApiToken.findUnique({ where: { id: context.apiTokenId }, select: { userId: true, kind: true, revokedAt: true, expiresAt: true, workroomRef: true, runRef: true } });
    if (!credential || credential.userId !== userId || credential.revokedAt
      || (credential.expiresAt !== null && credential.expiresAt <= new Date())
      || (credential.kind === "workroom_session" && !binding)) throw new Error("engagement_read_scope_refused");
    if (binding) {
      const room = await prisma.workroom.findUnique({ where: { capsuleId: binding.workroomId }, select: { id: true, capsuleId: true, taskRunId: true } });
      if (!room || (credential.kind === "workroom_session" && (credential.workroomRef !== room.capsuleId || credential.runRef !== room.taskRunId))) throw new Error("engagement_read_scope_refused");
      const { resolveAgentWorkroomAccess } = await import("@/lib/work-management/workroom-agent-access.server");
      const access = await resolveAgentWorkroomAccess({ userId, agentId: context.agentId, workroomId: room.id, requested: "content" }, prisma);
      if (access.decision.level !== "content") throw new Error("engagement_read_access_refused");
    }
    const taskRunId = record(record(engagement.metadata).fulfillment).taskRunId;
    if (text(taskRunId)) {
      try { await reconcileEngagementTaskResult(taskRunId, db); }
      catch {
        return { success: false, error: "engagement_projection_unavailable", entityId: engagementId,
          message: "The original task is persisted but engagement result projection failed. Retry observation; no execution was requested.",
          data: { engagementId, taskRunId, observedEngagementStatus: engagement.status, nextAction: "Observe this same engagementId again; inspect engagement-result-projection phase timings if it persists.", executionRequested: false } };
      }
    }
    const latest = await prisma.coworkerEngagement.findUnique({ where: { engagementId } });
    return { success: true, entityId: engagementId, message: "Persisted engagement state; no execution was requested.", data: { engagementId, status: latest?.status ?? engagement.status, fulfillment: record(latest?.metadata ?? engagement.metadata).fulfillment ?? null, result: record(latest?.metadata ?? engagement.metadata).result ?? null } };
  }
  const supplied = record(locator);
  if (Object.keys(supplied).some(key => !["workroomId", "stageKey", "artifactRef", "guidanceArtifacts"].includes(key))) return { success: false, error: "engagement_locator_invalid", message: "Use the original artifact and current room stage; original request inputs cannot be replaced." };
  const room = typeof supplied.workroomId === "string" ? await prisma.workroom.findUnique({ where: { capsuleId: supplied.workroomId }, select: { headSha: true } }) : null;
  const binding = parseEngagementTaskBinding({
    version: 1, engagementId, offerId: engagement.offerId, serviceId: engagement.serviceId,
    providerAgentId: engagement.providerAgentId, actorAgentId: context.agentId, userId,
    workroomId: supplied.workroomId, stageKey: supplied.stageKey, artifactRef: supplied.artifactRef, roomHeadSha: room?.headSha,
    ...(supplied.guidanceArtifacts !== undefined ? { guidanceArtifacts: supplied.guidanceArtifacts } : {}),
    inputDigest: engagementInputDigest(engagement.requestedOutcome, engagement.inputPayload),
  });
  if (!binding) return { success: false, error: "engagement_locator_invalid", message: "Provide the current Workroom stage and immutable repository artifact locator." };
  const existing = record(record(engagement.metadata).fulfillment);
  if (existing.taskRunId) {
    if (canonicalJson(existing.binding) !== canonicalJson(binding)) return { success: false, error: "engagement_already_bound", message: "Read the original engagementId without fulfillment to observe its existing task; do not submit a different revision or stage." };
    if (engagement.status === "failed") {
    const { resumeUnstartedEngagementTask } = await import("@/lib/coworker-service-catalog/engagement-pre-admission-recovery");
    await resumeUnstartedEngagementTask({ taskRunId: String(existing.taskRunId), binding,
      token: { tokenId: context.apiTokenId, userId, capability: context.tokenScope === "write" || context.tokenScope === "admin" ? "write" : "read", source: context.authSource } });
    } else if (["accepted", "in-progress"].includes(engagement.status)) {
      const { resumeCapacityWaitingEngagementTask } = await import("@/lib/coworker-service-catalog/engagement-capacity-recovery");
      await resumeCapacityWaitingEngagementTask({ taskRunId: String(existing.taskRunId), binding,
        token: { tokenId: context.apiTokenId, userId, capability: context.tokenScope === "write" || context.tokenScope === "admin" ? "write" : "read", source: context.authSource } });
    }
    return fulfillCoworkerEngagement(engagementId, undefined, userId, context, db);
  }
  const token: RemoteTaskSubmitAuth = { tokenId: context.apiTokenId, userId, capability: context.tokenScope === "write" || context.tokenScope === "admin" ? "write" : "read", source: context.authSource };
  const scope = ["coworker_engagement_write", "file_read", "registry_read", ...ENGAGEMENT_READ_TOOLS.map(name => `tool:${name}`)];
  const prompt = buildEngagementTaskPrompt(binding, engagement);
  const outcome = await submitRemoteCoworkerTask({ token, userContext: context.userContext, params: {
    agentId: binding.providerAgentId, routeContext: context.routeContext ?? "/area/platform", title: `Specialist contribution: ${engagement.offerId}`,
    objective: engagement.requestedOutcome, prompt, idempotencyKey: `coworker-engagement:${engagementId}`,
    riskClass: "read", authorityScope: scope, engagementBinding: binding,
  } });
  if (outcome.kind === "invalid_params") return { success: false, error: "engagement_task_invalid", message: outcome.message };
  return { success: outcome.result.isError !== true, entityId: engagementId,
    message: "Read the persisted task state to distinguish acceptance, execution and a completed contribution.", data: { engagementId, task: outcome.result } };
}
