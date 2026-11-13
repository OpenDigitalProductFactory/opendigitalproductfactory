type RecoveryCandidate = {
  status: string;
  completedAt: Date | null;
  admissionFingerprint: string | null;
  dispatchStatus: string | null;
  targetSha: string | null;
  targetTag: string | null;
  dispatchAttemptCount: number;
  dispatchAcknowledgedAt: Date | null;
  dispatchEventIds: string[];
};

/** Only a proven never-dispatched terminal failure can be a typed predecessor. */
export function isEligibleRecoveryPredecessor<T extends RecoveryCandidate>(
  run: T | null,
): run is T & { targetSha: string; targetTag: string } {
  return !!run && run.status === "failed" && run.completedAt != null
    && !!run.admissionFingerprint && !!run.dispatchStatus
    && !!run.targetSha && !!run.targetTag
    && run.dispatchAttemptCount === 0
    && run.dispatchAcknowledgedAt === null && run.dispatchEventIds.length === 0;
}

export interface SelfUpgradeRecoveryPointSnapshot {
  schemaVersion: 1;
  trigger: "pre-upgrade-recovery";
  status: "ok" | "degraded" | "failed" | "skipped";
  members: Array<{ target: string; runId: string | null; status: "ok" | "failed" | "skipped" }>;
}

export type SelfUpgradeRecoveryReason =
  | "no-upgrade-run" | "upgrade-running" | "recovery-point-missing"
  | "recovery-point-incomplete" | "already-restored"
  | "reassessment-rollback-retention-unproven";

export interface SelfUpgradeRecoveryState {
  point: SelfUpgradeRecoveryPointSnapshot | null;
  backupRunIds: { postgres: string } | null;
  rollbackStatus: string | null;
  available: boolean;
  reason: SelfUpgradeRecoveryReason;
  detail: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function parseRecoveryPoint(value: unknown): SelfUpgradeRecoveryPointSnapshot | null {
  const point = record(value);
  if (!point || point.schemaVersion !== 1 || point.trigger !== "pre-upgrade-recovery"
    || typeof point.status !== "string" || !["ok", "degraded", "failed", "skipped"].includes(point.status)
    || !Array.isArray(point.members)) return null;
  for (const value of point.members) {
    const member = record(value);
    if (!member || typeof member.target !== "string" || !member.target.trim()
      || typeof member.status !== "string" || !["ok", "failed", "skipped"].includes(member.status)
      || !(member.runId === null || typeof member.runId === "string")) return null;
  }
  return point as unknown as SelfUpgradeRecoveryPointSnapshot;
}

/** A saved backup is evidence of backup creation, never authority to rewind history. */
export function getSelfUpgradeRecoveryState(run: {
  status: string; completionEvidence?: unknown;
} | null): SelfUpgradeRecoveryState {
  const evidence = record(run?.completionEvidence);
  const point = parseRecoveryPoint(evidence?.recoveryPoint);
  const rollback = record(evidence?.rollback);
  const postgres = point?.status === "ok" ? point.members.find(member =>
    member.target === "postgres" && member.status === "ok" && member.runId?.trim()) : null;
  const snapshot = { point, backupRunIds: postgres?.runId ? { postgres: postgres.runId } : null,
    rollbackStatus: typeof rollback?.status === "string" ? rollback.status : null };
  const unavailable = (reason: SelfUpgradeRecoveryReason, detail: string): SelfUpgradeRecoveryState =>
    ({ ...snapshot, available: false, reason, detail });
  if (!run) return unavailable("no-upgrade-run", "No completed update is available to restore.");
  if (["queued", "pending", "running", "completing"].includes(run.status)) {
    return unavailable("upgrade-running", "Restoration is unavailable while the update is in progress.");
  }
  if (!point) return unavailable("recovery-point-missing", "This update has no governed recovery point.");
  if (point.status !== "ok") return unavailable("recovery-point-incomplete",
    `Recovery point status is ${point.status}; only complete recovery points can be restored.`);
  if (!snapshot.backupRunIds) return unavailable("recovery-point-incomplete",
    "Recovery point is missing successful backup members: postgres.");
  if (snapshot.rollbackStatus === "ok") return unavailable("already-restored",
    "This recovery point was restored previously; another restore is unavailable.");
  // No producer proves retained history, exclusion through restoration, or settled restoration.
  // Caller metadata and an empty active-task inventory cannot supply that proof.
  return unavailable("reassessment-rollback-retention-unproven",
    "Database restoration is unavailable until review history can be preserved safely.");
}
