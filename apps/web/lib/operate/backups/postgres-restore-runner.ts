/**
 * Voice Slice 2 — TypeScript orchestrator for the Postgres restore wizard.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.6
 * Plan: docs/superpowers/plans/2026-05-17-postgres-backup-slice-2-restore.md
 *
 * Responsibilities:
 *   1. Acquire the portal-side mutex (single restore at a time).
 *   2. Verify the source dump's sha256 still matches what was recorded —
 *      catches on-disk corruption BEFORE pg_restore touches the live DB.
 *   3. Write a pre-restore safety dump via the Slice 1 runner, labeled
 *      "pre-restore-safety" so the existing retention pruner treats it
 *      identically to other successful backups.
 *   4. Spawn scripts/restore-postgres.sh against the source dump.
 *   5. Record the BackupRestore audit row (sourceBackupRunId +
 *      preRestoreBackupRunId + status + duration).
 *   6. Release the lock in finally.
 *
 * Per the never-ask-user-to-run-commands kernel principle, this is only
 * ever invoked from the admin restore wizard's confirmRestore action with
 * a typed-RESTORE confirmation already verified.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  postgresRestoreRunsTotal,
  postgresRestoreDurationSeconds,
} from "@/lib/operate/metrics";

import { runPostgresBackup } from "./postgres-backup-runner";

const execFileAsync = promisify(execFile);

const BACKUPS_ROOT = "/backups";
const RESTORE_SCRIPT_PATH = "/workspace/scripts/restore-postgres.sh";
const RUNNER_TIMEOUT_MS = 30 * 60 * 1000; // mirror backup runner

/** Module-scoped portal mutex. Single Next.js server = single source of truth. */
let restoreLockHeld = false;
let restoreLockHolder: string | null = null;
let restoreLockAcquiredAt: Date | null = null;

export class RestoreLockedError extends Error {
  constructor(public readonly heldBy: string | null, public readonly since: Date | null) {
    super(
      since
        ? `A restore is already in progress (started ${since.toISOString()}). Wait for it to complete or fail.`
        : "A restore is already in progress.",
    );
    this.name = "RestoreLockedError";
  }
}

export class RestoreIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreIntegrityError";
  }
}

export interface RestoreArgs {
  sourceBackupRunId: string;
  /** User id who clicked confirm. Stored on BackupRestore for audit. */
  initiatedByUserId?: string | null;
  /** Override backups root for tests. */
  backupsRoot?: string;
  /** Override restore script path for tests. */
  scriptPath?: string;
  /** Inject prisma for tests. */
  prismaClient?: PrismaLike;
  /** Inject clock for deterministic tests. */
  now?: () => Date;
  /**
   * Inject a custom safety-backup function for tests. Defaults to the Slice 1
   * runPostgresBackup with trigger="pre-restore-safety".
   */
  takeSafetyBackup?: () => Promise<{ runId: string; status: "ok" | "failed" }>;
}

type PrismaLike = typeof import("@dpf/db").prisma;

function restoreTraceLog(...parts: unknown[]) {
  // eslint-disable-next-line no-console
  console.log("[restore-trace]", ...parts);
}

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

interface ScriptOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runRestoreScript(
  scriptPath: string,
  env: NodeJS.ProcessEnv,
): Promise<ScriptOutcome> {
  try {
    const { stdout, stderr } = await execFileAsync(scriptPath, [], {
      env,
      timeout: RUNNER_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message?: string;
    };
    const exitCode = typeof e.code === "number" ? e.code : -1;
    return {
      ok: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
      exitCode,
    };
  }
}

function summarizeScriptFailure(outcome: ScriptOutcome): string {
  const traceLine = outcome.stderr
    .split("\n")
    .reverse()
    .find((l) => l.includes("[restore-trace] failed:"));
  if (traceLine) {
    return traceLine.replace(/^.*\[restore-trace\]\s*failed:\s*/, "").trim();
  }
  const lastStderr = outcome.stderr.trim().split("\n").pop()?.trim() ?? "";
  if (lastStderr) return lastStderr.slice(0, 500);
  if (outcome.exitCode !== 0) return `restore script exited ${outcome.exitCode}`;
  return "restore failed (no diagnostic captured)";
}

/**
 * Acquire the portal mutex. Throws RestoreLockedError if another restore
 * is already in flight. Returns a release function the caller MUST invoke
 * in `finally`.
 */
function acquireRestoreLock(holder: string): () => void {
  if (restoreLockHeld) {
    throw new RestoreLockedError(restoreLockHolder, restoreLockAcquiredAt);
  }
  restoreLockHeld = true;
  restoreLockHolder = holder;
  restoreLockAcquiredAt = new Date();
  return () => {
    restoreLockHeld = false;
    restoreLockHolder = null;
    restoreLockAcquiredAt = null;
  };
}

/**
 * Inspect the lock state without acquiring. Used by the readiness card +
 * server actions that want to surface "restore in progress" to the operator.
 */
export function isRestoreInFlight(): {
  inFlight: boolean;
  holder: string | null;
  since: Date | null;
} {
  return {
    inFlight: restoreLockHeld,
    holder: restoreLockHolder,
    since: restoreLockAcquiredAt,
  };
}

export async function runPostgresRestore(
  args: RestoreArgs,
): Promise<{ restoreId: string; status: "ok" | "failed" }> {
  const now = args.now ?? (() => new Date());
  const backupsRoot = args.backupsRoot ?? BACKUPS_ROOT;
  const scriptPath = args.scriptPath ?? RESTORE_SCRIPT_PATH;
  const prisma = args.prismaClient ?? (await import("@dpf/db")).prisma;

  const release = acquireRestoreLock(args.sourceBackupRunId);
  const startedAt = now();
  restoreTraceLog(`acquired lock for source=${args.sourceBackupRunId}`);

  try {
    // ── 1. Resolve + integrity-check the source dump ──────────────────────
    const source = await prisma.backupRun.findUnique({
      where: { id: args.sourceBackupRunId },
    });
    if (!source) {
      throw new RestoreIntegrityError(`Source BackupRun ${args.sourceBackupRunId} not found.`);
    }
    if (source.status !== "ok") {
      throw new RestoreIntegrityError(
        `Source BackupRun ${args.sourceBackupRunId} status=${source.status}; only successful backups can be restored.`,
      );
    }
    if (source.prunedAt !== null) {
      throw new RestoreIntegrityError(
        `Source BackupRun ${args.sourceBackupRunId} has been pruned; its file is no longer on disk.`,
      );
    }

    const dumpPath = path.posix.join(backupsRoot, source.storagePath, "dpf.dump");
    try {
      await fs.access(dumpPath);
    } catch {
      throw new RestoreIntegrityError(`Source dump file is missing at ${dumpPath}.`);
    }

    if (source.sha256) {
      const actual = await fileSha256(dumpPath);
      if (actual !== source.sha256) {
        throw new RestoreIntegrityError(
          `Source dump checksum does not match what was recorded when the backup was taken. The file may be corrupted (expected ${source.sha256}, got ${actual}).`,
        );
      }
    }

    // ── 2. Pre-restore safety dump ────────────────────────────────────────
    restoreTraceLog("writing pre-restore safety dump");
    const safetyTake = args.takeSafetyBackup
      ? args.takeSafetyBackup
      : () =>
          runPostgresBackup({
            trigger: "pre-restore-safety",
            backupsRoot,
            prismaClient: prisma,
          });
    const safety = await safetyTake();
    if (safety.status !== "ok") {
      throw new RestoreIntegrityError(
        "Pre-restore safety dump failed; aborting restore so the current state is not lost.",
      );
    }
    restoreTraceLog(`safety dump ok runId=${safety.runId}`);

    // ── 3. Insert the BackupRestore row in "running" state ────────────────
    const created = await prisma.backupRestore.create({
      data: {
        status: "running",
        sourceBackupRunId: source.id,
        preRestoreBackupRunId: safety.runId,
        initiatedByUserId: args.initiatedByUserId ?? null,
      },
      select: { id: true },
    });

    // ── 4. Run the restore script ─────────────────────────────────────────
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DUMP_PATH: dumpPath,
      POSTGRES_USER: process.env.POSTGRES_USER ?? "dpf",
      POSTGRES_DB: process.env.POSTGRES_DB ?? "dpf",
      DPF_PRODUCTION_DB_CONTAINER:
        process.env.DPF_PRODUCTION_DB_CONTAINER ?? "dpf-postgres-1",
    };

    const outcome = await runRestoreScript(scriptPath, env);
    const finishedAt = now();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    if (outcome.ok) {
      await prisma.backupRestore.update({
        where: { id: created.id },
        data: {
          status: "ok",
          finishedAt,
        },
      });
      postgresRestoreRunsTotal.inc({ status: "ok" });
      postgresRestoreDurationSeconds.observe(durationMs / 1000);
      restoreTraceLog(`restore ok id=${created.id} duration_ms=${durationMs}`);
      return { restoreId: created.id, status: "ok" };
    }

    // Failure path — safety dump is still on disk, operator can retry.
    const errorMessage = summarizeScriptFailure(outcome);
    await prisma.backupRestore.update({
      where: { id: created.id },
      data: {
        status: "failed",
        finishedAt,
        errorMessage,
      },
    });
    postgresRestoreRunsTotal.inc({ status: "failed" });
    postgresRestoreDurationSeconds.observe(durationMs / 1000);
    restoreTraceLog(`restore failed id=${created.id} reason=${errorMessage}`);
    return { restoreId: created.id, status: "failed" };
  } finally {
    release();
    restoreTraceLog("released lock");
  }
}

// Test-only exports
export const __test__ = {
  acquireRestoreLock,
  resetLockForTest: () => {
    restoreLockHeld = false;
    restoreLockHolder = null;
    restoreLockAcquiredAt = null;
  },
};
