// A provider failure holds a Workroom's queue until it is resumed (BI-2B6A8A74,
// design 2026-10-07-durable-delegation-ledger-design.md §4.6, AC-DDL-RECOVER-HOLD).
//
// Before this, a room's agent stage that failed because no provider could answer
// went straight back on the retry cadence, and the drive re-dispatched it every
// tick: the room kept spending attempts against an outage it could not fix. Now
// the failure records a hold on the room. While it holds, the drive pauses the
// room (`provider_held`) and the failed stage's task is not due; an explicit
// `resume_workroom_queue` clears it and re-arms that task.
//
// A hold releases itself (BI-95638941): 36 rooms once sat frozen for ten days on
// rate-limit holds nobody resumed. Each hold carries `releaseAt`, and the sweep
// (lib/queue/functions/workroom-queue-hold-release.ts) releases due holds through
// resumeWorkroomQueue. A room re-held within a day of its last release waits
// twice as long, up to six hours.

import { prisma } from "@dpf/db";
import type { InferenceFailureKind } from "@/lib/build/inference-failure";
import { classifyInferenceFailure } from "@/lib/build/inference-failure";
import { readScheduledWorkTrigger } from "@dpf/validators/workroom-policy/scheduled-work-trigger";
import { isRecord } from "@/lib/shared/coerce";
import { readDispatchCheckpoint } from "@/lib/work-management/workroom-drive-checkpoint";

import { recordWorkCapsuleActivity } from "./work-capsule-activity-store";
import type { CapsuleDb, WorkCapsuleActor } from "./work-capsule-store-types";

export type WorkroomQueueHold = {
  since: string;
  kind: InferenceFailureKind;
  taskId: string;
  error: string;
  /** When the sweep releases it. Legacy holds: 30 minutes after `since`. */
  releaseAt: string;
  /** Consecutive holds of this room (1 = first), which sets the backoff. */
  count: number;
  /** The held task's owner; the release is recorded as the scheduler acting for them. */
  ownerUserId: string | null;
};

const BASE_RELEASE_MS = 30 * 60_000;
const MAX_RELEASE_MS = 6 * 60 * 60_000;
/** A hold within this long of the room's last release counts as the same outage. */
const REPEAT_WINDOW_MS = 24 * 60 * 60_000;

export function holdReleaseDelayMs(count: number): number {
  return Math.min(MAX_RELEASE_MS, BASE_RELEASE_MS * 2 ** Math.max(0, count - 1));
}

/** The consecutive-hold count a new hold starts at, from the room's last release. */
export function nextHoldCount(workspaceState: unknown, now: Date): number {
  const history = isRecord(workspaceState) ? workspaceState["queueHoldHistory"] : null;
  if (!isRecord(history) || typeof history["lastReleasedAt"] !== "string") return 1;
  const prior = typeof history["count"] === "number" ? history["count"] : 1;
  return now.getTime() - Date.parse(history["lastReleasedAt"]) <= REPEAT_WINDOW_MS ? prior + 1 : 1;
}

/**
 * Failures that are the provider's, not the request's. `empty-response` is a
 * model that answered with nothing; the next attempt may answer, and holding the
 * room would stop work no outage is blocking.
 */
const HOLDING_FAILURE_KINDS: ReadonlySet<InferenceFailureKind> = new Set([
  "connection",
  "rate-limit",
  "provider-unavailable",
  "config",
]);

/**
 * The holding failure an error names, if any. A scheduled run that did no work
 * because no provider answered throws "Scheduled run produced no governed work
 * (<kind>). <the loop's reply>", so the kind it already detected is read first.
 */
export function queueHoldingFailureKind(errorText: string | null | undefined): InferenceFailureKind | null {
  const named = /no governed work \(([a-z-]+)\)/.exec(errorText ?? "")?.[1] as InferenceFailureKind | undefined;
  const kind = named && HOLDING_FAILURE_KINDS.has(named) ? named : classifyInferenceFailure(errorText);
  return kind && HOLDING_FAILURE_KINDS.has(kind) ? kind : null;
}

export function readWorkroomQueueHold(workspaceState: unknown): WorkroomQueueHold | null {
  if (!workspaceState || typeof workspaceState !== "object" || Array.isArray(workspaceState)) return null;
  const hold = (workspaceState as Record<string, unknown>)["queueHold"];
  if (!hold || typeof hold !== "object" || Array.isArray(hold)) return null;
  const record = hold as Record<string, unknown>;
  if (typeof record["since"] !== "string" || typeof record["taskId"] !== "string") return null;
  const since = record["since"];
  const count = typeof record["count"] === "number" && record["count"] >= 1 ? record["count"] : 1;
  return {
    since,
    kind: (typeof record["kind"] === "string" ? record["kind"] : "provider-unavailable") as InferenceFailureKind,
    taskId: record["taskId"],
    error: typeof record["error"] === "string" ? record["error"] : "",
    releaseAt: typeof record["releaseAt"] === "string"
      ? record["releaseAt"]
      : new Date(Date.parse(since) + BASE_RELEASE_MS).toISOString(),
    count,
    ownerUserId: typeof record["ownerUserId"] === "string" ? record["ownerUserId"] : null,
  };
}

/** The room a scheduled task serves: the drive's dispatch checkpoint, or the task's declared trigger. */
function servedWorkroomRef(taskConfig: unknown): string | null {
  const checkpoint = isRecord(taskConfig) ? readDispatchCheckpoint(taskConfig["workroomDispatchCheckpoint"]) : null;
  return checkpoint?.roomId ?? readScheduledWorkTrigger(taskConfig)?.workroomId ?? null;
}

/**
 * Called after a scheduled agent task failed. When the task serves a Workroom
 * and the failure is the provider's, hold the room and take the task off the
 * schedule. Returns the hold, or null when nothing was held.
 */
export async function holdWorkroomQueueAfterFailure(input: {
  taskId: string;
  /** The task's owner; the hold is recorded as the scheduler acting for them. */
  ownerUserId: string;
  taskConfig: unknown;
  error: string;
  now?: Date;
}): Promise<WorkroomQueueHold | null> {
  const kind = queueHoldingFailureKind(input.error);
  const workroomRef = servedWorkroomRef(input.taskConfig);
  if (!kind || !workroomRef) return null;
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const room = await tx.workroom.findFirst({
      where: { archivedAt: null, OR: [{ capsuleId: workroomRef }, { id: workroomRef }] },
      select: { id: true, workspaceState: true },
    });
    if (!room) return null;
    if (readWorkroomQueueHold(room.workspaceState)) return null;
    const state = room.workspaceState && typeof room.workspaceState === "object" && !Array.isArray(room.workspaceState)
      ? room.workspaceState as Record<string, unknown>
      : {};
    const count = nextHoldCount(state, now);
    const hold: WorkroomQueueHold = {
      since: now.toISOString(),
      kind,
      taskId: input.taskId,
      error: input.error.slice(0, 500),
      releaseAt: new Date(now.getTime() + holdReleaseDelayMs(count)).toISOString(),
      count,
      ownerUserId: input.ownerUserId,
    };
    await tx.workroom.update({ where: { id: room.id }, data: { workspaceState: { ...state, queueHold: hold } } });
    await tx.scheduledAgentTask.updateMany({ where: { taskId: input.taskId }, data: { nextRunAt: null, attempts: 0 } });
    await recordWorkCapsuleActivity(tx as unknown as CapsuleDb, {
      workCapsuleId: room.id,
      kind: "provider-blocked",
      summary: `Queue held: no provider could answer (${kind}). It releases itself at ${hold.releaseAt}, or resume_workroom_queue releases it now.`,
      payload: hold,
      actor: { userId: input.ownerUserId, agentId: "agent-task-scheduler", principalId: null },
    }, { deferPublication: true });
    return hold;
  });
}

/** Clear a room's hold and re-arm the task it stopped. No hold is a no-op. */
export async function resumeWorkroomQueue(input: {
  db: CapsuleDb;
  capsuleId: string;
  reason: string;
  actor: WorkCapsuleActor;
  now?: Date;
}): Promise<{ resumed: boolean; hold: WorkroomQueueHold | null }> {
  const db = input.db as unknown as typeof prisma;
  const room = await db.workroom.findUnique({ where: { capsuleId: input.capsuleId }, select: { id: true, workspaceState: true } });
  if (!room) throw new Error(`Workroom ${input.capsuleId} not found`);
  const hold = readWorkroomQueueHold(room.workspaceState);
  if (!hold) return { resumed: false, hold: null };
  const { queueHold: _released, ...state } = room.workspaceState as Record<string, unknown>;
  const now = input.now ?? new Date();
  const queueHoldHistory = { count: hold.count, lastReleasedAt: now.toISOString() };
  await db.workroom.update({ where: { id: room.id }, data: { workspaceState: { ...state, queueHoldHistory } as never } });
  await db.scheduledAgentTask.updateMany({
    where: { taskId: hold.taskId, isActive: true },
    data: { nextRunAt: now },
  });
  await recordWorkCapsuleActivity(input.db, {
    workCapsuleId: room.id,
    kind: "provider-unblocked",
    summary: `Queue resumed: ${input.reason}`,
    payload: { released: hold, reason: input.reason },
    actor: input.actor,
  });
  return { resumed: true, hold };
}

/**
 * Release every hold that is due (BI-95638941), through resumeWorkroomQueue so a
 * timed release is recorded exactly as a manual one. Returns the rooms released.
 */
export async function releaseDueWorkroomQueueHolds(now: Date = new Date()): Promise<string[]> {
  const rooms = await prisma.workroom.findMany({
    where: { archivedAt: null, status: { notIn: ["complete", "abandoned", "archived"] } },
    select: { capsuleId: true, workspaceState: true },
  });
  const released: string[] = [];
  for (const room of rooms) {
    const hold = readWorkroomQueueHold(room.workspaceState);
    if (!hold || Date.parse(hold.releaseAt) > now.getTime()) continue;
    const ownerUserId = hold.ownerUserId
      ?? (await prisma.scheduledAgentTask.findUnique({ where: { taskId: hold.taskId }, select: { ownerUserId: true } }))?.ownerUserId
      ?? null;
    if (!ownerUserId) continue; // Nobody to record the release for; a manual resume still can.
    await resumeWorkroomQueue({
      db: prisma as unknown as CapsuleDb,
      capsuleId: room.capsuleId,
      reason: `the ${hold.kind} hold from ${hold.since} reached its release time (${hold.releaseAt}); hold ${hold.count} for this room`,
      actor: { userId: ownerUserId, agentId: "agent-task-scheduler", principalId: null },
      now,
    });
    released.push(room.capsuleId);
  }
  return released;
}
