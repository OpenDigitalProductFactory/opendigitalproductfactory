import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";
import {
  enqueuePrismaAsyncOperationWake,
  requestPrismaAuthorizedAsyncOperationCancellation,
} from "@/lib/inference/async-operation-runtime";
import { agentEventBus } from "@/lib/tak/agent-event-bus";
import type { TaskState } from "@/lib/tak/task-states";
import { isTerminalTaskStatus, MCP_TASK_SELECT } from "@/lib/mcp/tasks-lifecycle";
import {
  reserveSubmittedTaskRunWorking,
  reserveTaskRunGenerationWorking,
} from "@/lib/observability/heartbeat";
import { ok, type ActionSuccess } from "@/lib/shared/action-result";
import { mcpTaskNotificationBus } from "./mcp-task-notification-bus";
import {
  remoteTaskRequestDigest,
  remoteTaskRequestMatches,
} from "./mcp-task-capacity-contract";
import {
  parseDurableInferenceProgress,
  parseDurableInferenceTaskMetadata,
} from "./mcp-task-durable-inference-contract";
import { admitDurableInferenceTask } from "./mcp-task-durable-inference-runtime";
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

const DURABLE_TASK_WORKING_STATUS = "working" as const;
const DURABLE_RECOVERABLE_ADMISSION_STATES = new Set(["working", "quiescing"]);

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
  const hasRequestObjective = metadata !== null
    && Object.prototype.hasOwnProperty.call(metadata, "requestObjective");
  let requestObjective = row.objective;
  if (hasRequestObjective) {
    const storedRequestObjective = string(metadata?.["requestObjective"]);
    if (!storedRequestObjective) {
      return {
        ok: false,
        code: "persisted_request_invalid",
        message: "Persisted remote task request objective is invalid.",
      };
    }
    requestObjective = storedRequestObjective;
  }

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
  const requestedThreadId = string(metadata?.["requestedThreadId"]);
  const collaboration = string(metadata?.["collaborationKind"]);
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
    ...(durableInference ? { recipeId: durableInference.recipeId } : {}),
  };

  if (!remoteTaskRequestMatches(metadata, parsed)) {
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
  row: Pick<
    PersistedRemoteTask,
    | "taskRunId"
    | "threadId"
    | "contextId"
    | "status"
    | "updatedAt"
    | "progressPayload"
    | "a2aMetadata"
  >,
  failure: ReconstructionFailure | { code: "authorization_revoked"; message: string },
): Promise<boolean> {
  const durableMetadata = parseDurableInferenceTaskMetadata(
    record(row.a2aMetadata)?.["durableInference"],
  );
  const durableProgress = parseDurableInferenceProgress(
    record(row.progressPayload)?.["durableInference"],
  );
  const isExecutablePreAdmission = row.status === "submitted"
    || Boolean(
      durableMetadata
      && DURABLE_RECOVERABLE_ADMISSION_STATES.has(row.status)
      && durableProgress?.state === "admitting",
    );
  if (!isExecutablePreAdmission) return false;

  const settled = await prisma.taskRun.updateMany({
    where: {
      taskRunId: row.taskRunId,
      status: row.status,
      updatedAt: row.updatedAt,
    },
    data: {
      status: "failed",
      completedAt: new Date(),
      progressPayload: {
        ...(record(row.progressPayload) ?? {}),
        error: failure.message,
        errorCode: failure.code,
      } as Prisma.InputJsonValue,
    },
  });
  if (settled.count !== 1) return false;
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
  return true;
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

  // Stale queue events are advisory. Canonical terminal state wins without
  // reconstructing credentials that may lawfully have expired since submit.
  if (isTerminalTaskStatus(row.status)) {
    return { status: row.status, taskRunId: row.taskRunId, idempotentReplay: true };
  }

  const earlyProgress = record(row.progressPayload) ?? {};
  const earlyDurableMetadata = parseDurableInferenceTaskMetadata(
    record(row.a2aMetadata)?.["durableInference"],
  );
  const earlyDurableProgress = parseDurableInferenceProgress(
    earlyProgress["durableInference"],
  );
  if (
    earlyDurableMetadata
    && DURABLE_RECOVERABLE_ADMISSION_STATES.has(row.status)
    && earlyDurableProgress?.state === "admitted"
    && earlyDurableProgress.asyncOperationId
  ) {
    // The wake path independently verifies the exact TaskRun/operation
    // binding. Do not let later credential expiry strand admitted work.
    await enqueuePrismaAsyncOperationWake(earlyDurableProgress.asyncOperationId);
    return {
      status: row.status,
      taskRunId: row.taskRunId,
      asyncOperationId: earlyDurableProgress.asyncOperationId,
      idempotentReplay: true,
    };
  }

  const reconstructed = reconstructPersistedRemoteTask(row);
  if (!reconstructed.ok) {
    const settled = await settleReconstructionFailure(row, reconstructed);
    if (!settled) return { status: "duplicate", taskRunId: row.taskRunId };
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
      const settled = await settleReconstructionFailure(row, failure);
      if (!settled) return { status: "duplicate", taskRunId: row.taskRunId };
      await publishMcpTaskStatus(row.taskRunId, reconstructed.data.token.tokenId);
      return { status: "failed", taskRunId: row.taskRunId, error: failure.code };
    }
  }

  const progress = record(row.progressPayload) ?? {};
  const dispatch = record(progress["dispatch"]) ?? {};
  const claimedAt = new Date();
  const durableRecipeId = reconstructed.data.parsed.recipeId;
  const existingDurableProgress = parseDurableInferenceProgress(progress["durableInference"]);
  if (
    durableRecipeId
    && DURABLE_RECOVERABLE_ADMISSION_STATES.has(row.status)
    && existingDurableProgress?.state === "admitting"
    && existingDurableProgress.cancellationRequestedAt
  ) {
    const canceledAt = new Date();
    const canceled = await prisma.taskRun.updateMany({
      where: {
        taskRunId: row.taskRunId,
        status: row.status,
        updatedAt: row.updatedAt,
      },
      data: {
        status: "canceled",
        completedAt: canceledAt,
        lastHeartbeatAt: canceledAt,
        progressPayload: {
          ...progress,
          durableInference: {
            ...existingDurableProgress,
            state: "cancelled-before-admission",
            canceledAt: canceledAt.toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    });
    if (canceled.count === 1) {
      await publishMcpTaskStatus(row.taskRunId, reconstructed.data.token.tokenId);
      return { status: "canceled", taskRunId: row.taskRunId };
    }
    return { status: "duplicate", taskRunId: row.taskRunId };
  }
  if (
    durableRecipeId
    && DURABLE_RECOVERABLE_ADMISSION_STATES.has(row.status)
    && existingDurableProgress?.state === "admitted"
    && existingDurableProgress.asyncOperationId
  ) {
    await enqueuePrismaAsyncOperationWake(existingDurableProgress.asyncOperationId);
    return {
      status: row.status,
      taskRunId: row.taskRunId,
      asyncOperationId: existingDurableProgress.asyncOperationId,
      idempotentReplay: true,
    };
  }
  const durableAttempt = durableRecipeId
    ? (existingDurableProgress?.attempt ?? 0) + 1
    : null;
  const claimedProgressObject = {
    ...progress,
    dispatch: {
      ...dispatch,
      state: "claimed",
      claimedAt: claimedAt.toISOString(),
    },
    ...(durableRecipeId ? {
      durableInference: {
        schemaVersion: 1,
        recipeId: durableRecipeId,
        state: "admitting",
        attempt: durableAttempt,
      },
    } : {}),
  };
  const claimedProgress = claimedProgressObject as Prisma.InputJsonValue;
  const claimed = row.status === "submitted"
    ? await reserveSubmittedTaskRunWorking({
        taskRunId: row.taskRunId,
        updatedAt: row.updatedAt,
        progressPayload: claimedProgress,
      })
    : durableRecipeId
        && DURABLE_RECOVERABLE_ADMISSION_STATES.has(row.status)
        && existingDurableProgress?.state === "admitting"
      ? await reserveTaskRunGenerationWorking({
          taskRunId: row.taskRunId,
          expectedStatus: row.status,
          updatedAt: row.updatedAt,
          progressPayload: claimedProgress,
        })
      : false;
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

  if (durableRecipeId) {
    const admitted = await admitDurableInferenceTask({
      taskRunId: row.taskRunId,
      requestKey: reconstructed.data.parsed.idempotencyKey,
      requestDigest: remoteTaskRequestDigest(reconstructed.data.parsed),
      prompt: reconstructed.data.parsed.prompt,
      userId: reconstructed.data.token.userId,
      agentId: reconstructed.data.parsed.agentId,
      threadId: reconstructed.data.threadId,
      routeContext: reconstructed.data.parsed.routeContext,
      recipeId: durableRecipeId,
    });
    let cancellationRequested = false;
    let persisted = false;
    for (let attempt = 0; attempt < 2 && !persisted; attempt += 1) {
      const current = await prisma.taskRun.findFirst({
        where: { taskRunId: row.taskRunId },
        select: { status: true, updatedAt: true, progressPayload: true },
      });
      if (!current) throw new Error("DURABLE_INFERENCE_TASKRUN_MISSING_AFTER_ADMISSION");
      const currentProgress = record(current.progressPayload) ?? {};
      const currentDurable = parseDurableInferenceProgress(currentProgress["durableInference"]);
      if (
        currentDurable?.state === "admitted"
        && currentDurable.asyncOperationId === admitted.asyncOperationId
      ) {
        await enqueuePrismaAsyncOperationWake(admitted.asyncOperationId);
        return {
          status: current.status,
          taskRunId: row.taskRunId,
          asyncOperationId: admitted.asyncOperationId,
          idempotentReplay: true,
        };
      }
      if (
        !DURABLE_RECOVERABLE_ADMISSION_STATES.has(current.status)
        || currentDurable?.state !== "admitting"
      ) {
        throw new Error("DURABLE_INFERENCE_TASKRUN_STATE_CONFLICT_AFTER_ADMISSION");
      }
      cancellationRequested = Boolean(currentDurable.cancellationRequestedAt);
      const admittedAt = new Date();
      const update = await prisma.taskRun.updateMany({
        where: {
          taskRunId: row.taskRunId,
          status: current.status,
          updatedAt: current.updatedAt,
        },
        data: {
          completedAt: null,
          lastHeartbeatAt: admittedAt,
          progressPayload: {
            ...currentProgress,
            durableInference: {
              ...currentDurable,
              schemaVersion: 1,
              recipeId: durableRecipeId,
              state: "admitted",
              attempt: durableAttempt,
              asyncOperationId: admitted.asyncOperationId,
              routingRecipeId: admitted.recipeId,
              admittedAt: admittedAt.toISOString(),
            },
          } as Prisma.InputJsonValue,
        },
      });
      persisted = update.count === 1;
    }
    if (!persisted) {
      throw new Error("DURABLE_INFERENCE_TASKRUN_ADMISSION_CAS_RETRY_REQUIRED");
    }
    if (cancellationRequested) {
      const canceled = await requestPrismaAuthorizedAsyncOperationCancellation({
        target: { kind: "task-run", taskRunId: row.taskRunId },
        actor: {
          userId: reconstructed.data.token.userId,
          agentId: null,
          principalId: null,
          isSuperuser: false,
        },
        requestKey: reconstructed.data.parsed.idempotencyKey,
      });
      if (canceled.operationId !== admitted.asyncOperationId) {
        throw new Error("DURABLE_INFERENCE_OPERATION_ID_MISMATCH");
      }
    }
    // Advisory delivery happens only after the TaskRun owns the operation id.
    // A failed send is safe: the operation row is durable and reconciliation,
    // or an idempotent TaskRun worker retry, emits the same identity again.
    await enqueuePrismaAsyncOperationWake(admitted.asyncOperationId);
    await publishMcpTaskStatus(row.taskRunId, reconstructed.data.token.tokenId);
    return {
      status: DURABLE_TASK_WORKING_STATUS,
      taskRunId: row.taskRunId,
      asyncOperationId: admitted.asyncOperationId,
      ...(cancellationRequested ? { cancellationRequested: true } : {}),
    };
  }

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
