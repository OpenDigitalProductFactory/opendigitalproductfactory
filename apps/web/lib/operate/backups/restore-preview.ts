/**
 * Restore impact preview — target-aware.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.6 step 2.
 * Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md (Slice 4)
 *
 * Computes the impact preview the wizard renders before the operator types
 * RESTORE. Reads the BackupRun row, resolves the dump filename by target,
 * verifies the file exists and the sha256 matches, and emits a human-friendly
 * summary with any service-specific warnings.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { prisma as defaultPrisma } from "@dpf/db";

import { type RestoreImpactPreview } from "./restore-types";

const DEFAULT_BACKUPS_ROOT = "/backups";

/** Maps BackupTarget to the artifact filename produced by the backup script. */
const DUMP_FILENAME: Record<string, string> = {
  postgres: "dpf.dump",
  neo4j: "neo4j.dump",
  qdrant: "qdrant.snapshot",
};

const SERVICE_WARNINGS: Record<string, string | null> = {
  postgres: null,
  neo4j:
    "Restoring Neo4j stops the graph database container for ~15–30 s while the dump loads. Wiki search, routing, and EA topology will be briefly unavailable.",
  qdrant:
    "Restoring Qdrant replaces all vector collections with the snapshot state. Semantic search and brand context will briefly reflect the snapshot until reindexing completes.",
};

export interface PreviewArgs {
  sourceBackupRunId: string;
  backupsRoot?: string;
  prismaClient?: typeof defaultPrisma;
  now?: () => Date;
  currentDpfVersion?: string | null;
}

async function fileSha256(absolutePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const fileHandle = await fs.open(absolutePath, "r");
  try {
    const stream = fileHandle.createReadStream();
    for await (const chunk of stream) hash.update(chunk as Buffer);
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

function serviceLabel(target: string): string {
  const labels: Record<string, string> = {
    postgres: "Postgres database",
    neo4j: "Neo4j graph database",
    qdrant: "Qdrant vector store",
  };
  return labels[target] ?? target;
}

export async function buildRestorePreview(
  args: PreviewArgs,
): Promise<RestoreImpactPreview> {
  const prisma = args.prismaClient ?? defaultPrisma;
  const now = (args.now ?? (() => new Date()))();
  const backupsRoot = args.backupsRoot ?? DEFAULT_BACKUPS_ROOT;
  const currentDpfVersion = args.currentDpfVersion ?? process.env.DPF_VERSION ?? null;

  const run = await prisma.backupRun.findUnique({ where: { id: args.sourceBackupRunId } });
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

  const dumpFilename = DUMP_FILENAME[run.target] ?? "dpf.dump";
  const absoluteDir = path.posix.join(backupsRoot, run.storagePath);
  const dumpPath = path.posix.join(absoluteDir, dumpFilename);

  let fileMissing = false;
  let sha256Mismatch = false;
  try {
    await fs.access(dumpPath);
    if (run.sha256) {
      const actual = await fileSha256(dumpPath);
      if (actual !== run.sha256) sha256Mismatch = true;
    }
  } catch {
    fileMissing = true;
  }

  const ageMs = run.finishedAt
    ? now.getTime() - run.finishedAt.getTime()
    : now.getTime() - run.startedAt.getTime();
  const ageMinutes = Math.max(0, Math.floor(ageMs / 60_000));

  let versionWarning: string | null = null;
  if (run.dpfVersion && currentDpfVersion && run.dpfVersion !== currentDpfVersion) {
    versionWarning = `Source dump was taken from DPF version ${run.dpfVersion.slice(0, 12)}; the install is currently running ${currentDpfVersion.slice(0, 12)}. Schema or behavior may have diverged.`;
  }

  const label = serviceLabel(run.target);
  const impactSummary = fileMissing
    ? `The ${label} file is missing from disk. Restore is not possible.`
    : sha256Mismatch
      ? `The ${label} file's checksum does not match what was recorded when it was taken. The file may be corrupted. Restore is blocked.`
      : `Restoring this backup will replace the ${label} with data from ${describeAge(
          ageMinutes,
        )}. A pre-restore safety backup of the current state will be written first, so a misclick is recoverable.`;

  return {
    sourceBackupRunId: run.id,
    target: run.target as RestoreImpactPreview["target"],
    sourceFinishedAt: run.finishedAt?.toISOString() ?? null,
    sourceSizeBytes: run.sizeBytes ? Number(run.sizeBytes) : null,
    sourceSha256: run.sha256,
    sourceAgeMinutes: ageMinutes,
    impactSummary,
    fileMissing,
    sha256Mismatch,
    versionWarning,
    serviceWarning: SERVICE_WARNINGS[run.target] ?? null,
  };
}

export const __test__ = { describeAge };
