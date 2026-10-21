// What each room's scheduled task shows about the run the drive queued (BI-7C0B2BD6).
//
// The writeback latch (writeback-latch.ts decideWritebackLatch) holds only
// while a dispatched run is outstanding, so the drive reads the room's task:
// which stage it was queued for and when (the dispatch checkpoint), and how
// its latest run ended. One bounded read per tick for the sequential rooms.

import type { PrismaClient } from "@dpf/db";
import { readWorkroomStageTaskConfig } from "@/lib/scheduling/workroom-stage-task-config";
import { isRecord } from "@/lib/shared/coerce";
import { driveDispatchCapacity, type DriveDispatchCapacity } from "@/lib/work-management/drive-dispatch-cap";
import { workroomDriveTaskId } from "@/lib/work-management/drive-plan-stage";
import { readDispatchCheckpoint } from "@/lib/work-management/workroom-drive-checkpoint";
import { resolveWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import type { StageRunObservation } from "@/lib/work-management/writeback-latch";

export type StageRunTaskRow = {
  taskId: string;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  taskConfig: unknown;
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
  };
}

/**
 * The rooms with `stageRun` set from each room's primary task (null when the
 * task does not exist). On a failed read the rooms are returned unchanged, so
 * the latch keeps its cycle rule rather than releasing blind. Only the
 * sequential drive reads `stageRun`; a graph room ignores it.
 */
export async function withStageRuns<R extends { capsuleId: string; scopeClaims: unknown; workspaceState: unknown }>(
  rooms: R[],
  db?: Pick<PrismaClient, "scheduledAgentTask">,
): Promise<Array<R & { stageRun?: StageRunObservation | null }>> {
  const taskIdOf = (room: R) => {
    const key = resolveWorkShapeClaim(room.scopeClaims)?.key;
    return key ? workroomDriveTaskId(room.capsuleId, key) : null;
  };
  const tasks = await loadStageRunTasks(rooms.map(taskIdOf).filter((id): id is string => id !== null), db);
  if (!tasks) return rooms;
  return rooms.map((room) => {
    const taskId = taskIdOf(room);
    return taskId ? { ...room, stageRun: stageRunFromTask({ taskId, task: tasks.get(taskId) ?? null, roomWorkspaceState: room.workspaceState }) } : room;
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

/** Each task by id, for the given primary task ids. A failed read returns null: the latch keeps its cycle rule. */
export async function loadStageRunTasks(
  taskIds: readonly string[],
  db?: Pick<PrismaClient, "scheduledAgentTask">,
): Promise<Map<string, StageRunTaskRow> | null> {
  const ids = [...new Set(taskIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  try {
    const source = db ?? (await import("@dpf/db")).prisma;
    const rows = await source.scheduledAgentTask.findMany({
      where: { taskId: { in: ids } },
      select: { taskId: true, lastRunAt: true, lastStatus: true, lastError: true, taskConfig: true },
    });
    return new Map(rows.map((row) => [row.taskId, row as StageRunTaskRow]));
  } catch (error) {
    console.warn("[workroom-drive] stage task read failed; the writeback latch keeps its cycle rule:", error);
    return null;
  }
}
