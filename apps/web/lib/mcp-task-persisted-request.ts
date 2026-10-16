// Immutable request reconstruction is shared by workers and governed preflight.
// Keep this leaf independent of execution/dispatch modules.
import { prisma } from "@dpf/db";
import { isRecord } from "./shared/coerce";
import { currentUserContextFromRecord } from "./govern/current-user-context";
import { ok, type ActionSuccess } from "./shared/action-result";
import { remoteTaskRequestMatches } from "./mcp-task-capacity-contract";
import { parseDurableInferenceTaskMetadata } from "./mcp-task-durable-inference-contract";
import { parseInitiativeReviewBinding } from "./mcp-task-review-contract";
import type { RemoteTaskSubmitAuth } from "./mcp-task-submit-types";
import { parseEngagementTaskBinding } from "./coworker-service-catalog/engagement-fulfillment";
import { parseRemoteTaskSubmitParams } from "./mcp-task-submit-params";
import type { RemoteTaskSubmitParams } from "./mcp-task-submit-params";

export type PersistedRemoteTask = {
  id: string;
  taskRunId: string;
  userId: string;
  threadId: string | null;
  contextId: string | null;
  status: string;
  routeContext: string | null;
  title: string;
  objective: string;
  currentAgentId: string | null;
  authorityScope: unknown;
  progressPayload: unknown;
  a2aMetadata: unknown;
  updatedAt: Date;
  messages: Array<{ parts: unknown }>;
  user: {
    id: string;
    isActive: boolean;
    isSuperuser: boolean;
    groups: Array<{ platformRole: { roleId: string } | null }>;
  };
};

type ReconstructedRemoteTask = {
  run: { id: string; taskRunId: string; contextId: string | null };
  threadId: string;
  token: RemoteTaskSubmitAuth;
  userContext: import("@/lib/permissions").UserContext;
  parsed: RemoteTaskSubmitParams;
};

export type ReconstructionFailure = {
  ok: false;
  code:
    | "persisted_identity_incomplete"
    | "persisted_request_invalid"
    | "request_digest_mismatch";
  message: string;
};

export function persistedTaskString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return null;
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function storedTextPart(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const value = isRecord(part) ? part : null;
    const text = persistedTaskString(value?.["text"]);
    if (text) return text;
  }
  return null;
}

export type ReviewExecutionAuthority = {
  schemaVersion: 1; tokenId: string; userId: string; actingAgentId: string;
  requestDigest: string; originTokenId: string; expectedPriorUpdatedAt: string; recordedAt: string;
};

/** A malformed persisted authority record is a refusal, never fallback to origin. */
export function parseReviewExecutionAuthority(progress: unknown, metadata: unknown, userId: string): ReviewExecutionAuthority | null {
  const ref = isRecord(progress) ? progress.reviewExecutionAuthority : null;
  if (!isRecord(ref) || !isRecord(metadata) || ref.schemaVersion !== 1 || ref.userId !== userId
    || ref.originTokenId !== metadata.apiTokenId || ref.requestDigest !== metadata.requestDigest
    || metadata.tokenSource !== "oauth" || metadata.tokenCapability !== "write"
    || typeof metadata.taskAuthorityKey !== "string" || !metadata.taskAuthorityKey.startsWith("oauth-family:")
    || ["tokenId", "actingAgentId", "originTokenId", "requestDigest", "expectedPriorUpdatedAt", "recordedAt"].some(key => typeof ref[key] !== "string" || !ref[key])
    || !Number.isFinite(Date.parse(String(ref.expectedPriorUpdatedAt))) || !Number.isFinite(Date.parse(String(ref.recordedAt)))) return null;
  return ref as ReviewExecutionAuthority;
}

export function reconstructPersistedRemoteTask(
  row: PersistedRemoteTask,
): ActionSuccess<ReconstructedRemoteTask> | ReconstructionFailure {
  const metadata = isRecord(row.a2aMetadata) ? row.a2aMetadata : null;
  const idempotencyKey = persistedTaskString(metadata?.["idempotencyKey"]);
  const requestDigest = persistedTaskString(metadata?.["requestDigest"]);
  const riskClass = persistedTaskString(metadata?.["riskClass"]);
  const tokenId = persistedTaskString(metadata?.["apiTokenId"]);
  const tokenSource = persistedTaskString(metadata?.["tokenSource"]);
  const tokenCapability = persistedTaskString(metadata?.["tokenCapability"]);
  const agentId = persistedTaskString(metadata?.["requestedAgentId"]) ?? persistedTaskString(row.currentAgentId);
  const routeContext = persistedTaskString(row.routeContext);
  const prompt = storedTextPart(row.messages[0]?.parts);
  const authorityScope = stringArray(row.authorityScope);
  const hasRequestObjective = metadata !== null
    && Object.prototype.hasOwnProperty.call(metadata, "requestObjective");
  let requestObjective = row.objective;
  if (hasRequestObjective) {
    const storedRequestObjective = persistedTaskString(metadata?.["requestObjective"]);
    if (!storedRequestObjective) {
      return {
        ok: false,
        code: "persisted_request_invalid",
        message: "Persisted remote task request objective is invalid.",
      };
    }
    requestObjective = storedRequestObjective;
  }

  const currentHuman = currentUserContextFromRecord(row.userId, row.user);
  if (
    !row.id
    || !currentHuman
    || !row.taskRunId
    || !row.userId
    || !row.threadId
    || !idempotencyKey
    || !requestDigest
    || !tokenId
    || !agentId
    || !routeContext
    || !prompt
    || !authorityScope
  ) {
    return {
      ok: false,
      code: "persisted_identity_incomplete",
      message: "Persisted remote task identity is incomplete and cannot be executed.",
    };
  }
  if (
    (riskClass !== "read" && riskClass !== "bounded-write" && riskClass !== "high-risk")
    || (tokenCapability !== "read" && tokenCapability !== "write")
    || (tokenSource !== "pat" && tokenSource !== "oauth" && tokenSource !== "session-jwt")
  ) {
    return {
      ok: false,
      code: "persisted_request_invalid",
      message: "Persisted remote task authorization snapshot is invalid.",
    };
  }

  const rawEngagementBinding = metadata?.["engagementBinding"];
  const engagementBinding = rawEngagementBinding == null ? undefined : parseEngagementTaskBinding(rawEngagementBinding);
  if (rawEngagementBinding != null && !engagementBinding) return { ok: false, code: "persisted_request_invalid", message: "Persisted engagement binding is invalid." };
  const rawReviewBinding = metadata?.["initiativeReviewBinding"];
  const initiativeReviewBinding = rawReviewBinding === null || rawReviewBinding === undefined
    ? undefined
    : parseInitiativeReviewBinding(rawReviewBinding);
  if (rawReviewBinding !== null && rawReviewBinding !== undefined && !initiativeReviewBinding) {
    return {
      ok: false,
      code: "persisted_request_invalid",
      message: "Persisted initiative review binding is invalid.",
    };
  }
  const rawDurableInference = metadata?.["durableInference"];
  const durableInference = rawDurableInference === undefined
    ? null
    : parseDurableInferenceTaskMetadata(rawDurableInference);
  if (rawDurableInference !== undefined && !durableInference) {
    return {
      ok: false,
      code: "persisted_request_invalid",
      message: "Persisted durable inference recipe binding is invalid.",
    };
  }
  if (durableInference && (riskClass !== "read" || initiativeReviewBinding)) {
    return {
      ok: false,
      code: "persisted_request_invalid",
      message: "Persisted durable inference authorization is outside the closed read-only mode.",
    };
  }
  const requestedThreadId = persistedTaskString(metadata?.["requestedThreadId"]);
  const collaboration = persistedTaskString(metadata?.["collaborationKind"]);
  const collaborationKind = collaboration === "handoff" || collaboration === "summon"
    ? collaboration
    : undefined;
  const parsed: RemoteTaskSubmitParams = {
    agentId,
    routeContext,
    title: row.title,
    objective: requestObjective,
    prompt,
    idempotencyKey,
    riskClass,
    threadId: requestedThreadId,
    authorityScope,
    ...(collaborationKind ? { collaborationKind } : {}),
    ...(initiativeReviewBinding ? { initiativeReviewBinding } : {}),
    ...(engagementBinding ? { engagementBinding } : {}),
    ...(durableInference ? { recipeId: durableInference.recipeId } : {}),
  };

  if (engagementBinding && typeof parseRemoteTaskSubmitParams({ ...parsed }) === "string") {
    return { ok: false, code: "persisted_request_invalid", message: "Persisted engagement task is outside its closed submission contract." };
  }
  if (!remoteTaskRequestMatches(metadata, parsed)) {
    return {
      ok: false,
      code: "request_digest_mismatch",
      message: "Persisted remote task request does not match its immutable digest.",
    };
  }

  const hasRecoveryAuthority = isRecord(row.progressPayload) && row.progressPayload["reviewExecutionAuthority"] !== undefined;
  const recoveryAuthority = hasRecoveryAuthority ? parseReviewExecutionAuthority(row.progressPayload, metadata, row.userId) : null;
  if (hasRecoveryAuthority && (!recoveryAuthority || !initiativeReviewBinding?.workroomRef || durableInference || engagementBinding)) {
    return { ok: false, code: "persisted_request_invalid", message: "Persisted review execution authority is invalid." };
  }
  return ok({
      run: { id: row.id, taskRunId: row.taskRunId, contextId: row.contextId },
      threadId: row.threadId,
      token: {
        tokenId: recoveryAuthority?.tokenId ?? tokenId,
        userId: row.userId,
        capability: tokenCapability,
        source: tokenSource,
      },
      userContext: currentHuman,
      parsed,
  });
}

export async function loadPersistedRemoteTask(taskRunId: string): Promise<PersistedRemoteTask | null> {
  const row = await prisma.taskRun.findUnique({
    where: { taskRunId: taskRunId },
    select: {
      id: true,
      taskRunId: true,
      userId: true,
      threadId: true,
      contextId: true,
      status: true,
      routeContext: true,
      title: true,
      objective: true,
      currentAgentId: true,
      authorityScope: true,
      progressPayload: true,
      a2aMetadata: true,
      updatedAt: true,
      messages: {
        where: { role: "user" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { parts: true },
      },
      user: {
        select: {
          id: true,
          isSuperuser: true,
          isActive: true,
          groups: { include: { platformRole: true } },
        },
      },
    },
  }) as PersistedRemoteTask | null;
  return row;
}
