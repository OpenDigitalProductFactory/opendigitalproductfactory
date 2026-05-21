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
 * Per-phase Retry strategy (BI-4ab6be39 Phase H, spec §5.5).
 *
 * What it means in v1:
 *   - "fresh"          — re-dispatch from scratch (ideate, review, default).
 *   - "resume-build"   — build phase. FeatureBuild.buildExecState carries the
 *                        last-checkpoint state and is NOT touched by Retry,
 *                        so the existing runBuildPipeline(..., existingState)
 *                        path naturally resumes from the failed step.
 *   - "resume-plan"    — plan phase. If a DeliberationRun for this build has
 *                        completedAt set, the new TaskRun is pre-seeded with
 *                        its outcome (via a2aMetadata.priorDeliberationRunId).
 *                        Otherwise falls back to "fresh".
 *   - "review-current" — review phase. Re-run only the current reviewer pass;
 *                        do NOT re-run upstream design/plan work.
 *   - "ship-force"     — ship phase with explicit force:true. Same dispatch
 *                        path as fresh, recorded with the force outcome notes
 *                        so the audit trail captures the double-publish-risk
 *                        acknowledgment.
 *
 * The strategy label is recorded on:
 *   - The new TaskRun.a2aMetadata (so downstream agentic dispatchers can read it).
 *   - The closing StallEvent.notes (so the audit ledger explains WHY retry).
 *
 * Behavioral wiring that requires the strategy beyond these two recordings
 * (e.g. plan-phase deliberation pre-seeding, review-phase upstream skip) is
 * implemented progressively — the build-phase resume works today because
 * the checkpoint substrate already supports it.
 */
export type RetryStrategy =
  | "fresh"
  | "resume-build"
  | "resume-plan"
  | "review-current"
  | "ship-force";

interface RetryDecision {
  strategy: RetryStrategy;
  notes: string;
  /** Pre-resolved metadata to attach to the new TaskRun.a2aMetadata. */
  metadata: Record<string, unknown>;
}

async function decideRetryStrategy(
  stalled: StalledRow,
  opts: { force?: boolean },
): Promise<RetryDecision> {
  const phase = stalled.phase;

  if (phase === "build") {
    return {
      strategy: "resume-build",
      notes: "Build phase — FeatureBuild.buildExecState carries the last checkpoint; runBuildPipeline will resume from the failed step.",
      metadata: { retryStrategy: "resume-build", priorTaskRunId: stalled.taskRunId },
    };
  }

  if (phase === "plan") {
    // Look up the most recent completed DeliberationRun on this TaskRun (the
    // stalled row's cuid id is what DeliberationRun.taskRunId stores). Pre-
    // seed the next agent turn with its outcome so plan work isn't redone.
    const priorDeliberation = await prisma.deliberationRun.findFirst({
      where: { taskRunId: stalled.id, completedAt: { not: null } },
      orderBy: { completedAt: "desc" },
      select: { id: true, consensusState: true },
    });
    if (priorDeliberation) {
      return {
        strategy: "resume-plan",
        notes: `Plan phase — pre-seeding with DeliberationRun ${priorDeliberation.id} (consensus=${priorDeliberation.consensusState}).`,
        metadata: {
          retryStrategy: "resume-plan",
          priorTaskRunId: stalled.taskRunId,
          priorDeliberationRunId: priorDeliberation.id,
        },
      };
    }
    return {
      strategy: "fresh",
      notes: "Plan phase — no prior DeliberationRun found, falling back to fresh dispatch.",
      metadata: { retryStrategy: "fresh", priorTaskRunId: stalled.taskRunId },
    };
  }

  if (phase === "review") {
    return {
      strategy: "review-current",
      notes: "Review phase — re-running the reviewer pass only; do not re-run upstream design/plan.",
      metadata: { retryStrategy: "review-current", priorTaskRunId: stalled.taskRunId },
    };
  }

  if (phase === "ship" && opts.force) {
    return {
      strategy: "ship-force",
      notes: "Ship phase — operator explicitly forced retry, double-publish risk acknowledged.",
      metadata: { retryStrategy: "ship-force", priorTaskRunId: stalled.taskRunId },
    };
  }

  return {
    strategy: "fresh",
    notes: `${phase ?? "unknown"} phase — fresh dispatch.`,
    metadata: { retryStrategy: "fresh", priorTaskRunId: stalled.taskRunId },
  };
}

/**
 * Operator clicks Retry on a stalled TaskRun.
 *
 * Creates a sibling TaskRun with parentTaskRunId pointing at the stalled
 * row's cuid id. Re-uses the same threadId/contextId so the UI thread
 * stays coherent. Updates the most recent open StallEvent's outcome to
 * "retry". Records a per-phase strategy in a2aMetadata + StallEvent.notes.
 *
 * Ship-phase Retry is gated: callers must pass { force: true } or this
 * throws ship_phase_requires_force.
 */
export async function taskrunRetry(
  taskRunId: string,
  operatorUserId: string,
  opts: { force?: boolean } = {},
): Promise<{ newTaskRunId: string; strategy: RetryStrategy }> {
  const stalled = await loadStalled(taskRunId);

  if (stalled.phase === "ship" && !opts.force) {
    throw new TaskrunRecoveryError(
      "ship_phase_requires_force",
      "Ship-phase Retry is disabled by default. Pass force:true to override after confirming the double-publish risk.",
    );
  }

  const decision = await decideRetryStrategy(stalled, opts);
  const now = new Date();
  const newBusinessId = `TR-RETRY-${Math.random().toString(36).slice(2, 10)}`;

  const { newTaskRunId } = await prisma.$transaction(async (tx) => {
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
        a2aMetadata: decision.metadata as Record<string, string>,
      },
    });

    // Close the most recent open StallEvent on the stalled row as "retry",
    // or synthesize one if no open event exists (audit completeness — see
    // upsertRecoveryOutcome).
    await upsertRecoveryOutcome(tx, {
      stalledCuid: stalled.id,
      buildId: stalled.buildId,
      phase: stalled.phase,
      outcome: "retry",
      operatorUserId,
      now,
      notes: decision.notes,
    });

    return { newTaskRunId: newRun.taskRunId };
  });

  return { newTaskRunId, strategy: decision.strategy };
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

    // 2. Close the most recent open StallEvent as "abandoned", or
    //    synthesize one if no open event exists (audit completeness — see
    //    upsertRecoveryOutcome).
    await upsertRecoveryOutcome(tx, {
      stalledCuid: stalled.id,
      buildId: stalled.buildId,
      phase: stalled.phase,
      outcome: "abandoned",
      operatorUserId,
      now,
    });

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
 *
 * Audit completeness (BI-4ab6be39 follow-up, 2026-05-20): if no open
 * StallEvent exists for this row when the operator escalates, we synthesize
 * one with the outcome already set. The earlier behavior silently skipped
 * the audit row when the watchdog hadn't yet inserted a fresh open event,
 * leaving the StallEvent ledger one record short of the Notification row —
 * caught during F2 UX dogfooding when the notification fired but no
 * outcome='escalated' row appeared in StallEvent. Retry and Abandon have
 * the same pattern; see taskrunRetry / taskrunAbandon for parity.
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
    await upsertRecoveryOutcome(tx, {
      stalledCuid: stalled.id,
      buildId: stalled.buildId,
      phase: stalled.phase,
      outcome: "escalated",
      operatorUserId,
      now,
      notes,
    });

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

/**
 * Close the most recent open StallEvent for a recovery operation, or
 * synthesize one with the outcome pre-set if no open event exists.
 *
 * The watchdog only INSERTs a StallEvent when it transitions a row from
 * working/active → stalled. If an operator recovers a row whose open event
 * has already been resolved (e.g. earlier action, or the row was force-
 * stalled by an admin tool that didn't write an event), the prior behavior
 * silently dropped the outcome row, leaving the StallEvent ledger missing
 * a record of the operator action. This helper guarantees one outcome row
 * lands per recovery call.
 *
 * thresholdHeartbeatS / thresholdTotalS are 0 sentinels on synthesized
 * rows (matching the parent_abandoned cascade rows in taskrunAbandon),
 * since the original watchdog thresholds aren't recoverable after the fact.
 *
 * The `startedAt` field is required by the schema. We look it up rather
 * than threading it through every call site, so the helper stays tight.
 */
async function upsertRecoveryOutcome(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  args: {
    stalledCuid: string;
    buildId: string | null;
    phase: string | null;
    outcome: "retry" | "abandoned" | "escalated";
    operatorUserId: string;
    now: Date;
    notes?: string;
  },
): Promise<void> {
  const openEvent = await tx.stallEvent.findFirst({
    where: { taskRunId: args.stalledCuid, outcome: null },
    orderBy: { detectedAt: "desc" },
  });
  if (openEvent) {
    await tx.stallEvent.update({
      where: { id: openEvent.id },
      data: {
        outcome: args.outcome,
        outcomeAt: args.now,
        outcomeBy: args.operatorUserId,
        notes: args.notes,
      },
    });
    return;
  }

  // No open event — synthesize one so the audit row lands. Pull startedAt
  // from the TaskRun itself; lastHeartbeatAt may legitimately be null on
  // rows that never reported a heartbeat before transitioning to stalled.
  const row = await tx.taskRun.findUnique({
    where: { id: args.stalledCuid },
    select: { startedAt: true, lastHeartbeatAt: true },
  });
  if (!row) return; // Shouldn't happen — loadStalled already validated.
  await tx.stallEvent.create({
    data: {
      taskRunId: args.stalledCuid,
      buildId: args.buildId,
      phase: args.phase,
      reason: "operator_recovery_synthesized",
      lastHeartbeatAt: row.lastHeartbeatAt,
      startedAt: row.startedAt,
      thresholdHeartbeatS: 0,
      thresholdTotalS: 0,
      outcome: args.outcome,
      outcomeAt: args.now,
      outcomeBy: args.operatorUserId,
      notes: args.notes ?? "Synthesized on operator recovery — no open StallEvent at recovery time.",
    },
  });
}
