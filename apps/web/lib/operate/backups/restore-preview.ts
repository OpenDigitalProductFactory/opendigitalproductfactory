/**
 * Voice Slice 2 — restore impact preview.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.6 step 2.
 *
 * Computes the impact preview the wizard renders before the operator types
 * RESTORE. Reads the BackupRun row, verifies the file exists on disk and
 * the sha256 matches what was recorded, and emits a human-friendly summary.
 *
 * Pure as possible: takes the prisma client + the file system as
 * dependencies so the unit tests can stub both.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { prisma as defaultPrisma } from "@dpf/db";

import { type RestoreImpactPreview } from "./restore-types";

const DEFAULT_BACKUPS_ROOT = "/backups";

export interface PreviewArgs {
  sourceBackupRunId: string;
  /** Override the backups root for tests. */
  backupsRoot?: string;
  /** Inject prisma for tests. */
  prismaClient?: typeof defaultPrisma;
  /** Inject clock for deterministic tests. */
  now?: () => Date;
  /** Current DPF version (for cross-version warning). Defaults to process.env.DPF_VERSION. */
  currentDpfVersion?: string | null;
}

/** Stream the file through sha256 to verify integrity. */
async function fileSha256(absolutePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const fileHandle = await fs.open(absolutePath, "r");
  try {
    const stream = fileHandle.createReadStream();
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
  } finally {
    await fileHandle.close();
  }
  return hash.digest("hex");
}

function describeAge(ageMinutes: number): string {
  if (ageMinutes < 1) return "less than a minute ago";
  if (ageMinutes < 60) return `${Math.round(ageMinutes)} minutes ago`;
  if (ageMinutes < 60 * 24) {
    const h = Math.round(ageMinutes / 60);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.round(ageMinutes / (60 * 24));
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export async function buildRestorePreview(
  args: PreviewArgs,
): Promise<RestoreImpactPreview> {
  const prisma = args.prismaClient ?? defaultPrisma;
  const now = (args.now ?? (() => new Date()))();
  const backupsRoot = args.backupsRoot ?? DEFAULT_BACKUPS_ROOT;
  const currentDpfVersion = args.currentDpfVersion ?? process.env.DPF_VERSION ?? null;

  const run = await prisma.backupRun.findUnique({
    where: { id: args.sourceBackupRunId },
  });
  if (!run) {
    throw new Error(`BackupRun ${args.sourceBackupRunId} not found`);
  }
  if (run.status !== "ok") {
    throw new Error(
      `BackupRun ${args.sourceBackupRunId} has status="${run.status}"; only successful backups can be restored.`,
    );
  }
  if (run.prunedAt !== null) {
    throw new Error(
      `BackupRun ${args.sourceBackupRunId} has been pruned by retention; its file is no longer on disk.`,
    );
  }

  const absoluteDir = path.posix.join(backupsRoot, run.storagePath);
  const dumpPath = path.posix.join(absoluteDir, "dpf.dump");

  let fileMissing = false;
  let sha256Mismatch = false;
  try {
    await fs.access(dumpPath);
    if (run.sha256) {
      const actual = await fileSha256(dumpPath);
      if (actual !== run.sha256) {
        sha256Mismatch = true;
      }
    }
  } catch {
    fileMissing = true;
  }

  const ageMs = run.finishedAt
    ? now.getTime() - run.finishedAt.getTime()
    : now.getTime() - run.startedAt.getTime();
  const ageMinutes = Math.max(0, Math.floor(ageMs / 60_000));

  // Cross-version warning. We never block — operators recovering from a wipe
  // sometimes need to restore older dumps. We just surface the difference.
  let versionWarning: string | null = null;
  if (run.dpfVersion && currentDpfVersion && run.dpfVersion !== currentDpfVersion) {
    versionWarning = `Source dump was taken from DPF version ${run.dpfVersion.slice(0, 12)}; the install is currently running ${currentDpfVersion.slice(0, 12)}. Schema or behavior may have diverged.`;
  }

  const impactSummary = fileMissing
    ? "The dump file is missing from disk. Restore is not possible."
    : sha256Mismatch
      ? "The dump file's checksum does not match what was recorded when it was taken. The file may be corrupted. Restore is blocked."
      : `Restoring this backup will replace ALL platform data created since the dump was taken (${describeAge(
          ageMinutes,
        )}). A pre-restore safety dump of the current state will be written first, so a misclick is recoverable.`;

  return {
    sourceBackupRunId: run.id,
    sourceFinishedAt: run.finishedAt?.toISOString() ?? null,
    sourceSizeBytes: run.sizeBytes ? Number(run.sizeBytes) : null,
    sourceSha256: run.sha256,
    sourceAgeMinutes: ageMinutes,
    impactSummary,
    fileMissing,
    sha256Mismatch,
    versionWarning,
  };
}

// Test-only exports
export const __test__ = {
  describeAge,
};
