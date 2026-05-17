/**
 * TypeScript orchestrator for the Postgres daily backup.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §6 Slice 1
 * Plan: docs/superpowers/plans/2026-05-17-postgres-daily-backup-slice-1.md
 *
 * Responsibilities:
 *   1. Allocate a per-run target directory under /backups/postgres/<ISO-ts>.
 *   2. Spawn scripts/backup-postgres.sh, which exec's pg_dump into the
 *      postgres container and writes dpf.dump + sha256 + manifest + log.
 *   3. Read back the manifest, insert a BackupRun row (status ok/failed).
 *   4. Update the ScheduledJob heartbeat (jobId: "postgres-daily-backup").
 *   5. Apply GFS retention — delete file directories for runs the policy
 *      no longer keeps and mark them prunedAt.
 *   6. Emit [backup-trace] logs and Prometheus metrics.
 *
 * Per the never-ask-user-to-run-commands kernel principle, the operator
 * never sees any of the shell commands here. Failure is reported through
 * BackupRun.errorMessage and rendered as a human-readable readiness banner.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  postgresBackupDurationSeconds,
  postgresBackupLastSuccessSeconds,
  postgresBackupRunsTotal,
  postgresBackupStorageBytes,
} from "@/lib/operate/metrics";

import { POSTGRES_BACKUP_JOB_ID, POSTGRES_BACKUP_SCHEDULE } from "./constants";
import { partitionForRetention } from "./retention";
import {
  DEFAULT_BACKUP_RETENTION,
  type BackupManifest,
  type BackupRetentionPolicy,
  type BackupTrigger,
} from "./types";

const execFileAsync = promisify(execFile);

const BACKUPS_ROOT = "/backups";
const POSTGRES_SUBDIR = "postgres";
const SCRIPT_PATH = "/workspace/scripts/backup-postgres.sh";
const RUNNER_TIMEOUT_MS = 30 * 60 * 1000; // 30-minute hard cap

export interface RunBackupArgs {
  trigger: BackupTrigger;
  /**
   * Compose project name. Used to derive the postgres container name
   * (`<project>-postgres-1`) so worktree-isolated stacks back themselves up
   * independently. Defaults to "dpf".
   */
  composeProject?: string;
  /** Override the GFS retention policy for tests / future config slider. */
  retention?: BackupRetentionPolicy;
  /** Override the backup root for tests. */
  backupsRoot?: string;
  /** Override script path for tests. */
  scriptPath?: string;
  /** Inject the prisma client (for testing without a live DB). */
  prismaClient?: PrismaLike;
  /** Inject a clock for deterministic testing. */
  now?: () => Date;
}

type PrismaLike = typeof import("@dpf/db").prisma;

interface ScriptOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

function backupTraceLog(...parts: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(`[backup-trace]`, ...parts);
}

function isoTsForDirectory(d: Date): string {
  // 2026-05-17T03-00-00Z — colons replaced with hyphens for cross-fs safety.
  return d.toISOString().replace(/:/g, "-").replace(/\.\d+/, "");
}

async function runScript(
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
      signal?: string;
      message?: string;
    };
    const exitCode =
      typeof e.code === "number" ? e.code : e.code === undefined ? -1 : -1;
    return {
      ok: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
      exitCode,
    };
  }
}

async function readManifest(targetDir: string): Promise<BackupManifest | null> {
  try {
    const raw = await fs.readFile(path.join(targetDir, "manifest.json"), "utf-8");
    return JSON.parse(raw) as BackupManifest;
  } catch {
    return null;
  }
}

async function pruneTargetDir(targetDir: string): Promise<void> {
  try {
    await fs.rm(targetDir, { recursive: true, force: true });
  } catch (err) {
    backupTraceLog("retention: could not delete", targetDir, err);
  }
}

async function computeRetainedStorageBytes(
  prisma: PrismaLike,
): Promise<number> {
  const rows = await prisma.backupRun.findMany({
    where: { status: "ok", prunedAt: null, target: "postgres" },
    select: { sizeBytes: true },
  });
  return rows.reduce(
    (sum, r) => sum + Number(r.sizeBytes ?? BigInt(0)),
    0,
  );
}

/**
 * Compute the next 03:00 UTC strictly after `from`. Mirrors the seed helper
 * so heartbeat math is consistent at every layer.
 */
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

/**
 * Main entrypoint. Idempotent in the sense that each call produces a new
 * BackupRun row regardless of outcome; concurrent invocations are kept to one
 * at a time by the Inngest function's `concurrency: { limit: 1 }`.
 */
export async function runPostgresBackup(
  args: RunBackupArgs,
): Promise<{ runId: string; status: "ok" | "failed" }> {
  const now = args.now ?? (() => new Date());
  const startedAt = now();
  const trigger = args.trigger;
  const retention = args.retention ?? DEFAULT_BACKUP_RETENTION;
  const backupsRoot = args.backupsRoot ?? BACKUPS_ROOT;
  const scriptPath = args.scriptPath ?? SCRIPT_PATH;
  const composeProject = args.composeProject ?? process.env.COMPOSE_PROJECT_NAME ?? "dpf";
  const containerName =
    process.env.DPF_PRODUCTION_DB_CONTAINER ?? `${composeProject}-postgres-1`;

  // Use the in-process Prisma client unless the caller injected a stub.
  const prisma =
    args.prismaClient ?? (await import("@dpf/db")).prisma;

  const tsKey = isoTsForDirectory(startedAt);
  const relativePath = `${POSTGRES_SUBDIR}/${tsKey}`;
  const absoluteTargetDir = path.posix.join(backupsRoot, relativePath);

  backupTraceLog(`run start trigger=${trigger} target=${absoluteTargetDir}`);

  // Create the BackupRun row up front in `running` state so the readiness
  // card surfaces an in-progress dump immediately. The runner has a hard
  // timeout so this can't sit `running` forever.
  const created = await prisma.backupRun.create({
    data: {
      target: "postgres",
      status: "running",
      trigger,
      schedule: trigger === "scheduled" ? POSTGRES_BACKUP_SCHEDULE : null,
      storagePath: relativePath,
      dpfVersion: process.env.DPF_VERSION ?? null,
    },
    select: { id: true },
  });

  await prisma.scheduledJob
    .update({
      where: { jobId: POSTGRES_BACKUP_JOB_ID },
      data: {
        lastRunAt: startedAt,
        lastStatus: "running",
        lastError: null,
      },
    })
    .catch(() => {
      // Heartbeat row not present (fresh install before seed ran). Caller's
      // seed will create it; we don't fail the run on a missing heartbeat row.
    });

  // Ensure the parent /backups/postgres directory exists. The target itself
  // is created by the shell script.
  await fs.mkdir(path.posix.join(backupsRoot, POSTGRES_SUBDIR), {
    recursive: true,
  });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TARGET_DIR: absoluteTargetDir,
    DPF_PRODUCTION_DB_CONTAINER: containerName,
    POSTGRES_USER: process.env.POSTGRES_USER ?? "dpf",
    POSTGRES_DB: process.env.POSTGRES_DB ?? "dpf",
  };

  const outcome = await runScript(scriptPath, env);
  const manifest = outcome.ok ? await readManifest(absoluteTargetDir) : null;
  const finishedAt = now();
  const durationMs = finishedAt.getTime() - startedAt.getTime();

  if (outcome.ok && manifest) {
    await prisma.backupRun.update({
      where: { id: created.id },
      data: {
        status: "ok",
        finishedAt,
        sizeBytes: BigInt(manifest.sizeBytes),
        durationMs,
        sha256: manifest.sha256,
        pgVersion: manifest.pgVersion,
      },
    });

    await prisma.scheduledJob
      .update({
        where: { jobId: POSTGRES_BACKUP_JOB_ID },
        data: {
          lastRunAt: startedAt,
          lastStatus: "ok",
          lastError: null,
          nextRunAt: nextDailyRunAt(finishedAt),
        },
      })
      .catch(() => {});

    postgresBackupRunsTotal.inc({ status: "ok", trigger });
    postgresBackupDurationSeconds.observe({ trigger }, durationMs / 1000);
    postgresBackupLastSuccessSeconds.set(Math.floor(finishedAt.getTime() / 1000));

    await applyRetention(prisma, retention, backupsRoot);

    const retainedBytes = await computeRetainedStorageBytes(prisma);
    postgresBackupStorageBytes.set(retainedBytes);

    backupTraceLog(
      `run ok id=${created.id} size=${manifest.sizeBytes} duration_ms=${durationMs}`,
    );
    return { runId: created.id, status: "ok" };
  }

  // Failure path. Capture as much diagnostic detail as we can without
  // surfacing CLI bits to the operator.
  const errorSummary = summarizeFailure(outcome);
  await prisma.backupRun.update({
    where: { id: created.id },
    data: {
      status: "failed",
      finishedAt,
      durationMs,
      errorMessage: errorSummary,
    },
  });

  await prisma.scheduledJob
    .update({
      where: { jobId: POSTGRES_BACKUP_JOB_ID },
      data: {
        lastRunAt: startedAt,
        lastStatus: "failed",
        lastError: errorSummary,
        nextRunAt: nextDailyRunAt(finishedAt),
      },
    })
    .catch(() => {});

  postgresBackupRunsTotal.inc({ status: "failed", trigger });
  postgresBackupDurationSeconds.observe({ trigger }, durationMs / 1000);

  backupTraceLog(`run failed id=${created.id} reason=${errorSummary}`);
  return { runId: created.id, status: "failed" };
}

function summarizeFailure(outcome: ScriptOutcome): string {
  // Prefer the structured [backup-trace] failure line from the shell script
  // because it's human-curated; fall back to the last stderr line.
  const traceLine = outcome.stderr
    .split("\n")
    .reverse()
    .find((line) => line.includes("[backup-trace] failed:"));
  if (traceLine) {
    return traceLine.replace(/^.*\[backup-trace\]\s*failed:\s*/, "").trim();
  }
  const lastStderr = outcome.stderr.trim().split("\n").pop()?.trim() ?? "";
  if (lastStderr) return lastStderr.slice(0, 500);
  if (outcome.exitCode !== 0) return `runner exited ${outcome.exitCode}`;
  return "backup failed (no diagnostic captured)";
}

async function applyRetention(
  prisma: PrismaLike,
  policy: BackupRetentionPolicy,
  backupsRoot: string,
): Promise<void> {
  const runs = await prisma.backupRun.findMany({
    where: { target: "postgres" },
    orderBy: { startedAt: "desc" },
  });

  const partition = partitionForRetention(
    runs.map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      prunedAt: r.prunedAt,
    })),
    policy,
  );

  // Only the runs that were eligible (ok + not-yet-pruned) but didn't make
  // the keep set need filesystem deletion. Failed/already-pruned go through
  // a metadata-only sweep (just to flip prunedAt for failed runs whose files
  // we never wrote, so the UI can hide them).
  const eligibleToPrune = partition.prune.filter(
    (r) => r.status === "ok" && r.prunedAt === null,
  );
  const failedSweep = partition.prune.filter(
    (r) => r.status === "failed" && r.prunedAt === null,
  );

  for (const run of eligibleToPrune) {
    const dbRow = runs.find((r) => r.id === run.id);
    if (!dbRow) continue;
    const absolute = path.posix.join(backupsRoot, dbRow.storagePath);
    await pruneTargetDir(absolute);
  }

  if (eligibleToPrune.length > 0) {
    await prisma.backupRun.updateMany({
      where: { id: { in: eligibleToPrune.map((r) => r.id) } },
      data: { prunedAt: new Date() },
    });
  }
  if (failedSweep.length > 0) {
    await prisma.backupRun.updateMany({
      where: { id: { in: failedSweep.map((r) => r.id) } },
      data: { prunedAt: new Date() },
    });
  }

  backupTraceLog(
    `retention applied kept=${partition.keep.length} pruned=${eligibleToPrune.length} failed_swept=${failedSweep.length}`,
  );
}
