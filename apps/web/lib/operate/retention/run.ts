// EP-DATA-RETENTION — Scheduled retention orchestration.
//
// Spec: docs/superpowers/specs/2026-06-14-data-retention-lifecycle-governance-design.md §5
//
// Wraps the pure engine (execute.ts) with the live-system concerns the inngest
// function needs: the operator kill switch (ScheduledJob.enabled), industry
// resolution for floors, and persistence of the run heartbeat + a compact,
// durable summary of what was purged (the auditable record — ScheduledJob.metadata
// outlives Loki's 14-day log retention).

import { type Prisma } from "@dpf/db";

import { isJobEnabled } from "@/lib/operate/scheduled-jobs/core";
import { runRetentionSweep, type RetentionSweepReport } from "./execute";
import type { RetentionPrismaClient } from "./policies";
import { resolveOrgIndustryKey } from "./industry-floors";
import {
  DATA_RETENTION_JOB_ID,
  nextRetentionRunAt,
} from "./constants";

export interface ScheduledRetentionResult extends RetentionSweepReport {
  /** True when the operator disabled the job (ScheduledJob.enabled=false). */
  skipped?: boolean;
  skipReason?: string;
}

/** Keep the last N per-run summaries on the heartbeat row for the admin view. */
const MAX_RECENT_RUNS = 10;

function summarizeForMetadata(report: RetentionSweepReport) {
  const byCategory: Record<string, number> = {};
  for (const r of report.results) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + r.affected;
  }
  return {
    at: report.finishedAt,
    dryRun: report.dryRun,
    industryKey: report.industryKey,
    totalAffected: report.totalAffected,
    errorCount: report.errorCount,
    durationMs: report.durationMs,
    byCategory,
    capped: report.results.filter((r) => r.capped).map((r) => r.model),
    errors: report.results
      .filter((r) => r.error)
      .map((r) => ({ model: r.model, error: r.error })),
  };
}

/**
 * Execute a retention sweep as the scheduled/manual job would.
 * - Honors the operator kill switch (ScheduledJob.enabled === false → skip).
 * - Resolves industry for floor widening.
 * - On a real (non-dry) run, persists lastRunAt/lastStatus/nextRunAt and pushes
 *   a compact summary onto ScheduledJob.metadata.recentRuns.
 */
export async function executeScheduledRetentionSweep(opts: {
  dryRun: boolean;
  now?: Date;
}): Promise<ScheduledRetentionResult> {
  const { dryRun } = opts;
  const now = opts.now ?? new Date();

  const { prisma } = await import("@dpf/db");
  const retentionPrisma = prisma as unknown as RetentionPrismaClient;

  // Operator kill switch. A destructive purge MUST be disableable without code.
  // Shared implementation (BI-7E49FA15); kept here as well as in gateAtEntry
  // because the run-now event path reaches this runner without the entry gate.
  if (!(await isJobEnabled(DATA_RETENTION_JOB_ID))) {
    return {
      dryRun,
      industryKey: null,
      startedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      durationMs: 0,
      totalAffected: 0,
      errorCount: 0,
      results: [],
      retainedDatasetCount: 0,
      skipped: true,
      skipReason: "disabled-by-operator",
    };
  }

  const industryKey = await resolveOrgIndustryKey(prisma);

  const report = await runRetentionSweep({
    prisma: retentionPrisma,
    now,
    dryRun,
    industryKey,
  });

  if (!dryRun) {
    const job = await prisma.scheduledJob
      .findUnique({
        where: { jobId: DATA_RETENTION_JOB_ID },
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
        where: { jobId: DATA_RETENTION_JOB_ID },
        data: {
          lastRunAt: new Date(report.finishedAt),
          lastStatus: report.errorCount > 0 ? "error" : "ok",
          lastError:
            report.errorCount > 0
              ? `${report.errorCount} policy error(s)`
              : null,
          nextRunAt: nextRetentionRunAt(now),
          metadata: { recentRuns: nextRecent } as Prisma.InputJsonValue,
        },
      })
      .catch(() => {
        // Heartbeat is best-effort; the purge itself already happened.
      });
  }

  return report;
}
