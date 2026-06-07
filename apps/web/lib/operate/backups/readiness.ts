/**
 * Reads the current state of the backup mechanism for the admin readiness card.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.8
 * Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md §3.4
 */

import { prisma } from "@dpf/db";

import {
  NEO4J_BACKUP_JOB_ID,
  POSTGRES_BACKUP_JOB_ID,
  QDRANT_BACKUP_JOB_ID,
  TRIAL_RESTORE_TRIGGER,
} from "./constants";
import {
  DEFAULT_BACKUP_RETENTION,
  type BackupTarget,
  type ReadinessSummary,
} from "./types";

const BACKUPS_ROOT = "/backups";

async function getReadinessForTarget(
  jobId: string,
  target: BackupTarget,
): Promise<ReadinessSummary> {
  const [job, lastRun, lastSuccess, retainedRuns, recentFailures, lastTrialRestore] =
    await Promise.all([
      prisma.scheduledJob.findUnique({ where: { jobId } }),
      prisma.backupRun.findFirst({
        where: { target },
        orderBy: { startedAt: "desc" },
      }),
      prisma.backupRun.findFirst({
        where: { target, status: "ok", prunedAt: null },
        orderBy: { finishedAt: "desc" },
      }),
      prisma.backupRun.findMany({
        where: { target, status: "ok", prunedAt: null },
        select: { sizeBytes: true },
      }),
      prisma.backupRun.findMany({
        where: { target },
        orderBy: { startedAt: "desc" },
        take: 3,
        select: { status: true },
      }),
      // BI-A8C149C1: surface the most recent trial-restore for this target.
      // The trial restore writes BackupRestore rows with trigger='trial-verification'
      // (BI-31C9FBDF). We join through sourceBackup to scope by target — a
      // trial-restore validates a specific BackupRun, so the target is the
      // sourceBackup's target. Postgres-only today; neo4j+qdrant are slice-2.
      target === "postgres"
        ? prisma.backupRestore.findFirst({
            where: {
              trigger: TRIAL_RESTORE_TRIGGER,
              sourceBackup: { target },
            },
            orderBy: { startedAt: "desc" },
            select: {
              id: true,
              status: true,
              startedAt: true,
              finishedAt: true,
              errorMessage: true,
            },
          })
        : Promise.resolve(null),
    ]);

  const retainedBytes = retainedRuns.reduce(
    (sum, r) => sum + Number(r.sizeBytes ?? BigInt(0)),
    0,
  );

  return {
    target,
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
          trigger: lastRun.trigger as NonNullable<ReadinessSummary["lastRun"]>["trigger"],
        }
      : null,
    lastSuccess: lastSuccess
      ? {
          id: lastSuccess.id,
          finishedAt: lastSuccess.finishedAt?.toISOString() ?? null,
          sizeBytes: lastSuccess.sizeBytes ? Number(lastSuccess.sizeBytes) : null,
          sha256: lastSuccess.sha256,
        }
      : null,
    retention: DEFAULT_BACKUP_RETENTION,
    retainedCount: retainedRuns.length,
    retainedBytes,
    storagePath: `${BACKUPS_ROOT}/${target}/`,
    failuresInLastThreeRuns: recentFailures.filter((r) => r.status === "failed").length,
    trialRestore: lastTrialRestore
      ? {
          lastRunId: lastTrialRestore.id,
          lastStatus: lastTrialRestore.status as "ok" | "failed",
          lastStartedAt: lastTrialRestore.startedAt.toISOString(),
          lastFinishedAt: lastTrialRestore.finishedAt?.toISOString() ?? null,
          lastError: lastTrialRestore.errorMessage,
        }
      : null,
  };
}

export async function getPostgresBackupReadiness(): Promise<ReadinessSummary> {
  return getReadinessForTarget(POSTGRES_BACKUP_JOB_ID, "postgres");
}

export async function getNeo4jBackupReadiness(): Promise<ReadinessSummary> {
  return getReadinessForTarget(NEO4J_BACKUP_JOB_ID, "neo4j");
}

export async function getQdrantBackupReadiness(): Promise<ReadinessSummary> {
  return getReadinessForTarget(QDRANT_BACKUP_JOB_ID, "qdrant");
}

export async function getAllBackupReadiness(): Promise<{
  postgres: ReadinessSummary;
  neo4j: ReadinessSummary;
  qdrant: ReadinessSummary;
}> {
  const [postgres, neo4j, qdrant] = await Promise.all([
    getReadinessForTarget(POSTGRES_BACKUP_JOB_ID, "postgres"),
    getReadinessForTarget(NEO4J_BACKUP_JOB_ID, "neo4j"),
    getReadinessForTarget(QDRANT_BACKUP_JOB_ID, "qdrant"),
  ]);
  return { postgres, neo4j, qdrant };
}
