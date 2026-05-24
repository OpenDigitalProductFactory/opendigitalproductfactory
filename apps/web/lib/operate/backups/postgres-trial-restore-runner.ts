/**
 * Postgres trial-restore verification runner (BI-31C9FBDF).
 *
 * Spawns scripts/postgres-trial-restore.sh against the latest successful
 * Postgres backup. The script creates a temp DB, pg_restores into it,
 * row-count-asserts critical tables, drops the temp DB. We parse the
 * script's "RESULT ok|failed ..." line and write a BackupRestore audit
 * row with trigger=trial-verification.
 *
 * Distinct from postgres-restore-runner.ts: that one performs the real
 * operator-confirmed restore that wipes + replaces the production DB.
 * This one never touches the production DB.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.7
 * BI:   BI-31C9FBDF (EP-DR-HARDENING-2026-05-23)
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  postgresTrialRestoreDurationSeconds,
  postgresTrialRestoreLastSuccessSeconds,
  postgresTrialRestoreRunsTotal,
} from "@/lib/operate/metrics";

import {
  POSTGRES_TRIAL_RESTORE_JOB_ID,
  TRIAL_RESTORE_DEFAULT_ASSERT_TABLES,
  TRIAL_RESTORE_TRIGGER,
} from "./constants";

const execFileAsync = promisify(execFile);

const BACKUPS_ROOT = "/backups";
const TRIAL_RESTORE_SCRIPT_PATH = "/workspace/scripts/postgres-trial-restore.sh";
const RUNNER_TIMEOUT_MS = 10 * 60 * 1000; // 10-minute hard cap

export interface RunPostgresTrialRestoreArgs {
  /** Override the backups root for tests (default: /backups). */
  backupsRoot?: string;
  /** Override the script path for tests. */
  scriptPath?: string;
  /** Override critical-table list (default: BacklogItem, Epic, ModelProvider, User). */
  assertTables?: readonly string[];
  /** Inject prisma for tests. */
  prismaClient?: PrismaLike;
  /** Inject clock for deterministic tests. */
  now?: () => Date;
  /**
   * Inject the script spawner for tests. Default uses execFile against
   * scriptPath; tests pass a stub that returns the desired ScriptOutcome.
   */
  runScript?: (scriptPath: string, env: NodeJS.ProcessEnv) => Promise<ScriptOutcome>;
}

type PrismaLike = typeof import("@dpf/db").prisma;

export interface ScriptOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

function trialTraceLog(...parts: unknown[]) {
  // CodeQL js/log-injection: assertTables / table names could be operator-
  // configured; JSON.stringify each part to neutralize CR/LF.
  // eslint-disable-next-line no-console
  console.log(
    "[trial-restore-trace] %s",
    parts.map((p) => JSON.stringify(p)).join(" "),
  );
}

async function defaultRunScript(
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
    const e = err as { stdout?: string; stderr?: string; code?: number | string; message?: string };
    return {
      ok: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
      exitCode: typeof e.code === "number" ? e.code : -1,
    };
  }
}

/**
 * Parse the "RESULT ok|failed assert_X=N ... duration_ms=M [reason=...]" line
 * the shell script emits on stdout. Returns null if the line is missing or
 * malformed (the runner treats that as failure with a clear error message).
 */
export interface ParsedResult {
  status: "ok" | "failed";
  assertions: Record<string, number>;
  durationMs: number;
  reason: string | null;
}

export function parseResultLine(stdout: string): ParsedResult | null {
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith("RESULT "));
  if (!line) return null;

  // Format: "RESULT ok assert_BacklogItem=550 assert_Epic=62 duration_ms=10000"
  //         "RESULT failed assert_BacklogItem=0 duration_ms=5000 reason=BacklogItem:zero-rows "
  const parts = line.trim().split(/\s+/);
  if (parts.length < 3) return null;
  if (parts[1] !== "ok" && parts[1] !== "failed") return null;

  const result: ParsedResult = {
    status: parts[1],
    assertions: {},
    durationMs: 0,
    reason: null,
  };

  for (const kv of parts.slice(2)) {
    const eq = kv.indexOf("=");
    if (eq === -1) continue;
    const key = kv.slice(0, eq);
    const value = kv.slice(eq + 1);
    if (key === "duration_ms") {
      result.durationMs = parseInt(value, 10) || 0;
    } else if (key === "reason") {
      result.reason = value;
    } else if (key.startsWith("assert_")) {
      const tableName = key.slice("assert_".length);
      result.assertions[tableName] = parseInt(value, 10);
    }
  }
  return result;
}

/**
 * Find the latest successful, non-pruned Postgres BackupRun whose dump file
 * is still readable on disk. Returns null when no such run exists (fresh
 * install pre-first-backup) — the caller skips with a warn-level log.
 */
async function findLatestEligibleBackup(
  prisma: PrismaLike,
  backupsRoot: string,
): Promise<{ runId: string; dumpPath: string } | null> {
  const rows = await prisma.backupRun.findMany({
    where: { target: "postgres", status: "ok", prunedAt: null },
    orderBy: { finishedAt: "desc" },
    take: 5,
    select: { id: true, storagePath: true },
  });
  for (const row of rows) {
    const dumpPath = path.posix.join(backupsRoot, row.storagePath, "dpf.dump");
    try {
      await fs.access(dumpPath);
      return { runId: row.id, dumpPath };
    } catch {
      // Recorded as ok but the file is gone — skip and try the next-newest.
      continue;
    }
  }
  return null;
}

export interface TrialRestoreResult {
  status: "ok" | "failed" | "skipped";
  restoreId: string | null;
  reason?: string;
  assertions?: Record<string, number>;
  durationMs?: number;
}

export async function runPostgresTrialRestore(
  args: RunPostgresTrialRestoreArgs = {},
): Promise<TrialRestoreResult> {
  const now = args.now ?? (() => new Date());
  const startedAt = now();
  const backupsRoot = args.backupsRoot ?? BACKUPS_ROOT;
  const scriptPath = args.scriptPath ?? TRIAL_RESTORE_SCRIPT_PATH;
  const assertTables = args.assertTables ?? TRIAL_RESTORE_DEFAULT_ASSERT_TABLES;
  const runScript = args.runScript ?? defaultRunScript;
  const prisma = args.prismaClient ?? (await import("@dpf/db")).prisma;

  trialTraceLog(`run start job=${POSTGRES_TRIAL_RESTORE_JOB_ID}`);

  // Update the heartbeat row so the readiness card shows last-attempt-at
  // even when we skip (e.g., no eligible backup yet on a fresh install).
  await prisma.scheduledJob
    .update({
      where: { jobId: POSTGRES_TRIAL_RESTORE_JOB_ID },
      data: { lastRunAt: startedAt, lastStatus: "running", lastError: null },
    })
    .catch(() => {});

  const source = await findLatestEligibleBackup(prisma, backupsRoot);
  if (!source) {
    trialTraceLog("skip reason=no eligible backup found");
    await prisma.scheduledJob
      .update({
        where: { jobId: POSTGRES_TRIAL_RESTORE_JOB_ID },
        data: { lastStatus: "skipped", lastError: "no eligible backup" },
      })
      .catch(() => {});
    return { status: "skipped", restoreId: null, reason: "no eligible backup found on disk" };
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DUMP_PATH: source.dumpPath,
    POSTGRES_USER: process.env.POSTGRES_USER ?? "dpf",
    DPF_PRODUCTION_DB_CONTAINER:
      process.env.DPF_PRODUCTION_DB_CONTAINER ?? "dpf-postgres-1",
    ASSERT_TABLES: assertTables.join(","),
  };

  const outcome = await runScript(scriptPath, env);
  const parsed = parseResultLine(outcome.stdout);
  const finishedAt = now();
  const durationMs = parsed?.durationMs ?? finishedAt.getTime() - startedAt.getTime();

  // The script's exit code differentiates: 0 = full ok, 5 = assertion fail,
  // 3/4 = create/restore fail, 6 = ok-but-cleanup-orphan. We treat any
  // non-(0|6) as failed, but trust the parsed result line for the reason
  // when available.
  const cleanupWarn = outcome.exitCode === 6;
  const scriptStatus = outcome.exitCode === 0 || cleanupWarn ? "ok" : "failed";
  const finalStatus: "ok" | "failed" =
    parsed?.status === "failed" || scriptStatus === "failed" ? "failed" : "ok";

  const errorMessage = (() => {
    if (finalStatus === "ok") {
      return cleanupWarn ? "Trial restore succeeded but cleanup left an orphan temp DB." : null;
    }
    if (parsed?.reason) return `Assertion failed: ${parsed.reason}`;
    if (outcome.exitCode === 3) return "CREATE DATABASE failed (dpf role may lack CREATEDB privilege).";
    if (outcome.exitCode === 4) return "pg_restore failed against the trial DB.";
    if (outcome.exitCode === 5) return parsed?.reason ?? "Row-count assertion failed.";
    return `Trial-restore script exited ${outcome.exitCode}. Tail of stderr: ${outcome.stderr.trim().split("\n").slice(-3).join(" / ")}`;
  })();

  const created = await prisma.backupRestore.create({
    data: {
      startedAt,
      finishedAt,
      status: finalStatus,
      sourceBackupRunId: source.runId,
      preRestoreBackupRunId: null, // trial restores never take a safety dump
      initiatedByUserId: null,
      trigger: TRIAL_RESTORE_TRIGGER,
      errorMessage,
    },
    select: { id: true },
  });

  postgresTrialRestoreRunsTotal.inc({ status: finalStatus });
  postgresTrialRestoreDurationSeconds.observe(durationMs / 1000);
  if (finalStatus === "ok") {
    postgresTrialRestoreLastSuccessSeconds.set(Math.floor(finishedAt.getTime() / 1000));
  }

  await prisma.scheduledJob
    .update({
      where: { jobId: POSTGRES_TRIAL_RESTORE_JOB_ID },
      data: {
        lastRunAt: startedAt,
        lastStatus: finalStatus,
        lastError: errorMessage,
      },
    })
    .catch(() => {});

  trialTraceLog(
    `run done status=${finalStatus} restoreId=${created.id} duration_ms=${durationMs}`,
  );

  return {
    status: finalStatus,
    restoreId: created.id,
    durationMs,
    assertions: parsed?.assertions,
    reason: parsed?.reason ?? undefined,
  };
}
