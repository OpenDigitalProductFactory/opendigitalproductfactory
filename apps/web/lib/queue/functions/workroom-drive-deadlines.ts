// apps/web/lib/queue/functions/workroom-drive-deadlines.ts
//
// Stage-deadline notices for a graph room's drive tick (BI-8875C9DF, GPP
// Phase 3c PR-3c-4). Design:
// docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §8 ("Idempotency"); plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-4, workroom-drive.ts). Called only by workroom-drive-graph.ts, so a
// sequential room never reaches it; it lives apart from workroom-drive.ts to
// keep that module under its size ceiling.
//
// - NOTIFY AFTER COMMIT. A notice is sent only for a `deadlines` entry that is
//   already committed in the room's stored marking with `notifiedAt: null`,
//   and still in the marking this tick persists: the planner raised it on an
//   earlier tick and that tick's snapshot was written under the persist
//   compare-and-set. `notifiedAt` is set in the snapshot only when the send
//   succeeded, so a failed send (an error, or no recipient) retries next tick
//   and a successful one never repeats. A duplicate is possible only if a send
//   succeeds and its persist then fails, the trade-off notifyStall makes with
//   `hold.notifiedAt`.
// - RAISED ACTIVITY. When the plan raised an entry this tick, a
//   `workroom-drive-deadline` activity names the stage, the deadline and how
//   far past it the stage is, through the drive's own persist as an
//   observation (activity only), after the snapshot carrying the entry.
// - Callers skip both on a tick that commits nothing (a held lease, a dispatch
//   that never scheduled), so nothing is sent for an uncommitted state.

import { unnotifiedDeadlines, withDeadlinesNotified, type PendingDeadlineNotice } from "@/lib/work-management/drive-deadlines";
import { readStoredDriveMarking, type DriveMarking } from "@/lib/work-management/drive-marking";
import type { DrivePlan } from "@/lib/work-management/drive-resolution";
import { WORKROOM_DRIVE_DEADLINE_KIND } from "@/lib/work-management/workroom-drive-constants";

import type { WorkroomDriveEffects, WorkroomDriveRoom } from "./workroom-drive";

export type DeadlineNoticeInput = { room: WorkroomDriveRoom; notice: PendingDeadlineNotice; now: Date };

function isMarking(value: unknown): value is DriveMarking {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && "deadlines" in (value as object) && "tokens" in (value as object);
}

/**
 * Send every committed, unsent notice, and return a function that writes
 * `notifiedAt` for the ones that went out into whatever snapshot the tick
 * persists. A notice the effect does not confirm (false, or a throw) is left
 * for the next tick.
 */
export async function sendCommittedDeadlineNotices(input: {
  room: WorkroomDriveRoom;
  plan: DrivePlan;
  effects: WorkroomDriveEffects;
  now: Date;
}): Promise<(snapshot: Record<string, unknown>) => Record<string, unknown>> {
  const { room, plan, effects, now } = input;
  const identity = (snapshot: Record<string, unknown>) => snapshot;
  const definition = plan.definition;
  const next = plan.marking && !("raw" in plan.marking) ? plan.marking : null;
  if (!definition || !next || !effects.notifyDeadline) return identity;
  const stored = readStoredDriveMarking(room.workspaceState, definition, null);
  if (!stored.ok || stored.data.source !== "stored") return identity;
  const sent: string[] = [];
  for (const notice of unnotifiedDeadlines(definition, stored.data.marking)) {
    if (next.deadlines[notice.key]?.notifiedAt !== null) continue;
    const delivered = await effects.notifyDeadline({ room, notice, now }).catch(() => false);
    if (delivered) sent.push(notice.key);
  }
  if (sent.length === 0) return identity;
  return (snapshot) => (isMarking(snapshot.marking) ? { ...snapshot, marking: withDeadlinesNotified(snapshot.marking, sent, now) } : snapshot);
}

/** The `workroom-drive-deadline` activity for the notices this tick raised, once its snapshot is written. */
export async function recordRaisedDeadlines(input: {
  room: WorkroomDriveRoom;
  plan: DrivePlan;
  persist: WorkroomDriveEffects["persist"];
  snapshot: Record<string, unknown>;
}): Promise<void> {
  const raised = input.plan.deadlinesDue ?? [];
  if (raised.length === 0) return;
  const hours = (ms: number) => Math.round(ms / 3_600_000);
  await input.persist({
    roomId: input.room.id,
    snapshot: input.snapshot,
    activityKind: WORKROOM_DRIVE_DEADLINE_KIND,
    summary: raised.map((due) => `Stage ${due.stageTitle} is past its deadline (${due.description}), ${hours(due.overdueMs)}h overdue; it waits on ${due.escalationRef}.`).join(" "),
    payload: {
      kind: "workroom-drive-deadline",
      deadlines: raised.map((due) => ({
        key: due.key,
        stageKey: due.stageKey,
        iteration: due.iteration,
        description: due.description,
        afterDays: due.afterDays,
        enteredAt: due.enteredAt,
        dueAt: due.dueAt,
        overdueMs: due.overdueMs,
        escalationRef: due.escalationRef,
      })),
    },
    observationOnly: true,
  });
}
