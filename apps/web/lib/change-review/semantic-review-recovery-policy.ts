import { isRecord } from "@/lib/shared/coerce";

/** Immutable request limits shared by recovery and its readback; this grants no authority. */
export const SEMANTIC_REVIEW_MAX_ATTEMPTS = 3;
const capacityReasons = new Set(["local-ci-active-capacity-reservation", "local-ci-queued-capacity-reservation",
  "local-ci-capacity-reservation-unavailable", "host-gpu-busy", "local-runner-busy"]);
export function isSemanticReviewCapacityReason(value: unknown): value is string {
  return typeof value === "string" && capacityReasons.has(value);
}
/** Readback and reconciliation share the same bounded wait shape; this grants no authority. */
export function readCapacityRecoveryWait(progress: unknown) {
  const state = isRecord(progress) ? progress : {};
  const marker = isRecord(state.capacityRecovery) ? state.capacityRecovery : {};
  if (state.reason !== "review-capacity-deferred" || state.executionOutcome === "unknown" || state.branchFailure
    || (Array.isArray(state.routingEligibility) && state.routingEligibility.length > 0)
    || marker.schemaVersion !== 1 || marker.requestDigest !== state.requestDigest
    || typeof marker.requestDigest !== "string" || !/^[a-f0-9]{64}$/.test(marker.requestDigest)
    || typeof marker.checks !== "number" || !Number.isSafeInteger(marker.checks) || marker.checks < 0 || marker.checks > 1024
    || typeof marker.nextCheckAt !== "string" || !Number.isFinite(Date.parse(marker.nextCheckAt))) return null;
  const reason = isSemanticReviewCapacityReason(state.capacityWaitReason)
    || state.capacityWaitReason === "portal-quiescing" || state.capacityWaitReason === "review-authority-unavailable"
    || state.capacityWaitReason === "review-capacity-observation-unavailable"
    ? state.capacityWaitReason : null;
  return { requestDigest: marker.requestDigest, checks: marker.checks, nextCheckAt: marker.nextCheckAt, reason };
}
/** A recorded wait can be considered for recovery, subject to authority and budget checks. */
export function isSemanticReviewRecoveryWait(status: string): boolean {
  return status === "input-required" || status === "auth-required" || status === "stalled";
}
export type SemanticReviewBudgetSnapshot = { deadlineAt: string | null; recoveryAttempt: number | null };
/** Both execution views read the same versioned payload; this is not authorization. */
export function readSemanticReviewBudget(payload: unknown): SemanticReviewBudgetSnapshot {
  const progress = isRecord(payload) ? payload.semanticReview : null;
  const budget = isRecord(progress) && progress.schemaVersion === 1 ? progress : null;
  const attempt = budget ? budget.recoveryAttempt === undefined ? 0 : budget.recoveryAttempt : null;
  return { deadlineAt: typeof budget?.deadlineAt === "string" ? budget.deadlineAt : null,
    recoveryAttempt: typeof attempt === "number" ? attempt : null };
}
export function semanticReviewRecoveryBudget(deadlineAt: unknown, recoveryAttempt: unknown, now = Date.now()): "available" | "unknown" | "expired" | "exhausted" {
  const deadline = typeof deadlineAt === "string" ? Date.parse(deadlineAt) : NaN;
  if (!Number.isFinite(deadline)) return "unknown";
  if (now >= deadline) return "expired";
  const attempt = recoveryAttempt === undefined ? 0 : recoveryAttempt;
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 0) return "unknown";
  if (attempt >= SEMANTIC_REVIEW_MAX_ATTEMPTS) return "exhausted";
  return "available";
}

/** Bounded public readback; never expose request bodies or treat availability as consent. */
export function semanticReviewRecoveryObservation(status: string, payload: unknown, now = Date.now()) {
  const snapshot = readSemanticReviewBudget(payload);
  const recorded = isRecord(payload) && isRecord(payload.semanticReview) ? payload.semanticReview : {};
  const budget = semanticReviewRecoveryBudget(snapshot.deadlineAt, snapshot.recoveryAttempt, now);
  const executing = status === "working" || status === "submitted";
  const successorTaskRunId = typeof recorded.successorTaskRunId === "string" ? recorded.successorTaskRunId : null;
  const reason = typeof recorded.reason === "string" ? recorded.reason : null;
  const capacityRecovery = status === "input-required" && budget === "available" ? readCapacityRecoveryWait(recorded) : null;
  const classification = successorTaskRunId ? "superseded" : status === "completed" ? "completed"
    : status === "canceled" ? "canceled" : status === "auth-required" ? "authorization-required" : executing ? "active-execution"
    : (recorded.executionOutcome === "unknown" || reason?.startsWith("provider-outcome-uncertain")) ? "execution-uncertain"
    : capacityRecovery ? "capacity-wait" : "infrastructure-inconclusive";
  return { ...snapshot, budget, executing, classification, reason, successorTaskRunId, capacityRecovery,
    manualRecoveryWait: isSemanticReviewRecoveryWait(status) && !capacityRecovery,
    requestDigest: typeof recorded.requestDigest === "string" && /^[a-f0-9]{64}$/.test(recorded.requestDigest) ? recorded.requestDigest : null,
    remainingAttempts: snapshot.recoveryAttempt === null || !Number.isSafeInteger(snapshot.recoveryAttempt) || snapshot.recoveryAttempt < 0 ? null : Math.max(0, SEMANTIC_REVIEW_MAX_ATTEMPTS - snapshot.recoveryAttempt),
    pollUseful: executing || Boolean(capacityRecovery),
    nextAction: successorTaskRunId ? "Read the successor task."
      : status === "completed" ? "Read the independent review receipt."
      : status === "canceled" ? "This review was canceled. Inspect its history before any new review."
      : status === "auth-required" ? "Restore the original requester's authority before requesting recovery."
      : executing ? "Observe this task; do not submit duplicate inference."
      : capacityRecovery ? `The server will recheck capacity after ${capacityRecovery.nextCheckAt} within the original window; do not submit duplicate inference.`
      : budget === "available" ? "Reconcile the execution, then confirm retry_semantic_review if replacement is required."
      : budget === "expired" && recorded.successorAttempt !== undefined ? "The successor window is exhausted. Inspect the recorded failure; this lineage cannot renew again."
      : budget === "expired" ? "The original window cannot resume. Record remediation evidence before requesting a bounded successor."
      : "Inspect the immutable request and exhausted or unknown recovery limits." };
}
