import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";
import { agentEventBus } from "@/lib/tak/agent-event-bus";
import type { TaskState } from "@/lib/tak/task-states";
import { MCP_TASK_SELECT } from "@/lib/mcp/tasks-lifecycle";
import { reserveSubmittedTaskRunWorking } from "@/lib/observability/heartbeat";
import { ok, type ActionSuccess } from "@/lib/shared/action-result";
import { mcpTaskNotificationBus } from "./mcp-task-notification-bus";
import { remoteTaskRequestDigest } from "./mcp-task-capacity-contract";
import { parseInitiativeReviewBinding } from "./mcp-task-review-contract";
import { executeRemoteTaskAttempt } from "./mcp-task-execution";
import type {
  RemoteTaskSubmitAuth,
  RemoteTaskSubmitParams,
} from "./mcp-task-submit";

type PersistedRemoteTask = {
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

type ReconstructionFailure = {
  ok: false;
  code:
    | "persisted_identity_incomplete"
    | "persisted_request_invalid"
    | "request_digest_mismatch";
  message: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return null;
  return value.map((entry) => entry.trim()).filter(Boolean);
}

function storedTextPart(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const value = record(part);
    const text = string(value?.["text"]);
    if (text) return text;
  }
  return null;
}

function taskState(value: unknown): TaskState {
  switch (value) {
    case "submitted":
    case "working":
    case "input-required":
    case "auth-required":
    case "completed":
    case "failed":
    case "canceled":
    case "rejected":
    case "archived":
    case "stalled":
    case "quiescing":
    case "paused-for-upgrade":
    case "paused-for-upgrade-forced":
      return value;
    default:
      return "working";
  }
}

async function publishMcpTaskStatus(taskRunId: string, apiTokenId: string): Promise<void> {
  const task = await prisma.taskRun.findUnique({
    where: { taskRunId },
    select: MCP_TASK_SELECT,
  });
  if (task) mcpTaskNotificationBus.publish(apiTokenId, task);
}

export function reconstructPersistedRemoteTask(
  row: PersistedRemoteTask,
): ActionSuccess<ReconstructedRemoteTask> | ReconstructionFailure {
  const metadata = record(row.a2aMetadata);
  const idempotencyKey = string(metadata?.["idempotencyKey"]);
  const requestDigest = string(metadata?.["requestDigest"]);
  const riskClass = string(metadata?.["riskClass"]);
  const tokenId = string(metadata?.["apiTokenId"]);
  const tokenSource = string(metadata?.["tokenSource"]);
  const tokenCapability = string(metadata?.["tokenCapability"]);
  const agentId = string(metadata?.["requestedAgentId"]) ?? string(row.currentAgentId);
  const routeContext = string(row.routeContext);
  const prompt = storedTextPart(row.messages[0]?.parts);
  const authorityScope = stringArray(row.authorityScope);

  if (
    !row.id
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
  const requestedThreadId = string(metadata?.["requestedThreadId"]);
  const collaboration = string(metadata?.["collaborationKind"]);
  const collaborationKind = collaboration === "handoff" || collaboration === "summon"
    ? collaboration
    : undefined;
  const parsed: RemoteTaskSubmitParams = {
    agentId,
    routeContext,
    title: row.title,
    objective: row.objective,
    prompt,
    idempotencyKey,
    riskClass,
    threadId: requestedThreadId,
    authorityScope,
    ...(collaborationKind ? { collaborationKind } : {}),
    ...(initiativeReviewBinding ? { initiativeReviewBinding } : {}),
  };

  if (remoteTaskRequestDigest(parsed) !== requestDigest) {
    return {
      ok: false,
      code: "request_digest_mismatch",
      message: "Persisted remote task request does not match its immutable digest.",
    };
  }

  return ok({
      run: { id: row.id, taskRunId: row.taskRunId, contextId: row.contextId },
      threadId: row.threadId,
      token: {
        tokenId,
        userId: row.userId,
        capability: tokenCapability,
        source: tokenSource,
      },
      userContext: {
        userId: row.userId,
        platformRole: row.user.groups[0]?.platformRole?.roleId ?? null,
        isSuperuser: row.user.isSuperuser,
      },
      parsed,
  });
}

async function settleReconstructionFailure(
  row: Pick<PersistedRemoteTask, "taskRunId" | "threadId" | "contextId">,
  failure: ReconstructionFailure | { code: "authorization_revoked"; message: string },
): Promise<void> {
  await prisma.taskRun.update({
    where: { taskRunId: row.taskRunId },
    data: {
      status: "failed",
      completedAt: new Date(),
      progressPayload: {
        error: failure.message,
        errorCode: failure.code,
      } as Prisma.InputJsonValue,
    },
  });
  if (row.threadId) {
    agentEventBus.emit(row.threadId, {
      type: "task:status",
      taskId: row.taskRunId,
      contextId: row.contextId,
      state: "failed",
      sourceEvent: "mcp/task-run.execute",
      message: failure.message,
    });
  }
}

export async function executePersistedRemoteTask(input: {
  taskRunId: string;
}): Promise<Record<string, unknown>> {
  const row = await prisma.taskRun.findUnique({
    where: { taskRunId: input.taskRunId },
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
          groups: { include: { platformRole: true }, take: 1 },
        },
      },
    },
  }) as PersistedRemoteTask | null;
  if (!row) return { status: "missing", taskRunId: input.taskRunId };

  const reconstructed = reconstructPersistedRemoteTask(row);
  if (!reconstructed.ok) {
    await settleReconstructionFailure(row, reconstructed);
    const apiTokenId = string(record(row.a2aMetadata)?.["apiTokenId"]);
    if (apiTokenId) await publishMcpTaskStatus(row.taskRunId, apiTokenId);
    return { status: "failed", taskRunId: row.taskRunId, error: reconstructed.code };
  }

  if (reconstructed.data.token.source !== "session-jwt") {
    const activeToken = await prisma.mcpApiToken.findFirst({
      where: {
        id: reconstructed.data.token.tokenId,
        userId: reconstructed.data.token.userId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { id: true, capability: true },
    });
    const capabilityStillSufficient = activeToken
      && (reconstructed.data.token.capability === "read" || activeToken.capability === "write");
    if (!capabilityStillSufficient) {
      const failure = {
        code: "authorization_revoked" as const,
        message: "The submitting MCP credential is no longer active with sufficient authority.",
      };
      await settleReconstructionFailure(row, failure);
      await publishMcpTaskStatus(row.taskRunId, reconstructed.data.token.tokenId);
      return { status: "failed", taskRunId: row.taskRunId, error: failure.code };
    }
  }

  const progress = record(row.progressPayload) ?? {};
  const dispatch = record(progress["dispatch"]) ?? {};
  const claimedAt = new Date();
  const claimed = await reserveSubmittedTaskRunWorking({
    taskRunId: row.taskRunId,
    updatedAt: row.updatedAt,
    progressPayload: {
      ...progress,
      dispatch: {
        ...dispatch,
        state: "claimed",
        claimedAt: claimedAt.toISOString(),
      },
    } as Prisma.InputJsonValue,
  });
  if (!claimed) {
    return { status: "duplicate", taskRunId: row.taskRunId };
  }

  agentEventBus.emit(reconstructed.data.threadId, {
    type: "task:status",
    taskId: row.taskRunId,
    contextId: row.contextId,
    state: "working",
    sourceEvent: "mcp/task-run.execute",
  });
  await publishMcpTaskStatus(row.taskRunId, reconstructed.data.token.tokenId);

  const outcome = await executeRemoteTaskAttempt({
    ...reconstructed.data,
    idempotentReplay: false,
    capacityAttempt: 1,
    terminalWriterAttempt: 1,
  });
  const outcomeStatus = outcome.kind === "result" ? outcome.result["status"] : null;
  agentEventBus.emit(reconstructed.data.threadId, {
    type: "task:status",
    taskId: row.taskRunId,
    contextId: row.contextId,
    state: taskState(outcomeStatus),
    sourceEvent: "mcp/task-run.execute",
  });
  await publishMcpTaskStatus(row.taskRunId, reconstructed.data.token.tokenId);
  return {
    status: typeof outcomeStatus === "string" ? outcomeStatus : "working",
    taskRunId: row.taskRunId,
  };
}
