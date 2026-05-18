/**
 * TypeScript orchestrator for the Qdrant daily backup.
 *
 * Spec: docs/superpowers/specs/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md
 * Plan: docs/superpowers/plans/2026-05-18-postgres-backup-slice-3-neo4j-qdrant.md
 *
 * Responsibilities:
 *   1. Allocate a per-run target directory under /backups/qdrant/<ISO-ts>.
 *   2. Spawn scripts/backup-qdrant.sh, which hits the Qdrant REST API to
 *      create a full-instance snapshot, downloads it, deletes the in-Qdrant
 *      copy, and writes qdrant.snapshot + sha256 + manifest + log.
 *   3. Read back the manifest, insert a BackupRun row (status ok/failed).
 *   4. Update the ScheduledJob heartbeat (jobId: "qdrant-daily-backup").
 *   5. Apply GFS retention.
 *   6. Emit [backup-trace] logs and Prometheus metrics.
 *
 * Qdrant backup is fully online — no service interruption required.
 *
 * Per the never-ask-user-to-run-commands kernel principle, the operator
 * never sees any of the shell commands here.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  qdrantBackupDurationSeconds,
  qdrantBackupLastSuccessSeconds,
  qdrantBackupRunsTotal,
  qdrantBackupStorageBytes,
} from "@/lib/operate/metrics";

import { QDRANT_BACKUP_JOB_ID, QDRANT_BACKUP_SCHEDULE } from "./constants";
import { partitionForRetention } from "./retention";
import {
  DEFAULT_BACKUP_RETENTION,
  type QdrantBackupManifest,
  type BackupRetentionPolicy,
  type BackupTrigger,
} from "./types";

const execFileAsync = promisify(execFile);

const BACKUPS_ROOT = "/backups";
const QDRANT_SUBDIR = "qdrant";
const SCRIPT_PATH = "/workspace/scripts/backup-qdrant.sh";
const RUNNER_TIMEOUT_MS = 30 * 60 * 1000; // 30-minute hard cap

export interface RunQdrantBackupArgs {
  trigger: BackupTrigger;
  retention?: BackupRetentionPolicy;
  backupsRoot?: string;
  scriptPath?: string;
  prismaClient?: PrismaLike;
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
  console.log(`[backup-trace][qdrant]`, ...parts);
}

function isoTsForDirectory(d: Date): string {
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

async function readManifest(targetDir: string): Promise<QdrantBackupManifest | null> {
  try {
    const raw = await fs.readFile(path.posix.join(targetDir, "manifest.json"), "utf-8");
    return JSON.parse(raw) as QdrantBackupManifest;
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

async function computeRetainedStorageBytes(prisma: PrismaLike): Promise<number> {
  const rows = await prisma.backupRun.findMany({
    where: { status: "ok", prunedAt: null, target: QDRANT_SUBDIR },
    select: { sizeBytes: true },
  });
  return rows.reduce((sum, r) => sum + Number(r.sizeBytes ?? BigInt(0)), 0);
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

export async function runQdrantBackup(
  args: RunQdrantBackupArgs,
): Promise<{ runId: string; status: "ok" | "failed" }> {
  const now = args.now ?? (() => new Date());
  const startedAt = now();
  const trigger = args.trigger;
  const retention = args.retention ?? DEFAULT_BACKUP_RETENTION;
  const backupsRoot = args.backupsRoot ?? BACKUPS_ROOT;
  const scriptPath = args.scriptPath ?? SCRIPT_PATH;

  const prisma = args.prismaClient ?? (await import("@dpf/db")).prisma;

  const tsKey = isoTsForDirectory(startedAt);
  const relativePath = `${QDRANT_SUBDIR}/${tsKey}`;
  const absoluteTargetDir = path.posix.join(backupsRoot, relativePath);

  backupTraceLog(`run start trigger=${trigger} target=${absoluteTargetDir}`);

  const created = await prisma.backupRun.create({
    data: {
      target: "qdrant",
      status: "running",
      trigger,
      schedule: trigger === "scheduled" ? QDRANT_BACKUP_SCHEDULE : null,
      storagePath: relativePath,
      dpfVersion: process.env.DPF_VERSION ?? null,
    },
    select: { id: true },
  });

  await prisma.scheduledJob
    .update({
      where: { jobId: QDRANT_BACKUP_JOB_ID },
      data: { lastRunAt: startedAt, lastStatus: "running", lastError: null },
    })
    .catch(() => {});

  await fs.mkdir(path.posix.join(backupsRoot, QDRANT_SUBDIR), { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TARGET_DIR: absoluteTargetDir,
    DPF_QDRANT_URL: process.env.DPF_QDRANT_URL ?? "http://qdrant:6333",
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
      },
    });

    await prisma.scheduledJob
      .update({
        where: { jobId: QDRANT_BACKUP_JOB_ID },
        data: {
          lastRunAt: startedAt,
          lastStatus: "ok",
          lastError: null,
          nextRunAt: nextDailyRunAt(finishedAt),
        },
      })
      .catch(() => {});

    qdrantBackupRunsTotal.inc({ status: "ok", trigger });
    qdrantBackupDurationSeconds.observe({ trigger }, durationMs / 1000);
    qdrantBackupLastSuccessSeconds.set(Math.floor(finishedAt.getTime() / 1000));

    await applyRetention(prisma, retention, backupsRoot);

    const retainedBytes = await computeRetainedStorageBytes(prisma);
    qdrantBackupStorageBytes.set(retainedBytes);

    backupTraceLog(
      `run ok id=${created.id} size=${manifest.sizeBytes} duration_ms=${durationMs}`,
    );
    return { runId: created.id, status: "ok" };
  }

  const errorSummary = summarizeFailure(outcome);
  await prisma.backupRun.update({
    where: { id: created.id },
    data: { status: "failed", finishedAt, durationMs, errorMessage: errorSummary },
  });

  await prisma.scheduledJob
    .update({
      where: { jobId: QDRANT_BACKUP_JOB_ID },
      data: {
        lastRunAt: startedAt,
        lastStatus: "failed",
        lastError: errorSummary,
        nextRunAt: nextDailyRunAt(finishedAt),
      },
    })
    .catch(() => {});

  qdrantBackupRunsTotal.inc({ status: "failed", trigger });
  qdrantBackupDurationSeconds.observe({ trigger }, durationMs / 1000);

  backupTraceLog(`run failed id=${created.id} reason=${errorSummary}`);
  return { runId: created.id, status: "failed" };
}

function summarizeFailure(outcome: ScriptOutcome): string {
  const traceLine = outcome.stderr
    .split("\n")
    .reverse()
    .find((line) => line.includes("[backup-qdrant-trace] failed:"));
  if (traceLine) {
    return traceLine.replace(/^.*\[backup-qdrant-trace\]\s*failed:\s*/, "").trim();
  }
  const lastStderr = outcome.stderr.trim().split("\n").pop()?.trim() ?? "";
  if (lastStderr) return lastStderr.slice(0, 500);
  if (outcome.exitCode !== 0) return `runner exited ${outcome.exitCode}`;
  return "qdrant backup failed (no diagnostic captured)";
}

async function applyRetention(
  prisma: PrismaLike,
  policy: BackupRetentionPolicy,
  backupsRoot: string,
): Promise<void> {
  const runs = await prisma.backupRun.findMany({
    where: { target: "qdrant" },
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
