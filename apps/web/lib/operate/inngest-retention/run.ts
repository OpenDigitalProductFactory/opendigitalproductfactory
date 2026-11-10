// BI-0AB96FE7 — Scheduled Inngest-retention orchestration.
//
// Wraps the pure engine (execute.ts) with the live-system concerns the inngest
// function needs: the operator kill switch (ScheduledJob.enabled), the
// connection to the SEPARATE db=inngest database (the portal's Prisma client
// only speaks db=dpf), and persistence of the run heartbeat + a compact,
// durable summary of what was reaped (ScheduledJob.metadata outlives Loki's
// 14-day log retention).

import { type Prisma } from "@dpf/db";

import { isJobEnabled } from "@/lib/operate/scheduled-jobs/core";

import {
  runInngestRetentionSweep,
  type InngestRetentionSweepReport,
  type SqlRunner,
} from "./execute";
import {
  INNGEST_RETENTION_JOB_ID,
  nextInngestRetentionRunAt,
  resolveInngestDatabaseUrl,
} from "./constants";

export interface ScheduledInngestRetentionResult
  extends InngestRetentionSweepReport {
  /** True when the operator disabled the job (ScheduledJob.enabled=false). */
  skipped?: boolean;
  skipReason?: string;
}

/** Keep the last N per-run summaries on the heartbeat row for the admin view. */
const MAX_RECENT_RUNS = 10;

function emptyReport(
  now: Date,
  dryRun: boolean,
  skipReason: string,
): ScheduledInngestRetentionResult {
  return {
    dryRun,
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    durationMs: 0,
    orphansReaped: 0,
    historyTrimmed: 0,
    byTable: {},
    capped: [],
    errorCount: skipReason === "disabled-by-operator" ? 0 : 1,
    errors:
      skipReason === "disabled-by-operator"
        ? []
        : [{ table: "(connection)", error: skipReason }],
    skipped: true,
    skipReason,
  };
}

function summarizeForMetadata(report: InngestRetentionSweepReport) {
  return {
    at: report.finishedAt,
    dryRun: report.dryRun,
    orphansReaped: report.orphansReaped,
    historyTrimmed: report.historyTrimmed,
    byTable: report.byTable,
    capped: report.capped,
    errorCount: report.errorCount,
    durationMs: report.durationMs,
    errors: report.errors,
  };
}

/**
 * Execute an Inngest-retention sweep as the scheduled/manual job would.
 * - Honors the operator kill switch (ScheduledJob.enabled === false → skip).
 * - Opens a short-lived `pg` connection to db=inngest (derived from
 *   DATABASE_URL, or an explicit INNGEST_POSTGRES_URI).
 * - On a real (non-dry) run, persists lastRunAt/lastStatus/nextRunAt and pushes
 *   a compact summary onto ScheduledJob.metadata.recentRuns.
 *
 * Never throws for an expected operational condition (job disabled, DB
 * unreachable): those return a `skipped` report so the Inngest function stays
 * green and does not retry a wedge into existence.
 */
export async function executeScheduledInngestRetentionSweep(opts: {
  dryRun: boolean;
  now?: Date;
  env?: Record<string, string | undefined>;
}): Promise<ScheduledInngestRetentionResult> {
  const { dryRun } = opts;
  const now = opts.now ?? new Date();
  const env = opts.env ?? process.env;

  const { prisma } = await import("@dpf/db");

  // Operator kill switch. A maintenance sweep MUST be disableable without code.
  // Shared implementation (BI-7E49FA15); kept here as well as in gateAtEntry
  // because the run-now event path reaches this runner without the entry gate.
  if (!(await isJobEnabled(INNGEST_RETENTION_JOB_ID))) {
    return emptyReport(now, dryRun, "disabled-by-operator");
  }

  const connectionString = resolveInngestDatabaseUrl(env);
  if (!connectionString) {
    return emptyReport(now, dryRun, "no-inngest-db-url");
  }

  let report: InngestRetentionSweepReport;
  let client: { end: () => Promise<void> } | null = null;
  try {
    const { Client } = await import("pg");
    const pgClient = new Client({ connectionString });
    client = pgClient;
    await pgClient.connect();
    report = await runInngestRetentionSweep({
      sql: pgClient as unknown as SqlRunner,
      now,
      dryRun,
    });
  } catch (err) {
    return emptyReport(
      now,
      dryRun,
      err instanceof Error ? err.message : "inngest-db-connect-failed",
    );
  } finally {
    await client?.end().catch(() => {});
  }

  if (!dryRun) {
    const job = await prisma.scheduledJob
      .findUnique({
        where: { jobId: INNGEST_RETENTION_JOB_ID },
        select: { metadata: true },
      })
      .catch(() => null);
    const prior = (job?.metadata ?? {}) as { recentRuns?: unknown[] };
    const recentRuns = Array.isArray(prior.recentRuns) ? prior.recentRuns : [];
    const nextRecent = [summarizeForMetadata(report), ...recentRuns].slice(
      0,
      MAX_RECENT_RUNS,
    );

    await prisma.scheduledJob
      .update({
        where: { jobId: INNGEST_RETENTION_JOB_ID },
        data: {
          lastRunAt: new Date(report.finishedAt),
          lastStatus: report.errorCount > 0 ? "error" : "ok",
          lastError:
            report.errorCount > 0
              ? `${report.errorCount} table error(s)`
              : null,
          nextRunAt: nextInngestRetentionRunAt(now),
          metadata: { recentRuns: nextRecent } as Prisma.InputJsonValue,
        },
      })
      .catch(() => {
        // Heartbeat is best-effort; the reap itself already happened.
      });
  }

  return report;
}
