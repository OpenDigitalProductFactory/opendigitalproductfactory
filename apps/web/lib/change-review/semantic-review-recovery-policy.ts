import { isRecord } from "@/lib/shared/coerce";

/** Immutable request limits shared by recovery and its readback; this grants no authority. */
export const SEMANTIC_REVIEW_MAX_ATTEMPTS = 3;
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
