import type { PairedRecoveryReceipt } from "@dpf/integration-shared/paired-recovery-contract";
import { getErrorMessage } from "@/lib/shared/get-error-message";

import { readCapturedBackupPair } from "@/lib/operate/backups/captured-backup-pair";
import { persistSelfUpgradeRecoveryPoint, readSelfUpgradeRecoveryPoint } from "./recovery-point-store";

const RECOVERY_TRIGGER = "pre-upgrade-recovery" as const;

type Target = "postgres" | "uploads";
type BackupRunnerResult = { runId: string | null; status: "ok" | "failed"; error?: string };
type CapturedMember<T extends Target> = { target: T; runId: string; status: "ok" };
type FailedMember<T extends Target> = { target: T; runId: string | null; status: "failed"; error?: string };
type Member<T extends Target> = CapturedMember<T> | FailedMember<T>;

interface RecoveryPointIdentity {
  schemaVersion: 2;
  trigger: typeof RECOVERY_TRIGGER;
  selfUpgradeRunId: string;
  createdAt: string;
}

export interface SuccessfulSelfUpgradeRecoveryPoint extends RecoveryPointIdentity {
  status: "ok";
  members: [CapturedMember<"postgres">, CapturedMember<"uploads">];
  pairedReceipt: PairedRecoveryReceipt;
}

export type SelfUpgradeRecoveryPoint = SuccessfulSelfUpgradeRecoveryPoint | (RecoveryPointIdentity & {
  status: "failed" | "skipped";
  members: Member<Target>[];
  pairedReceipt: null;
  reason?: string;
});

interface CreateRecoveryPointArgs {
  runId: string;
  dryRun?: boolean;
  composeProject?: string;
  backupsRoot?: string;
  now?: () => Date;
}

async function capture<T extends Target>(
  target: T,
  run: () => Promise<BackupRunnerResult>,
): Promise<Member<T>> {
  try {
    const result = await run();
    if (result.status === "ok" && result.runId) return { target, runId: result.runId, status: "ok" };
    const error = result.error ?? (result.status === "ok" ? "Backup did not return a run ID." : undefined);
    return { target, runId: result.runId, status: "failed", ...(error ? { error } : {}) };
  } catch (error) {
    return { target, runId: null, status: "failed", error: getErrorMessage(error) };
  }
}

export async function createSelfUpgradeRecoveryPoint(args: CreateRecoveryPointArgs): Promise<SelfUpgradeRecoveryPoint> {
  const identity: RecoveryPointIdentity = {
    schemaVersion: 2,
    trigger: RECOVERY_TRIGGER,
    selfUpgradeRunId: args.runId,
    createdAt: (args.now?.() ?? new Date()).toISOString(),
  };
  if (args.dryRun) return { ...identity, status: "skipped", members: [], pairedReceipt: null, reason: "dry-run" };

  const backupsRoot = args.backupsRoot ?? (await import("@/lib/operate/backups/managed-backup")).BACKUPS_ROOT;
  const backupArgs = { trigger: RECOVERY_TRIGGER, composeProject: args.composeProject, backupsRoot };
  const failed = (members: Member<Target>[], reason?: string): SelfUpgradeRecoveryPoint => ({
    ...identity, status: "failed", members, pairedReceipt: null, ...(reason ? { reason } : {}),
  });
  try {
    if (await readSelfUpgradeRecoveryPoint(backupsRoot, args.runId)) {
      // The previous drain may have reopened on restart. Preserve its point for
      // recovery, but never let its older data authorize another swap attempt.
      return failed([], "This run already has a retained host point. Start a fresh upgrade to capture current data.");
    }
  } catch (error) {
    return failed([], `Could not read the host recovery point: ${getErrorMessage(error)}`);
  }

  const postgres = await capture("postgres", async () => {
    const { runPostgresBackup } = await import("@/lib/operate/backups/postgres-backup-runner");
    return runPostgresBackup(backupArgs);
  });
  if (postgres.status !== "ok") return failed([postgres]);

  const uploads = await capture("uploads", async () => {
    const { runUploadsBackup } = await import("@/lib/operate/backups/uploads-backup-runner");
    return runUploadsBackup({ ...backupArgs, pairedPostgresRunId: postgres.runId });
  });
  if (uploads.status !== "ok") return failed([postgres, uploads]);

  try {
    const pairedReceipt = await readCapturedBackupPair({
      backupsRoot, postgresRunId: postgres.runId, uploadsRunId: uploads.runId,
    });
    return await persistSelfUpgradeRecoveryPoint(backupsRoot, {
      ...identity, status: "ok", members: [postgres, uploads], pairedReceipt,
    });
  } catch (error) {
    return failed([postgres, uploads], getErrorMessage(error));
  }
}

export function summarizeRecoveryPointFailure(point: SelfUpgradeRecoveryPoint): string {
  if (point.status !== "failed") return "recovery-point-failed";
  if (point.reason) return `recovery-point-failed: ${point.reason}`;
  const parts: string[] = [];
  for (const member of point.members) {
    if (member.status !== "failed") continue;
    const runId = member.runId ? ` ${member.runId}` : "";
    const suffix = member.error ? `: ${member.error}` : "";
    parts.push(`${member.target}${runId}${suffix}`);
  }
  return parts.length ? `recovery-point-failed: ${parts.join("; ")}` : "recovery-point-failed";
}
