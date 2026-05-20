/**
 * Operator-initiated recovery actions for stalled TaskRuns (BI-4ab6be39 Phase F2).
 *
 * Three operations the operator UI invokes after the watchdog flags a row:
 *
 *   - taskrunRetry: re-dispatch the work. Spawns a sibling TaskRun via
 *     parentTaskRunId so the audit timeline survives ("Retry #N of build X").
 *     Per-phase strategy belongs in Phase H — this v1 falls back to a
 *     uniform "re-dispatch from scratch" for every phase. Ship-phase Retry
 *     is disabled unless force=true (operator confirmed double-publish risk).
 *
 *   - taskrunAbandon: cancel the stalled row and cascade one level to any
 *     live children (in-flight states). Terminal children are left alone.
 *     The cascade writes StallEvent rows with reason=parent_abandoned.
 *
 *   - taskrunEscalate: park the row in stalled, notify the accountable
 *     human, write StallEvent.outcome=escalated. The route the notification
 *     takes resolves to the build owner if a buildId is present.
 *
 * See docs/superpowers/specs/2026-05-19-build-studio-stall-detection.md §6.3, §6.5, §6.6
 * and the corresponding plan file Phase F2.
 */
import { prisma } from "@dpf/db";

const IN_FLIGHT_STATUSES = ["submitted", "working", "input-required", "auth-required"];

export class TaskrunRecoveryError extends Error {
  readonly code: "not_stalled" | "not_found" | "ship_phase_requires_force";
  constructor(code: TaskrunRecoveryError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "TaskrunRecoveryError";
  }
}

interface StalledRow {
  id: string;
  taskRunId: string;
  userId: string;
  threadId: string | null;
  contextId: string | null;
  buildId: string | null;
  routeContext: string | null;
  title: string;
  objective: string;
  source: string;
  phase: string | null;
}

async function loadStalled(taskRunId: string): Promise<StalledRow> {
  const row = await prisma.taskRun.findUnique({
    where: { taskRunId },
    select: {
      id: true,
      taskRunId: true,
      userId: true,
      threadId: true,
      contextId: true,
      buildId: true,
      routeContext: true,
      title: true,
      objective: true,
      source: true,
      status: true,
    },
  });
  if (!row) {
    throw new TaskrunRecoveryError("not_found", `TaskRun not found: ${taskRunId}`);
  }
  if (row.status !== "stalled") {
    throw new TaskrunRecoveryError(
      "not_stalled",
      `Cannot recover TaskRun ${taskRunId}: status is ${row.status}, expected "stalled"`,
    );
  }
  let phase: string | null = null;
  if (row.buildId) {
    const fb = await prisma.featureBuild.findUnique({
      where: { buildId: row.buildId },
      select: { phase: true },
    });
    phase = fb?.phase ?? null;
  }
  return {
    id: row.id,
    taskRunId: row.taskRunId,
    userId: row.userId,
    threadId: row.threadId,
    contextId: row.contextId,
    buildId: row.buildId,
    routeContext: row.routeContext,
    title: row.title,
    objective: row.objective,
    source: row.source,
    phase,
  };
}

/**
 * Operator clicks Retry on a stalled TaskRun.
 *
 * Creates a sibling TaskRun with parentTaskRunId pointing at the stalled
 * row's cuid id. Re-uses the same threadId/contextId so the UI thread
 * stays coherent. Updates the most recent open StallEvent's outcome to
 * "retry". Returns the new business taskRunId so the caller can navigate
 * the operator to it.
 *
 * Ship-phase Retry is gated: callers must pass { force: true } or this
 * throws ship_phase_requires_force.
 */
export async function taskrunRetry(
  taskRunId: string,
  operatorUserId: string,
  opts: { force?: boolean } = {},
): Promise<{ newTaskRunId: string }> {
  const stalled = await loadStalled(taskRunId);

  if (stalled.phase === "ship" && !opts.force) {
    throw new TaskrunRecoveryError(
      "ship_phase_requires_force",
      "Ship-phase Retry is disabled by default. Pass force:true to override after confirming the double-publish risk.",
    );
  }

  const now = new Date();
  const newBusinessId = `TR-RETRY-${Math.random().toString(36).slice(2, 10)}`;

  return prisma.$transaction(async (tx) => {
    const newRun = await tx.taskRun.create({
      data: {
        taskRunId: newBusinessId,
        userId: stalled.userId,
        threadId: stalled.threadId,
        contextId: stalled.contextId,
        buildId: stalled.buildId,
        parentTaskRunId: stalled.id, // cuid, per the schema FK convention
        routeContext: stalled.routeContext,
        title: stalled.title,
        objective: stalled.objective,
        source: stalled.source,
        status: "submitted",
        startedAt: now,
      },
    });

    // Close the most recent open StallEvent on the stalled row as "retry".
    const openEvent = await tx.stallEvent.findFirst({
      where: { taskRunId: stalled.id, outcome: null },
      orderBy: { detectedAt: "desc" },
    });
    if (openEvent) {
      await tx.stallEvent.update({
        where: { id: openEvent.id },
        data: {
          outcome: "retry",
          outcomeAt: now,
          outcomeBy: operatorUserId,
        },
      });
    }

    return { newTaskRunId: newRun.taskRunId };
  });
}

/**
 * Operator clicks Abandon on a stalled TaskRun.
 *
 * Transitions to canceled. Walks one level of children (parentTaskRunId =
 * stalled.id) and cancels any that are still in-flight, writing a
 * StallEvent row of reason="parent_abandoned" for each. Terminal children
 * (completed/failed/canceled/rejected/archived/stalled) are left alone.
 */
export async function taskrunAbandon(
  taskRunId: string,
  operatorUserId: string,
): Promise<void> {
  const stalled = await loadStalled(taskRunId);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // 1. Cancel the stalled row itself.
    await tx.taskRun.update({
      where: { taskRunId },
      data: { status: "canceled", completedAt: now },
    });

    // 2. Close the most recent open StallEvent as "abandoned".
    const openEvent = await tx.stallEvent.findFirst({
      where: { taskRunId: stalled.id, outcome: null },
      orderBy: { detectedAt: "desc" },
    });
    if (openEvent) {
      await tx.stallEvent.update({
        where: { id: openEvent.id },
        data: {
          outcome: "abandoned",
          outcomeAt: now,
          outcomeBy: operatorUserId,
        },
      });
    }

    // 3. Cascade one level: find live children, cancel them, write
    //    parent_abandoned StallEvent for each.
    const liveChildren = await tx.taskRun.findMany({
      where: {
        parentTaskRunId: stalled.id,
        status: { in: IN_FLIGHT_STATUSES },
      },
      select: { id: true, taskRunId: true, startedAt: true, buildId: true, lastHeartbeatAt: true },
    });

    for (const child of liveChildren) {
      await tx.taskRun.update({
        where: { taskRunId: child.taskRunId },
        data: { status: "canceled", completedAt: now },
      });
      await tx.stallEvent.create({
        data: {
          taskRunId: child.id,
          buildId: child.buildId,
          phase: stalled.phase,
          reason: "parent_abandoned",
          lastHeartbeatAt: child.lastHeartbeatAt,
          startedAt: child.startedAt,
          // Thresholds aren't applicable to a cascade event — record 0 as a
          // sentinel so the audit row remains queryable.
          thresholdHeartbeatS: 0,
          thresholdTotalS: 0,
          outcome: "abandoned",
          outcomeAt: now,
          outcomeBy: operatorUserId,
          notes: `Cancelled via parent abandon: ${taskRunId}`,
        },
      });
    }
  });
}

/**
 * Operator clicks Escalate on a stalled TaskRun.
 *
 * Leaves the row in stalled (this is the explicit "park for human review"
 * outcome). Writes StallEvent.outcome=escalated and notifies the accountable
 * human — build owner if buildId resolves to a FeatureBuild.createdById,
 * else the task's userId.
 */
export async function taskrunEscalate(
  taskRunId: string,
  operatorUserId: string,
  notes?: string,
): Promise<void> {
  const stalled = await loadStalled(taskRunId);
  const now = new Date();

  // Resolve recipient: build owner > task user.
  let notifyUserId: string | null = stalled.userId ?? null;
  if (stalled.buildId) {
    const fb = await prisma.featureBuild.findUnique({
      where: { buildId: stalled.buildId },
      select: { createdById: true },
    });
    if (fb?.createdById) notifyUserId = fb.createdById;
  }

  await prisma.$transaction(async (tx) => {
    const openEvent = await tx.stallEvent.findFirst({
      where: { taskRunId: stalled.id, outcome: null },
      orderBy: { detectedAt: "desc" },
    });
    if (openEvent) {
      await tx.stallEvent.update({
        where: { id: openEvent.id },
        data: {
          outcome: "escalated",
          outcomeAt: now,
          outcomeBy: operatorUserId,
          notes,
        },
      });
    }

    if (notifyUserId) {
      await tx.notification.create({
        data: {
          userId: notifyUserId,
          type: "taskrun.escalated",
          title: `Stalled task escalated for review`,
          body: `Stalled task ${taskRunId} (phase ${stalled.phase ?? "unknown"}) escalated by operator. ${notes ?? ""}`.trim(),
          deepLink: stalled.buildId ? `/build` : `/platform/ai/operations`,
        },
      });
    }
  });
}
