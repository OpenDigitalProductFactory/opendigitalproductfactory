import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";
import { MCP_TASK_SELECT } from "@/lib/mcp/tasks-lifecycle";
import {
  enqueuePrismaAsyncOperationWake,
  requestPrismaAuthorizedAsyncOperationCancellation,
} from "@/lib/inference/async-operation-runtime";
import { canonicalAsyncOperationBindingDigest } from "@/lib/inference/async-operation-contract";
import {
  REMOTE_TASK_EXECUTION_EVENT,
  sendMcpTaskRunExecutionEvent,
} from "@/lib/queue/mcp-task-run-events";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
  DURABLE_INFERENCE_TASK_RECIPE_ID,
  exactDurableInferenceExecutionRecipeId,
  parseDurableInferenceProgress,
  parseDurableInferenceTaskMetadata,
} from "./mcp-task-durable-inference-contract";
import { ensureDurableInferenceTaskRecipes } from "./mcp-task-durable-inference-runtime";
import { mcpTaskNotificationBus } from "./mcp-task-notification-bus";
import { parseResourceWaitProjection } from "./mcp-task-capacity-contract";

export { REMOTE_TASK_EXECUTION_EVENT };

export type RemoteTaskDispatchProjection = {
  schemaVersion: 1;
  kind: "external-mcp-task";
  state: "pending" | "enqueued" | "failed";
  eventId: string;
  attempt: number;
  requestedAt: string;
  enqueuedAt?: string;
  failedAt?: string;
  lastError?: string;
};

export function externalMcpTaskAsyncEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const configured = env["DPF_EXTERNAL_MCP_TASK_ASYNC"]?.trim().toLowerCase();
  return configured !== "0" && configured !== "false" && configured !== "off";
}

export function remoteTaskDispatchEventId(taskRunId: string, attempt = 1): string {
  return `mcp-task-run:${taskRunId}:execute:${attempt}`;
}

export function initialRemoteTaskDispatchProjection(
  taskRunId: string,
  now: Date,
): RemoteTaskDispatchProjection {
  return {
    schemaVersion: 1,
    kind: "external-mcp-task",
    state: "pending",
    eventId: remoteTaskDispatchEventId(taskRunId),
    attempt: 1,
    requestedAt: now.toISOString(),
  };
}

function boundedError(error: unknown): string {
  return getErrorMessage(error).slice(0, 500);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function priorDispatch(value: unknown): Partial<RemoteTaskDispatchProjection> {
  return record(record(value)?.["dispatch"]) ?? {};
}

function exactDurableOperationBinding(input: {
  taskRunRowId: string;
  metadata: Record<string, unknown> | null;
}): {
  authorityScopeKey: string;
  requestKey: string;
  bindingDigest: string;
} | null {
  const requestKey = typeof input.metadata?.["idempotencyKey"] === "string"
    ? input.metadata["idempotencyKey"].trim()
    : "";
  const requestDigest = typeof input.metadata?.["requestDigest"] === "string"
    ? input.metadata["requestDigest"].trim()
    : "";
  if (!requestKey || !/^[a-f0-9]{64}$/u.test(requestDigest)) return null;
  return {
    authorityScopeKey: `task-run:${input.taskRunRowId}`,
    requestKey,
    bindingDigest: canonicalAsyncOperationBindingDigest({
      kind: "task-run",
      taskRunId: input.taskRunRowId,
      requestKey,
      requestDigest,
    }),
  };
}

async function sendDispatchEvent(taskRunId: string, eventId: string): Promise<void> {
  await sendMcpTaskRunExecutionEvent(taskRunId, eventId);
}

/**
 * Persist the queue handoff before sending the event. The TaskRun is the
 * durable outbox: a failed send leaves an explicit submitted/failed dispatch
 * projection for the reconciliation worker to re-emit with the same event ID.
 */
export async function enqueuePersistedRemoteTask(input: {
  taskRunId: string;
  now?: Date;
  projectionAlreadyPersisted?: boolean;
}): Promise<{
  eventId: string;
  queued: boolean;
  error?: string;
}> {
  const now = input.now ?? new Date();
  const pending = initialRemoteTaskDispatchProjection(input.taskRunId, now);
  const eventId = pending.eventId;
  if (!input.projectionAlreadyPersisted) {
    const current = await prisma.taskRun.findUnique({
      where: { taskRunId: input.taskRunId },
      select: { status: true, updatedAt: true, progressPayload: true },
    });
    if (!current || (current.status !== "working" && current.status !== "submitted")) {
      return { eventId, queued: false, error: "TaskRun dispatch reservation is no longer available." };
    }
    const reserved = await prisma.taskRun.updateMany({
      where: {
        taskRunId: input.taskRunId,
        status: current.status,
        updatedAt: current.updatedAt,
      },
      data: {
        status: "submitted",
        completedAt: null,
        progressPayload: {
          ...(record(current.progressPayload) ?? {}),
          dispatch: pending,
        } as Prisma.InputJsonValue,
      },
    });
    if (reserved.count !== 1) {
      return { eventId, queued: false, error: "TaskRun dispatch reservation raced." };
    }
  }
  const snapshot = await prisma.taskRun.findUnique({
    where: { taskRunId: input.taskRunId },
    select: { status: true, updatedAt: true, progressPayload: true },
  });
  const snapshotProgress = record(snapshot?.progressPayload) ?? {};
  const snapshotDispatch = priorDispatch(snapshot?.progressPayload);
  if (
    !snapshot
    || snapshot.status !== "submitted"
    || snapshotDispatch.state !== "pending"
    || snapshotDispatch.eventId !== eventId
    || snapshotDispatch.attempt !== 1
  ) {
    return { eventId, queued: false, error: "TaskRun dispatch reservation changed before send." };
  }

  try {
    await sendDispatchEvent(input.taskRunId, eventId);
    const enqueued: RemoteTaskDispatchProjection = {
      ...pending,
      state: "enqueued",
      enqueuedAt: new Date().toISOString(),
    };
    await prisma.taskRun.updateMany({
      where: {
        taskRunId: input.taskRunId,
        status: "submitted",
        updatedAt: snapshot.updatedAt,
        progressPayload: { path: ["dispatch", "eventId"], equals: eventId },
      },
      data: {
        progressPayload: { ...snapshotProgress, dispatch: enqueued } as Prisma.InputJsonValue,
      },
    });
    return { eventId, queued: true };
  } catch (error) {
    const message = boundedError(error);
    const failed: RemoteTaskDispatchProjection = {
      ...pending,
      state: "failed",
      failedAt: new Date().toISOString(),
      lastError: message,
    };
    await prisma.taskRun.updateMany({
      where: {
        taskRunId: input.taskRunId,
        status: "submitted",
        updatedAt: snapshot.updatedAt,
        progressPayload: { path: ["dispatch", "eventId"], equals: eventId },
      },
      data: {
        progressPayload: { ...snapshotProgress, dispatch: failed } as Prisma.InputJsonValue,
      },
    });
    return { eventId, queued: false, error: message };
  }
}

export async function enqueuePersistedRemoteTaskSubmission(
  taskRunId: string,
  options?: { projectionAlreadyPersisted?: boolean },
): Promise<Record<string, unknown>> {
  const dispatch = await enqueuePersistedRemoteTask({
    taskRunId,
    projectionAlreadyPersisted: options?.projectionAlreadyPersisted,
  });
  const text = dispatch.queued
    ? "Remote task accepted for background execution. Subscribe for task updates or reconcile with tasks/get."
    : "Remote task persisted; background dispatch is pending reconciliation.";
  return {
    taskRunId,
    status: "submitted",
    idempotentReplay: false,
    requiresApproval: false,
    asynchronous: true,
    dispatchEventId: dispatch.eventId,
    dispatchQueued: dispatch.queued,
    pollInterval: 2_000,
    content: [{ type: "text", text }],
    ...(dispatch.error
      ? { structuredContent: { dispatchState: "pending-reconciliation", error: dispatch.error } }
      : {}),
    isError: false,
  };
}

const DISPATCH_STALE_MS = 60_000;
const MAX_DISPATCH_ATTEMPTS = 5;

/**
 * Reconcile the TaskRun outbox after a lost queue send or a queue run that
 * never claimed the row. Each retry receives a new deterministic attempt ID;
 * the TaskRun CAS still permits only one execution winner.
 */
export async function reconcilePersistedRemoteTaskDispatches(input?: {
  now?: Date;
  limit?: number;
  includeOrdinary?: boolean;
}): Promise<{ scanned: number; enqueued: number; exhausted: number; raced: number }> {
  const now = input?.now ?? new Date();
  const cutoff = new Date(now.getTime() - DISPATCH_STALE_MS);
  const durableSubmitted: Prisma.TaskRunWhereInput = {
    status: "submitted",
    a2aMetadata: {
      path: ["durableInference", "recipeId"],
      equals: DURABLE_INFERENCE_TASK_RECIPE_ID,
    },
  };
  const durableAdmitting: Prisma.TaskRunWhereInput = {
    status: { in: ["working", "quiescing"] },
    a2aMetadata: {
      path: ["durableInference", "recipeId"],
      equals: DURABLE_INFERENCE_TASK_RECIPE_ID,
    },
    progressPayload: {
      path: ["durableInference", "state"],
      equals: "admitting",
    },
  };
  const ordinarySubmitted: Prisma.TaskRunWhereInput = {
    status: "submitted",
    a2aMetadata: { path: ["trigger"], equals: "external-mcp" },
  };
  const resourceWaitSubmitted: Prisma.TaskRunWhereInput = {
    status: "submitted",
    a2aMetadata: { path: ["trigger"], equals: "external-mcp" },
    progressPayload: { path: ["resourceWait", "kind"], equals: "provider-capacity" },
  };
  const rows = await prisma.taskRun.findMany({
    where: {
      updatedAt: { lt: cutoff },
      OR: [
        durableSubmitted,
        durableAdmitting,
        resourceWaitSubmitted,
        ...(input?.includeOrdinary === false ? [] : [ordinarySubmitted]),
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: Math.min(Math.max(input?.limit ?? 25, 1), 100),
    select: {
      id: true,
      taskRunId: true,
      userId: true,
      status: true,
      updatedAt: true,
      progressPayload: true,
      a2aMetadata: true,
    },
  });

  let enqueued = 0;
  let exhausted = 0;
  let raced = 0;
  for (const row of rows) {
    const progress = record(row.progressPayload) ?? {};
    const metadata = record(row.a2aMetadata);
    const durableMetadata = parseDurableInferenceTaskMetadata(metadata?.["durableInference"]);
    const durableProgress = parseDurableInferenceProgress(progress["durableInference"]);
    const isDurableCandidate = Boolean(
      durableMetadata
      && (row.status === "submitted"
        || (["working", "quiescing"].includes(row.status)
          && durableProgress?.state === "admitting")),
    );
    const isOrdinaryCandidate = input?.includeOrdinary !== false
      && row.status === "submitted"
      && metadata?.["trigger"] === "external-mcp";
    const isResourceWaitCandidate = row.status === "submitted"
      && metadata?.["trigger"] === "external-mcp"
      && parseResourceWaitProjection(progress) !== null;
    if (!isDurableCandidate && !isOrdinaryCandidate && !isResourceWaitCandidate) {
      raced += 1;
      continue;
    }
    const previous = priorDispatch(row.progressPayload);
    const previousAttempt = Number.isInteger(previous.attempt) ? Number(previous.attempt) : 0;
    const attempt = previousAttempt + 1;
    if (attempt > MAX_DISPATCH_ATTEMPTS) {
      if (isDurableCandidate && row.status !== "submitted") {
        const expectedBinding = exactDurableOperationBinding({
          taskRunRowId: row.id,
          metadata,
        });
        const operationExists = expectedBinding
          ? await prisma.asyncInferenceOp.findFirst({
              where: {
                taskRunId: row.id,
                identityVersion: 1,
                authorityScopeKey: expectedBinding.authorityScopeKey,
                requestKey: expectedBinding.requestKey,
                bindingDigest: expectedBinding.bindingDigest,
                contractFamily: DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
              },
              select: { id: true, requestContext: true },
            })
          : null;
        if (durableProgress?.cancellationRequestedAt) {
          if (operationExists) {
            const requestKey = typeof metadata?.["idempotencyKey"] === "string"
              ? metadata["idempotencyKey"].trim()
              : "";
            if (!requestKey) {
              raced += 1;
              continue;
            }
            try {
              const canceled = await requestPrismaAuthorizedAsyncOperationCancellation({
                target: { kind: "task-run", taskRunId: row.taskRunId },
                actor: { userId: row.userId, agentId: null, principalId: null, isSuperuser: false },
                requestKey,
              });
              if (canceled.operationId !== operationExists.id) {
                throw new Error("DURABLE_INFERENCE_OPERATION_ID_MISMATCH");
              }
              await enqueuePrismaAsyncOperationWake(operationExists.id);
            } catch {
              raced += 1;
            }
            continue;
          }
          const canceledAt = now.toISOString();
          const settled = await prisma.taskRun.updateMany({
            where: { taskRunId: row.taskRunId, status: row.status, updatedAt: row.updatedAt },
            data: {
              status: "canceled",
              completedAt: now,
              progressPayload: {
                ...progress,
                durableInference: {
                  ...durableProgress,
                  state: "cancelled-before-admission",
                  canceledAt,
                },
              } as Prisma.InputJsonValue,
            },
          });
          if (settled.count === 1) exhausted += 1;
          else raced += 1;
          continue;
        }
        if (operationExists && durableProgress) {
          let routingRecipeId: string | null = null;
          try {
            const seeded = await ensureDurableInferenceTaskRecipes();
            routingRecipeId = exactDurableInferenceExecutionRecipeId({
              executionPlan: record(operationExists.requestContext)?.["executionPlan"],
              recipes: seeded.recipes,
            });
          } catch {
            // Current recipe truth is unavailable or invalid. Never resurrect a
            // provider operation from partial historical plan evidence.
          }
          if (!routingRecipeId) {
            raced += 1;
            continue;
          }
          const admittedAt = now.toISOString();
          const recovered = await prisma.taskRun.updateMany({
            where: {
              taskRunId: row.taskRunId,
              status: row.status,
              updatedAt: row.updatedAt,
            },
            data: {
              completedAt: null,
              lastHeartbeatAt: now,
              progressPayload: {
                ...progress,
                durableInference: {
                  ...durableProgress,
                  state: "admitted",
                  asyncOperationId: operationExists.id,
                  routingRecipeId,
                  admittedAt,
                  recoveredAt: admittedAt,
                },
              } as Prisma.InputJsonValue,
            },
          });
          if (recovered.count !== 1) {
            raced += 1;
            continue;
          }
          try {
            await enqueuePrismaAsyncOperationWake(operationExists.id);
            enqueued += 1;
          } catch {
            // The durable operation and admitted TaskRun projection now form a
            // complete outbox. Async-operation reconciliation will retry the
            // advisory wake without another provider admission or POST.
            raced += 1;
          }
          continue;
        }
      }
      const settled = await prisma.taskRun.updateMany({
        where: { taskRunId: row.taskRunId, status: row.status, updatedAt: row.updatedAt },
        data: {
          status: "failed",
          completedAt: now,
          progressPayload: {
            ...progress,
            dispatch: {
              ...previous,
              state: "failed",
              failedAt: now.toISOString(),
              lastError: `Background dispatch exhausted ${MAX_DISPATCH_ATTEMPTS} attempts.`,
            },
          } as Prisma.InputJsonValue,
        },
      });
      if (settled.count === 1) {
        exhausted += 1;
        const apiTokenId = typeof record(row.a2aMetadata)?.["apiTokenId"] === "string"
          ? record(row.a2aMetadata)?.["apiTokenId"] as string
          : null;
        if (apiTokenId) {
          const task = await prisma.taskRun.findUnique({
            where: { taskRunId: row.taskRunId },
            select: MCP_TASK_SELECT,
          });
          if (task) mcpTaskNotificationBus.publish(apiTokenId, task);
        }
      } else raced += 1;
      continue;
    }

    const eventId = remoteTaskDispatchEventId(row.taskRunId, attempt);
    const pending: RemoteTaskDispatchProjection = {
      schemaVersion: 1,
      kind: "external-mcp-task",
      state: "pending",
      eventId,
      attempt,
      requestedAt: now.toISOString(),
    };
    const reserved = await prisma.taskRun.updateMany({
      where: { taskRunId: row.taskRunId, status: row.status, updatedAt: row.updatedAt },
      data: {
        progressPayload: { ...progress, dispatch: pending } as Prisma.InputJsonValue,
      },
    });
    if (reserved.count !== 1) {
      raced += 1;
      continue;
    }
    const reservedSnapshot = await prisma.taskRun.findUnique({
      where: { taskRunId: row.taskRunId },
      select: { status: true, updatedAt: true, progressPayload: true },
    });
    const reservedProgress = record(reservedSnapshot?.progressPayload) ?? {};
    const reservedDispatch = priorDispatch(reservedSnapshot?.progressPayload);
    if (
      !reservedSnapshot
      || reservedSnapshot.status !== row.status
      || reservedDispatch.state !== "pending"
      || reservedDispatch.eventId !== eventId
      || reservedDispatch.attempt !== attempt
    ) {
      raced += 1;
      continue;
    }
    const completionWhere: Prisma.TaskRunWhereInput = {
      taskRunId: row.taskRunId,
      status: row.status,
      updatedAt: reservedSnapshot.updatedAt,
      AND: [
        { progressPayload: { path: ["dispatch", "eventId"], equals: eventId } },
        { progressPayload: { path: ["dispatch", "state"], equals: "pending" } },
      ],
    };

    try {
      await sendDispatchEvent(row.taskRunId, eventId);
      await prisma.taskRun.updateMany({
        where: completionWhere,
        data: {
          progressPayload: {
            ...reservedProgress,
            dispatch: { ...pending, state: "enqueued", enqueuedAt: new Date().toISOString() },
          } as Prisma.InputJsonValue,
        },
      });
      enqueued += 1;
    } catch (error) {
      await prisma.taskRun.updateMany({
        where: completionWhere,
        data: {
          progressPayload: {
            ...reservedProgress,
            dispatch: {
              ...pending,
              state: "failed",
              failedAt: new Date().toISOString(),
              lastError: boundedError(error),
            },
          } as Prisma.InputJsonValue,
        },
      });
    }
  }

  return { scanned: rows.length, enqueued, exhausted, raced };
}
