import type { BackupTarget } from "@/lib/operate/backups/types";

const RECOVERY_TRIGGER = "pre-upgrade-recovery" as const;

type BackupRunnerResult = { runId: string; status: "ok" | "failed" };
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

export type SelfUpgradeRecoveryPointStatus = "ok" | "failed" | "skipped";

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
    status: members.every((member) => member.status === "ok") ? "ok" : "failed",
    trigger: RECOVERY_TRIGGER,
    selfUpgradeRunId: args.runId,
    createdAt,
    members,
  };
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
