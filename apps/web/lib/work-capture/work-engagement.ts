// WorkEngagement lifecycle (work-capture primitive, BI-4C5F7A2D §9, slice 3).
//
// A coworker's own long-running/recurring work unit. Composes the shared
// primitives: the transition state machine (status lifecycle), the recurrence
// expander (occurrence materialization), and an append-only activity timeline.
//
// The pure decision logic (allowed transitions + idempotent materialization
// planning) is separated from the DB writes so it can be unit-tested without a
// database; the DB functions are thin and mock-tested.

import { prisma } from "@dpf/db";
import { evaluateTransition, type TransitionMap } from "./transition-state-machine";
import { expandOccurrences, type Occurrence } from "./recurrence-expander";

export const WORK_ENGAGEMENT_STATUS = [
  "planned",
  "in-progress",
  "completed",
  "cancelled",
  "failed",
] as const;
export type WorkEngagementStatus = (typeof WORK_ENGAGEMENT_STATUS)[number];

// Lifecycle: planned → in-progress → completed | failed; cancellable until terminal.
export const WORK_ENGAGEMENT_TRANSITIONS: TransitionMap<WorkEngagementStatus> = {
  planned: ["in-progress", "cancelled"],
  "in-progress": ["completed", "failed", "cancelled"],
  completed: [],
  cancelled: [],
  failed: ["in-progress", "cancelled"], // a failed run may be retried
};

/**
 * PURE: given the occurrences an RRULE produces in a window and the set of
 * occurrence keys already materialized, return only the occurrences that still
 * need instance rows. This is the idempotency core (§9.3): re-running never
 * double-creates, and a cancelled/overridden occurrence stays skipped because
 * its key is already present. Keys are UTC-ISO strings of occurrenceAt.
 */
export function planMaterialization(
  occurrences: Occurrence[],
  existingOccurrenceKeys: ReadonlySet<string>,
): Occurrence[] {
  return occurrences.filter((o) => !existingOccurrenceKeys.has(o.occurrenceAt.toISOString()));
}

export type TransitionInput = {
  engagementId: string;
  to: WorkEngagementStatus;
  actor?: { userId?: string | null; agentId?: string | null };
  summary?: string;
};

/**
 * Guarded, idempotent status transition. A no-op (already in `to`) returns
 * changed:false and records NO activity row (external gap #6). A real move
 * records one activity row (`status-change`) atomically with the status update.
 */
export async function transitionWorkEngagement(
  input: TransitionInput,
): Promise<{ status: WorkEngagementStatus; changed: boolean } | { error: string; message: string }> {
  const engagement = await prisma.workEngagement.findUnique({
    where: { id: input.engagementId },
    select: { id: true, status: true },
  });
  if (!engagement) {
    return { error: "not-found", message: `WorkEngagement ${input.engagementId} does not exist.` };
  }
  const from = engagement.status as WorkEngagementStatus;
  let outcome: { changed: boolean };
  try {
    outcome = evaluateTransition(WORK_ENGAGEMENT_TRANSITIONS, from, input.to, { label: "WorkEngagement" });
  } catch (e) {
    return { error: "illegal-transition", message: e instanceof Error ? e.message : String(e) };
  }
  if (!outcome.changed) return { status: from, changed: false };

  await prisma.$transaction(async (tx) => {
    await tx.workEngagement.update({ where: { id: input.engagementId }, data: { status: input.to } });
    await recordActivityTx(tx, {
      engagementId: input.engagementId,
      kind: "status-change",
      summary: input.summary ?? `Status ${from} → ${input.to}`,
      payload: { from, to: input.to },
      actor: input.actor,
    });
  });
  return { status: input.to, changed: true };
}

export type RecordActivityInput = {
  engagementId: string;
  kind: string;
  summary: string;
  payload?: Record<string, unknown>;
  actor?: { userId?: string | null; agentId?: string | null };
  toolExecutionId?: string | null;
};

/** Append an activity row with a monotonic per-engagement seq; bumps lastActivityAt. */
export async function recordWorkEngagementActivity(
  input: RecordActivityInput,
): Promise<{ activityId: string; seq: number } | { error: string; message: string }> {
  const engagement = await prisma.workEngagement.findUnique({
    where: { id: input.engagementId },
    select: { id: true },
  });
  if (!engagement) {
    return { error: "not-found", message: `WorkEngagement ${input.engagementId} does not exist.` };
  }
  return prisma.$transaction((tx) => recordActivityTx(tx, input));
}

// Shared writer: allocate seq = (current max) + 1 inside the caller's transaction,
// insert the row, and bump the parent's lastActivityAt. The @@unique([weId, seq])
// makes a racing duplicate seq fail loudly rather than silently reorder.
type TxLike = {
  workEngagementActivity: {
    aggregate: (args: unknown) => Promise<{ _max: { seq: number | null } }>;
    create: (args: unknown) => Promise<{ id: string; seq: number }>;
  };
  workEngagement: { update: (args: unknown) => Promise<unknown> };
};
async function recordActivityTx(
  tx: TxLike,
  input: RecordActivityInput,
): Promise<{ activityId: string; seq: number }> {
  const agg = await tx.workEngagementActivity.aggregate({
    where: { workEngagementId: input.engagementId },
    _max: { seq: true },
  });
  const seq = (agg._max.seq ?? 0) + 1;
  const row = await tx.workEngagementActivity.create({
    data: {
      workEngagementId: input.engagementId,
      seq,
      kind: input.kind,
      summary: input.summary,
      payload: (input.payload ?? {}) as object,
      recordedById: input.actor?.userId ?? null,
      recordedByAgentId: input.actor?.agentId ?? null,
      toolExecutionId: input.toolExecutionId ?? null,
    },
    select: { id: true, seq: true },
  });
  await tx.workEngagement.update({
    where: { id: input.engagementId },
    data: { lastActivityAt: row.id ? new Date() : undefined },
  });
  return { activityId: row.id, seq: row.seq };
}

/** Read a parent engagement's materialized instances (optionally by status window). */
export async function getWorkEngagementInstances(
  parentId: string,
  opts?: { status?: WorkEngagementStatus },
): Promise<
  | { message: string; data: { parentId: string; instances: unknown[] } }
  | { error: string; message: string }
> {
  const parent = await prisma.workEngagement.findUnique({
    where: { id: parentId },
    select: { id: true, title: true },
  });
  if (!parent) {
    return { error: "not-found", message: `WorkEngagement ${parentId} does not exist.` };
  }
  const instances = await prisma.workEngagement.findMany({
    where: {
      parentWorkEngagementId: parentId,
      ...(opts?.status ? { status: opts.status } : {}),
    },
    orderBy: { instanceNumber: "asc" },
    select: {
      id: true, instanceNumber: true, occurrenceAt: true, dueAt: true, status: true,
      exceptionState: true, lastActivityAt: true,
    },
  });
  return {
    message: `"${parent.title}" — ${instances.length} instance(s)${opts?.status ? ` in status ${opts.status}` : ""}.`,
    data: { parentId, instances },
  };
}

export type CreateRecurringInput = {
  organizationId: string;
  title: string;
  requestedOutcome?: string;
  createdByAgentId?: string | null;
  rrule: string;
  timezone: string;
  anchorAt: Date;
  until?: Date | null;
  windowStart: Date;
  windowEnd: Date;
  maxOccurrences: number;
};

/**
 * Create a recurring WorkEngagement: a parent engagement + its RecurrenceSchedule
 * + materialized child instance rows over the window. Idempotent per occurrence
 * via the @@unique([recurrenceScheduleId, occurrenceAt]) key — createMany
 * skipDuplicates means a re-run tops up without doubling.
 */
export async function createRecurringWorkEngagement(
  input: CreateRecurringInput,
): Promise<{ parentId: string; scheduleId: string; instances: number }> {
  const occurrences = expandOccurrences({
    rrule: input.rrule,
    timezone: input.timezone,
    anchorAt: input.anchorAt,
    until: input.until ?? null,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    maxOccurrences: input.maxOccurrences,
  });

  return prisma.$transaction(async (tx) => {
    const schedule = await tx.recurrenceSchedule.create({
      data: { rrule: input.rrule, timezone: input.timezone, anchorAt: input.anchorAt, until: input.until ?? null },
      select: { id: true },
    });
    const parent = await tx.workEngagement.create({
      data: {
        organizationId: input.organizationId,
        title: input.title,
        requestedOutcome: input.requestedOutcome ?? null,
        createdByAgentId: input.createdByAgentId ?? null,
        recurrenceScheduleId: schedule.id,
        status: "planned",
      },
      select: { id: true },
    });
    if (occurrences.length > 0) {
      await tx.workEngagement.createMany({
        data: occurrences.map((o) => ({
          organizationId: input.organizationId,
          title: input.title,
          createdByAgentId: input.createdByAgentId ?? null,
          recurrenceScheduleId: schedule.id,
          parentWorkEngagementId: parent.id,
          instanceNumber: o.instanceNumber,
          occurrenceAt: o.occurrenceAt,
          dueAt: o.occurrenceAt,
          status: "planned",
        })),
        skipDuplicates: true,
      });
    }
    return { parentId: parent.id, scheduleId: schedule.id, instances: occurrences.length };
  });
}
