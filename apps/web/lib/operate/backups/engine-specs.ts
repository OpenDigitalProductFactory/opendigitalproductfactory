/**
 * Per-engine backup/restore specs (EP-8DC217EB BET-11, BI-B72328D5).
 *
 * Every real difference between the postgres/neo4j/qdrant runners lives here
 * as data + tiny hooks; the lifecycle itself lives once in managed-backup.ts
 * and managed-restore.ts. The runner files (postgres-backup-runner.ts etc.)
 * are thin wrappers that keep their historical export names so the Inngest
 * layer, server actions and self-upgrade rollback are untouched.
 *
 * Metric handles reference the EXISTING objects in @/lib/operate/metrics —
 * no Prometheus metric name changes (dashboards depend on them).
 *
 * NOTE on the neo4j env builders: backups-host-path-relocation.test.ts
 * structurally pins the DPF_BACKUPS_HOST_PATH forwarding contract to
 * neo4j-backup-runner.ts / neo4j-restore-runner.ts, so those two builders are
 * defined (as hoisted function declarations — safe across the module cycle)
 * in their runner files and referenced from the specs here.
 */

import type { Counter, Gauge, Histogram } from "prom-client";

import {
  neo4jBackupDurationSeconds,
  neo4jBackupLastSuccessSeconds,
  neo4jBackupRunsTotal,
  neo4jBackupStorageBytes,
  postgresBackupDurationSeconds,
  postgresBackupLastSuccessSeconds,
  postgresBackupRunsTotal,
  postgresBackupStorageBytes,
  postgresRestoreDurationSeconds,
  postgresRestoreRunsTotal,
  qdrantBackupDurationSeconds,
  qdrantBackupLastSuccessSeconds,
  qdrantBackupRunsTotal,
  qdrantBackupStorageBytes,
} from "@/lib/operate/metrics";

import {
  NEO4J_BACKUP_JOB_ID,
  NEO4J_BACKUP_SCHEDULE,
  POSTGRES_BACKUP_JOB_ID,
  POSTGRES_BACKUP_SCHEDULE,
  QDRANT_BACKUP_JOB_ID,
  QDRANT_BACKUP_SCHEDULE,
} from "./constants";
import type {
  BackupManifest,
  BackupTarget,
  Neo4jBackupManifest,
  QdrantBackupManifest,
} from "./types";
import type { PrismaLike } from "./managed-backup";
import {
  postgresExtensionPreflight,
  type BackupPreflightResult,
} from "./extension-preflight";
import { RestoreIntegrityError } from "./managed-restore";
import { buildNeo4jBackupScriptEnv } from "./neo4j-backup-runner";
import { buildNeo4jRestoreScriptEnv } from "./neo4j-restore-runner";

/** Union of the three engines' sidecar manifest shapes. */
export type AnyBackupManifest =
  | BackupManifest
  | Neo4jBackupManifest
  | QdrantBackupManifest;

/** Inputs the shared backup engine hands to a spec's env builder. */
export interface BackupScriptEnvContext {
  /** Absolute per-run target directory (TARGET_DIR for the script). */
  targetDir: string;
  /** Compose project name resolved from args/env with the "dpf" fallback. */
  composeProject: string;
}

export interface BackupEngineSpec {
  target: BackupTarget;
  /** ScheduledJob heartbeat row id (see constants.ts / seed). */
  jobId: string;
  /** BackupRun.schedule value recorded when trigger === "scheduled". */
  schedule: string;
  /** Subdirectory under /backups for this engine's run directories. */
  subdir: string;
  /** Managed shell script name under scripts/. */
  scriptName: string;
  /** Hard cap on script wall-clock time. */
  timeoutMs: number;
  /** Console trace tag, e.g. "[backup-trace][neo4j]". */
  traceTag: string;
  /** Failure marker the shell script prints to stderr. */
  failureMarker: string;
  /** Strips everything up to and including the failure marker. */
  failureStrip: RegExp;
  /** No-diagnostic fallback error text. */
  failureFallback: string;
  /**
   * EXISTING Prometheus metric objects from @/lib/operate/metrics. Declared
   * as getters in the specs so a test that partially mocks the metrics
   * module (e.g. postgres-restore-runner.test.ts mocks only the restore
   * metrics) never trips vitest's missing-export guard at module eval.
   */
  metrics: {
    readonly runsTotal: Counter<"status" | "trigger">;
    readonly lastSuccessSeconds: Gauge<string>;
    readonly storageBytes: Gauge<string>;
    readonly durationSeconds: Histogram<"trigger">;
  };
  /** Full script env (spread process.env + engine-specific wiring). */
  buildEnv(ctx: BackupScriptEnvContext): NodeJS.ProcessEnv;
  /** Extra BackupRun fields written on success (postgres: pgVersion). */
  successRowExtras?(manifest: AnyBackupManifest): Record<string, unknown>;
  /**
   * Optional pre-dump capability check. Runs before the backup script and,
   * when it returns `{ ok: false }`, short-circuits the run to a failed
   * BackupRun carrying the actionable `error` — the script is never spawned.
   * Postgres uses it to catch a container image missing a required extension
   * library (pgvector) before pg_dump fails opaquely (BI-A35347E4). Must be
   * fail-open on any inconclusive signal so it never becomes a new failure
   * source. Never mutates infrastructure.
   */
  preflight?(ctx: {
    composeProject: string;
  }): Promise<BackupPreflightResult>;
}

/** Inputs the shared restore engine hands to a spec's env builder. */
export interface RestoreScriptEnvContext {
  /** Absolute path of the source dump/snapshot artifact (DUMP_PATH). */
  dumpPath: string;
}

/** Context handed to the Postgres-only audit capture/reinsert hooks. */
export interface RestoreAuditHookContext {
  prisma: PrismaLike;
  safetyRunId: string;
}

export interface RestoreEngineSpec {
  target: BackupTarget;
  scriptName: string;
  timeoutMs: number;
  /** Artifact file inside the run directory (dpf.dump / neo4j.dump / …). */
  artifactFileName: string;
  /** Console trace tag, e.g. "[restore-trace][qdrant]". */
  traceTag: string;
  failureMarker: string;
  failureStrip: RegExp;
  failureFallback: string;
  /**
   * Engine-specific operator-facing texts. Wordings differ slightly between
   * the original runners; they are preserved verbatim here.
   * `wrongTarget` present ⇒ the target check is enforced (postgres predates
   * that check and intentionally omits it).
   */
  messages: {
    statusNotOk(sourceId: string, status: string): string;
    pruned(sourceId: string): string;
    wrongTarget?(actualTarget: string): string;
    missingArtifact(absolutePath: string): string;
    checksumMismatch(expected: string, actual: string): string;
    safetyFailed: string;
    safetyStartTrace: string;
    safetyOkTrace(runId: string): string;
  };
  buildEnv(ctx: RestoreScriptEnvContext): NodeJS.ProcessEnv;
  /** Default pre-restore safety backup (engine backup entry point). */
  takeSafetyBackup(deps: {
    backupsRoot: string;
    prisma: PrismaLike;
  }): Promise<{ runId: string; status: "ok" | "failed" }>;
  /** Postgres-only restore metrics (neo4j/qdrant never emitted any). */
  metrics?: {
    runsTotal: Counter<"status">;
    durationSeconds: Histogram<string>;
  };
  /**
   * Postgres-only: snapshot the safety BackupRun row in memory BEFORE the
   * restore script wipes the DB. Throws RestoreIntegrityError if the row
   * vanished. Returns opaque state for reinsertAuditRows.
   */
  capturePreRestoreState?(ctx: RestoreAuditHookContext): Promise<unknown>;
  /**
   * Postgres-only: after the restore lands, re-insert/refresh the source and
   * safety BackupRun rows so the operator still sees both in history.
   */
  reinsertAuditRows?(ctx: {
    prisma: PrismaLike;
    source: BackupRunSnapshot;
    preState: unknown;
  }): Promise<void>;
}

// ─── Backup specs ───────────────────────────────────────────────────────────

export const POSTGRES_BACKUP_SPEC: BackupEngineSpec = {
  target: "postgres",
  jobId: POSTGRES_BACKUP_JOB_ID,
  schedule: POSTGRES_BACKUP_SCHEDULE,
  subdir: "postgres",
  scriptName: "backup-postgres.sh",
  timeoutMs: 30 * 60 * 1000, // 30-minute hard cap
  traceTag: "[backup-trace]",
  failureMarker: "[backup-trace] failed:",
  failureStrip: /^.*\[backup-trace\]\s*failed:\s*/,
  failureFallback: "backup failed (no diagnostic captured)",
  metrics: {
    get runsTotal() { return postgresBackupRunsTotal; },
    get lastSuccessSeconds() { return postgresBackupLastSuccessSeconds; },
    get storageBytes() { return postgresBackupStorageBytes; },
    get durationSeconds() { return postgresBackupDurationSeconds; },
  },
  buildEnv({ targetDir, composeProject }) {
    const containerName =
      process.env.DPF_PRODUCTION_DB_CONTAINER ?? `${composeProject}-postgres-1`;
    return {
      ...process.env,
      TARGET_DIR: targetDir,
      DPF_PRODUCTION_DB_CONTAINER: containerName,
      POSTGRES_USER: process.env.POSTGRES_USER ?? "dpf",
      POSTGRES_DB: process.env.POSTGRES_DB ?? "dpf",
    };
  },
  successRowExtras(manifest) {
    return { pgVersion: (manifest as BackupManifest).pgVersion };
  },
  preflight: (ctx) => postgresExtensionPreflight(ctx),
};

export const NEO4J_BACKUP_SPEC: BackupEngineSpec = {
  target: "neo4j",
  jobId: NEO4J_BACKUP_JOB_ID,
  schedule: NEO4J_BACKUP_SCHEDULE,
  subdir: "neo4j",
  scriptName: "backup-neo4j.sh",
  timeoutMs: 10 * 60 * 1000, // 10-minute hard cap (Neo4j stop+dump+start)
  traceTag: "[backup-trace][neo4j]",
  failureMarker: "[backup-neo4j-trace] failed:",
  failureStrip: /^.*\[backup-neo4j-trace\]\s*failed:\s*/,
  failureFallback: "neo4j backup failed (no diagnostic captured)",
  metrics: {
    get runsTotal() { return neo4jBackupRunsTotal; },
    get lastSuccessSeconds() { return neo4jBackupLastSuccessSeconds; },
    get storageBytes() { return neo4jBackupStorageBytes; },
    get durationSeconds() { return neo4jBackupDurationSeconds; },
  },
  buildEnv: (ctx) => buildNeo4jBackupScriptEnv(ctx),
};

export const QDRANT_BACKUP_SPEC: BackupEngineSpec = {
  target: "qdrant",
  jobId: QDRANT_BACKUP_JOB_ID,
  schedule: QDRANT_BACKUP_SCHEDULE,
  subdir: "qdrant",
  scriptName: "backup-qdrant.sh",
  timeoutMs: 30 * 60 * 1000, // 30-minute hard cap
  traceTag: "[backup-trace][qdrant]",
  failureMarker: "[backup-qdrant-trace] failed:",
  failureStrip: /^.*\[backup-qdrant-trace\]\s*failed:\s*/,
  failureFallback: "qdrant backup failed (no diagnostic captured)",
  metrics: {
    get runsTotal() { return qdrantBackupRunsTotal; },
    get lastSuccessSeconds() { return qdrantBackupLastSuccessSeconds; },
    get storageBytes() { return qdrantBackupStorageBytes; },
    get durationSeconds() { return qdrantBackupDurationSeconds; },
  },
  buildEnv({ targetDir }) {
    return {
      ...process.env,
      TARGET_DIR: targetDir,
      DPF_QDRANT_URL: process.env.DPF_QDRANT_URL ?? "http://qdrant:6333",
    };
  },
};

// ─── Restore specs ──────────────────────────────────────────────────────────

/**
 * Minimal BackupRun row shape the Postgres audit re-insert dance needs.
 * (rollback.ts keeps its own copy for the recovery-point snapshots.)
 */
export type BackupRunSnapshot = {
  id: string;
  target: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  trigger: string;
  schedule: string | null;
  sizeBytes: bigint | number | null;
  durationMs: number | null;
  sha256: string | null;
  pgVersion: string | null;
  dpfVersion: string | null;
  storagePath: string;
  errorMessage: string | null;
  prunedAt: Date | null;
  createdAt: Date;
};

async function upsertBackupRunSnapshot(
  prisma: PrismaLike,
  row: BackupRunSnapshot | null,
) {
  if (!row) return;
  const data = {
    target: row.target,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: row.status,
    trigger: row.trigger,
    schedule: row.schedule,
    sizeBytes: row.sizeBytes,
    durationMs: row.durationMs,
    sha256: row.sha256,
    pgVersion: row.pgVersion,
    dpfVersion: row.dpfVersion,
    storagePath: row.storagePath,
    errorMessage: row.errorMessage,
    prunedAt: row.prunedAt,
    createdAt: row.createdAt,
  };
  await prisma.backupRun.upsert({
    where: { id: row.id },
    update: data,
    create: { id: row.id, ...data },
  });
}

export const POSTGRES_RESTORE_SPEC: RestoreEngineSpec = {
  target: "postgres",
  scriptName: "restore-postgres.sh",
  timeoutMs: 30 * 60 * 1000, // mirror backup runner
  artifactFileName: "dpf.dump",
  traceTag: "[restore-trace]",
  failureMarker: "[restore-trace] failed:",
  failureStrip: /^.*\[restore-trace\]\s*failed:\s*/,
  failureFallback: "restore failed (no diagnostic captured)",
  messages: {
    statusNotOk: (sourceId, status) =>
      `Source BackupRun ${sourceId} status=${status}; only successful backups can be restored.`,
    pruned: (sourceId) =>
      `Source BackupRun ${sourceId} has been pruned; its file is no longer on disk.`,
    // No wrongTarget: the Postgres wizard predates the target check.
    missingArtifact: (p) => `Source dump file is missing at ${p}.`,
    checksumMismatch: (expected, actual) =>
      `Source dump checksum does not match what was recorded when the backup was taken. The file may be corrupted (expected ${expected}, got ${actual}).`,
    safetyFailed:
      "Pre-restore safety dump failed; aborting restore so the current state is not lost.",
    safetyStartTrace: "writing pre-restore safety dump",
    safetyOkTrace: (runId) => `safety dump ok runId=${runId}`,
  },
  buildEnv({ dumpPath }) {
    return {
      ...process.env,
      DUMP_PATH: dumpPath,
      POSTGRES_USER: process.env.POSTGRES_USER ?? "dpf",
      POSTGRES_DB: process.env.POSTGRES_DB ?? "dpf",
      DPF_PRODUCTION_DB_CONTAINER:
        process.env.DPF_PRODUCTION_DB_CONTAINER ?? "dpf-postgres-1",
    };
  },
  async takeSafetyBackup({ backupsRoot, prisma }) {
    // Dynamic import keeps this hook mockable via vi.mock and avoids an
    // eval-time cycle with the wrapper module.
    const { runPostgresBackup } = await import("./postgres-backup-runner");
    return runPostgresBackup({
      trigger: "pre-restore-safety",
      backupsRoot,
      prismaClient: prisma,
    });
  },
  metrics: {
    get runsTotal() { return postgresRestoreRunsTotal; },
    get durationSeconds() { return postgresRestoreDurationSeconds; },
  },
  // pg_restore --clean drops + recreates ALL tables, which wipes any rows we
  // INSERT before running it — including the safety-dump BackupRun row and
  // our own BackupRestore audit row. So we capture the safety dump's metadata
  // in MEMORY here, run the restore, then re-insert both rows AFTER the
  // restore lands. This keeps the audit trail visible to operators in the
  // admin UX (otherwise the table would always be empty after a successful
  // restore). The safety dump's FILE on disk is unaffected by pg_restore
  // (host bind mount), so even if the re-insert fails, manual recovery is
  // possible.
  async capturePreRestoreState({ prisma, safetyRunId }) {
    // Read the row back rather than reconstruct from memory so the audit
    // captures the exact field values (sizeBytes, sha256, finishedAt, etc.).
    const snapshot = await prisma.backupRun.findUnique({
      where: { id: safetyRunId },
    });
    if (!snapshot) {
      throw new RestoreIntegrityError(
        "Safety dump BackupRun row not found after creation; aborting restore.",
      );
    }
    return snapshot;
  },
  async reinsertAuditRows({ prisma, source, preState }) {
    // The DB is now in the source-dump state. The source BackupRun row may
    // have been rewound to its initial "running" state; the safety BackupRun
    // row is gone. Upsert (not create) because the dump may already contain
    // an older copy of the row.
    await upsertBackupRunSnapshot(prisma, source);
    await upsertBackupRunSnapshot(prisma, preState as BackupRunSnapshot | null);
  },
};

export const NEO4J_RESTORE_SPEC: RestoreEngineSpec = {
  target: "neo4j",
  scriptName: "restore-neo4j.sh",
  timeoutMs: 10 * 60 * 1000,
  artifactFileName: "neo4j.dump",
  traceTag: "[restore-trace][neo4j]",
  failureMarker: "[restore-neo4j-trace] failed:",
  failureStrip: /^.*\[restore-neo4j-trace\]\s*failed:\s*/,
  failureFallback: "neo4j restore failed (no diagnostic captured)",
  messages: {
    statusNotOk: (_sourceId, status) =>
      `Source BackupRun status=${status}; only successful backups can be restored.`,
    pruned: (sourceId) =>
      `Source BackupRun ${sourceId} has been pruned; file is gone.`,
    wrongTarget: (actual) => `BackupRun target=${actual}; expected neo4j.`,
    missingArtifact: (p) => `Source dump file is missing at ${p}.`,
    checksumMismatch: (expected, actual) =>
      `Source dump checksum mismatch — file may be corrupted (expected ${expected}, got ${actual}).`,
    safetyFailed:
      "Pre-restore safety dump failed; aborting restore so current state is not lost.",
    safetyStartTrace: "writing pre-restore safety dump",
    safetyOkTrace: (runId) => `safety dump ok runId=${runId}`,
  },
  buildEnv: (ctx) => buildNeo4jRestoreScriptEnv(ctx),
  async takeSafetyBackup({ backupsRoot, prisma }) {
    const { runNeo4jBackup } = await import("./neo4j-backup-runner");
    return runNeo4jBackup({
      trigger: "pre-restore-safety",
      backupsRoot,
      prismaClient: prisma,
    });
  },
  // Neo4j's database is NOT wiped by the restore — it replaces the graph
  // database in-place via neo4j-admin, so audit rows written to Postgres
  // before the restore persist normally (no re-insert dance, no metrics —
  // the original runner never emitted restore metrics).
};

export const QDRANT_RESTORE_SPEC: RestoreEngineSpec = {
  target: "qdrant",
  scriptName: "restore-qdrant.sh",
  timeoutMs: 30 * 60 * 1000,
  artifactFileName: "qdrant.snapshot",
  traceTag: "[restore-trace][qdrant]",
  failureMarker: "[restore-qdrant-trace] failed:",
  failureStrip: /^.*\[restore-qdrant-trace\]\s*failed:\s*/,
  failureFallback: "qdrant restore failed (no diagnostic captured)",
  messages: {
    statusNotOk: (_sourceId, status) =>
      `Source BackupRun status=${status}; only successful backups can be restored.`,
    pruned: (sourceId) =>
      `Source BackupRun ${sourceId} has been pruned; file is gone.`,
    wrongTarget: (actual) => `BackupRun target=${actual}; expected qdrant.`,
    missingArtifact: (p) => `Source snapshot file is missing at ${p}.`,
    checksumMismatch: (expected, actual) =>
      `Source snapshot checksum mismatch — file may be corrupted (expected ${expected}, got ${actual}).`,
    safetyFailed: "Pre-restore safety snapshot failed; aborting restore.",
    safetyStartTrace: "writing pre-restore safety snapshot",
    safetyOkTrace: (runId) => `safety snapshot ok runId=${runId}`,
  },
  buildEnv({ dumpPath }) {
    return {
      ...process.env,
      DUMP_PATH: dumpPath,
      DPF_QDRANT_URL: process.env.DPF_QDRANT_URL ?? "http://qdrant:6333",
    };
  },
  async takeSafetyBackup({ backupsRoot, prisma }) {
    const { runQdrantBackup } = await import("./qdrant-backup-runner");
    return runQdrantBackup({
      trigger: "pre-restore-safety",
      backupsRoot,
      prismaClient: prisma,
    });
  },
  // Qdrant restore is fully online (POST /snapshots/upload) — Postgres is
  // unaffected, so no re-insert dance; no restore metrics existed.
};
