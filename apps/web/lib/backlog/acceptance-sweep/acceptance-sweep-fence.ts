import { readSweepCheckpoint, requireSweepOwner, type SweepClaim } from "./acceptance-sweep-checkpoint";

export type SweepFenceClient = {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
};
export type SweepFenceDb<T extends SweepFenceClient> = {
  $transaction<R>(work: (tx: T) => Promise<R>, options: {
    isolationLevel: "Serializable"; maxWait: number; timeout: number;
  }): Promise<R>;
};

export type LockedSweepTask = { taskConfig: unknown; isActive: boolean; schedule: string; attempts: number };

function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function isRolledBackConflict(error: unknown): boolean {
  const code = field(error, "code");
  if (code === "P2034" || code === "40001" || code === "40P01") return true;
  if (code !== "P2010") return false;
  // Prisma's driver adapter wraps raw-query SQLSTATEs rather than exposing
  // P2034. Only serialization/deadlock confirms rollback; never retry a generic
  // raw error, a connection loss, or text that happens to mention a SQLSTATE.
  const originalCode = field(field(field(field(error, "meta"), "driverAdapterError"), "cause"), "originalCode");
  return originalCode === "40001" || originalCode === "40P01";
}

/** Retry only database-confirmed rolled-back serialization/deadlock conflicts. */
export async function sweepTransaction<T extends SweepFenceClient, R>(db: SweepFenceDb<T>, work: (tx: T) => Promise<R>): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        await tx.$queryRawUnsafe("SELECT set_config('statement_timeout', '8000', true), set_config('lock_timeout', '4000', true)");
        return work(tx);
      }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 10_000 });
    } catch (error) {
      if (attempt >= 2 || !isRolledBackConflict(error)) throw error;
    }
  }
}

/** All acceptance writes lock the task BEFORE a room, backlog item, or job row. */
export async function lockSweepTask(tx: SweepFenceClient, taskId: string): Promise<LockedSweepTask> {
  const rows = await tx.$queryRawUnsafe(
    'SELECT "taskConfig", "isActive", schedule, attempts FROM "ScheduledAgentTask" WHERE "taskId" = $1 FOR UPDATE', taskId,
  ) as LockedSweepTask[];
  if (rows.length !== 1) throw new Error("Acceptance sweep task missing");
  if (!rows[0]!.isActive) throw new Error("Acceptance sweep task disabled");
  return rows[0]!;
}

export async function sweepDatabaseTime(tx: SweepFenceClient): Promise<number> {
  const rows = await tx.$queryRawUnsafe('SELECT clock_timestamp() AS "now"') as Array<{ now: Date }>;
  const now = rows[0]?.now?.getTime();
  if (now === undefined || !Number.isFinite(now)) throw new Error("Acceptance sweep database time unavailable");
  return now;
}

/**
 * DB-only callback. Never pass a callback that performs network/model/tool I/O
 * or writes through another client. The task-row lock serializes takeover with
 * the domain mutation; a separate check followed by a write cannot do that.
 * Failures roll back and propagate to the scheduler; no unfenced fallback.
 */
export async function withAcceptanceSweepWrite<T extends SweepFenceClient, R>(
  db: SweepFenceDb<T>, taskId: string, claim: SweepClaim, write: (tx: T) => Promise<R>,
): Promise<R> {
  return sweepTransaction(db, async tx => {
    const row = await lockSweepTask(tx, taskId);
    const checkpoint = readSweepCheckpoint(row.taskConfig);
    requireSweepOwner(checkpoint, claim, await sweepDatabaseTime(tx));
    const result = await write(tx);
    requireSweepOwner(checkpoint, claim, await sweepDatabaseTime(tx));
    return result;
  });
}
