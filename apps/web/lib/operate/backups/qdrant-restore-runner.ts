/**
 * TypeScript orchestrator for the Qdrant restore wizard.
 *
 * Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md (Slice 4)
 *
 * Uses the Qdrant REST snapshot API for an online restore:
 *   1. Acquire the shared portal-side mutex.
 *   2. Verify the source snapshot file exists and sha256 matches.
 *   3. Write a Qdrant safety backup (trigger="pre-restore-safety").
 *   4. Spawn scripts/restore-qdrant.sh — POST /snapshots/upload?wait=true.
 *      Qdrant replaces all collections from the full-instance snapshot.
 *      No service interruption required.
 *   5. Record BackupRestore audit row.
 *   6. Release lock in finally.
 *
 * The Qdrant REST API (qdrant/qdrant:latest) accepts POST /snapshots/upload
 * with a multipart snapshot file and recovers all collections inline.
 * Postgres is unaffected, so audit rows persist normally.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  acquireRestoreLock,
  RestoreLockedError,
  RestoreIntegrityError,
} from "./postgres-restore-runner";
import { runQdrantBackup } from "./qdrant-backup-runner";

const execFileAsync = promisify(execFile);

const BACKUPS_ROOT = "/backups";
const RESTORE_SCRIPT_PATH = "/workspace/scripts/restore-qdrant.sh";
const RUNNER_TIMEOUT_MS = 30 * 60 * 1000;

export interface QdrantRestoreArgs {
  sourceBackupRunId: string;
  initiatedByUserId?: string | null;
  backupsRoot?: string;
  scriptPath?: string;
  prismaClient?: PrismaLike;
  now?: () => Date;
  takeSafetyBackup?: () => Promise<{ runId: string; status: "ok" | "failed" }>;
}

type PrismaLike = typeof import("@dpf/db").prisma;

interface ScriptOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

function restoreTraceLog(...parts: unknown[]) {
  // eslint-disable-next-line no-console
  console.log("[restore-trace][qdrant]", ...parts);
}

async function fileSha256(absolutePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  const fh = await fs.open(absolutePath, "r");
  try {
    const stream = fh.createReadStream();
    for await (const chunk of stream) hash.update(chunk as Buffer);
  } finally {
    await fh.close();
  }
  return hash.digest("hex");
}

async function runScript(scriptPath: string, env: NodeJS.ProcessEnv): Promise<ScriptOutcome> {
  try {
    const { stdout, stderr } = await execFileAsync(scriptPath, [], {
      env,
      timeout: RUNNER_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string; message?: string };
    return {
      ok: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
      exitCode: typeof e.code === "number" ? e.code : -1,
    };
  }
}

function summarizeFailure(outcome: ScriptOutcome): string {
  const traceLine = outcome.stderr
    .split("\n")
    .reverse()
    .find((l) => l.includes("[restore-qdrant-trace] failed:"));
  if (traceLine) return traceLine.replace(/^.*\[restore-qdrant-trace\]\s*failed:\s*/, "").trim();
  const lastStderr = outcome.stderr.trim().split("\n").pop()?.trim() ?? "";
  if (lastStderr) return lastStderr.slice(0, 500);
  if (outcome.exitCode !== 0) return `restore script exited ${outcome.exitCode}`;
  return "qdrant restore failed (no diagnostic captured)";
}

export async function runQdrantRestore(
  args: QdrantRestoreArgs,
): Promise<{ restoreId: string; status: "ok" | "failed" }> {
  const now = args.now ?? (() => new Date());
  const backupsRoot = args.backupsRoot ?? BACKUPS_ROOT;
  const scriptPath = args.scriptPath ?? RESTORE_SCRIPT_PATH;
  const prisma = args.prismaClient ?? (await import("@dpf/db")).prisma;

  const release = acquireRestoreLock(args.sourceBackupRunId);
  const startedAt = now();
  restoreTraceLog(`acquired lock for source=${args.sourceBackupRunId}`);

  try {
    // 1. Resolve + integrity-check the source snapshot
    const source = await prisma.backupRun.findUnique({ where: { id: args.sourceBackupRunId } });
    if (!source) {
      throw new RestoreIntegrityError(`Source BackupRun ${args.sourceBackupRunId} not found.`);
    }
    if (source.status !== "ok") {
      throw new RestoreIntegrityError(`Source BackupRun status=${source.status}; only successful backups can be restored.`);
    }
    if (source.prunedAt !== null) {
      throw new RestoreIntegrityError(`Source BackupRun ${args.sourceBackupRunId} has been pruned; file is gone.`);
    }
    if (source.target !== "qdrant") {
      throw new RestoreIntegrityError(`BackupRun target=${source.target}; expected qdrant.`);
    }

    const snapshotPath = path.posix.join(backupsRoot, source.storagePath, "qdrant.snapshot");
    try {
      await fs.access(snapshotPath);
    } catch {
      throw new RestoreIntegrityError(`Source snapshot file is missing at ${snapshotPath}.`);
    }
    if (source.sha256) {
      const actual = await fileSha256(snapshotPath);
      if (actual !== source.sha256) {
        throw new RestoreIntegrityError(
          `Source snapshot checksum mismatch — file may be corrupted (expected ${source.sha256}, got ${actual}).`,
        );
      }
    }

    // 2. Pre-restore safety backup
    restoreTraceLog("writing pre-restore safety snapshot");
    const safetyTake = args.takeSafetyBackup
      ? args.takeSafetyBackup
      : () => runQdrantBackup({ trigger: "pre-restore-safety", backupsRoot, prismaClient: prisma });
    const safety = await safetyTake();
    if (safety.status !== "ok") {
      throw new RestoreIntegrityError("Pre-restore safety snapshot failed; aborting restore.");
    }
    restoreTraceLog(`safety snapshot ok runId=${safety.runId}`);

    // 3. Run the restore script (POST /snapshots/upload?wait=true)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DUMP_PATH: snapshotPath,
      DPF_QDRANT_URL: process.env.DPF_QDRANT_URL ?? "http://qdrant:6333",
    };
    const outcome = await runScript(scriptPath, env);
    const finishedAt = now();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    // 4. Record audit row (Postgres unaffected — no re-insert dance needed)
    const created = await prisma.backupRestore.create({
      data: {
        startedAt,
        finishedAt,
        status: outcome.ok ? "ok" : "failed",
        sourceBackupRunId: source.id,
        preRestoreBackupRunId: safety.runId,
        initiatedByUserId: args.initiatedByUserId ?? null,
        errorMessage: outcome.ok ? null : summarizeFailure(outcome),
      },
      select: { id: true },
    });

    if (outcome.ok) {
      restoreTraceLog(`restore ok id=${created.id} duration_ms=${durationMs}`);
      return { restoreId: created.id, status: "ok" };
    }
    restoreTraceLog(`restore failed id=${created.id} reason=${summarizeFailure(outcome)}`);
    return { restoreId: created.id, status: "failed" };
  } finally {
    release();
    restoreTraceLog("released lock");
  }
}

export { RestoreLockedError, RestoreIntegrityError };
