import type { Prisma, PrismaClient } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { readWorkroomStageTaskConfig, withWorkroomStageTaskConfig } from "@/lib/scheduling/workroom-stage-task-config";
import { buildDispatchCheckpoint, readDispatchCheckpoint } from "@/lib/work-management/workroom-drive-checkpoint";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";
import { WORKROOM_DRIVE_CRON } from "@/lib/work-management/workroom-drive-constants";
import type { WorkroomDriveEffects } from "./workroom-drive";
import {
  parseQualificationExperimentState,
  qualificationBindingDigest,
  verifyQualificationExperimentAdmission,
  validateQualificationExperimentAdmission,
} from "@/lib/backlog/initiative-readiness/qualification-research-admission";

// One lease-fenced transaction for sequential and graph-stage enqueue capture.
// Design: docs/architecture/workroom-cycle-continuity.md.
export async function scheduleWorkroomAgentTask(
  prisma: Pick<PrismaClient, "$transaction">,
  input: Parameters<WorkroomDriveEffects["upsertAgentTask"]>[0],
  clock: () => Date,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // Lock the room through the scheduling write. An expired or superseded
    // driver cannot reactivate a task after another owner takes over.
    const owned = await tx.workroom.updateMany({
      where: {
        id: input.lease.roomId, archivedAt: null, status: { notIn: [...TERMINAL_WORKROOM_STATUSES] },
        leaseExpiresAt: input.lease.expiresAt,
        leaseHolderPrincipalId: input.lease.holderPrincipalId,
        AND: [{ leaseExpiresAt: { gt: clock() } }],
      },
      data: { leaseExpiresAt: input.lease.expiresAt },
    });
    if (owned.count !== 1) return false;
    const room = await tx.workroom.findUnique({ where: { id: input.lease.roomId }, select: {
      workspaceState: true, objective: true, capsuleId: true, backlogItemId: true, repositoryFullName: true,
      baseSha: true, headSha: true, leaseHolderPrincipalId: true,
    } });
    if (!room) return false;
    const workspace = isRecord(room.workspaceState) ? room.workspaceState : {};
    const qualificationState = parseQualificationExperimentState(workspace.qualificationExperimentAdmission);
    let qualificationBinding = null;
    if (qualificationState) {
      const external = verifyQualificationExperimentAdmission(qualificationState.token, { now: clock(), allowExpired: true });
      // Host-specific qualification is deliberately executed by the accountable
      // Workroom runtime, not by Build Studio's unrelated Linux sandbox.
      if (external.ok) {
        if (external.data.binding.executorMode === "workroom-host") return false;
        throw new Error("Sandbox qualification execution is unavailable until exact executor provenance is bound.");
      }
      if (qualificationState.status !== "issued" || qualificationState.startCount !== 0) {
        throw new Error("Qualification experiment was already started or settled.");
      }
      const verified = verifyQualificationExperimentAdmission(qualificationState.token, { now: clock() });
      if (!verified.ok || qualificationBindingDigest(verified.data.binding) !== qualificationState.bindingDigest) {
        throw new Error("Qualification experiment admission is invalid or expired.");
      }
      const admitted = validateQualificationExperimentAdmission(verified.data.binding, {
        itemId: room.backlogItemId ?? "", workroomId: room.capsuleId,
        repositoryFullName: room.repositoryFullName ?? "", baseSha: room.baseSha ?? "", headSha: room.headSha ?? "",
        protocol: verified.data.binding.protocol,
        installationId: verified.data.binding.installationId,
        accountablePrincipalRef: room.leaseHolderPrincipalId ?? "",
        protocolReviewReceiptId: verified.data.binding.protocolReviewReceiptId,
        startCount: qualificationState.startCount, now: clock(),
      });
      if (!admitted.ok || verified.data.binding.shapeKey !== input.stage.shapeKey
        || verified.data.binding.shapeVersion !== input.stage.shapeVersion
        || verified.data.binding.stageKey !== input.stage.stageKey) {
        throw new Error("Qualification experiment no longer matches the live room or scheduled stage.");
      }
      qualificationBinding = verified.data.binding;
    }
    const checkpoint = buildDispatchCheckpoint(workspace.workroomDispatchCheckpoint, {
      taskId: input.taskId, roomId: input.lease.roomId, objective: room.objective ?? null,
      stage: input.stage, now: input.now.toISOString(),
      dispatchScope: input.dispatchScope,
      holderPrincipalId: input.lease.holderPrincipalId, leaseExpiresAt: input.lease.expiresAt.toISOString(),
    });
    // Merge, never replace: taskConfig is shared JSON; only workroomStage is this writer's.
    const current = await tx.scheduledAgentTask.findUnique({ where: { taskId: input.taskId }, select: { taskConfig: true, agentId: true, ownerUserId: true } });
    const taskState = isRecord(current?.taskConfig) ? current.taskConfig : {};
    const storedReceipt = taskState.workroomDispatchCheckpoint;
    const taskReceipt = readDispatchCheckpoint(storedReceipt);
    if (storedReceipt != null && (!taskReceipt || taskReceipt.roomId !== input.lease.roomId
      || taskReceipt.confirmedEffect.taskId !== input.taskId)) throw new Error("Unreadable or foreign task dispatch checkpoint");
    const latest = readDispatchCheckpoint(workspace.workroomDispatchCheckpoint);
    const prior = taskReceipt ?? (latest?.confirmedEffect.taskId === input.taskId ? latest : null);
    if (prior) {
      const recordedStage = readWorkroomStageTaskConfig(current?.taskConfig);
      const sameStage = (stage: typeof recordedStage, expected: typeof input.stage) => stage !== null
        && stage.shapeKey === expected.shapeKey && stage.shapeVersion === expected.shapeVersion
        && stage.stageKey === expected.stageKey
        && JSON.stringify([...new Set(stage.tools)].sort()) === JSON.stringify([...new Set(expected.tools)].sort());
      // Validate the stored receipt against its task before deciding whether this
      // is a replay or a legitimate new stage/run. A task id alone is not an intent.
      if (!current || current.ownerUserId !== input.ownerUserId || !sameStage(recordedStage, prior.stage)) {
        throw new Error("Recorded dispatch requires task identity reconciliation before replay");
      }
      const sameScope = prior.dispatchScope && input.dispatchScope
        ? prior.dispatchScope.runKey === input.dispatchScope.runKey
          && prior.dispatchScope.cycleKey === input.dispatchScope.cycleKey
          && prior.dispatchScope.iteration === input.dispatchScope.iteration
        : !prior.dispatchScope && !input.dispatchScope;
      const sameStageIdentity = prior.stage.shapeKey === input.stage.shapeKey
        && prior.stage.shapeVersion === input.stage.shapeVersion && prior.stage.stageKey === input.stage.stageKey;
      if (sameStageIdentity && sameScope) {
        if (current.agentId !== input.agentId || !sameStage(prior.stage, input.stage)) {
          throw new Error("Recorded dispatch requires task identity reconciliation before replay");
        }
        return true;
      }
      // Legacy same-stage receipts cannot establish a new cycle boundary.
      if (sameStageIdentity && Boolean(prior.dispatchScope) !== Boolean(input.dispatchScope)) {
        throw new Error("Legacy dispatch requires cycle identity reconciliation before replay");
      }
    }
    const scheduledStage = qualificationBinding ? { ...input.stage, qualificationExperiment: qualificationBinding } : input.stage;
    const taskConfig = { ...withWorkroomStageTaskConfig(current?.taskConfig ?? null, scheduledStage),
      workroomDispatchCheckpoint: checkpoint } as unknown as Prisma.InputJsonValue;
    await tx.scheduledAgentTask.upsert({
      where: { taskId: input.taskId },
      create: {
        taskId: input.taskId,
        agentId: input.agentId,
        title: input.title,
        prompt: input.prompt,
        routeContext: "/ops/workrooms",
        schedule: WORKROOM_DRIVE_CRON,
        timezone: "UTC",
        ownerUserId: input.ownerUserId,
        nextRunAt: input.now,
        isActive: true,
        taskConfig,
      },
      update: {
        agentId: input.agentId,
        title: input.title,
        prompt: input.prompt,
        taskConfig,
        nextRunAt: input.now,
        isActive: true,
      },
    });
    // Both sequential and graph branches enter here. The task, checkpoint
    // and append-only enqueue receipt commit together under the room lock.
    await tx.workroom.update({ where: { id: input.lease.roomId }, data: {
      workspaceState: { ...workspace, workroomDispatchCheckpoint: checkpoint,
        ...(qualificationState && qualificationBinding ? { qualificationExperimentAdmission: {
          ...qualificationState, status: "started", startCount: 1, startedAt: clock().toISOString(), taskId: input.taskId,
        } } : {}) } as Prisma.InputJsonValue,
    } });
    await tx.workroomActivity.create({ data: {
      workCapsuleId: input.lease.roomId, kind: "workroom-dispatch-confirmed",
      summary: `Queued ${input.taskId}; execution outcome remains unconfirmed.`,
      payload: checkpoint as unknown as Prisma.InputJsonValue,
    } });
    return true;
  });
}
