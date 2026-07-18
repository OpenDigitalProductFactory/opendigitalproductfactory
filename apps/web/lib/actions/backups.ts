"use server";

import { promises as fs } from "node:fs";
import path from "node:path";

import { prisma } from "@dpf/db";

import { requireCapability } from "@/lib/actions/shared/guards";
import { inngest } from "@/lib/queue/inngest-client";

import {
  POSTGRES_BACKUP_EVENT,
  POSTGRES_BACKUP_JOB_ID,
} from "@/lib/operate/backups/constants";
import { getAllBackupReadiness, getPostgresBackupReadiness } from "@/lib/operate/backups/readiness";
import { nextDailyRunAt } from "@/lib/operate/backups/managed-backup";
import type { BackupTarget, ReadinessSummary } from "@/lib/operate/backups/types";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const BACKUPS_ROOT = "/backups";
const MAX_LOG_BYTES = 64 * 1024;

async function requireBackupAdmin(): Promise<void> {
  await requireCapability("manage_provider_connections");
}

/** Returns readiness for a single target (Postgres only — kept for Slice 2 restore compat). */
export async function getBackupReadinessAction(): Promise<ReadinessSummary> {
  await requireBackupAdmin();
  return getPostgresBackupReadiness();
}

/** Returns backup readiness (postgres-only after BET-5). */
export async function getAllBackupReadinessAction(): Promise<{
  postgres: ReadinessSummary;
  capabilityOwned: Array<{ target: string; status: "required" | "optional_inactive" | "optional_degraded" }>;
}> {
  await requireBackupAdmin();
  return getAllBackupReadiness();
}

export interface BackupRunListItem {
  id: string;
  target: string;
  status: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  sha256: string | null;
  prunedAt: string | null;
  errorMessage: string | null;
}

export async function listBackupRunsAction(args?: {
  limit?: number;
  target?: BackupTarget;
}): Promise<BackupRunListItem[]> {
  await requireBackupAdmin();
  const rows = await prisma.backupRun.findMany({
    where: args?.target ? { target: args.target } : { target: "postgres" },
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(args?.limit ?? 50, 1), 200),
  });
  return rows.map((r) => ({
    id: r.id,
    target: r.target,
    status: r.status,
    trigger: r.trigger,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    sizeBytes: r.sizeBytes ? Number(r.sizeBytes) : null,
    durationMs: r.durationMs ?? null,
    sha256: r.sha256,
    prunedAt: r.prunedAt?.toISOString() ?? null,
    errorMessage: r.errorMessage,
  }));
}

// postgres-only after BET-5 retired the neo4j + qdrant backup triggers.
const TARGET_EVENT: Partial<Record<BackupTarget, string>> = {
  postgres: POSTGRES_BACKUP_EVENT,
};

export async function triggerBackupNowAction(
  target: BackupTarget = "postgres",
): Promise<{ ok: boolean; eventIds?: string[]; error?: string }> {
  await requireBackupAdmin();
  const eventName = TARGET_EVENT[target];
  if (!eventName) {
    return {
      ok: false,
      error: `Backups are postgres-only after BET-5 (got target=${target}).`,
    };
  }
  try {
    const result = await inngest.send({
      name: eventName,
      data: { trigger: "manual" },
    });
    return { ok: true, eventIds: result.ids };
  } catch (err: unknown) {
    const message = getErrorMessage(err);
    return { ok: false, error: message };
  }
}

/**
 * BI-A8C149C1: admin "Verify last backup" button — fires the trial-restore
 * manual-trigger event so an operator can prove the most recent Postgres
 * backup is restorable without waiting for the nightly cron. Postgres-only
 * in slice 1 (BI-31C9FBDF). Future BIs add Neo4j + Qdrant variants.
 */
export async function triggerTrialRestoreNowAction(
  target: BackupTarget = "postgres",
): Promise<{ ok: boolean; eventIds?: string[]; error?: string }> {
  await requireBackupAdmin();
  if (target !== "postgres") {
    return {
      ok: false,
      error: `Trial-restore verification is currently postgres-only (got target=${target}). Neo4j + Qdrant variants are tracked as follow-up BIs.`,
    };
  }
  const { POSTGRES_TRIAL_RESTORE_EVENT } = await import(
    "@/lib/operate/backups/constants"
  );
  try {
    const result = await inngest.send({
      name: POSTGRES_TRIAL_RESTORE_EVENT,
      data: { trigger: "manual" },
    });
    return { ok: true, eventIds: result.ids };
  } catch (err: unknown) {
    const message = getErrorMessage(err);
    return { ok: false, error: message };
  }
}

export interface BackupRunLog {
  manifest: unknown | null;
  logTail: string | null;
  notFound: boolean;
}

export async function readBackupRunLogAction(runId: string): Promise<BackupRunLog> {
  await requireBackupAdmin();
  const row = await prisma.backupRun.findUnique({
    where: { id: runId },
    select: { storagePath: true, prunedAt: true },
  });
  if (!row) {
    return { manifest: null, logTail: null, notFound: true };
  }
  if (row.prunedAt) {
    return { manifest: null, logTail: null, notFound: false };
  }

  const absoluteDir = path.posix.join(BACKUPS_ROOT, row.storagePath);
  const manifestPath = path.posix.join(absoluteDir, "manifest.json");
  const logPath = path.posix.join(absoluteDir, "log.txt");

  const [manifest, logTail] = await Promise.all([
    fs
      .readFile(manifestPath, "utf-8")
      .then((raw) => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })
      .catch(() => null),
    fs
      .readFile(logPath, "utf-8")
      .then((raw) =>
        raw.length > MAX_LOG_BYTES ? raw.slice(-MAX_LOG_BYTES) : raw,
      )
      .catch(() => null),
  ]);

  return { manifest, logTail, notFound: false };
}

export async function refreshBackupScheduleHeartbeatAction(): Promise<void> {
  await requireBackupAdmin();
  await prisma.scheduledJob.upsert({
    where: { jobId: POSTGRES_BACKUP_JOB_ID },
    create: {
      jobId: POSTGRES_BACKUP_JOB_ID,
      name: "Postgres daily backup (platform-managed)",
      schedule: "daily",
      nextRunAt: nextDailyRunAt(new Date()),
    },
    update: {},
  });
}
