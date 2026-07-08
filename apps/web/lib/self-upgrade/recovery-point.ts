import type { BackupTarget } from "@/lib/operate/backups/types";
import { getErrorMessage } from "@/lib/shared/get-error-message";

const RECOVERY_TRIGGER = "pre-upgrade-recovery" as const;

type BackupRunnerResult = {
  runId: string;
  status: "ok" | "failed";
  /** Human-readable failure summary surfaced into the recovery-point member. */
  error?: string;
};
type ClusteredBackupRunner = (args: {
  trigger: typeof RECOVERY_TRIGGER;
  composeProject?: string;
  backupsRoot?: string;
}) => Promise<BackupRunnerResult>;
type QdrantBackupRunner = (args: {
  trigger: typeof RECOVERY_TRIGGER;
  backupsRoot?: string;
}) => Promise<BackupRunnerResult>;

interface RecoveryPointRunners {
  postgres: ClusteredBackupRunner;
  neo4j: ClusteredBackupRunner;
  qdrant: QdrantBackupRunner;
}

export type SelfUpgradeRecoveryPointStatus = "ok" | "degraded" | "failed" | "skipped";

export interface SelfUpgradeRecoveryPointMember {
  target: BackupTarget;
  runId: string | null;
  status: "ok" | "failed" | "skipped";
  error?: string;
  /** Why a target was skipped (a derived store that isn't backed up). */
  reason?: string;
}

export interface SelfUpgradeRecoveryPoint {
  schemaVersion: 1;
  status: SelfUpgradeRecoveryPointStatus;
  trigger: "pre-upgrade-recovery";
  selfUpgradeRunId: string;
  createdAt: string;
  members: SelfUpgradeRecoveryPointMember[];
  reason?: string;
}

interface CreateRecoveryPointArgs {
  runId: string;
  dryRun?: boolean;
  composeProject?: string;
  backupsRoot?: string;
  runners?: Partial<RecoveryPointRunners>;
  now?: () => Date;
}

export async function createSelfUpgradeRecoveryPoint(
  args: CreateRecoveryPointArgs,
): Promise<SelfUpgradeRecoveryPoint> {
  const now = args.now ?? (() => new Date());
  const createdAt = now().toISOString();

  if (args.dryRun) {
    return {
      schemaVersion: 1,
      status: "skipped",
      trigger: RECOVERY_TRIGGER,
      selfUpgradeRunId: args.runId,
      createdAt,
      members: [],
      reason: "dry-run",
    };
  }

  const backupTargets = resolveRecoveryBackupTargets();
  const overrides = args.runners ?? {};

  // postgres (the primary data store, and the only store a portal upgrade
  // migrates) is always backed up. neo4j (code + knowledge graph) and qdrant
  // (vectors) are DERIVED stores — rebuilt from source and untouched by a
  // portal upgrade — so they are skipped unless an operator opts them in via
  // DPF_RECOVERY_POINT_BACKUP_TARGETS. Skipping avoids running (and failing on)
  // a backup of regenerable data on every upgrade.
  const members: SelfUpgradeRecoveryPointMember[] = [];
  for (const target of RECOVERY_TARGET_ORDER) {
    if (backupTargets.has(target)) {
      members.push(await runBackupForTarget(target, overrides, args));
    } else {
      members.push({
        target,
        runId: null,
        status: "skipped",
        reason: DERIVED_STORE_SKIP_REASON,
      });
    }
  }

  return {
    schemaVersion: 1,
    status: classifyRecoveryPointStatus(members),
    trigger: RECOVERY_TRIGGER,
    selfUpgradeRunId: args.runId,
    createdAt,
    members,
  };
}

/** The order recovery-point members are recorded in. */
const RECOVERY_TARGET_ORDER: readonly BackupTarget[] = ["postgres", "neo4j", "qdrant"];

const DERIVED_STORE_SKIP_REASON =
  "derived store — rebuilt from source and unchanged by a portal upgrade; " +
  "not backed up (set DPF_RECOVERY_POINT_BACKUP_TARGETS to opt in)";

/**
 * The primary data store. Always backed up, and the only target whose backup
 * failure BLOCKS an upgrade: it holds the irreplaceable data (epics, backlog,
 * config, credentials) and the only schema migrations an upgrade runs.
 */
export const PRIMARY_BACKUP_TARGET: BackupTarget = "postgres";

/**
 * Which stores the pre-upgrade recovery point backs up. postgres is ALWAYS
 * included. neo4j (code + knowledge graph) and qdrant (vectors) are DERIVED
 * stores — rebuilt from source by the code-graph bootstrap and untouched by a
 * portal upgrade (separate containers + volumes) — so backing them up before
 * every upgrade is wasted work and a source of spurious failures (observed
 * 2026-06-14: a neo4j backup volume-mismatch blocked every self-upgrade). They
 * are skipped by default. An operator who prefers a fast restore over a
 * from-source rebuild can opt them in via DPF_RECOVERY_POINT_BACKUP_TARGETS
 * (comma-separated); opted-in derived backups are best-effort — a failure
 * degrades the recovery point but never blocks the upgrade.
 */
export function resolveRecoveryBackupTargets(
  env: Record<string, string | undefined> = process.env,
): Set<BackupTarget> {
  const targets = new Set<BackupTarget>([PRIMARY_BACKUP_TARGET]);
  const raw = env.DPF_RECOVERY_POINT_BACKUP_TARGETS;
  if (raw && raw.trim()) {
    for (const token of raw.split(",").map((t) => t.trim())) {
      if (token === "neo4j" || token === "qdrant") targets.add(token);
    }
  }
  return targets;
}

/**
 * Classify a recovery point from its members:
 *   - "failed"   — a REQUIRED target's backup failed → the upgrade must abort.
 *   - "degraded" — only best-effort (derived-store) backups failed → the
 *                  upgrade proceeds, but the gap is recorded for the operator.
 *   - "ok"       — every backup succeeded.
 */
export function classifyRecoveryPointStatus(
  members: SelfUpgradeRecoveryPointMember[],
  required: Set<BackupTarget> = new Set([PRIMARY_BACKUP_TARGET]),
): SelfUpgradeRecoveryPointStatus {
  const requiredFailed = members.some(
    (member) => required.has(member.target) && member.status === "failed",
  );
  if (requiredFailed) return "failed";
  const anyFailed = members.some((member) => member.status === "failed");
  return anyFailed ? "degraded" : "ok";
}

/**
 * Run the backup for a single target, lazily importing only the runner we
 * actually need — so a skipped derived store never even pulls in its backup
 * module. Test callers pass runner overrides to avoid spawning real backups.
 */
async function runBackupForTarget(
  target: BackupTarget,
  overrides: Partial<RecoveryPointRunners>,
  args: CreateRecoveryPointArgs,
): Promise<SelfUpgradeRecoveryPointMember> {
  return runMember(target, async () => {
    if (target === "postgres") {
      const run =
        overrides.postgres ??
        (await import("@/lib/operate/backups/postgres-backup-runner"))
          .runPostgresBackup;
      return run({
        trigger: RECOVERY_TRIGGER,
        composeProject: args.composeProject,
        backupsRoot: args.backupsRoot,
      });
    }
    if (target === "neo4j") {
      const run =
        overrides.neo4j ??
        (await import("@/lib/operate/backups/neo4j-backup-runner")).runNeo4jBackup;
      return run({
        trigger: RECOVERY_TRIGGER,
        composeProject: args.composeProject,
        backupsRoot: args.backupsRoot,
      });
    }
    const run =
      overrides.qdrant ??
      (await import("@/lib/operate/backups/qdrant-backup-runner")).runQdrantBackup;
    return run({
      trigger: RECOVERY_TRIGGER,
      backupsRoot: args.backupsRoot,
    });
  });
}

async function runMember(
  target: BackupTarget,
  run: () => Promise<BackupRunnerResult>,
): Promise<SelfUpgradeRecoveryPointMember> {
  try {
    const result = await run();
    return {
      target,
      runId: result.runId,
      status: result.status,
      // A runner can return status:"failed" without throwing (e.g. the backup
      // script exits non-zero). Carry its summary so the operator-facing
      // recovery-point message names the cause, not just an opaque run id.
      ...(result.status === "failed" && result.error
        ? { error: result.error }
        : {}),
    };
  } catch (err) {
    return {
      target,
      runId: null,
      status: "failed",
      error: getErrorMessage(err),
    };
  }
}

export function summarizeRecoveryPointFailure(point: SelfUpgradeRecoveryPoint): string {
  const failed = point.members.filter((member) => member.status === "failed");
  if (failed.length === 0) return "recovery-point-failed";

  const parts = failed.map((member) => {
    const runId = member.runId ? ` ${member.runId}` : "";
    const suffix = member.error ? `: ${member.error}` : "";
    return `${member.target}${runId}${suffix}`;
  });
  return `recovery-point-failed: ${parts.join("; ")}`;
}

/**
 * Human-readable note naming the best-effort (derived-store) backups that
 * failed on a "degraded" recovery point. Returns null when nothing failed.
 * The upgrade proceeds regardless; this is for the operator audit trail.
 */
export function summarizeRecoveryPointDegradation(
  point: SelfUpgradeRecoveryPoint,
): string | null {
  const failed = point.members.filter((member) => member.status === "failed");
  if (failed.length === 0) return null;

  const parts = failed.map((member) => {
    const suffix = member.error ? `: ${member.error}` : "";
    return `${member.target}${suffix}`;
  });
  return `recovery-point-degraded (best-effort backup failed, upgrade proceeding): ${parts.join("; ")}`;
}
