// Has the dispatch this stage task carries already been answered? (BI-CAP-B5F50D1F)
//
// A Workroom stage task keeps the drive's own cron (WORKROOM_DRIVE_CRON), so
// after a successful run its next tick lands on the same tick the drive uses
// to read the evidence and stop the room. The scheduler can start first. Live
// on 2026-10-28: room WC-PIR-MCP-EFF-852B5BBE was dispatched at 11:45:00, its
// reviewer recorded the receipt and stage evidence "completed" at 11:51:02, the
// task ran again at 12:00:00.24, and the drive stopped the room at 12:00:16.
// The second run's writer was refused (packet-no-longer-owed), the run was
// filed as an error, and it left a `blocked` record after the completed one.
// Six of that day's ten review errors were this race.
//
// The drive still owns the advance. This only answers the scheduler's
// question "is there anything left to do for THIS dispatch?", with the same
// rule the drive earns its receipt by (stageHasCompletingEvidence), bounded by
// the dispatch time the task's own checkpoint records. A new dispatch writes a
// new checkpoint, so it is never answered by an earlier attempt's evidence.
//
// Fails open: no checkpoint, a foreign one, a graph shape, or a failed read
// all answer "not answered", and the run proceeds exactly as before.

import type { PrismaClient } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { stageHasCompletingEvidence, type RecordedEvidence } from "./stage-evidence-receipts";
import { readDispatchCheckpoint } from "./workroom-drive-checkpoint";
import { getWorkShapeVersion } from "./work-shapes";

export type StageDispatchAnswer =
  | { answered: false }
  | { answered: true; roomId: string; stageKey: string; evidenceRecordedAt: Date };

type DispatchUnderTest = { roomId: string; stageKey: string; dispatchedAt: Date; declaredKinds: readonly string[] };

function dispatchOf(taskId: string, taskConfig: unknown): DispatchUnderTest | null {
  const checkpoint = readDispatchCheckpoint(isRecord(taskConfig) ? taskConfig.workroomDispatchCheckpoint : null);
  if (!checkpoint || checkpoint.confirmedEffect.taskId !== taskId) return null;
  const shape = getWorkShapeVersion(checkpoint.stage.shapeKey, checkpoint.stage.shapeVersion);
  // Graph shapes earn receipts per stage and iteration (earnGraphReceipts); leave them to the drive.
  if (!shape || "flow" in shape && shape.flow) return null;
  const stage = shape.stages.find((candidate) => candidate.key === checkpoint.stage.stageKey);
  if (!stage) return null;
  const dispatchedAt = new Date(checkpoint.confirmedEffect.recordedAt);
  if (!Number.isFinite(dispatchedAt.getTime())) return null;
  const evidence = (stage as { evidence?: readonly string[] }).evidence;
  return { roomId: checkpoint.roomId, stageKey: stage.key, dispatchedAt, declaredKinds: Array.isArray(evidence) ? evidence : [] };
}

/** Pure: the answer for this task's dispatch over the supplied evidence rows. */
export function stageDispatchAnswered(input: {
  taskId: string;
  taskConfig: unknown;
  evidence: readonly RecordedEvidence[];
}): StageDispatchAnswer {
  const dispatch = dispatchOf(input.taskId, input.taskConfig);
  if (!dispatch) return { answered: false };
  const rows = input.evidence.filter((row) => row.stageKey === dispatch.stageKey && row.outcome === "completed" && row.recordedAt >= dispatch.dispatchedAt);
  if (!stageHasCompletingEvidence({ stageKey: dispatch.stageKey, declaredKinds: dispatch.declaredKinds, evidence: rows, dispatchedAt: dispatch.dispatchedAt })) {
    return { answered: false };
  }
  const latest = rows.reduce((a, b) => (b.recordedAt > a.recordedAt ? b : a));
  return { answered: true, roomId: dispatch.roomId, stageKey: dispatch.stageKey, evidenceRecordedAt: latest.recordedAt };
}

type EvidenceDb = { workroomActivity: { findMany: (args: never) => Promise<Array<{ payload: unknown; recordedAt: Date }>> } };

const text = (value: unknown) => (typeof value === "string" ? value : null);

/** Reads the room's stage evidence since this task's dispatch and answers from it. */
export async function loadStageDispatchAnswered(
  task: { taskId: string; taskConfig: unknown },
  db?: EvidenceDb | Pick<PrismaClient, "workroomActivity">,
): Promise<StageDispatchAnswer> {
  const dispatch = dispatchOf(task.taskId, task.taskConfig);
  if (!dispatch) return { answered: false };
  try {
    const source = (db ?? (await import("@dpf/db")).prisma) as EvidenceDb;
    const rows = await source.workroomActivity.findMany({
      where: { workCapsuleId: dispatch.roomId, kind: "evidence-recorded", recordedAt: { gte: dispatch.dispatchedAt } },
      select: { payload: true, recordedAt: true },
      orderBy: { recordedAt: "desc" },
      take: 50,
    } as never);
    const evidence: RecordedEvidence[] = rows.map((row) => {
      const payload = isRecord(row.payload) ? row.payload : {};
      return { stageKey: text(payload.stageKey), kind: text(payload.kind), outcome: text(payload.outcome), recordedAt: row.recordedAt };
    });
    return stageDispatchAnswered({ taskId: task.taskId, taskConfig: task.taskConfig, evidence });
  } catch {
    return { answered: false };
  }
}
