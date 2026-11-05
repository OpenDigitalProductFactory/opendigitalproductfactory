import { isRecord } from "@/lib/shared/coerce";
import { readRoutingEligibility, type RoutingEligibility } from "../inference/routing-exclusion-buckets";

/** Immutable request limits shared by recovery and its readback; this grants no authority. */
export const SEMANTIC_REVIEW_MAX_ATTEMPTS = 3;
/**
 * A proven pre-dispatch capacity wait is not review time (BI-73D878A5): no
 * provider started, so waiting for local CI to release the runner must not
 * spend the packet's window. The credit is bounded so a wait cannot hold a
 * review open indefinitely; the packet and its own deadline never change.
 */
export const SEMANTIC_REVIEW_MAX_CAPACITY_WAIT_MS = 4 * 60 * 60_000;
/** Credited plus currently open capacity wait, capped; zero for legacy state. */
export function semanticReviewCapacityWaitMs(review: unknown, now = Date.now()): number {
  const state = isRecord(review) ? review : {};
  const credited = typeof state.capacityWaitCreditMs === "number" && Number.isSafeInteger(state.capacityWaitCreditMs)
    && state.capacityWaitCreditMs > 0 ? state.capacityWaitCreditMs : 0;
  const marker = isRecord(state.capacityRecovery) ? state.capacityRecovery : {};
  const started = typeof marker.waitStartedAt === "string" ? Date.parse(marker.waitStartedAt) : NaN;
  const open = Number.isFinite(started) ? Math.max(0, now - started) : 0;
  return Math.min(SEMANTIC_REVIEW_MAX_CAPACITY_WAIT_MS, credited + open);
}
/** The packet's deadline plus credited capacity wait; every deadline check reads this. */
export function semanticReviewEffectiveDeadline(deadlineAt: unknown, review: unknown, now = Date.now()): string | null {
  const deadline = typeof deadlineAt === "string" ? Date.parse(deadlineAt) : NaN;
  if (!Number.isFinite(deadline)) return null;
  const credit = semanticReviewCapacityWaitMs(review, now);
  return credit ? new Date(deadline + credit).toISOString() : deadlineAt as string;
}
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
  const waitStartedAt = typeof marker.waitStartedAt === "string" && Number.isFinite(Date.parse(marker.waitStartedAt))
    ? marker.waitStartedAt : null;
  return { requestDigest: marker.requestDigest, checks: marker.checks, nextCheckAt: marker.nextCheckAt, waitStartedAt, reason };
}
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
export function readSemanticReviewBudget(payload: unknown, now = Date.now()): SemanticReviewBudgetSnapshot {
  const progress = isRecord(payload) ? payload.semanticReview : null;
  const budget = isRecord(progress) && progress.schemaVersion === 1 ? progress : null;
  const attempt = budget ? budget.recoveryAttempt === undefined ? 0 : budget.recoveryAttempt : null;
  const routingEligibility = Array.isArray(budget?.routingEligibility)
    ? budget.routingEligibility.slice(0, 5).flatMap(value => { const safe = readRoutingEligibility(value); return safe ? [safe] : []; }) : [];
  // An unparseable recorded deadline is kept as recorded, so the budget reads "unknown" rather than vanishing.
  return { deadlineAt: typeof budget?.deadlineAt === "string"
      ? semanticReviewEffectiveDeadline(budget.deadlineAt, budget, now) ?? budget.deadlineAt : null,
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
  const snapshot = readSemanticReviewBudget(payload, now);
  const recorded = isRecord(payload) && isRecord(payload.semanticReview) ? payload.semanticReview : {};
  const budget = semanticReviewRecoveryBudget(snapshot.deadlineAt, snapshot.recoveryAttempt, now);
  const executing = status === "working" || status === "submitted";
  const successorTaskRunId = typeof recorded.successorTaskRunId === "string" ? recorded.successorTaskRunId : null;
  const reason = typeof recorded.reason === "string" ? recorded.reason : null;
  const executionUncertain = recorded.executionOutcome === "unknown" || reason?.startsWith("provider-outcome-uncertain");
  const allowanceResetAt = reason === "reviewer-daily-allowance-used" && typeof recorded.allowanceResetAt === "string" ? recorded.allowanceResetAt : null;
  const capacityRecovery = status === "input-required" && budget === "available" ? readCapacityRecoveryWait(recorded) : null;
  const classification = successorTaskRunId ? "superseded" : status === "completed" ? "completed"
    : status === "canceled" ? "canceled" : status === "auth-required" ? "authorization-required" : executing ? "active-execution"
    : executionUncertain ? "execution-uncertain"
    : allowanceResetAt ? "daily-allowance-used"
    : snapshot.eligibilityBlocked ? "routing-blocked" : capacityRecovery ? "capacity-wait" : "infrastructure-inconclusive";
  return { ...snapshot, eligibility: snapshot.routingEligibility ?? [], budget, executing, classification, reason, successorTaskRunId, capacityRecovery, allowanceResetAt,
    manualRecoveryWait: isSemanticReviewRecoveryWait(status) && !capacityRecovery,
    requestDigest: typeof recorded.requestDigest === "string" && /^[a-f0-9]{64}$/.test(recorded.requestDigest) ? recorded.requestDigest : null,
    remainingAttempts: snapshot.recoveryAttempt === null || !Number.isSafeInteger(snapshot.recoveryAttempt) || snapshot.recoveryAttempt < 0 ? null : Math.max(0, SEMANTIC_REVIEW_MAX_ATTEMPTS - snapshot.recoveryAttempt),
    pollUseful: executing || Boolean(capacityRecovery),
    nextAction: successorTaskRunId ? "Read the successor task."
      : status === "completed" ? "Read the independent review receipt."
      : status === "canceled" ? "This review was canceled. Inspect its history before any new review."
      : status === "auth-required" ? "Restore the original requester's authority before requesting recovery."
      : executing ? "Observe this task; do not submit duplicate inference."
      : allowanceResetAt ? `The reviewer's daily allowance for paid AI is used; no provider was asked. It resets at ${allowanceResetAt}. Submit a fresh review after the reset, or after an owner raises it in Admin > Platform Development > Paid AI allowance.`
      : executionUncertain ? "The original execution outcome is unknown. Use the owned recovery details to establish complete execution settlement before requesting any retry or successor."
      : snapshot.eligibilityBlocked ? "Verify scoped endpoint eligibility remediation and record fresh runtime evidence before requesting recovery. An unchanged retry cannot resolve this refusal; the original budget still applies."
      : capacityRecovery ? `The server will recheck capacity after ${capacityRecovery.nextCheckAt} within the original window; do not submit duplicate inference.`
      : budget === "available" ? "Reconcile the execution, then confirm retry_semantic_review if replacement is required."
      : budget === "expired" && recorded.successorAttempt !== undefined ? "The successor window is exhausted. Inspect the recorded failure; this lineage cannot renew again."
      : budget === "expired" ? "The original window cannot resume. Record remediation evidence before requesting a bounded successor."
      : "Inspect the immutable request and exhausted or unknown recovery limits." };
}
