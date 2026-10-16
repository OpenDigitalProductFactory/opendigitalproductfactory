import { isRecord } from "@/lib/shared/coerce";
import { readRoutingEligibility, type RoutingEligibility } from "../inference/routing-exclusion-buckets";

/** Immutable request limits shared by recovery and its readback; this grants no authority. */
export const SEMANTIC_REVIEW_MAX_ATTEMPTS = 3;
/** A recorded wait can be considered for recovery, subject to authority and budget checks. */
export function isSemanticReviewRecoveryWait(status: string): boolean {
  return status === "input-required" || status === "auth-required" || status === "stalled";
}
export type SemanticReviewBudgetSnapshot = { deadlineAt: string | null; recoveryAttempt: number | null;
  eligibilityBlocked?: boolean; routingEligibility?: RoutingEligibility[] };
export function semanticReviewEligibilityBlocked(reason: unknown): boolean {
  return typeof reason === "string" && reason.split(",").includes("review-endpoint-ineligible");
}
/** Read bound durable branches, including mixed-outcome runs and executor loss. */
export function semanticReviewNodeEligibility(nodes: readonly { status: string; outputSnapshot: unknown }[], requestDigest: string): RoutingEligibility[] {
  return nodes.flatMap(node => {
    const output = isRecord(node.outputSnapshot) ? node.outputSnapshot : {};
    if (node.status === "superseded" || output.requestDigest !== requestDigest) return [];
    const result = isRecord(output.result) ? output.result : {};
    const failure = isRecord(output.failure) ? output.failure : {};
    const candidates = Array.isArray(output.routingEligibility) ? output.routingEligibility
      : Array.isArray(result.routingEligibility) ? result.routingEligibility : [failure.routingEligibility];
    return candidates.slice(0, 5).flatMap(value => { const safe = readRoutingEligibility(value); return safe ? [safe] : []; });
  }).slice(0, 5);
}
/** Both execution views read the same versioned payload; this is not authorization. */
export function readSemanticReviewBudget(payload: unknown): SemanticReviewBudgetSnapshot {
  const progress = isRecord(payload) ? payload.semanticReview : null;
  const budget = isRecord(progress) && progress.schemaVersion === 1 ? progress : null;
  const attempt = budget ? budget.recoveryAttempt === undefined ? 0 : budget.recoveryAttempt : null;
  const routingEligibility = Array.isArray(budget?.routingEligibility)
    ? budget.routingEligibility.slice(0, 5).flatMap(value => { const safe = readRoutingEligibility(value); return safe ? [safe] : []; }) : [];
  return { deadlineAt: typeof budget?.deadlineAt === "string" ? budget.deadlineAt : null,
    recoveryAttempt: typeof attempt === "number" ? attempt : null,
    ...(semanticReviewEligibilityBlocked(budget?.reason) || routingEligibility.length ? { eligibilityBlocked: true } : {}),
    ...(routingEligibility.length ? { routingEligibility } : {}) };
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
  const classification = successorTaskRunId ? "superseded" : status === "completed" ? "completed"
    : status === "canceled" ? "canceled" : status === "auth-required" ? "authorization-required" : executing ? "active-execution"
    : (recorded.executionOutcome === "unknown" || reason?.startsWith("provider-outcome-uncertain")) ? "execution-uncertain"
    : snapshot.eligibilityBlocked ? "routing-blocked" : "infrastructure-inconclusive";
  return { ...snapshot, eligibility: snapshot.routingEligibility ?? [], budget, executing, classification, reason, successorTaskRunId,
    requestDigest: typeof recorded.requestDigest === "string" && /^[a-f0-9]{64}$/.test(recorded.requestDigest) ? recorded.requestDigest : null,
    remainingAttempts: snapshot.recoveryAttempt === null || !Number.isSafeInteger(snapshot.recoveryAttempt) || snapshot.recoveryAttempt < 0 ? null : Math.max(0, SEMANTIC_REVIEW_MAX_ATTEMPTS - snapshot.recoveryAttempt),
    pollUseful: executing,
    nextAction: successorTaskRunId ? "Read the successor task."
      : status === "completed" ? "Read the independent review receipt."
      : status === "canceled" ? "This review was canceled. Inspect its history before any new review."
      : status === "auth-required" ? "Restore the original requester's authority before requesting recovery."
      : executing ? "Observe this task; do not submit duplicate inference."
      : snapshot.eligibilityBlocked ? "Verify scoped endpoint eligibility remediation and record fresh runtime evidence before requesting recovery. An unchanged retry cannot resolve this refusal; the original budget still applies."
      : budget === "available" ? "Reconcile the execution, then confirm retry_semantic_review if replacement is required."
      : budget === "expired" && recorded.successorAttempt !== undefined ? "The successor window is exhausted. Inspect the recorded failure; this lineage cannot renew again."
      : budget === "expired" ? "The original window cannot resume. Record remediation evidence before requesting a bounded successor."
      : "Inspect the immutable request and exhausted or unknown recovery limits." };
}
