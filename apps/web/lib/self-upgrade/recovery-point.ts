import { runNeo4jBackup } from "@/lib/operate/backups/neo4j-backup-runner";
import { runPostgresBackup } from "@/lib/operate/backups/postgres-backup-runner";
import { runQdrantBackup } from "@/lib/operate/backups/qdrant-backup-runner";
import type { BackupTarget } from "@/lib/operate/backups/types";

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
  runners?: {
    postgres?: typeof runPostgresBackup;
    neo4j?: typeof runNeo4jBackup;
    qdrant?: typeof runQdrantBackup;
  };
  now?: () => Date;
}

const RECOVERY_TRIGGER = "pre-upgrade-recovery" as const;

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

  const runners = {
    postgres: args.runners?.postgres ?? runPostgresBackup,
    neo4j: args.runners?.neo4j ?? runNeo4jBackup,
    qdrant: args.runners?.qdrant ?? runQdrantBackup,
  };

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

async function runMember(
  target: BackupTarget,
  run: () => Promise<{ runId: string; status: "ok" | "failed" }>,
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
