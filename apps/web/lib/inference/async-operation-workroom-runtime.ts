import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";

import {
  DURABLE_INFERENCE_TASK_RECIPE_ID,
  durableInferenceTaskMetadata,
  parseDurableInferenceProgress,
  parseDurableInferenceTaskMetadata,
} from "@/lib/mcp-task-durable-inference-contract";
import { admitRuntimeGuardedWork } from "@/lib/platform-runtime/work-admission";
import {
  resolveServerOwnedAsyncOperationAuthority,
  type AsyncOperationAuthorityDatabase,
} from "./async-operation-authority";
import {
  admitWorkroomBoundDurableTaskOperation,
  type AuthorizedWorkroomDurableTask,
  type WorkroomDurableTaskAdmissionDependencies,
  type WorkroomDurableTaskAdmissionInput,
  type WorkroomDurableTaskRunInput,
} from "./async-operation-workroom-task";

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function authorityDatabase(): AsyncOperationAuthorityDatabase {
  return prisma as unknown as AsyncOperationAuthorityDatabase;
}

function isPrismaAdmissionRace(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && ((error as { code?: unknown }).code === "P2002"
      || (error as { code?: unknown }).code === "P2034"),
  );
}

async function resolvePrismaAuthorizedWorkroom(
  input: Parameters<WorkroomDurableTaskAdmissionDependencies["resolveWorkroom"]>[0],
): Promise<AuthorizedWorkroomDurableTask> {
  const authority = await resolveServerOwnedAsyncOperationAuthority({
    target: input.request,
    actor: input.actor,
    db: authorityDatabase(),
  });
  if (authority.kind !== "workroom") {
    throw new Error("DURABLE_INFERENCE_WORKROOM_AUTHORITY_MISMATCH");
  }
  const workroom = await prisma.workroom.findUnique({
    where: { id: authority.workroomId },
    select: { id: true, capsuleId: true, title: true, objective: true },
  });
  if (!workroom) throw new Error("DURABLE_INFERENCE_WORKROOM_NOT_FOUND");
  if (workroom.capsuleId !== input.request.workroomId) {
    throw new Error("DURABLE_INFERENCE_WORKROOM_IDENTITY_CONFLICT");
  }
  return workroom;
}

function assertWorkroomTaskRunIdentity(
  row: {
    taskRunId: string;
    userId: string;
    currentAgentId: string | null;
    a2aMetadata: unknown;
  },
  input: WorkroomDurableTaskRunInput,
): void {
  const metadata = jsonObject(row.a2aMetadata);
  const sourceRef = jsonObject(metadata?.["sourceRef"]);
  const workroomBinding = jsonObject(metadata?.["workroomDurableAdmission"]);
  if (
    row.taskRunId !== input.taskRunId
    || row.userId !== input.userId
    || row.currentAgentId !== input.agentId
    || metadata?.["idempotencyKey"] !== input.requestKey
    || metadata?.["requestDigest"] !== input.requestDigest
    || !parseDurableInferenceTaskMetadata(metadata?.["durableInference"])
    || sourceRef?.["kind"] !== "workroom"
    || sourceRef?.["id"] !== input.workroom.capsuleId
    || workroomBinding?.["schemaVersion"] !== 1
    || workroomBinding?.["workroomId"] !== input.workroom.capsuleId
  ) {
    throw new Error("DURABLE_INFERENCE_WORKROOM_TASKRUN_IDENTITY_CONFLICT");
  }
}

async function createOrReplayPrismaWorkroomDurableTaskRun(
  input: WorkroomDurableTaskRunInput,
): Promise<{ id: string; taskRunId: string; replayed: boolean }> {
  const attempt = () => prisma.$transaction(async (tx) => {
    const workroom = await tx.workroom.findUnique({
      where: { id: input.workroom.id },
      select: { id: true, capsuleId: true, taskRunId: true, archivedAt: true },
    });
    if (
      !workroom
      || workroom.archivedAt
      || workroom.capsuleId !== input.workroom.capsuleId
    ) throw new Error("DURABLE_INFERENCE_WORKROOM_IDENTITY_CONFLICT");

    let replayed = true;
    let taskRun = await tx.taskRun.findUnique({
      where: { taskRunId: input.taskRunId },
      select: {
        id: true,
        taskRunId: true,
        userId: true,
        currentAgentId: true,
        a2aMetadata: true,
      },
    });
    if (!taskRun) {
      await admitRuntimeGuardedWork(tx as never, "task-run:proactive");
      const durableInference = durableInferenceTaskMetadata(DURABLE_INFERENCE_TASK_RECIPE_ID);
      taskRun = await tx.taskRun.create({
        data: {
          taskRunId: input.taskRunId,
          userId: input.userId,
          threadId: input.threadId,
          contextId: input.threadId,
          initiatingAgentId: input.agentId,
          currentAgentId: input.agentId,
          routeContext: input.routeContext,
          title: `Durable task for ${input.workroom.capsuleId}`,
          objective: input.workroom.objective.slice(0, 1000),
          source: "proactive",
          status: "working",
          lastHeartbeatAt: input.now,
          authorityScope: [`workroom:${input.workroom.capsuleId}`],
          a2aMetadata: {
            trigger: "system-recovery",
            sourceRef: { kind: "workroom", id: input.workroom.capsuleId },
            idempotencyKey: input.requestKey,
            requestDigest: input.requestDigest,
            durableInference,
            workroomDurableAdmission: {
              schemaVersion: 1,
              workroomId: input.workroom.capsuleId,
            },
          } as Prisma.InputJsonValue,
          progressPayload: {
            durableInference: {
              ...durableInference,
              state: "admitting",
              attempt: 1,
            },
          } as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          taskRunId: true,
          userId: true,
          currentAgentId: true,
          a2aMetadata: true,
        },
      });
      replayed = false;
    }
    assertWorkroomTaskRunIdentity(taskRun, input);

    if (workroom.taskRunId && workroom.taskRunId !== taskRun.id) {
      throw new Error("DURABLE_INFERENCE_WORKROOM_TASKRUN_BINDING_CONFLICT");
    }
    if (!workroom.taskRunId) {
      const linked = await tx.workroom.updateMany({
        where: { id: workroom.id, taskRunId: null, archivedAt: null },
        data: { taskRunId: taskRun.id },
      });
      if (linked.count !== 1) {
        throw new Error("DURABLE_INFERENCE_WORKROOM_TASKRUN_BINDING_CONFLICT");
      }
    }
    return { id: taskRun.id, taskRunId: taskRun.taskRunId, replayed };
  }, { isolationLevel: "Serializable" });
  try {
    return await attempt();
  } catch (error) {
    // A concurrent identical admission can win either unique TaskRun creation
    // or serializable Workroom linkage. Re-read and verify the winner once;
    // identity validation below still rejects a different request.
    if (!isPrismaAdmissionRace(error)) throw error;
    return attempt();
  }
}

async function projectPrismaWorkroomDurableTaskRunAdmission(input: {
  taskRunId: string;
  requestKey: string;
  requestDigest: string;
  operationId: string;
  routingRecipeId: string;
  now: Date;
}): Promise<{ shouldEnqueue: boolean }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const taskRun = await prisma.taskRun.findUnique({
      where: { taskRunId: input.taskRunId },
      select: {
        taskRunId: true,
        status: true,
        updatedAt: true,
        a2aMetadata: true,
        progressPayload: true,
      },
    });
    if (!taskRun) throw new Error("DURABLE_INFERENCE_TASKRUN_MISSING_AFTER_ADMISSION");
    const metadata = jsonObject(taskRun.a2aMetadata);
    if (
      metadata?.["idempotencyKey"] !== input.requestKey
      || metadata?.["requestDigest"] !== input.requestDigest
      || !parseDurableInferenceTaskMetadata(metadata?.["durableInference"])
    ) throw new Error("DURABLE_INFERENCE_WORKROOM_TASKRUN_IDENTITY_CONFLICT");
    const progress = jsonObject(taskRun.progressPayload) ?? {};
    const durable = parseDurableInferenceProgress(progress["durableInference"]);
    if (durable?.state === "admitted") {
      if (
        durable.asyncOperationId !== input.operationId
        || durable.routingRecipeId !== input.routingRecipeId
      ) throw new Error("DURABLE_INFERENCE_OPERATION_ID_MISMATCH");
      return { shouldEnqueue: false };
    }
    if (
      !durable
      || durable.state !== "admitting"
      || !["working", "quiescing"].includes(taskRun.status)
    ) throw new Error("DURABLE_INFERENCE_TASKRUN_STATE_CONFLICT_AFTER_ADMISSION");

    const updated = await prisma.taskRun.updateMany({
      where: {
        taskRunId: taskRun.taskRunId,
        status: taskRun.status,
        updatedAt: taskRun.updatedAt,
      },
      data: {
        completedAt: null,
        lastHeartbeatAt: input.now,
        progressPayload: {
          ...progress,
          durableInference: {
            ...durable,
            state: "admitted",
            asyncOperationId: input.operationId,
            routingRecipeId: input.routingRecipeId,
            admittedAt: input.now.toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    });
    if (updated.count === 1) return { shouldEnqueue: true };
  }
  throw new Error("DURABLE_INFERENCE_TASKRUN_ADMISSION_CAS_RETRY_REQUIRED");
}

/** Production Prisma bridge for the closed Workroom-backed durable task contract. */
export async function admitPrismaWorkroomBoundDurableTaskOperation(
  input: WorkroomDurableTaskAdmissionInput,
  dependencies: Pick<
    WorkroomDurableTaskAdmissionDependencies,
    "admitTaskRunOperation" | "enqueue"
  >,
): Promise<{ operationId: string; taskRunId: string; replayed: boolean }> {
  return admitWorkroomBoundDurableTaskOperation(input, {
    resolveWorkroom: resolvePrismaAuthorizedWorkroom,
    createOrReplayTaskRun: createOrReplayPrismaWorkroomDurableTaskRun,
    admitTaskRunOperation: dependencies.admitTaskRunOperation,
    projectTaskRunAdmission: projectPrismaWorkroomDurableTaskRunAdmission,
    enqueue: dependencies.enqueue,
  });
}
