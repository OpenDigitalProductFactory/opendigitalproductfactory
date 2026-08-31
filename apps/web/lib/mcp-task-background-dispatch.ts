import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";
import { MCP_TASK_SELECT } from "@/lib/mcp/tasks-lifecycle";
import {
  REMOTE_TASK_EXECUTION_EVENT,
  sendMcpTaskRunExecutionEvent,
} from "@/lib/queue/mcp-task-run-events";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { mcpTaskNotificationBus } from "./mcp-task-notification-bus";

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
}): Promise<{
  eventId: string;
  queued: boolean;
  error?: string;
}> {
  const now = input.now ?? new Date();
  const requestedAt = now.toISOString();
  const eventId = remoteTaskDispatchEventId(input.taskRunId);
  const pending: RemoteTaskDispatchProjection = {
    schemaVersion: 1,
    kind: "external-mcp-task",
    state: "pending",
    eventId,
    attempt: 1,
    requestedAt,
  };

  await prisma.taskRun.update({
    where: { taskRunId: input.taskRunId },
    data: {
      status: "submitted",
      completedAt: null,
      progressPayload: { dispatch: pending } as Prisma.InputJsonValue,
    },
  });

  try {
    await sendDispatchEvent(input.taskRunId, eventId);
    const enqueued: RemoteTaskDispatchProjection = {
      ...pending,
      state: "enqueued",
      enqueuedAt: new Date().toISOString(),
    };
    await prisma.taskRun.updateMany({
      where: { taskRunId: input.taskRunId, status: "submitted" },
      data: { progressPayload: { dispatch: enqueued } as Prisma.InputJsonValue },
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
      where: { taskRunId: input.taskRunId, status: "submitted" },
      data: { progressPayload: { dispatch: failed } as Prisma.InputJsonValue },
    });
    return { eventId, queued: false, error: message };
  }
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
}): Promise<{ scanned: number; enqueued: number; exhausted: number; raced: number }> {
  const now = input?.now ?? new Date();
  const cutoff = new Date(now.getTime() - DISPATCH_STALE_MS);
  const rows = await prisma.taskRun.findMany({
    where: {
      status: "submitted",
      updatedAt: { lt: cutoff },
      a2aMetadata: { path: ["trigger"], equals: "external-mcp" },
    },
    orderBy: { updatedAt: "asc" },
    take: Math.min(Math.max(input?.limit ?? 25, 1), 100),
    select: { taskRunId: true, updatedAt: true, progressPayload: true, a2aMetadata: true },
  });

  let enqueued = 0;
  let exhausted = 0;
  let raced = 0;
  for (const row of rows) {
    const progress = record(row.progressPayload) ?? {};
    const previous = priorDispatch(row.progressPayload);
    const previousAttempt = Number.isInteger(previous.attempt) ? Number(previous.attempt) : 0;
    const attempt = previousAttempt + 1;
    if (attempt > MAX_DISPATCH_ATTEMPTS) {
      const settled = await prisma.taskRun.updateMany({
        where: { taskRunId: row.taskRunId, status: "submitted", updatedAt: row.updatedAt },
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
      where: { taskRunId: row.taskRunId, status: "submitted", updatedAt: row.updatedAt },
      data: {
        progressPayload: { ...progress, dispatch: pending } as Prisma.InputJsonValue,
      },
    });
    if (reserved.count !== 1) {
      raced += 1;
      continue;
    }

    try {
      await sendDispatchEvent(row.taskRunId, eventId);
      await prisma.taskRun.updateMany({
        where: { taskRunId: row.taskRunId, status: "submitted" },
        data: {
          progressPayload: {
            ...progress,
            dispatch: { ...pending, state: "enqueued", enqueuedAt: new Date().toISOString() },
          } as Prisma.InputJsonValue,
        },
      });
      enqueued += 1;
    } catch (error) {
      await prisma.taskRun.updateMany({
        where: { taskRunId: row.taskRunId, status: "submitted" },
        data: {
          progressPayload: {
            ...progress,
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
