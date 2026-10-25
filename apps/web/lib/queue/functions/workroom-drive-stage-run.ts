// What each room's scheduled task shows about the run the drive queued (BI-7C0B2BD6).
//
// The writeback latch (writeback-latch.ts decideWritebackLatch) holds only
// while a dispatched run is outstanding, so the drive reads the room's task:
// which stage it was queued for and when (the dispatch checkpoint), and how
// its latest run ended. Bounded reads also retain primary/parallel approval waits.

import type { PrismaClient } from "@dpf/db";
import { readWorkroomStageTaskConfig } from "@/lib/scheduling/workroom-stage-task-config";
import { isRecord } from "@/lib/shared/coerce";
import { driveDispatchCapacity, type DriveDispatchCapacity } from "@/lib/work-management/drive-dispatch-cap";
import { workroomDriveTaskId, workroomDriveBranchTaskId } from "@/lib/work-management/drive-plan-stage";
import { readDispatchCheckpoint } from "@/lib/work-management/workroom-drive-checkpoint";
import { projectApprovalOutcome, type ApprovalOutcomeState } from "@/lib/coworker/approval-outcome";

import { resolveWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import type { StageRunObservation } from "@/lib/work-management/writeback-latch";

type StageRunDb = Pick<PrismaClient, "scheduledAgentTask"> & Partial<Pick<PrismaClient, "coworkerActionEnvelope">>;
export type StageRunTaskRow = {
  taskId: string;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  taskConfig: unknown;
  taskRunId?: string | null;
  ownerUserId?: string;
  approvalOutcome?: ApprovalOutcomeState;
};

/**
 * The observation for one room's task, or null when the task does not exist.
 * The checkpoint is the room's when it names this task, else the one the task
 * carries; without either the queue time is unknown and the latch releases.
 */
export function stageRunFromTask(input: {
  taskId: string;
  task: StageRunTaskRow | null;
  roomWorkspaceState: unknown;
}): StageRunObservation | null {
  const { task } = input;
  if (!task) return null;
  const roomCheckpoint = readDispatchCheckpoint(isRecord(input.roomWorkspaceState) ? input.roomWorkspaceState.workroomDispatchCheckpoint : null);
  const taskCheckpoint = readDispatchCheckpoint(isRecord(task.taskConfig) ? task.taskConfig.workroomDispatchCheckpoint : null);
  const checkpoint = [roomCheckpoint, taskCheckpoint].find((entry) => entry?.confirmedEffect.taskId === input.taskId) ?? null;
  return {
    stageKey: checkpoint?.stage.stageKey ?? readWorkroomStageTaskConfig(task.taskConfig)?.stageKey ?? null,
    dispatchedAt: checkpoint?.confirmedEffect.recordedAt ?? null,
    lastRunAt: task.lastRunAt?.toISOString() ?? null,
    lastStatus: task.lastStatus,
    lastError: task.lastError,
    ...(task.lastStatus === "proposed" ? { approvalOutcome: task.approvalOutcome ?? "unknown" } : {}),
  };
}

/**
 * The rooms with `stageRun` set from each room's primary task (null when the
 * task does not exist). On a failed read the rooms are returned unchanged, so
 * the latch keeps its cycle rule rather than releasing blind. Only the
 * sequential drive reads `stageRun`; graph tokens read `stageRunsByTask`.
 */
export async function withStageRuns<R extends { capsuleId: string; scopeClaims: unknown; workspaceState: unknown }>(
  rooms: R[],
  db?: StageRunDb,
): Promise<Array<R & { stageRun?: StageRunObservation | null; stageRunsByTask?: Readonly<Record<string, StageRunObservation | null>> }>> {
  const taskIdOf = (room: R) => {
    const key = resolveWorkShapeClaim(room.scopeClaims)?.key;
    return key ? workroomDriveTaskId(room.capsuleId, key) : null;
  };
  const taskIdsOf = (room: R) => {
    const shape = resolveWorkShapeClaim(room.scopeClaims);
    return shape ? [workroomDriveTaskId(room.capsuleId, shape.key), ...shape.stages.map((stage) => workroomDriveBranchTaskId(room.capsuleId, shape.key, stage.key))] : [];
  };
  const tasks = await loadStageRunTasks(rooms.flatMap(taskIdsOf), db);
  if (!tasks) return rooms;
  return rooms.map((room) => {
    const taskId = taskIdOf(room);
    const stageRunsByTask = Object.fromEntries(taskIdsOf(room).map((id) => [id, stageRunFromTask({ taskId: id, task: tasks.get(id) ?? null, roomWorkspaceState: room.workspaceState })]));
    return taskId ? { ...room, stageRun: stageRunsByTask[taskId], stageRunsByTask } : room;
  });
}

/**
 * This tick's dispatch capacity, read as the agent-task dispatcher reads it
 * (DI-7109D22D4812, BI-6DBA2238). getAllCliPoolStatuses returns [] on a failed
 * read; the cap is still bounded by the CLI slot gate.
 */
export async function loadDispatchCapacity(now: Date): Promise<DriveDispatchCapacity> {
  const { getAllCliPoolStatuses } = await import("@/lib/routing/cli-pool-status");
  const { cliConcurrencyStats } = await import("@/lib/routing/cli-concurrency");
  return driveDispatchCapacity({ pools: await getAllCliPoolStatuses(), cli: cliConcurrencyStats(), now });
}

/** Each task by id, including branch tasks. A failed task read retains the legacy latch rule. */
export async function loadStageRunTasks(
  taskIds: readonly string[],
  db?: StageRunDb,
): Promise<Map<string, StageRunTaskRow> | null> {
  const ids = [...new Set(taskIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  try {
    const source = db ?? (await import("@dpf/db")).prisma;
    const rows = await source.scheduledAgentTask.findMany({
      where: { taskId: { in: ids } },
      select: { taskId: true, lastRunAt: true, lastStatus: true, lastError: true, taskConfig: true, taskRunId: true, ownerUserId: true },
    });
    const runIds = rows.filter((r) => r.lastStatus === "proposed" && r.taskRunId).map((r) => r.taskRunId!);
    const outcomes = new Map<string, Array<{ owner: string; state: ApprovalOutcomeState }>>();
    if (runIds.length && source.coworkerActionEnvelope) {
      try {
        const approvals = await source.coworkerActionEnvelope.findMany({
          where: { taskRunId: { in: runIds } }, take: 1001,
          select: { id: true, taskRunId: true, delegatingUserId: true, status: true, createdAt: true, expiresAt: true,
            toolExecutions: { where: { executionMode: "approval-outcome" }, orderBy: { createdAt: "desc" }, take: 1,
              select: { executionMode: true, success: true, result: true } } },
        });
        // An incomplete observation cannot establish that every request ran.
        if (approvals.length <= 1000) for (const approval of approvals) {
          if (!approval.taskRunId) continue;
          const values = outcomes.get(approval.taskRunId) ?? [];
          values.push({ owner: approval.delegatingUserId, state: projectApprovalOutcome(approval, new Date()).state });
          outcomes.set(approval.taskRunId, values);
        }
      } catch { /* Unknown approval state retains the wait. */ }
    }
    return new Map(rows.map((row) => {
      const states = (outcomes.get(row.taskRunId ?? "") ?? []).filter((o) => o.owner === row.ownerUserId).map((o) => o.state);
      const approvalOutcome = states.length ? states.find((s) => s !== "executed") ?? "executed" : "unknown";
      return [row.taskId, { ...row, ...(row.lastStatus === "proposed" ? { approvalOutcome } : {}) } as StageRunTaskRow];
    }));
  } catch (error) {
    console.warn("[workroom-drive] stage task read failed; the writeback latch keeps its cycle rule:", error);
    return null;
  }
}
