/**
 * Reads the current state of the Postgres backup mechanism for the admin
 * readiness card.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.8
 */

import { prisma } from "@dpf/db";

import { POSTGRES_BACKUP_JOB_ID } from "./constants";
import { DEFAULT_BACKUP_RETENTION, type ReadinessSummary } from "./types";

const BACKUPS_ROOT = "/backups";

export async function getPostgresBackupReadiness(): Promise<ReadinessSummary> {
  const [job, lastRun, lastSuccess, retainedRuns, recentFailures] =
    await Promise.all([
      prisma.scheduledJob.findUnique({
        where: { jobId: POSTGRES_BACKUP_JOB_ID },
      }),
      prisma.backupRun.findFirst({
        where: { target: "postgres" },
        orderBy: { startedAt: "desc" },
      }),
      prisma.backupRun.findFirst({
        where: { target: "postgres", status: "ok", prunedAt: null },
        orderBy: { finishedAt: "desc" },
      }),
      prisma.backupRun.findMany({
        where: { target: "postgres", status: "ok", prunedAt: null },
        select: { sizeBytes: true },
      }),
      prisma.backupRun.findMany({
        where: { target: "postgres" },
        orderBy: { startedAt: "desc" },
        take: 3,
        select: { status: true },
      }),
    ]);

  const retainedBytes = retainedRuns.reduce(
    (sum, r) => sum + Number(r.sizeBytes ?? BigInt(0)),
    0,
  );

  return {
    scheduledJob: job
      ? {
          jobId: job.jobId,
          schedule: job.schedule,
          nextRunAt: job.nextRunAt?.toISOString() ?? null,
          lastRunAt: job.lastRunAt?.toISOString() ?? null,
          lastStatus: job.lastStatus,
          lastError: job.lastError,
        }
      : null,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status as ReadinessSummary["lastRun"] extends infer X
            ? X extends { status: infer S }
              ? S
              : never
            : never,
          startedAt: lastRun.startedAt.toISOString(),
          finishedAt: lastRun.finishedAt?.toISOString() ?? null,
          sizeBytes: lastRun.sizeBytes ? Number(lastRun.sizeBytes) : null,
          durationMs: lastRun.durationMs,
          trigger: lastRun.trigger as "scheduled" | "manual",
        }
      : null,
    lastSuccess: lastSuccess
      ? {
          id: lastSuccess.id,
          finishedAt: lastSuccess.finishedAt?.toISOString() ?? null,
          sizeBytes: lastSuccess.sizeBytes
            ? Number(lastSuccess.sizeBytes)
            : null,
        }
      : null,
    retention: DEFAULT_BACKUP_RETENTION,
    retainedCount: retainedRuns.length,
    retainedBytes,
    storagePath: `${BACKUPS_ROOT}/postgres/`,
    failuresInLastThreeRuns: recentFailures.filter((r) => r.status === "failed")
      .length,
  };
}
