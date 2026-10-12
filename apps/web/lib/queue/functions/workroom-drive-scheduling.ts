import type { Prisma, PrismaClient } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { readWorkroomStageTaskConfig, withWorkroomStageTaskConfig } from "@/lib/scheduling/workroom-stage-task-config";
import { buildDispatchCheckpoint, readDispatchCheckpoint } from "@/lib/work-management/workroom-drive-checkpoint";
import { TERMINAL_WORKROOM_STATUSES } from "@/lib/work-management/standing-room-nesting";
import { WORKROOM_DRIVE_CRON } from "@/lib/work-management/workroom-drive-constants";
import type { WorkroomDriveEffects } from "./workroom-drive";

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
    const room = await tx.workroom.findUnique({ where: { id: input.lease.roomId }, select: { workspaceState: true, objective: true } });
    if (!room) return false;
    const workspace = isRecord(room.workspaceState) ? room.workspaceState : {};
    const checkpoint = buildDispatchCheckpoint(workspace.workroomDispatchCheckpoint, {
      taskId: input.taskId, roomId: input.lease.roomId, objective: room.objective ?? null,
      stage: input.stage, now: input.now.toISOString(),
      holderPrincipalId: input.lease.holderPrincipalId, leaseExpiresAt: input.lease.expiresAt.toISOString(),
    });
    // Merge, never replace: taskConfig is shared JSON; only workroomStage is this writer's.
    const current = await tx.scheduledAgentTask.findUnique({ where: { taskId: input.taskId }, select: { taskConfig: true, agentId: true, ownerUserId: true } });
    const prior = readDispatchCheckpoint(workspace.workroomDispatchCheckpoint);
    if (prior?.confirmedEffect.taskId === input.taskId) {
      const recordedStage = readWorkroomStageTaskConfig(current?.taskConfig);
      const sameStage = (stage: typeof recordedStage) => stage !== null
        && stage.shapeKey === input.stage.shapeKey && stage.shapeVersion === input.stage.shapeVersion
        && stage.stageKey === input.stage.stageKey
        && JSON.stringify([...new Set(stage.tools)].sort()) === JSON.stringify([...new Set(input.stage.tools)].sort());
      if (!current || current.agentId !== input.agentId || current.ownerUserId !== input.ownerUserId
        || !sameStage(recordedStage) || !sameStage(prior.stage)) {
        throw new Error("Recorded dispatch requires task identity reconciliation before replay");
      }
      // Enqueue already committed. Preserve its receipt and the task's execution
      // state; the caller can repair the missing drive snapshot without rearming it.
      return true;
    }
    const taskConfig = withWorkroomStageTaskConfig(current?.taskConfig ?? null, input.stage) as Prisma.InputJsonValue;
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
      workspaceState: { ...workspace, workroomDispatchCheckpoint: checkpoint } as Prisma.InputJsonValue,
    } });
    await tx.workroomActivity.create({ data: {
      workCapsuleId: input.lease.roomId, kind: "workroom-dispatch-confirmed",
      summary: `Queued ${input.taskId}; execution outcome remains unconfirmed.`,
      payload: checkpoint as unknown as Prisma.InputJsonValue,
    } });
    return true;
  });
}
