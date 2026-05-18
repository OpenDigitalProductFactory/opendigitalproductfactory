"use server";

import { promises as fs } from "node:fs";
import path from "node:path";

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { inngest } from "@/lib/queue/inngest-client";

import {
  NEO4J_BACKUP_EVENT,
  POSTGRES_BACKUP_EVENT,
  POSTGRES_BACKUP_JOB_ID,
  QDRANT_BACKUP_EVENT,
} from "@/lib/operate/backups/constants";
import { getAllBackupReadiness, getPostgresBackupReadiness } from "@/lib/operate/backups/readiness";
import type { BackupTarget, ReadinessSummary } from "@/lib/operate/backups/types";

const BACKUPS_ROOT = "/backups";
const MAX_LOG_BYTES = 64 * 1024;

async function requireBackupAdmin(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  // Permission reuse: managing platform-level backups requires the same
  // authority as managing provider connections — superuser or
  // platform-admin role.
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    throw new Error("Unauthorized");
  }
}

/** Returns readiness for a single target (Postgres only — kept for Slice 2 restore compat). */
export async function getBackupReadinessAction(): Promise<ReadinessSummary> {
  await requireBackupAdmin();
  return getPostgresBackupReadiness();
}

/** Returns readiness summaries for all three targets. */
export async function getAllBackupReadinessAction(): Promise<{
  postgres: ReadinessSummary;
  neo4j: ReadinessSummary;
  qdrant: ReadinessSummary;
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

const TARGET_EVENT: Record<BackupTarget, string> = {
  postgres: POSTGRES_BACKUP_EVENT,
  neo4j: NEO4J_BACKUP_EVENT,
  qdrant: QDRANT_BACKUP_EVENT,
};

export async function triggerBackupNowAction(
  target: BackupTarget = "postgres",
): Promise<{ ok: boolean; eventIds?: string[]; error?: string }> {
  await requireBackupAdmin();
  try {
    const result = await inngest.send({
      name: TARGET_EVENT[target],
      data: { trigger: "manual" },
    });
    return { ok: true, eventIds: result.ids };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
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

function nextDailyRunAt(from: Date): Date {
  const next = new Date(from);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(0);
  next.setUTCHours(3);
  if (next <= from) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}
