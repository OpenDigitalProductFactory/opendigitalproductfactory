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
import { recordJobHeartbeat } from "./managed-backup";
import { resolveManagedScriptPath, runManagedScript } from "./managed-script-path";

const BACKUPS_ROOT = "/backups";
const TRIAL_RESTORE_SCRIPT_NAME = "postgres-trial-restore.sh";
const RUNNER_TIMEOUT_MS = 10 * 60 * 1000; // 10-minute hard cap
const PAIRED_RUNNER_TIMEOUT_MS = 60 * 60 * 1000;
const SHA = /^[0-9a-f]{64}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const PG_RUN_STORAGE = /^postgres\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;

type ReadUploadsCustody = typeof import("./uploads-custody").readUploadsCustody;
class PairedTrialAdmissionError extends Error {}

export interface RunPostgresTrialRestoreArgs {
  /** Override the backups root for tests (default: /backups). */
  backupsRoot?: string;
  /**
   * Bind verification to one BackupRun. Teardown uses this so a newer cron
   * backup can never satisfy the recovery gate for a different dump.
   */
  sourceBackupRunId?: string;
  /** Explicit null is an incomplete required pair. Omit for independent Postgres-only trials. */
  uploadsBackupRunId?: string | null;
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
  /** Inject the host custody reader for isolated runner tests. */
  readCustody?: ReadUploadsCustody;
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
  // Routes through the shared /bin/sh chokepoint so the script need not carry
  // the executable bit (which git-on-Windows + the Docker COPY both strip).
  return runManagedScript(scriptPath, {
    env, timeoutMs: env.DPF_PAIRED_TRIAL_UPLOADS_RUN_ID ? PAIRED_RUNNER_TIMEOUT_MS : RUNNER_TIMEOUT_MS,
  });
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

export interface PairedUploadsTrialReceipt {
  postgresRunId: string;
  uploadsRunId: string;
  referencedCount: number;
  deletedCount: number;
  orphanCount: number;
  orphanPaths: string[];
}

export function parsePairedUploadsTrialReceipt(
  stdout: string, expected: Pick<PairedUploadsTrialReceipt, "postgresRunId" | "uploadsRunId">,
): PairedUploadsTrialReceipt | null {
  const prefix = "UPLOADS_TRIAL ";
  const matching = stdout.split("\n").filter((line) => line.startsWith(prefix));
  if (matching.length !== 1 || matching[0]!.length > 256 * 1024) return null;
  try {
    const parsed = JSON.parse(matching[0]!.slice(prefix.length)) as Record<string, unknown> | null;
    if (!parsed || Object.keys(parsed).length !== 6) return null;
    const { postgresRunId, uploadsRunId, referencedCount, deletedCount, orphanCount, orphanPaths } = parsed;
    if (postgresRunId !== expected.postgresRunId || uploadsRunId !== expected.uploadsRunId
      || typeof referencedCount !== "number" || !Number.isSafeInteger(referencedCount) || referencedCount < 0
      || typeof deletedCount !== "number" || !Number.isSafeInteger(deletedCount) || deletedCount < 0 || deletedCount > referencedCount
      || typeof orphanCount !== "number" || !Number.isSafeInteger(orphanCount) || orphanCount < 0
      || !Array.isArray(orphanPaths) || orphanPaths.length !== Math.min(orphanCount, 100)
      || new Set(orphanPaths).size !== orphanPaths.length || !orphanPaths.every((entry) =>
        typeof entry === "string" && (entry.startsWith("documents/sha256/") || entry.startsWith("media/sha256/"))
        && entry.split("/").every((part) => part !== "" && part !== "." && part !== "..") && !entry.includes("\0"))) return null;
    return { postgresRunId, uploadsRunId, referencedCount, deletedCount, orphanCount, orphanPaths };
  } catch {
    return null;
  }
}

/**
 * Find the latest successful, non-pruned Postgres BackupRun whose dump file
 * is still readable on disk. Returns null when no such run exists (fresh
 * install pre-first-backup) — the caller skips with a warn-level log.
 */
async function findLatestEligibleBackup(
  prisma: PrismaLike,
  backupsRoot: string,
  sourceBackupRunId?: string,
): Promise<EligibleTrialSource | null> {
  if (sourceBackupRunId) {
    const row = await prisma.backupRun.findUnique({
      where: { id: sourceBackupRunId },
      select: { id: true, storagePath: true, target: true, status: true, prunedAt: true, sha256: true },
    });
    if (!row || row.target !== "postgres" || row.status !== "ok" || row.prunedAt) return null;
    const dumpPath = path.posix.join(backupsRoot, row.storagePath, "dpf.dump");
    try {
      await fs.access(dumpPath);
      return { runId: row.id, dumpPath, storagePath: row.storagePath, sha256: row.sha256 };
    } catch {
      return null;
    }
  }
  const rows = await prisma.backupRun.findMany({
    where: { target: "postgres", status: "ok", prunedAt: null },
    orderBy: { finishedAt: "desc" },
    take: 5,
    select: { id: true, storagePath: true, sha256: true },
  });
  for (const row of rows) {
    const dumpPath = path.posix.join(backupsRoot, row.storagePath, "dpf.dump");
    try {
      await fs.access(dumpPath);
      return { runId: row.id, dumpPath, storagePath: row.storagePath, sha256: row.sha256 };
    } catch {
      // Recorded as ok but the file is gone — skip and try the next-newest.
      continue;
    }
  }
  return null;
}

type EligibleTrialSource = { runId: string; dumpPath: string; storagePath: string; sha256: string | null };

async function pairedTrialEnvironment(
  prisma: PrismaLike, backupsRoot: string, source: EligibleTrialSource, uploadsRunId: string,
  readCustody: ReadUploadsCustody,
): Promise<Record<string, string>> {
  if (!RUN_ID.test(source.runId) || !RUN_ID.test(uploadsRunId) || !PG_RUN_STORAGE.test(source.storagePath)
    || !source.sha256 || !SHA.test(source.sha256)) throw new PairedTrialAdmissionError("The required upload pair lacks an exact Postgres capture identity.");
  const row = await prisma.backupRun.findUnique({
    where: { id: uploadsRunId },
    select: { id: true, storagePath: true, target: true, status: true, prunedAt: true, sha256: true },
  });
  if (!row || row.id !== uploadsRunId || row.target !== "uploads" || row.status !== "ok" || row.prunedAt
    || !row.sha256 || !SHA.test(row.sha256)) {
    throw new PairedTrialAdmissionError("The required upload backup capture is missing or did not succeed.");
  }
  const custody = await readCustody(backupsRoot, uploadsRunId).catch(() => {
    throw new PairedTrialAdmissionError("The required upload manifest custody is unavailable.");
  });
  if (custody.runId !== uploadsRunId || custody.storagePath !== row.storagePath || custody.archiveSha256 !== row.sha256
    || custody.pairedPostgresRunId !== source.runId || custody.pairedPostgresSha256 !== source.sha256) {
    throw new PairedTrialAdmissionError("The upload manifest custody does not match the exact requested backup pair.");
  }
  return {
    DPF_PAIRED_TRIAL_UPLOADS_RUN_ID: custody.runId,
    DPF_PAIRED_TRIAL_UPLOADS_DIR: path.resolve(backupsRoot, custody.storagePath),
    DPF_PAIRED_TRIAL_UPLOADS_SHA256: custody.archiveSha256,
    DPF_PAIRED_TRIAL_MANIFEST_SHA256: custody.manifestSha256,
    DPF_PAIRED_TRIAL_POSTGRES_RUN_ID: source.runId,
    DPF_PAIRED_TRIAL_POSTGRES_SHA256: source.sha256,
  };
}

export interface TrialRestoreResult {
  status: "ok" | "failed" | "skipped";
  restoreId: string | null;
  verificationScope: "postgres-only" | "paired";
  reason?: string;
  assertions?: Record<string, number>;
  durationMs?: number;
  pairedUploads?: PairedUploadsTrialReceipt;
}

export async function runPostgresTrialRestore(
  args: RunPostgresTrialRestoreArgs = {},
): Promise<TrialRestoreResult> {
  const now = args.now ?? (() => new Date());
  const startedAt = now();
  const backupsRoot = args.backupsRoot ?? BACKUPS_ROOT;
  const scriptPath = args.scriptPath ?? resolveManagedScriptPath(TRIAL_RESTORE_SCRIPT_NAME);
  const assertTables = args.assertTables ?? TRIAL_RESTORE_DEFAULT_ASSERT_TABLES;
  const runScript = args.runScript ?? defaultRunScript;
  const prisma = args.prismaClient ?? (await import("@dpf/db")).prisma;
  const pairedRequired = args.uploadsBackupRunId !== undefined;
  const verificationScope = pairedRequired ? "paired" : "postgres-only";

  trialTraceLog(`run start job=${POSTGRES_TRIAL_RESTORE_JOB_ID}`);

  // Update the heartbeat row so the readiness card shows last-attempt-at
  // even when we skip (e.g., no eligible backup yet on a fresh install).
  await recordJobHeartbeat(prisma, POSTGRES_TRIAL_RESTORE_JOB_ID, {
    lastRunAt: startedAt,
    lastStatus: "running",
    lastError: null,
  });

  const source = pairedRequired && !args.sourceBackupRunId ? null
    : await findLatestEligibleBackup(prisma, backupsRoot, args.sourceBackupRunId);
  if (!source) {
    if (pairedRequired) {
      const errorMessage = "The exact Postgres capture for the required upload trial is unavailable.";
      await recordJobHeartbeat(prisma, POSTGRES_TRIAL_RESTORE_JOB_ID, { lastStatus: "failed", lastError: errorMessage });
      await publishTrialNotification(prisma, "failed", errorMessage, now(), verificationScope);
      return { status: "failed", restoreId: null, reason: errorMessage, verificationScope };
    }
    trialTraceLog("skip reason=no eligible backup found");
    await recordJobHeartbeat(prisma, POSTGRES_TRIAL_RESTORE_JOB_ID, {
      lastStatus: "skipped",
      lastError: "no eligible backup",
    });
    return { status: "skipped", restoreId: null, reason: "no eligible backup found on disk", verificationScope };
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DUMP_PATH: source.dumpPath,
    POSTGRES_USER: process.env.POSTGRES_USER ?? "dpf",
    DPF_PRODUCTION_DB_CONTAINER:
      process.env.DPF_PRODUCTION_DB_CONTAINER ?? "dpf-postgres-1",
    ASSERT_TABLES: assertTables.join(","),
    DPF_PAIRED_TRIAL_UPLOADS_RUN_ID: undefined,
  };

  let preflightFailure: string | null = null;
  if (pairedRequired) {
    if (!args.uploadsBackupRunId) {
      preflightFailure = "The required upload backup capture did not finish successfully.";
    } else {
      try {
        const readCustody = args.readCustody ?? (await import("./uploads-custody")).readUploadsCustody;
        Object.assign(env, await pairedTrialEnvironment(prisma, backupsRoot, source, args.uploadsBackupRunId, readCustody));
      } catch (error) {
        preflightFailure = error instanceof PairedTrialAdmissionError ? error.message : "Paired trial preflight failed.";
      }
    }
  }
  const outcome = preflightFailure
    ? { ok: false, stdout: "", stderr: "", exitCode: 2 }
    : await runScript(scriptPath, env);
  const parsed = parseResultLine(outcome.stdout);
  const paired = args.uploadsBackupRunId ? parsePairedUploadsTrialReceipt(outcome.stdout, {
    postgresRunId: source.runId, uploadsRunId: args.uploadsBackupRunId,
  }) : null;
  const finishedAt = now();
  const durationMs = parsed?.durationMs ?? finishedAt.getTime() - startedAt.getTime();

  // The script's exit code differentiates: 0 = full ok, 5 = assertion fail,
  // 3/4 = create/restore fail, 6 = ok-but-cleanup-orphan. We treat any
  // non-(0|6) as failed, but trust the parsed result line for the reason
  // when available.
  const cleanupWarn = outcome.exitCode === 6;
  const scriptStatus = outcome.exitCode === 0 || cleanupWarn ? "ok" : "failed";
  const finalStatus: "ok" | "failed" =
    parsed?.status === "failed" || scriptStatus === "failed" || (pairedRequired && (!paired || parsed?.status !== "ok"))
      ? "failed" : "ok";

  const errorMessage = (() => {
    if (finalStatus === "ok") {
      return cleanupWarn ? "Trial restore succeeded but cleanup left an orphan temp DB." : null;
    }
    if (preflightFailure) return preflightFailure;
    if (parsed?.reason) return `Assertion failed: ${parsed.reason}`;
    if (outcome.exitCode === 3) return "CREATE DATABASE failed (dpf role may lack CREATEDB privilege).";
    if (outcome.exitCode === 4) return "pg_restore failed against the trial DB.";
    if (outcome.exitCode === 5) return parsed?.reason ?? "Row-count assertion failed.";
    if (pairedRequired && scriptStatus === "ok") return "The paired trial did not report valid evidence for both selected runs.";
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

  await publishTrialNotification(prisma, finalStatus, errorMessage, finishedAt, verificationScope);

  await recordJobHeartbeat(prisma, POSTGRES_TRIAL_RESTORE_JOB_ID, {
    lastRunAt: startedAt,
    lastStatus: finalStatus,
    lastError: errorMessage,
  });

  trialTraceLog(
    `run done status=${finalStatus} restoreId=${created.id} duration_ms=${durationMs}`,
  );

  return {
    status: finalStatus,
    restoreId: created.id,
    verificationScope,
    durationMs,
    assertions: parsed?.assertions,
    reason: parsed?.reason ?? (pairedRequired && finalStatus === "failed" ? errorMessage ?? undefined : undefined),
    ...(finalStatus === "ok" && paired ? { pairedUploads: paired } : {}),
  };
}

/** Keep the existing operator alert and clear-on-success behavior. */
async function publishTrialNotification(
  prisma: PrismaLike, status: "ok" | "failed", errorMessage: string | null, finishedAt: Date,
  scope: TrialRestoreResult["verificationScope"],
): Promise<void> {
  const subjectId = scope === "paired" ? "paired-postgres-uploads" : "postgres";
  if (status === "failed") {
    await prisma.platformNotification.create({
      data: {
        severity: "critical", category: "backup-trial-restore-failed", subjectId,
        message: `${scope === "paired" ? "Paired Postgres and uploads" : "Postgres"} backup trial restore failed: ${errorMessage ?? "unknown error"}. Navigate to Admin → Backups to inspect the log and trigger a new backup.`,
      },
    }).catch(() => {});
  } else {
    await prisma.platformNotification.updateMany({
      where: { category: "backup-trial-restore-failed", subjectId, resolvedAt: null },
      data: { resolvedAt: finishedAt },
    }).catch(() => {});
  }
}
