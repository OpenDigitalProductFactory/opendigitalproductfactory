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
