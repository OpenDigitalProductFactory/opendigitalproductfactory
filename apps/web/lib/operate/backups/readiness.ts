/**
 * Reads the current state of the backup mechanism for the admin readiness card.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.8
 */

import { prisma } from "@dpf/db";

import {
  POSTGRES_BACKUP_JOB_ID,
  TRIAL_RESTORE_TRIGGER,
  UPLOADS_BACKUP_JOB_ID,
} from "./constants";
import {
  DEFAULT_BACKUP_RETENTION,
  type BackupTarget,
  type ReadinessSummary,
} from "./types";
import type { OperationalCapabilityState } from "@/lib/platform-runtime/operational-state";
import { loadOperationalCapabilityState } from "@/lib/platform-runtime/operational-state";
import { listUnfinishedRestoreJournals, type RestoreJournalStage } from "./paired-restore-journal";
import { readUploadsCustody } from "./uploads-custody";

const BACKUPS_ROOT = "/backups";

type BackupOperationalState = Pick<OperationalCapabilityState, "backupServices" | "serviceStates">;
type BackupRunIdentity = { id: string; storagePath: string | null; sha256: string | null };

export type UploadsBackupReadiness = ReadinessSummary & {
  capturePair:
    | { status: "paired"; uploadsRunId: string; postgresRunId: string }
    | { status: "not-captured" | "unverified" };
  pairedRestore:
    | { status: "unfinished"; operations: { operationId: string; stage: RestoreJournalStage }[] }
    | { status: "no-unfinished" | "unreadable" };
};

export interface AllBackupReadiness {
  postgres: ReadinessSummary;
  uploads: UploadsBackupReadiness;
  capabilityOwned: ReturnType<typeof projectCapabilityBackupReadiness>[];
}

export function projectCapabilityBackupReadiness(target: string, state: BackupOperationalState): {
  target: string;
  status: "required" | "optional_inactive" | "optional_degraded";
} {
  if (!state.backupServices.includes(target)) return { target, status: "optional_inactive" };
  return { target, status: state.serviceStates[target] ?? "optional_degraded" };
}

async function getReadinessForTarget(
  jobId: string,
  target: BackupTarget,
): Promise<{ summary: ReadinessSummary; lastSuccess: BackupRunIdentity | null }> {
  const [job, lastRun, lastSuccess, retainedRuns, recentFailures, lastTrialRestore, openCorruptionAlert] =
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
      // sourceBackup's target. Postgres-only (BET-5 retired the other stores).
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
      // BI-EA67A758: open critical alert for a failed trial restore. The runner
      // creates a PlatformNotification on failure and resolves it on success.
      // The readiness card surfaces this as an inline warning banner.
      target === "postgres"
        ? prisma.platformNotification.findFirst({
            where: { category: "backup-trial-restore-failed", subjectId: target, resolvedAt: null },
            orderBy: { createdAt: "desc" },
            select: { id: true, message: true, createdAt: true },
          })
        : Promise.resolve(null),
    ]);

  const retainedBytes = retainedRuns.reduce(
    (sum, r) => sum + Number(r.sizeBytes ?? BigInt(0)),
    0,
  );

  const summary: ReadinessSummary = {
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
    openCorruptionAlert: openCorruptionAlert
      ? {
          id: openCorruptionAlert.id,
          message: openCorruptionAlert.message,
          createdAt: openCorruptionAlert.createdAt.toISOString(),
        }
      : null,
  };
  return { summary, lastSuccess };
}

async function readCapturePair(uploads: BackupRunIdentity | null): Promise<UploadsBackupReadiness["capturePair"]> {
  if (!uploads) return { status: "not-captured" };
  if (!uploads.storagePath || !uploads.sha256) return { status: "unverified" };
  const custody = await readUploadsCustody(BACKUPS_ROOT, uploads.id).catch(() => null);
  if (!custody || custody.runId !== uploads.id || custody.storagePath !== uploads.storagePath
    || custody.archiveSha256 !== uploads.sha256 || custody.pairedPostgresRunId === uploads.id) {
    return { status: "unverified" };
  }
  const postgres = await prisma.backupRun.findUnique({
    where: { id: custody.pairedPostgresRunId },
    select: { id: true, target: true, status: true, prunedAt: true, sha256: true },
  });
  if (!postgres || postgres.id !== custody.pairedPostgresRunId || postgres.target !== "postgres"
    || postgres.status !== "ok" || postgres.prunedAt !== null || postgres.sha256 !== custody.pairedPostgresSha256) {
    return { status: "unverified" };
  }
  // Custody establishes capture membership, not a passing trial or restore authorization.
  return { status: "paired", uploadsRunId: uploads.id, postgresRunId: postgres.id };
}

async function readPairedRestoreState(): Promise<UploadsBackupReadiness["pairedRestore"]> {
  try {
    const unfinished = await listUnfinishedRestoreJournals(BACKUPS_ROOT);
    return unfinished.length
      ? { status: "unfinished", operations: unfinished.map(({ operationId, stage }) => ({ operationId, stage })) }
      : { status: "no-unfinished" };
  } catch {
    // An unreadable receipt must not be shown as proof there is no unfinished restore.
    return { status: "unreadable" };
  }
}

export async function getPostgresBackupReadiness(): Promise<ReadinessSummary> {
  return (await getReadinessForTarget(POSTGRES_BACKUP_JOB_ID, "postgres")).summary;
}

export async function getAllBackupReadiness(): Promise<AllBackupReadiness> {
  const [postgres, upload, pairedRestore, operationalState] = await Promise.all([
    getPostgresBackupReadiness(),
    getReadinessForTarget(UPLOADS_BACKUP_JOB_ID, "uploads"),
    readPairedRestoreState(),
    loadOperationalCapabilityState({ observedProviders: {} }),
  ]);
  return {
    postgres,
    uploads: { ...upload.summary, capturePair: await readCapturePair(upload.lastSuccess), pairedRestore },
    capabilityOwned: operationalState.capabilityBackupCandidates.map((target) =>
      projectCapabilityBackupReadiness(target, operationalState)),
  };
}
