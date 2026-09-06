import type { UserContext } from "@/lib/permissions";
import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tools";
import {
  parseInitiativeReviewBinding,
  submitRemoteCoworkerTask,
  validateInitiativeReviewAuthorityScope,
  type InitiativeReviewBinding,
} from "@/lib/mcp-task-submit";

export type ExternalCoworkerTaskInput = {
  collaborationKind: "handoff" | "summon";
  targetAgent: string;
  objective: string;
  requestKey?: string;
  title?: string;
  requiredToolNames?: unknown;
  initiativeReviewBinding?: unknown;
  userId: string;
  context?: ToolExecutionContext;
};

const RECONNECT_ACTION =
  "Reconnect through the DPF MCP endpoint with a write-capable personal access token, then retry with requestKey.";

function verifiedPatContext(context: ToolExecutionContext | undefined): {
  tokenId: string;
  capability: "read" | "write";
  userContext: UserContext;
} | null {
  if (
    context?.authSource !== "pat"
    || typeof context.apiTokenId !== "string"
    || context.apiTokenId.trim().length === 0
    || !context.userContext
  ) {
    return null;
  }
  return {
    tokenId: context.apiTokenId,
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
  const allowedReaders = new Set(["read_source_at_version", "search_source_at_version"]);
  if (
    names.length < 2
    || names.length > 4
    || !names.includes(binding.writerToolName)
    || !names.includes("read_source_at_version")
    || names.some((name) => name !== binding.writerToolName && !allowedReaders.has(name))
  ) {
    return "requiredToolNames must contain the bound writer and read_source_at_version; search_source_at_version is the only optional extra tool";
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
 * Bridges threadless, PAT-authenticated collaboration calls onto the existing
 * governed autonomous-task owner. The caller never supplies a portal thread or
 * a reviewer principal: the token and target coworker remain server-owned.
 */
export async function dispatchExternalCoworkerTask(input: ExternalCoworkerTaskInput): Promise<ToolResult> {
  const verified = verifiedPatContext(input.context);
  if (!verified) {
    return {
      success: false,
      error: "external_handoff_context_required",
      message: `External coworker handoff requires verified PAT context. ${RECONNECT_ACTION}`,
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

  let outcome: Awaited<ReturnType<typeof submitRemoteCoworkerTask>>;
  try {
    outcome = await submitRemoteCoworkerTask({
      token: {
        tokenId: verified.tokenId,
        userId: input.userId,
        capability: verified.capability,
        source: "pat",
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
