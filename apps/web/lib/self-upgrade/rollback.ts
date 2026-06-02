import { prisma as defaultPrisma, type Prisma } from "@dpf/db";

import type { BackupTarget } from "@/lib/operate/backups/types";
import {
  acquireRestoreLock,
  RestoreIntegrityError,
  RestoreLockedError,
  runPostgresRestore,
} from "@/lib/operate/backups/postgres-restore-runner";
import { runNeo4jRestore } from "@/lib/operate/backups/neo4j-restore-runner";
import { runQdrantRestore } from "@/lib/operate/backups/qdrant-restore-runner";

export const SELF_UPGRADE_ROLLBACK_CONFIRMATION_TEXT = "ROLLBACK";
const ROLLBACK_TRIGGER = "self-upgrade-rollback";
const RESTORE_ORDER: BackupTarget[] = ["postgres", "neo4j", "qdrant"];

type PrismaLike = typeof defaultPrisma;

type BackupRunSnapshot = {
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

type RestoreRunnerResult = { restoreId: string; status: "ok" | "failed" };
type RestoreRunner = (args: {
  sourceBackupRunId: string;
  initiatedByUserId?: string | null;
  trigger?: string | null;
  prismaClient?: PrismaLike;
  acquireLock?: boolean;
}) => Promise<RestoreRunnerResult>;

export interface SelfUpgradeRollbackMemberResult {
  target: BackupTarget;
  sourceBackupRunId: string;
  restoreId: string | null;
  status: "ok" | "failed";
  error?: string;
}

export interface SelfUpgradeRollbackEvidence {
  schemaVersion: 1;
  trigger: typeof ROLLBACK_TRIGGER;
  status: "ok" | "failed";
  selfUpgradeRunId: string;
  startedAt: string;
  completedAt: string;
  initiatedByUserId: string | null;
  restoreOrder: BackupTarget[];
  restores: SelfUpgradeRollbackMemberResult[];
}

export interface SelfUpgradeRollbackResult {
  ok: boolean;
  status: "ok" | "failed";
  runId: string;
  restores: SelfUpgradeRollbackMemberResult[];
  error?: string;
}

export class SelfUpgradeRollbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelfUpgradeRollbackError";
  }
}

interface SelfUpgradeRecoveryPointMemberLike {
  target: BackupTarget;
  runId: string | null;
  status: "ok" | "failed";
  error?: string;
}

interface SelfUpgradeRecoveryPointLike {
  schemaVersion: 1;
  status: "ok" | "failed" | "skipped";
  trigger: "pre-upgrade-recovery";
  selfUpgradeRunId: string;
  createdAt: string;
  members: SelfUpgradeRecoveryPointMemberLike[];
}

interface RollbackArgs {
  runId: string;
  initiatedByUserId?: string | null;
  prismaClient?: PrismaLike;
  now?: () => Date;
  runners?: Partial<Record<BackupTarget, RestoreRunner>>;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseRecoveryPoint(value: unknown): SelfUpgradeRecoveryPointLike | null {
  const evidence = toRecord(value);
  const point = toRecord(evidence?.recoveryPoint);
  if (!point) return null;
  if (point.schemaVersion !== 1) return null;
  if (point.trigger !== "pre-upgrade-recovery") return null;
  if (!Array.isArray(point.members)) return null;

  return point as unknown as SelfUpgradeRecoveryPointLike;
}

function memberMap(point: SelfUpgradeRecoveryPointLike): Record<BackupTarget, string> {
  if (point.status !== "ok") {
    throw new SelfUpgradeRollbackError(
      `Recovery point status is ${point.status}; only complete recovery points can be restored.`,
    );
  }

  const byTarget = new Map<BackupTarget, string>();
  for (const member of point.members) {
    if (member.status === "ok" && member.runId) {
      byTarget.set(member.target, member.runId);
    }
  }

  const missing = RESTORE_ORDER.filter((target) => !byTarget.has(target));
  if (missing.length > 0) {
    throw new SelfUpgradeRollbackError(
      `Recovery point is missing successful backup members: ${missing.join(", ")}.`,
    );
  }

  return {
    postgres: byTarget.get("postgres")!,
    neo4j: byTarget.get("neo4j")!,
    qdrant: byTarget.get("qdrant")!,
  };
}

async function resolveRunners(
  overrides?: Partial<Record<BackupTarget, RestoreRunner>>,
): Promise<Record<BackupTarget, RestoreRunner>> {
  return {
    postgres: overrides?.postgres ?? runPostgresRestore,
    neo4j: overrides?.neo4j ?? runNeo4jRestore,
    qdrant: overrides?.qdrant ?? runQdrantRestore,
  };
}

function backupRunSnapshotData(row: BackupRunSnapshot) {
  return {
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
}

async function upsertBackupRunSnapshots(
  prisma: PrismaLike,
  snapshots: BackupRunSnapshot[],
) {
  for (const row of snapshots) {
    const data = backupRunSnapshotData(row);
    await prisma.backupRun.upsert({
      where: { id: row.id },
      update: data,
      create: { id: row.id, ...data },
    });
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function mergeRollbackEvidence(args: {
  existingEvidence: unknown;
  recoveryPoint: SelfUpgradeRecoveryPointLike;
  rollback: SelfUpgradeRollbackEvidence;
}): Prisma.InputJsonValue {
  return toJson({
    ...(toRecord(args.existingEvidence) ?? {}),
    recoveryPoint: args.recoveryPoint,
    rollback: args.rollback,
  });
}

function summarizeRestoreFailure(restores: SelfUpgradeRollbackMemberResult[]): string {
  const failed = restores.find((restore) => restore.status === "failed");
  if (!failed) return "self-upgrade rollback failed";
  return `self-upgrade rollback failed at ${failed.target}: ${failed.error ?? failed.restoreId ?? "restore failed"}`;
}

async function recordRollbackEvidence(args: {
  prisma: PrismaLike;
  run: {
    runId: string;
    trigger: string;
    currentSha: string | null;
    targetSha: string | null;
    deployedSha: string | null;
    startedAt: Date | null;
    createdAt: Date;
    completionEvidence: unknown;
    failureLog: string | null;
  };
  recoveryPoint: SelfUpgradeRecoveryPointLike;
  rollback: SelfUpgradeRollbackEvidence;
}) {
  const failed = args.rollback.status === "failed";
  const failureLog = failed
    ? [
        args.run.failureLog,
        summarizeRestoreFailure(args.rollback.restores),
      ].filter(Boolean).join("\n")
    : args.run.failureLog;

  await args.prisma.selfUpgradeRun.upsert({
    where: { runId: args.run.runId },
    update: {
      status: failed ? "rollback-failed" : "rolled-back",
      completedAt: new Date(args.rollback.completedAt),
      failureLog: failureLog || null,
      completionEvidence: mergeRollbackEvidence({
        existingEvidence: args.run.completionEvidence,
        recoveryPoint: args.recoveryPoint,
        rollback: args.rollback,
      }),
    },
    create: {
      runId: args.run.runId,
      trigger: args.run.trigger,
      status: failed ? "rollback-failed" : "rolled-back",
      currentSha: args.run.currentSha,
      targetSha: args.run.targetSha,
      deployedSha: args.run.deployedSha,
      startedAt: args.run.startedAt,
      completedAt: new Date(args.rollback.completedAt),
      createdAt: args.run.createdAt,
      failureLog: failureLog || null,
      completionEvidence: mergeRollbackEvidence({
        existingEvidence: args.run.completionEvidence,
        recoveryPoint: args.recoveryPoint,
        rollback: args.rollback,
      }),
    },
  });
}

async function loadRecoverySourceSnapshots(
  prisma: PrismaLike,
  memberRunIds: Record<BackupTarget, string>,
): Promise<BackupRunSnapshot[]> {
  const ids = RESTORE_ORDER.map((target) => memberRunIds[target]);
  const rows = await prisma.backupRun.findMany({
    where: { id: { in: ids } },
  });
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const missing = ids.filter((id) => !rowsById.has(id));
  if (missing.length > 0) {
    throw new SelfUpgradeRollbackError(
      `Recovery point BackupRun rows are missing: ${missing.join(", ")}.`,
    );
  }
  return ids.map((id) => rowsById.get(id)!);
}

async function runRestoreMember(args: {
  target: BackupTarget;
  sourceBackupRunId: string;
  runner: RestoreRunner;
  initiatedByUserId: string | null;
  prisma: PrismaLike;
}): Promise<SelfUpgradeRollbackMemberResult> {
  try {
    const result = await args.runner({
      sourceBackupRunId: args.sourceBackupRunId,
      initiatedByUserId: args.initiatedByUserId,
      trigger: ROLLBACK_TRIGGER,
      prismaClient: args.prisma,
      acquireLock: false,
    });
    return {
      target: args.target,
      sourceBackupRunId: args.sourceBackupRunId,
      restoreId: result.restoreId,
      status: result.status,
    };
  } catch (err) {
    return {
      target: args.target,
      sourceBackupRunId: args.sourceBackupRunId,
      restoreId: null,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runSelfUpgradeRollback(
  args: RollbackArgs,
): Promise<SelfUpgradeRollbackResult> {
  const prisma = args.prismaClient ?? defaultPrisma;
  const now = args.now ?? (() => new Date());
  const initiatedByUserId = args.initiatedByUserId ?? null;
  const startedAt = now();

  const run = await prisma.selfUpgradeRun.findUnique({
    where: { runId: args.runId },
    select: {
      runId: true,
      trigger: true,
      currentSha: true,
      targetSha: true,
      deployedSha: true,
      startedAt: true,
      createdAt: true,
      status: true,
      completionEvidence: true,
      failureLog: true,
    },
  });
  if (!run) {
    throw new SelfUpgradeRollbackError(`SelfUpgradeRun ${args.runId} not found.`);
  }
  if (run.status === "running") {
    throw new SelfUpgradeRollbackError("Cannot rollback while the self-upgrade run is still running.");
  }

  const recoveryPoint = parseRecoveryPoint(run.completionEvidence);
  if (!recoveryPoint) {
    throw new SelfUpgradeRollbackError("Self-upgrade run has no governed recovery point.");
  }
  const memberRunIds = memberMap(recoveryPoint);
  const sourceSnapshots = await loadRecoverySourceSnapshots(prisma, memberRunIds);
  const runners = await resolveRunners(args.runners);

  const restores: SelfUpgradeRollbackMemberResult[] = [];
  const release = acquireRestoreLock(`${ROLLBACK_TRIGGER}:${args.runId}`);
  try {
    for (const target of RESTORE_ORDER) {
      const result = await runRestoreMember({
        target,
        sourceBackupRunId: memberRunIds[target],
        runner: runners[target],
        initiatedByUserId,
        prisma,
      });
      restores.push(result);

      // Postgres restore rewinds the DB to a point before the Neo4j/Qdrant
      // BackupRun rows existed. Reinsert all source rows before continuing.
      if (target === "postgres") {
        await upsertBackupRunSnapshots(prisma, sourceSnapshots);
      }

      if (result.status === "failed") break;
    }
  } finally {
    release();
  }

  const status = restores.every((restore) => restore.status === "ok") &&
    restores.length === RESTORE_ORDER.length
    ? "ok"
    : "failed";
  const completedAt = now();
  const rollback: SelfUpgradeRollbackEvidence = {
    schemaVersion: 1,
    trigger: ROLLBACK_TRIGGER,
    status,
    selfUpgradeRunId: args.runId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    initiatedByUserId,
    restoreOrder: RESTORE_ORDER,
    restores,
  };

  await recordRollbackEvidence({
    prisma,
    run,
    recoveryPoint,
    rollback,
  });

  return {
    ok: status === "ok",
    status,
    runId: args.runId,
    restores,
    ...(status === "failed" ? { error: summarizeRestoreFailure(restores) } : {}),
  };
}

export function hasGovernedRecoveryPoint(completionEvidence: unknown): boolean {
  const recoveryPoint = parseRecoveryPoint(completionEvidence);
  if (!recoveryPoint) return false;
  try {
    memberMap(recoveryPoint);
    return true;
  } catch {
    return false;
  }
}

export { RestoreIntegrityError, RestoreLockedError };
