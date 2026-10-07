// What a drive-dispatched scheduled run may write without a person
// (BI-C1781121).
//
// A coworker self-task declares its cadence's writes (coworker-self-tasks.ts
// `mandatedTools`), and installing the cadence is the recorded decision the
// escalation gate steers by (`scheduled-mandate`). A Workroom drive stage is the
// same kind of decision, made per room: the work shape declares the stage's
// writes (`WorkShapeStage.mandatedTools`) and the room binds who answers for
// the stage (`workShapeRoleBindings`). When the drive dispatches that stage it
// upserts a ScheduledAgentTask whose id is `workroomDriveTaskId(capsuleId,
// shapeKey)`; the scheduler's TaskRun records that id as its sourceRef.
//
// So the mandate for a scheduled run is read back from facts the platform wrote:
// the run's SCHED id and sourceRef, the room that task id names, its shape, and
// its role binding. It covers only the declared tools, only for the agent the
// room bound to a non-governed stage, and only while the room is live. A model
// or client can assert none of it.

import { boundStagePrincipal, parseAccountablePrincipalRef, workroomDriveTaskId } from "./drive-resolution";
import { TERMINAL_WORKROOM_STATUSES } from "./standing-room-nesting";
import { listWorkShapes } from "./work-shapes";
import { readWorkShapeRoleBindings, resolveWorkShapeClaim } from "./workroom-shape-claim";

/** Public task-run ids for the scheduled trigger carry this prefix (autonomous-work-run.ts). */
export const SCHEDULED_RUN_PREFIX = "TR-SCHED-";
const DRIVE_TASK_PREFIX = "workroom-";

export type MandateRoom = {
  capsuleId: string;
  status: string;
  archivedAt: Date | null;
  scopeClaims: unknown;
};

/** The declared writes the room grants one of `agentIds` on its own drive task. Pure. */
export function roomStageMandatedTools(input: {
  scheduledTaskId: string;
  room: MandateRoom;
  agentIds: readonly string[];
}): string[] {
  const { room } = input;
  if (room.archivedAt !== null || TERMINAL_WORKROOM_STATUSES.has(room.status)) return [];
  const shape = resolveWorkShapeClaim(room.scopeClaims);
  if (!shape || input.scheduledTaskId !== workroomDriveTaskId(room.capsuleId, shape.key)) return [];
  const bindings = readWorkShapeRoleBindings(room.scopeClaims);
  const tools = new Set<string>();
  for (const stage of shape.stages) {
    if (!stage.mandatedTools?.length || stage.advance.kind === "governed-decision") continue;
    const principal = parseAccountablePrincipalRef(boundStagePrincipal(stage.accountablePrincipalRef, false, bindings));
    if (principal.kind === "agent" && input.agentIds.includes(principal.value)) {
      for (const tool of stage.mandatedTools) tools.add(tool);
    }
  }
  return [...tools].sort();
}

export type RoomMandateDb = {
  taskRun: { findUnique(args: unknown): Promise<{ a2aMetadata: unknown } | null> };
  workroom: { findMany(args: unknown): Promise<MandateRoom[]> };
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Capsule ids a drive task id could name, one per shape that declares a mandate. */
function candidateCapsuleIds(taskId: string): string[] {
  if (!taskId.startsWith(DRIVE_TASK_PREFIX)) return [];
  const ids = new Set<string>();
  for (const shape of listWorkShapes()) {
    if (!shape.stages.some((stage) => stage.mandatedTools?.length)) continue;
    const suffix = `-${shape.key}`;
    if (taskId.endsWith(suffix) && taskId.length > DRIVE_TASK_PREFIX.length + suffix.length) {
      ids.add(taskId.slice(DRIVE_TASK_PREFIX.length, -suffix.length));
    }
  }
  return [...ids];
}

/**
 * The declared writes this scheduled run may make, or an empty list. Pass the
 * run's `a2aMetadata` when the caller already read it.
 */
export async function loadScheduledRoomMandate(
  db: RoomMandateDb,
  input: { taskRunId: string | null | undefined; agentIds: readonly string[]; a2aMetadata?: unknown },
): Promise<string[]> {
  if (!input.taskRunId?.startsWith(SCHEDULED_RUN_PREFIX) || input.agentIds.length === 0) return [];
  const metadata = input.a2aMetadata !== undefined
    ? input.a2aMetadata
    : (await db.taskRun.findUnique({ where: { taskRunId: input.taskRunId }, select: { a2aMetadata: true } }))?.a2aMetadata;
  const sourceRef = record(record(metadata)?.sourceRef);
  const taskId = sourceRef?.kind === "scheduled-task" && typeof sourceRef.id === "string" ? sourceRef.id : null;
  const capsuleIds = taskId ? candidateCapsuleIds(taskId) : [];
  if (!taskId || capsuleIds.length === 0) return [];
  const rooms = await db.workroom.findMany({
    where: { capsuleId: { in: capsuleIds } },
    select: { capsuleId: true, status: true, archivedAt: true, scopeClaims: true },
  });
  const tools = new Set<string>();
  for (const room of rooms) {
    for (const tool of roomStageMandatedTools({ scheduledTaskId: taskId, room, agentIds: input.agentIds })) tools.add(tool);
  }
  return [...tools].sort();
}

/** The live loader, for callers holding only a run id and an agent. */
export async function loadScheduledRoomMandateLive(input: { taskRunId: string | null; agentId: string }): Promise<string[]> {
  if (!input.taskRunId?.startsWith(SCHEDULED_RUN_PREFIX)) return [];
  const { prisma } = await import("@dpf/db");
  return loadScheduledRoomMandate(prisma as unknown as RoomMandateDb, { taskRunId: input.taskRunId, agentIds: [input.agentId] });
}
