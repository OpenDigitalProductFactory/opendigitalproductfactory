import { readPairedRecoveryReceipt, type PairedRecoveryReceipt } from "@dpf/integration-shared/paired-recovery-contract";

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

interface RecoveryPointFields {
  trigger: "pre-upgrade-recovery";
  status: "ok" | "degraded" | "failed" | "skipped";
  members: Array<{ target: string; runId: string | null; status: "ok" | "failed" | "skipped" }>;
}

export type SelfUpgradeRecoveryPointSnapshot = RecoveryPointFields & (
  { schemaVersion: 1 } | { schemaVersion: 2; pairedReceipt: PairedRecoveryReceipt }
);

export type SelfUpgradeRecoveryReason =
  | "no-upgrade-run" | "upgrade-running" | "recovery-point-missing"
  | "recovery-point-incomplete" | "already-restored"
  | "reassessment-rollback-retention-unproven";

export interface SelfUpgradeRecoveryState {
  point: SelfUpgradeRecoveryPointSnapshot | null;
  backupRunIds: { postgres: string; uploads?: string } | null;
  membership: "legacy-postgres" | "paired" | "incomplete" | null;
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
  if (!point || (point.schemaVersion !== 1 && point.schemaVersion !== 2) || point.trigger !== "pre-upgrade-recovery"
    || typeof point.status !== "string" || !["ok", "degraded", "failed", "skipped"].includes(point.status)
    || !Array.isArray(point.members)) return null;
  for (const value of point.members) {
    const member = record(value);
    if (!member || typeof member.target !== "string" || !member.target.trim()
      || typeof member.status !== "string" || !["ok", "failed", "skipped"].includes(member.status)
      || !(member.runId === null || typeof member.runId === "string")) return null;
  }
  if (point.schemaVersion === 2 && !readPairedRecoveryReceipt(point.pairedReceipt)) return null;
  return point as unknown as SelfUpgradeRecoveryPointSnapshot;
}

function readMembership(
  point: SelfUpgradeRecoveryPointSnapshot | null, raw: Record<string, unknown> | null,
): Pick<SelfUpgradeRecoveryState, "membership" | "backupRunIds"> {
  if (!point) return { membership: raw?.schemaVersion === 2 ? "incomplete" : null, backupRunIds: null };
  const incomplete = { membership: "incomplete", backupRunIds: null } as const;
  if (point.status !== "ok") return incomplete;
  const postgres = point.members.filter((member) => member.target === "postgres");
  const uploads = point.members.filter((member) => member.target === "uploads");
  const pg = postgres[0];
  if (postgres.length !== 1 || pg?.status !== "ok" || !pg.runId?.trim()) return incomplete;
  if (point.schemaVersion === 1) {
    if (uploads.length !== 0 || (raw && Object.hasOwn(raw, "pairedReceipt"))) return incomplete;
    return { membership: "legacy-postgres", backupRunIds: { postgres: pg.runId } };
  }
  const upload = uploads[0];
  const pair = point.pairedReceipt;
  if (point.members.length !== 2 || uploads.length !== 1 || upload?.status !== "ok"
    || upload.runId !== pair.uploads.runId || pg.runId !== pair.postgres.runId) return incomplete;
  return { membership: "paired", backupRunIds: { postgres: pg.runId, uploads: upload.runId } };
}

/** A saved backup is evidence of backup creation, never authority to rewind history. */
export function getSelfUpgradeRecoveryState(run: {
  status: string; completionEvidence?: unknown;
} | null): SelfUpgradeRecoveryState {
  const evidence = record(run?.completionEvidence);
  const rawPoint = record(evidence?.recoveryPoint);
  const point = parseRecoveryPoint(rawPoint);
  const rollback = record(evidence?.rollback);
  const snapshot = { point, ...readMembership(point, rawPoint),
    rollbackStatus: typeof rollback?.status === "string" ? rollback.status : null };
  const unavailable = (reason: SelfUpgradeRecoveryReason, detail: string): SelfUpgradeRecoveryState =>
    ({ ...snapshot, available: false, reason, detail });
  if (!run) return unavailable("no-upgrade-run", "No completed update is available to restore.");
  if (["queued", "pending", "running", "completing"].includes(run.status)) {
    return unavailable("upgrade-running", "Restoration is unavailable while the update is in progress.");
  }
  if (!point) return snapshot.membership === "incomplete"
    ? unavailable("recovery-point-incomplete", "This update's paired recovery evidence is incomplete or invalid.")
    : unavailable("recovery-point-missing", "This update has no governed recovery point.");
  if (point.status !== "ok") return unavailable("recovery-point-incomplete",
    `Recovery point status is ${point.status}; only complete recovery points can be restored.`);
  if (!snapshot.backupRunIds) return unavailable("recovery-point-incomplete",
    point.schemaVersion === 2 || point.members.some(member => member.target === "uploads")
      ? "Recovery point is missing exact paired Postgres and uploads evidence."
      : "Recovery point is missing successful backup members: postgres.");
  if (snapshot.rollbackStatus === "ok") return unavailable("already-restored",
    "This recovery point was restored previously; another restore is unavailable.");
  // BI-EDE6D56A tracks the producer for retained history, exclusion through restoration,
  // and settled restoration. Neither legacy nor valid paired membership supplies that proof.
  // Caller metadata and an empty active-task inventory cannot supply that proof.
  return unavailable("reassessment-rollback-retention-unproven",
    "Database restoration is unavailable until review history can be preserved safely.");
}
