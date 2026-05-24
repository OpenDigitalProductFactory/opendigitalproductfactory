/**
 * TypeScript orchestrator for the Neo4j restore wizard.
 *
 * Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md (Slice 4)
 *
 * Mirrors postgres-restore-runner.ts in structure:
 *   1. Acquire the shared portal-side mutex (one restore at a time, any target).
 *   2. Verify the source dump exists and sha256 matches.
 *   3. Write a Neo4j safety backup (trigger="pre-restore-safety").
 *   4. Spawn scripts/restore-neo4j.sh — stops Neo4j, loads dump, restarts.
 *   5. Record BackupRestore audit row.
 *   6. Release lock in finally.
 *
 * Neo4j is unavailable for ~15–30 s during the stop+load+restart sequence.
 * The restore wizard shows this warning before the operator types RESTORE.
 *
 * Unlike Postgres, Neo4j's database is NOT wiped by the restore — it replaces
 * the graph database in-place via neo4j-admin. So audit rows written to
 * Postgres BEFORE the restore persist normally (no re-insert dance needed).
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
import { runNeo4jBackup } from "./neo4j-backup-runner";

const execFileAsync = promisify(execFile);

const BACKUPS_ROOT = "/backups";
const RESTORE_SCRIPT_PATH = "/workspace/scripts/restore-neo4j.sh";
const RUNNER_TIMEOUT_MS = 10 * 60 * 1000;

export interface Neo4jRestoreArgs {
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
  // CodeQL js/log-injection: parts may contain user-influenced values
  // (restore-job parameters). JSON.stringify each part neutralises CR/LF.
  // eslint-disable-next-line no-console
  console.log("[restore-trace][neo4j] %s",
    parts.map((p) => typeof p === "string" ? JSON.stringify(p) : JSON.stringify(p)).join(" "));
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
    .find((l) => l.includes("[restore-neo4j-trace] failed:"));
  if (traceLine) return traceLine.replace(/^.*\[restore-neo4j-trace\]\s*failed:\s*/, "").trim();
  const lastStderr = outcome.stderr.trim().split("\n").pop()?.trim() ?? "";
  if (lastStderr) return lastStderr.slice(0, 500);
  if (outcome.exitCode !== 0) return `restore script exited ${outcome.exitCode}`;
  return "neo4j restore failed (no diagnostic captured)";
}

export async function runNeo4jRestore(
  args: Neo4jRestoreArgs,
): Promise<{ restoreId: string; status: "ok" | "failed" }> {
  const now = args.now ?? (() => new Date());
  const backupsRoot = args.backupsRoot ?? BACKUPS_ROOT;
  const scriptPath = args.scriptPath ?? RESTORE_SCRIPT_PATH;
  const prisma = args.prismaClient ?? (await import("@dpf/db")).prisma;

  const release = acquireRestoreLock(args.sourceBackupRunId);
  const startedAt = now();
  restoreTraceLog(`acquired lock for source=${args.sourceBackupRunId}`);

  try {
    // 1. Resolve + integrity-check the source dump
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
    if (source.target !== "neo4j") {
      throw new RestoreIntegrityError(`BackupRun target=${source.target}; expected neo4j.`);
    }

    const dumpPath = path.posix.join(backupsRoot, source.storagePath, "neo4j.dump");
    try {
      await fs.access(dumpPath);
    } catch {
      throw new RestoreIntegrityError(`Source dump file is missing at ${dumpPath}.`);
    }
    if (source.sha256) {
      const actual = await fileSha256(dumpPath);
      if (actual !== source.sha256) {
        throw new RestoreIntegrityError(
          `Source dump checksum mismatch — file may be corrupted (expected ${source.sha256}, got ${actual}).`,
        );
      }
    }

    // 2. Pre-restore safety backup
    restoreTraceLog("writing pre-restore safety dump");
    const safetyTake = args.takeSafetyBackup
      ? args.takeSafetyBackup
      : () => runNeo4jBackup({ trigger: "pre-restore-safety", backupsRoot, prismaClient: prisma });
    const safety = await safetyTake();
    if (safety.status !== "ok") {
      throw new RestoreIntegrityError("Pre-restore safety dump failed; aborting restore so current state is not lost.");
    }
    restoreTraceLog(`safety dump ok runId=${safety.runId}`);

    // 3. Run the restore script
    const composeProject = process.env.COMPOSE_PROJECT_NAME ?? "dpf";
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DUMP_PATH: dumpPath,
      DPF_NEO4J_CONTAINER: process.env.DPF_NEO4J_CONTAINER ?? `${composeProject}-neo4j-1`,
      DPF_NEO4J_VOLUME: process.env.DPF_NEO4J_VOLUME ?? `${composeProject}_neo4jdata`,
      DPF_NEO4J_DATABASE: process.env.DPF_NEO4J_DATABASE ?? "neo4j",
      // Forward both env vars for docker-in-docker bind translation; the
      // bash script prefers DPF_BACKUPS_HOST_PATH (sibling-to-install) and
      // falls back to DPF_HOST_INSTALL_PATH/backups for pre-relocation installs.
      DPF_BACKUPS_HOST_PATH: process.env.DPF_BACKUPS_HOST_PATH ?? "",
      DPF_HOST_INSTALL_PATH: process.env.DPF_HOST_INSTALL_PATH ?? "",
    };
    const outcome = await runScript(scriptPath, env);
    const finishedAt = now();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    // 4. Record audit row (Postgres is unaffected, so rows written before the
    //    restore still exist — no re-insert dance needed unlike the Postgres runner).
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
