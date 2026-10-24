import { revalidateReviewExecutionAuthority } from "./mcp-task-review-recovery";
import { reconstructPersistedRemoteTask, loadPersistedRemoteTask, persistedTaskString as string,
  type PersistedRemoteTask, type ReconstructionFailure } from "./mcp-task-persisted-request";
export { reconstructPersistedRemoteTask, loadPersistedRemoteTask } from "./mcp-task-persisted-request";
import { prisma } from "@dpf/db";
import { isCurrentOAuthExecutionAuthority, OAUTH_EXECUTION_AUTHORITY_SELECT } from "@/lib/auth/oauth-tokens";
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
import { mcpTaskNotificationBus } from "./mcp-task-notification-bus";
import {
  parseResourceWaitProjection,
  remoteTaskRequestDigest,
} from "./mcp-task-capacity-contract";
import {
  parseDurableInferenceProgress,
  parseDurableInferenceTaskMetadata,
} from "./mcp-task-durable-inference-contract";
import { admitDurableInferenceTask } from "./mcp-task-durable-inference-runtime";
import { executeRemoteTaskAttempt } from "./mcp-task-execution";
import { automaticReviewerRecoveryWait, healParkedReviewFromReceipt } from "./mcp-task-background-dispatch";


function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
  const row = await loadPersistedRemoteTask(input.taskRunId);
  if (!row) return { status: "missing", taskRunId: input.taskRunId };

  // Stale queue events are advisory. Canonical terminal state wins without
  // reconstructing credentials that may lawfully have expired since submit.
  if (isTerminalTaskStatus(row.status)) {
    return { status: row.status, taskRunId: row.taskRunId, idempotentReplay: true };
  }

  // Like terminal replay and the background reconciler, observe a genuine
  // receipt before reconstructing authority for new execution. The healer
  // retains artifact/writer checks and cancellation/version fencing.
  if (await healParkedReviewFromReceipt(row)) {
    return { taskRunId: row.taskRunId, status: "completed", idempotentReplay: true };
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
        ...(reconstructed.data.token.source === "oauth" ? {} : { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }),
      },
      select: { id: true, capability: true, ...OAUTH_EXECUTION_AUTHORITY_SELECT },
    });
    const capabilityStillSufficient = activeToken
      && (reconstructed.data.token.source !== "oauth" || await isCurrentOAuthExecutionAuthority(activeToken))
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
  if (progress.reviewExecutionAuthority !== undefined && !await revalidateReviewExecutionAuthority({
    ...reconstructed.data, metadata: row.a2aMetadata, progress,
  })) return { taskRunId: row.taskRunId, status: row.status, recoveryError: "current-review-authority-refused" };
  if (await automaticReviewerRecoveryWait(row)) {
    // The existing replay path owns request matching, generation CAS, bounded
    // attempts, immutable reader evidence and the terminal writer's authority.
    const { submitRemoteCoworkerTask } = await import("./mcp-task-submit");
    const resumed = await submitRemoteCoworkerTask({
      token: reconstructed.data.token,
      userContext: reconstructed.data.userContext,
      params: { ...reconstructed.data.parsed,
        ...(progress.reviewExecutionAuthority !== undefined ? { reviewRecovery: {
          taskRunId: row.taskRunId, requestDigest: record(row.a2aMetadata)!["requestDigest"], expectedUpdatedAt: row.updatedAt.toISOString(),
        } } : {}),
      },
    });
    return resumed.kind === "result"
      ? resumed.result
      : { taskRunId: row.taskRunId, status: row.status, recoveryError: resumed.message };
  }
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

  // A task parked for capacity resumes as its next attempt on the same TaskRun,
  // so the wait's bound counts real attempts instead of restarting at 1 (BI-D25F867D).
  const capacityWait = parseResourceWaitProjection(row.progressPayload);
  const outcome = await executeRemoteTaskAttempt({
    ...reconstructed.data,
    expectedReservation: string(progress["resumeReservedAt"]),
    expectedDispatchClaim: claimedAt.toISOString(),
    idempotentReplay: capacityWait !== null,
    capacityAttempt: capacityWait ? capacityWait.attempt + 1 : 1,
    ...(capacityWait ? { resumeKind: "capacity" as const } : {}),
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
