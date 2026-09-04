import { prisma } from "@dpf/db";
import { resolveWorkforcePlatformRole } from "@/lib/govern/auth-utils";
import type { UserContext } from "@/lib/permissions";
import {
  parseInitiativeReviewBinding,
  parseRemoteTaskSubmitParams,
  resumeWaitingRemoteTask,
  type ExistingRemoteTask,
  type RemoteRiskClass,
  type RemoteTaskSubmitAuth,
  type RemoteTaskSubmitOutcome,
} from "./mcp-task-submit";
import {
  deterministicExternalTaskRunId,
  parseResourceWaitProjection,
  remoteTaskRequestDigest,
} from "./mcp-task-capacity-contract";

type StoredRemoteTask = ExistingRemoteTask & {
  initiatingAgentId: string | null;
  routeContext: string | null;
  title: string;
  objective: string;
  authorityScope: unknown;
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function refusal(taskRunId: string, reason: string): RemoteTaskSubmitOutcome {
  return {
    kind: "result",
    result: {
      taskRunId,
      status: "submitted",
      idempotentReplay: true,
      content: [{ type: "text", text: reason }],
      structuredContent: {
        error: "stored_resume_state_incomplete",
        taskRunId,
        reason,
      },
      isError: true,
    },
  };
}

function storedTextPart(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (!part || typeof part !== "object" || Array.isArray(part)) continue;
    const text = optionalString((part as Record<string, unknown>)["text"]);
    if (text) return text;
  }
  return null;
}

/**
 * Trusted capacity-event seam. The caller supplies only the durable TaskRun
 * identity; request content and authority are reconstructed from server-owned
 * rows and revalidated before the shared compare-and-set resumer runs.
 */
export async function resumeRemoteCoworkerTaskById(
  taskRunId: string,
): Promise<RemoteTaskSubmitOutcome> {
  const existing = await prisma.taskRun.findUnique({
    where: { taskRunId },
    select: {
      id: true,
      taskRunId: true,
      userId: true,
      threadId: true,
      contextId: true,
      initiatingAgentId: true,
      routeContext: true,
      title: true,
      objective: true,
      authorityScope: true,
      status: true,
      progressPayload: true,
      a2aMetadata: true,
      updatedAt: true,
    },
  }) as StoredRemoteTask | null;
  if (!existing || existing.status !== "submitted" || !parseResourceWaitProjection(existing.progressPayload)) {
    return refusal(taskRunId, "The original waiting TaskRun is missing or no longer resumable.");
  }

  const metadata = existing.a2aMetadata && typeof existing.a2aMetadata === "object"
    && !Array.isArray(existing.a2aMetadata)
    ? existing.a2aMetadata as Record<string, unknown>
    : null;
  const tokenId = optionalString(metadata?.["apiTokenId"]);
  const tokenSource = metadata?.["tokenSource"];
  const tokenCapability = metadata?.["tokenCapability"];
  const requestedAgentId = optionalString(metadata?.["requestedAgentId"]);
  const idempotencyKey = optionalString(metadata?.["idempotencyKey"]);
  const riskClass = optionalString(metadata?.["riskClass"]);
  const requestDigest = optionalString(metadata?.["requestDigest"]);
  const collaborationKind = metadata?.["collaborationKind"];
  const requestedThreadId = metadata?.["requestedThreadId"];
  const authorityScope = Array.isArray(existing.authorityScope)
    && existing.authorityScope.every((entry) => typeof entry === "string")
    ? existing.authorityScope as string[]
    : null;
  const initiativeReviewBinding = metadata?.["initiativeReviewBinding"] === null
    || metadata?.["initiativeReviewBinding"] === undefined
    ? undefined
    : parseInitiativeReviewBinding(metadata["initiativeReviewBinding"]);
  const message = await prisma.taskMessage.findFirst({
    where: { taskRunId: existing.id, role: "user" },
    orderBy: { createdAt: "asc" },
    select: { parts: true },
  });
  const prompt = storedTextPart(message?.parts);

  if (
    !tokenId
    // Event recovery cannot revalidate a five-minute session JWT because the
    // bearer is intentionally not persisted. A fresh authenticated caller can
    // still perform an exact replay; the event seam remains PAT-only.
    || tokenSource !== "pat"
    || (tokenCapability !== "read" && tokenCapability !== "write")
    || !requestedAgentId
    || !existing.routeContext
    || !idempotencyKey
    || !riskClass
    || !(["read", "bounded-write", "high-risk"] as const).includes(riskClass as RemoteRiskClass)
    || !requestDigest
    || !authorityScope
    || !prompt
    || (requestedThreadId !== null && requestedThreadId !== undefined && typeof requestedThreadId !== "string")
    || (collaborationKind !== null && collaborationKind !== undefined
      && collaborationKind !== "handoff" && collaborationKind !== "summon")
    || (metadata?.["initiativeReviewBinding"] !== null
      && metadata?.["initiativeReviewBinding"] !== undefined
      && !initiativeReviewBinding)
  ) {
    return refusal(taskRunId, "Stored request or authority metadata is incomplete.");
  }

  const parsed = parseRemoteTaskSubmitParams({
    agentId: requestedAgentId,
    routeContext: existing.routeContext,
    title: existing.title,
    objective: existing.objective,
    prompt,
    idempotencyKey,
    riskClass,
    threadId: requestedThreadId,
    authorityScope,
    collaborationKind,
    ...(initiativeReviewBinding ? { initiativeReviewBinding } : {}),
  });
  if (typeof parsed === "string" || remoteTaskRequestDigest(parsed) !== requestDigest) {
    return refusal(taskRunId, "Stored request state does not match its immutable digest.");
  }
  if (deterministicExternalTaskRunId(tokenId, idempotencyKey) !== existing.taskRunId) {
    return refusal(taskRunId, "Stored TaskRun identity does not match its token-scoped request key.");
  }

  const storedToken = await prisma.mcpApiToken.findUnique({
    where: { id: tokenId },
    select: { userId: true, capability: true, revokedAt: true, expiresAt: true },
  });
  if (
    !storedToken
    || storedToken.userId !== existing.userId
    || storedToken.capability !== tokenCapability
    || storedToken.revokedAt !== null
    || (storedToken.expiresAt !== null && storedToken.expiresAt <= new Date())
  ) {
    return refusal(taskRunId, "The original MCP token authority is no longer valid.");
  }

  const user = await prisma.user.findUnique({
    where: { id: existing.userId },
    select: { isSuperuser: true, groups: { include: { platformRole: true } } },
  });
  if (!user) return refusal(taskRunId, "The original submitting user no longer exists.");
  const userContext: UserContext = {
    userId: existing.userId,
    platformRole: resolveWorkforcePlatformRole(user.groups),
    isSuperuser: user.isSuperuser,
  };
  const token: RemoteTaskSubmitAuth = {
    tokenId,
    userId: existing.userId,
    capability: tokenCapability,
    source: tokenSource,
  };
  return (await resumeWaitingRemoteTask({
    existing,
    requestDigest,
    token,
    userContext,
    parsed,
  })) ?? refusal(taskRunId, "The waiting TaskRun could not be reserved for continuation.");
}
