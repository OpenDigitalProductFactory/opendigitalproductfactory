import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";
import { readPrismaAuthorizedAsyncOperation } from "@/lib/inference/async-operation-runtime";
import {
  canonicalAsyncOperationBindingDigest,
  parseAsyncInferenceOperationStatus,
  type AsyncInferenceOperationStatus,
} from "@/lib/inference/async-operation-contract";
import { agentEventBus } from "@/lib/tak/agent-event-bus";

import {
  DURABLE_INFERENCE_TASK_CONTRACT_FAMILY,
  DURABLE_INFERENCE_TASK_RECIPE_ID,
  parseDurableInferenceTaskMetadata,
} from "./mcp-task-durable-inference-contract";
import { mcpTaskNotificationBus } from "./mcp-task-notification-bus";

const TERMINAL_TASK_STATES = new Set(["completed", "failed", "canceled", "rejected", "archived"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(code);
  return value.trim();
}

function taskStatus(status: AsyncInferenceOperationStatus): "working" | "completed" | "failed" | "canceled" {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "canceled";
  if (status === "failed" || status === "expired") return "failed";
  return "working";
}

function isTerminal(status: ReturnType<typeof taskStatus>): boolean {
  return status !== "working";
}

function projectedTaskStatus(
  operationStatus: ReturnType<typeof taskStatus>,
  currentTaskStatus: string,
): ReturnType<typeof taskStatus> | "quiescing" {
  return currentTaskStatus === "quiescing" && operationStatus === "working"
    ? "quiescing"
    : operationStatus;
}

function durableProgressPatch(input: {
  progress: Record<string, unknown>;
  priorDurable: Record<string, unknown>;
  operation: Awaited<ReturnType<typeof readPrismaAuthorizedAsyncOperation>>["operation"];
  now: Date;
}): Prisma.InputJsonValue {
  return {
    ...input.progress,
    durableInference: {
      ...input.priorDurable,
      schemaVersion: 1,
      recipeId: DURABLE_INFERENCE_TASK_RECIPE_ID,
      state: input.operation.status,
      asyncOperationId: input.operation.operationId,
      requestDigest: input.operation.requestDigest,
      providerId: input.operation.providerId,
      modelId: input.operation.modelId,
      providerOperationId: input.operation.providerOperationId,
      contractFamily: input.operation.contractFamily,
      checkpointSequence: input.operation.checkpointSequence,
      transitionSequence: input.operation.transitionSequence,
      progressPct: input.operation.progressPct,
      progressMessage: input.operation.progressMessage,
      errorMessage: input.operation.errorMessage,
      expiresAt: input.operation.expiresAt.toISOString(),
      observedAt: input.now.toISOString(),
    },
  } as Prisma.InputJsonValue;
}

/**
 * Settle the public TaskRun projection from the canonical async operation.
 * The event's bare operation id is only an internal lookup key; all state is
 * re-read through the TaskRun-scoped authorization boundary before mutation.
 */
export async function settleDurableInferenceTaskTransition(input: {
  operationId: string;
  sequence: number;
  status: unknown;
  now?: Date;
}): Promise<{ status: string; taskRunId?: string; settled: boolean }> {
  const operationId = requiredString(input.operationId, "DURABLE_INFERENCE_OPERATION_ID_REQUIRED");
  if (!Number.isInteger(input.sequence) || input.sequence < 0) {
    throw new Error("DURABLE_INFERENCE_TRANSITION_SEQUENCE_INVALID");
  }
  const eventStatus = parseAsyncInferenceOperationStatus(input.status);
  const related = await prisma.asyncInferenceOp.findUnique({
    where: { id: operationId },
    select: {
      id: true,
      identityVersion: true,
      bindingDigest: true,
      taskRun: {
        select: {
          id: true,
          taskRunId: true,
          userId: true,
          currentAgentId: true,
          threadId: true,
          contextId: true,
          status: true,
          updatedAt: true,
          a2aMetadata: true,
          progressPayload: true,
        },
      },
    },
  });
  if (!related?.taskRun) return { status: "ignored", settled: false };

  const row = related.taskRun;
  const metadata = record(row.a2aMetadata);
  const durableMetadata = parseDurableInferenceTaskMetadata(metadata?.["durableInference"]);
  if (!durableMetadata) return { status: "ignored", taskRunId: row.taskRunId, settled: false };
  const requestKey = requiredString(
    metadata?.["idempotencyKey"],
    "DURABLE_INFERENCE_REQUEST_KEY_MISSING",
  );
  const requestDigest = requiredString(
    metadata?.["requestDigest"],
    "DURABLE_INFERENCE_REQUEST_DIGEST_MISSING",
  );
  if (!/^[a-f0-9]{64}$/u.test(requestDigest)) {
    throw new Error("DURABLE_INFERENCE_REQUEST_DIGEST_INVALID");
  }
  if (
    related.identityVersion !== 1
    || related.bindingDigest !== canonicalAsyncOperationBindingDigest({
      kind: "task-run",
      taskRunId: row.id,
      requestKey,
      requestDigest,
    })
  ) throw new Error("DURABLE_INFERENCE_BINDING_DIGEST_MISMATCH");
  const progress = record(row.progressPayload) ?? {};
  const priorDurable = record(progress["durableInference"]) ?? {};
  const projectedOperationId = typeof priorDurable["asyncOperationId"] === "string"
    ? priorDurable["asyncOperationId"].trim()
    : "";
  if (projectedOperationId && projectedOperationId !== operationId) {
    throw new Error("DURABLE_INFERENCE_OPERATION_ID_MISMATCH");
  }
  if (TERMINAL_TASK_STATES.has(row.status)) {
    const priorStatus = typeof priorDurable["state"] === "string"
      ? taskStatus(parseAsyncInferenceOperationStatus(priorDurable["state"]))
      : null;
    if (priorStatus !== row.status) {
      throw new Error("DURABLE_INFERENCE_TERMINAL_PROJECTION_MISMATCH");
    }
    return { status: row.status, taskRunId: row.taskRunId, settled: false };
  }
  if (!["submitted", "working", "quiescing"].includes(row.status)) {
    throw new Error("DURABLE_INFERENCE_TASKRUN_STATE_CONFLICT");
  }

  const authorized = await readPrismaAuthorizedAsyncOperation({
    target: { kind: "task-run", taskRunId: row.taskRunId },
    actor: {
      userId: row.userId,
      agentId: null,
      principalId: null,
      isSuperuser: false,
    },
    requestKey,
    afterSequence: input.sequence - 1,
    limit: 1,
  });
  const operation = authorized.operation;
  const eventTransition = authorized.transitions[0];
  if (
    operation.operationId !== operationId
    || operation.requestKey !== requestKey
    || operation.providerId !== "gemini"
    || operation.contractFamily !== DURABLE_INFERENCE_TASK_CONTRACT_FAMILY
    || eventTransition?.sequence !== input.sequence
    || eventTransition.status !== eventStatus
  ) {
    throw new Error("DURABLE_INFERENCE_OPERATION_PROVENANCE_MISMATCH");
  }

  const operationTaskStatus = taskStatus(operation.status);
  const now = input.now ?? new Date();
  let status = projectedTaskStatus(operationTaskStatus, row.status);
  const completedAt = isTerminal(operationTaskStatus) ? (operation.completedAt ?? now) : null;
  const updated = await prisma.taskRun.updateMany({
    where: {
      taskRunId: row.taskRunId,
      status: row.status,
      updatedAt: row.updatedAt,
    },
    data: {
      status,
      completedAt,
      lastHeartbeatAt: now,
      progressPayload: durableProgressPatch({ progress, priorDurable, operation, now }),
    },
  });
  if (updated.count !== 1) {
    const latest = await prisma.taskRun.findUnique({
      where: { taskRunId: row.taskRunId },
      select: {
        taskRunId: true,
        userId: true,
        status: true,
        updatedAt: true,
        a2aMetadata: true,
        progressPayload: true,
      },
    });
    if (!latest || latest.userId !== row.userId) {
      throw new Error("DURABLE_INFERENCE_TASKRUN_CAS_IDENTITY_CONFLICT");
    }
    const latestMetadata = record(latest.a2aMetadata);
    const latestDurableMetadata = parseDurableInferenceTaskMetadata(
      latestMetadata?.["durableInference"],
    );
    if (
      !latestDurableMetadata
      || latestMetadata?.["idempotencyKey"] !== requestKey
      || latestMetadata?.["requestDigest"] !== requestDigest
    ) throw new Error("DURABLE_INFERENCE_TASKRUN_CAS_IDENTITY_CONFLICT");
    const latestProgress = record(latest.progressPayload) ?? {};
    const latestDurable = record(latestProgress["durableInference"]) ?? {};
    const latestOperationId = typeof latestDurable["asyncOperationId"] === "string"
      ? latestDurable["asyncOperationId"].trim()
      : "";
    if (latestOperationId && latestOperationId !== operationId) {
      throw new Error("DURABLE_INFERENCE_OPERATION_ID_MISMATCH");
    }
    if (TERMINAL_TASK_STATES.has(latest.status)) {
      const latestStatus = typeof latestDurable["state"] === "string"
        ? taskStatus(parseAsyncInferenceOperationStatus(latestDurable["state"]))
        : null;
      if (latestStatus !== latest.status) {
        throw new Error("DURABLE_INFERENCE_TERMINAL_PROJECTION_MISMATCH");
      }
      return { status: latest.status, taskRunId: row.taskRunId, settled: false };
    }
    if (!["submitted", "working", "quiescing"].includes(latest.status)) {
      throw new Error("DURABLE_INFERENCE_TASKRUN_STATE_CONFLICT");
    }
    status = projectedTaskStatus(operationTaskStatus, latest.status);
    const retried = await prisma.taskRun.updateMany({
      where: {
        taskRunId: row.taskRunId,
        status: latest.status,
        updatedAt: latest.updatedAt,
      },
      data: {
        status,
        completedAt,
        lastHeartbeatAt: now,
        progressPayload: durableProgressPatch({
          progress: latestProgress,
          priorDurable: latestDurable,
          operation,
          now,
        }),
      },
    });
    if (retried.count !== 1) {
      throw new Error("DURABLE_INFERENCE_TASKRUN_CAS_RETRY_REQUIRED");
    }
  }

  if (row.threadId) {
    agentEventBus.emit(row.threadId, {
      type: "task:status",
      taskId: row.taskRunId,
      contextId: row.contextId,
      state: status,
      sourceEvent: "inference/async-operation.transitioned",
    });
  }
  const apiTokenId = typeof metadata?.["apiTokenId"] === "string"
    ? metadata["apiTokenId"].trim()
    : "";
  if (apiTokenId) {
    const task = await prisma.taskRun.findUnique({
      where: { taskRunId: row.taskRunId },
      select: {
        taskRunId: true,
        userId: true,
        title: true,
        objective: true,
        status: true,
        progressPayload: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
      },
    });
    if (task) mcpTaskNotificationBus.publish(apiTokenId, task);
  }
  return { status, taskRunId: row.taskRunId, settled: true };
}
