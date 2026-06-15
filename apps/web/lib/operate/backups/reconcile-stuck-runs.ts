import { prisma } from "@dpf/db";

/**
 * Reconcile BackupRun rows stuck in "running". A backup runner records a row as
 * `status: "running"` up front to surface progress, then flips it to ok/failed
 * with `finishedAt` set. If the runner process dies between those two points
 * (crash, container kill, OOM), the row sits "running" with `finishedAt = null`
 * FOREVER — a false "backup in progress" that pollutes the backup-health card
 * and the corruption-alerting (BI-EA67A758, #1922), and hides that the backup
 * actually failed hours ago. There is no other recovery for it.
 *
 * This marks rows stuck "running" past a generous window (default 45 min — well
 * past the longest backup's 30-min hard timeout) as failed. Runs in-process on
 * an interval (NOT an Inngest cron — the 2026-06-14 incident proved the cron
 * engine itself can die, and a recovery net must not depend on it).
 *
 * Non-fatal: never throws; returns null on error.
 */
export async function reconcileStuckBackupRuns(
  opts: { staleAfterMs?: number; now?: () => Date } = {},
  logger: Pick<Console, "log" | "error"> = console,
): Promise<{ failed: number } | null> {
  const staleAfterMs = opts.staleAfterMs ?? 45 * 60 * 1000;
  const now = opts.now?.() ?? new Date();
  try {
    const stuck = await prisma.backupRun.findMany({
      where: {
        status: "running",
        finishedAt: null,
        startedAt: { lt: new Date(now.getTime() - staleAfterMs) },
      },
      select: { id: true, target: true, startedAt: true },
    });
    if (stuck.length === 0) return { failed: 0 };

    for (const run of stuck) {
      await prisma.backupRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          finishedAt: now,
          errorMessage: `Reconciled by watchdog: backup runner died with no finish recorded (stuck "running" > ${Math.round(staleAfterMs / 60000)}m). The backup did not complete.`,
        },
      });
      logger.log(
        `[backup-reconcile] ${run.target} ${run.id} -> failed (orphaned; started ${run.startedAt.toISOString()})`,
      );
    }
    logger.log(`[backup-reconcile] resolved ${stuck.length} stuck backup run(s)`);
    return { failed: stuck.length };
  } catch (err) {
    logger.error("[backup-reconcile] failed (non-fatal):", err);
    return null;
  }
}
