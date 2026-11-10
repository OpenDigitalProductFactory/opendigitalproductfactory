import { randomUUID } from "node:crypto";

import { computeNextCronRun } from "@/lib/operate/cron-next-run";

import {
  acknowledgeSweep, claimSweep, observeUpgrade, readSweepCheckpoint, requireSweepOwner,
  SWEEP_LEASE_MS, type SweepCheckpoint, type SweepClaim, type SweepUpgrade,
} from "./acceptance-sweep-checkpoint";
import { lockSweepTask, sweepDatabaseTime, sweepTransaction, withAcceptanceSweepWrite, type SweepFenceClient, type SweepFenceDb } from "./acceptance-sweep-fence";

export type SweepLeaseClient = SweepFenceClient & {
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
};

function configWithCheckpoint(config: unknown, checkpoint: SweepCheckpoint): string {
  // readSweepCheckpoint has already validated the container before every write.
  return JSON.stringify({ ...(config as Record<string, unknown> | null), acceptanceSweep: checkpoint });
}

async function saveCheckpoint(tx: SweepLeaseClient, taskId: string, config: unknown, checkpoint: SweepCheckpoint) {
  await tx.$executeRawUnsafe(
    'UPDATE "ScheduledAgentTask" SET "taskConfig" = $2::jsonb, "updatedAt" = clock_timestamp() WHERE "taskId" = $1',
    taskId, configWithCheckpoint(config, checkpoint),
  );
}

async function setDue(tx: SweepLeaseClient, taskId: string, due: Date) {
  await tx.$executeRawUnsafe('UPDATE "ScheduledAgentTask" SET "nextRunAt" = $2, "updatedAt" = clock_timestamp() WHERE "taskId" = $1', taskId, due);
  await tx.$executeRawUnsafe('UPDATE "ScheduledJob" SET "nextRunAt" = $2, "updatedAt" = clock_timestamp() WHERE "jobId" = $1', taskId, due);
}

/** Caller has resolved a successful non-dry-run upgrade against the served identity. */
export async function wakeAcceptanceSweep<T extends SweepLeaseClient>(db: SweepFenceDb<T>, taskId: string, observed: SweepUpgrade | null): Promise<void> {
  await sweepTransaction(db, async tx => {
    const row = await lockSweepTask(tx, taskId);
    const current = readSweepCheckpoint(row.taskConfig);
    const next = observed ? observeUpgrade(current, observed) : current;
    const now = await sweepDatabaseTime(tx);
    const expired = current.owner !== null && current.owner.expiresAt <= now;
    if (expired) {
      // One immediate crash recovery per generation/cadence cycle. Repeated
      // crashes fall back to the existing daily cadence, not endless 5m churn.
      const retry = next !== current || row.attempts === 0;
      await saveCheckpoint(tx, taskId, row.taskConfig, { ...next, owner: null });
      await tx.$executeRawUnsafe('UPDATE "ScheduledAgentTask" SET attempts=$2 WHERE "taskId"=$1', taskId, retry ? 1 : 0);
      await setDue(tx, taskId, retry ? new Date(now) : computeNextCronRun(row.schedule, new Date(now)));
      return;
    }
    if (next !== current) await saveCheckpoint(tx, taskId, row.taskConfig, next);
    if (next !== current) await tx.$executeRawUnsafe('UPDATE "ScheduledAgentTask" SET attempts=0 WHERE "taskId"=$1', taskId);
    // An unchanged pending failure keeps its cron backoff. Only a new generation
    // or an expired execution makes it due; notices are not a retry loop.
    if (next !== current && !current.owner) await setDue(tx, taskId, new Date(now));
  });
}

/** Every entry point claims here, before the generic scheduler changes cadence. */
export async function claimAcceptanceSweep<T extends SweepLeaseClient>(db: SweepFenceDb<T>, taskId: string): Promise<SweepClaim | null> {
  return sweepTransaction(db, async tx => {
    const row = await lockSweepTask(tx, taskId);
    const state = readSweepCheckpoint(row.taskConfig);
    const now = await sweepDatabaseTime(tx);
    const rows = await tx.$queryRawUnsafe('SELECT "nextRunAt", schedule FROM "ScheduledAgentTask" WHERE "taskId" = $1', taskId) as Array<{ nextRunAt: Date | null; schedule: string }>;
    const task = rows[0];
    if (!task?.nextRunAt || task.nextRunAt.getTime() > now || (state.owner && state.owner.expiresAt > now)) return null;
    const claimed = claimSweep(state, randomUUID(), now);
    await saveCheckpoint(tx, taskId, row.taskConfig, claimed.checkpoint);
    await setDue(tx, taskId, computeNextCronRun(task.schedule, new Date(now)));
    return claimed.claim;
  });
}

export async function renewAcceptanceSweep<T extends SweepLeaseClient>(db: SweepFenceDb<T>, taskId: string, claim: SweepClaim): Promise<void> {
  await withAcceptanceSweepWrite(db, taskId, claim, async tx => {
    const row = await lockSweepTask(tx, taskId);
    const state = readSweepCheckpoint(row.taskConfig);
    const now = await sweepDatabaseTime(tx);
    requireSweepOwner(state, claim, now);
    await saveCheckpoint(tx, taskId, row.taskConfig, { ...state, owner: { ...claim, expiresAt: now + SWEEP_LEASE_MS } });
  });
}

export async function finishAcceptanceSweep<T extends SweepLeaseClient>(
  db: SweepFenceDb<T>, taskId: string, claim: SweepClaim,
  result: { startedAt: Date; schedule: string; error: string | null },
): Promise<void> {
  await withAcceptanceSweepWrite(db, taskId, claim, async tx => {
    const row = await lockSweepTask(tx, taskId);
    const state = readSweepCheckpoint(row.taskConfig);
    const now = await sweepDatabaseTime(tx);
    const next = result.error === null ? acknowledgeSweep(state, claim, now) : { ...state, owner: null };
    const successorPending = next.pending !== null && next.pending.runId !== claim.runId;
    // Deterministic acceptance has no proactivity plan: existing failure policy
    // is plain cron re-arm. A new generation may run sooner; same-run notices cannot.
    const due = successorPending ? new Date(now) : computeNextCronRun(result.schedule, new Date(now));
    await saveCheckpoint(tx, taskId, row.taskConfig, next);
    const status = result.error === null ? "ok" : "error";
    await tx.$executeRawUnsafe(
      'UPDATE "ScheduledAgentTask" SET "lastRunAt" = $2, "lastStatus" = $3, "lastError" = $4, attempts = 0 WHERE "taskId" = $1',
      taskId, result.startedAt, status, result.error,
    );
    await tx.$executeRawUnsafe(
      'UPDATE "ScheduledJob" SET "lastRunAt" = $2, "lastStatus" = $3, "lastError" = $4 WHERE "jobId" = $1',
      taskId, result.startedAt, status, result.error,
    );
    await setDue(tx, taskId, due);
  });
}
