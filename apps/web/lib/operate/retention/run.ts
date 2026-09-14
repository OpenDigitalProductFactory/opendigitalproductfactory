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
import { buildPurgePolicies, buildRetainedDatasets, loadModelDeclarations } from "./declarations";
import { loadObligationFloors } from "./obligation-floors";
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

/**
 * The verdict a retention run earned.
 *
 * `error`   a policy threw, or a policy is STALLED: it ran to completion,
 *           deleted nothing, and eligible rows remain. That is a purge which
 *           cannot finish, and it is the state this whole check exists to catch.
 * `ok`      every declared window is being honoured, or the only shortfall is a
 *           policy still catching up under its per-policy cap, which is the
 *           designed behaviour for a backlog and self-heals over several nights.
 */
export function retentionRunStatus(report: RetentionSweepReport): "ok" | "error" {
  return report.errorCount > 0 || report.hasStalledPolicy ? "error" : "ok";
}

/** Human-readable reason for a non-ok run, or null when it was clean. */
export function retentionRunError(report: RetentionSweepReport): string | null {
  const parts: string[] = [];
  if (report.errorCount > 0) parts.push(`${report.errorCount} policy error(s)`);
  const stalled = report.incompletePolicies.filter((policy) => policy.stalled);
  for (const policy of stalled) {
    parts.push(
      `${policy.model} purged 0 rows but ${policy.residualEligible} remain eligible `
        + "— the declared retention window is not being honoured",
    );
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

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
    // What the window PROMISED versus what is actually left. Kept on the
    // heartbeat because ScheduledJob.metadata outlives log retention, so a purge
    // that has been quietly failing for weeks is still provable afterwards.
    incompletePolicies: report.incompletePolicies,
    stalledPolicies: report.incompletePolicies.filter((p) => p.stalled).map((p) => p.model),
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
      // A run the operator switched off verified nothing, so it claims nothing.
      // `skipped` is what explains the absence — not a false all-clear.
      incompletePolicies: [],
      hasStalledPolicy: false,
      skipped: true,
      skipReason: "disabled-by-operator",
    };
  }

  const industryKey = await resolveOrgIndustryKey(prisma);

  // EP-A33A5C61 slice 4d: the policies come from the Postgres catalog (the
  // schema's /// @dpf tags), not from a TypeScript list.
  const declarations = await loadModelDeclarations(prisma, (m) => console.warn(`[retention] ${m}`));
  // EP-A33A5C61 slice 6: floors come from the obligations that bind this
  // install, scoped by archetype and jurisdiction by the existing compliance
  // classifier. Unresolvable applicability means "consider every stated
  // minimum", which can only lengthen a window.
  const applicableRegulationIds = await import("@/lib/compliance-library")
    .then((m) => m.resolveApplicableRegulationDbIds(prisma))
    .catch(() => null);
  const obligationFloors = await loadObligationFloors(
    prisma,
    applicableRegulationIds,
    (m) => console.warn(`[retention] ${m}`),
  );
  const report = await runRetentionSweep({
    prisma: retentionPrisma,
    now,
    dryRun,
    industryKey,
    policies: buildPurgePolicies(declarations),
    retainedDatasetCount: buildRetainedDatasets(declarations).length,
    obligationFloorDays: obligationFloors.byBucket,
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
          // "ok" must mean the declared windows are being honoured, not merely
          // that nothing threw. A sweep that deleted ZERO rows while thousands
          // stayed eligible used to report ok -- which is how a stalled purge
          // went unnoticed for months. A stall is an error; catching up under
          // the per-policy cap is not.
          lastStatus: retentionRunStatus(report),
          lastError: retentionRunError(report),
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
