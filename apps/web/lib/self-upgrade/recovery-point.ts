import type { BackupTarget } from "@/lib/operate/backups/types";

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
  status: "ok" | "failed";
  error?: string;
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

  const runners = await resolveRecoveryPointRunners(args.runners);

  const members: SelfUpgradeRecoveryPointMember[] = [];
  members.push(
    await runMember("postgres", () =>
      runners.postgres({
        trigger: RECOVERY_TRIGGER,
        composeProject: args.composeProject,
        backupsRoot: args.backupsRoot,
      }),
    ),
  );
  members.push(
    await runMember("neo4j", () =>
      runners.neo4j({
        trigger: RECOVERY_TRIGGER,
        composeProject: args.composeProject,
        backupsRoot: args.backupsRoot,
      }),
    ),
  );
  members.push(
    await runMember("qdrant", () =>
      runners.qdrant({
        trigger: RECOVERY_TRIGGER,
        backupsRoot: args.backupsRoot,
      }),
    ),
  );

  return {
    schemaVersion: 1,
    status: classifyRecoveryPointStatus(members),
    trigger: RECOVERY_TRIGGER,
    selfUpgradeRunId: args.runId,
    createdAt,
    members,
  };
}

/**
 * Targets whose backup MUST succeed before an upgrade may proceed. Only the
 * primary data store — postgres (epics, backlog, config, credentials) — is
 * irreplaceable. neo4j (code + knowledge graph) and qdrant (vector index) are
 * DERIVED stores, rebuilt from source by the code-graph bootstrap, so a failed
 * or skipped backup of them must NOT block an upgrade — gating on a backup of
 * regenerable data turns a transient backup-tooling fault into an upgrade
 * outage (observed 2026-06-14: a neo4j backup volume-mismatch blocked every
 * self-upgrade). Operators who want stricter gating can widen the set via
 * DPF_RECOVERY_POINT_REQUIRED_TARGETS (comma-separated targets).
 */
export const DEFAULT_REQUIRED_RECOVERY_TARGETS: readonly BackupTarget[] = ["postgres"];

const ALL_BACKUP_TARGETS: ReadonlySet<BackupTarget> = new Set([
  "postgres",
  "neo4j",
  "qdrant",
]);

export function resolveRequiredRecoveryTargets(
  env: Record<string, string | undefined> = process.env,
): Set<BackupTarget> {
  const raw = env.DPF_RECOVERY_POINT_REQUIRED_TARGETS;
  if (raw && raw.trim()) {
    const parsed = raw
      .split(",")
      .map((t) => t.trim())
      .filter((t): t is BackupTarget => ALL_BACKUP_TARGETS.has(t as BackupTarget));
    if (parsed.length > 0) return new Set(parsed);
  }
  return new Set(DEFAULT_REQUIRED_RECOVERY_TARGETS);
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
  required: Set<BackupTarget> = resolveRequiredRecoveryTargets(),
): SelfUpgradeRecoveryPointStatus {
  const requiredFailed = members.some(
    (member) => required.has(member.target) && member.status === "failed",
  );
  if (requiredFailed) return "failed";
  const anyFailed = members.some((member) => member.status === "failed");
  return anyFailed ? "degraded" : "ok";
}

async function resolveRecoveryPointRunners(
  overrides?: Partial<RecoveryPointRunners>,
): Promise<RecoveryPointRunners> {
  const [postgres, neo4j, qdrant] = await Promise.all([
    overrides?.postgres ??
      import("@/lib/operate/backups/postgres-backup-runner").then(
        (module) => module.runPostgresBackup,
      ),
    overrides?.neo4j ??
      import("@/lib/operate/backups/neo4j-backup-runner").then(
        (module) => module.runNeo4jBackup,
      ),
    overrides?.qdrant ??
      import("@/lib/operate/backups/qdrant-backup-runner").then(
        (module) => module.runQdrantBackup,
      ),
  ]);

  return { postgres, neo4j, qdrant };
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
      error: err instanceof Error ? err.message : String(err),
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
