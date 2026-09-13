/** Immutable request limits shared by recovery and its readback; this grants no authority. */
export const SEMANTIC_REVIEW_MAX_ATTEMPTS = 3;
export type SemanticReviewBudgetSnapshot = { deadlineAt: string | null; recoveryAttempt: number | null };
export function semanticReviewRecoveryBudget(deadlineAt: unknown, recoveryAttempt: unknown, now = Date.now()): "available" | "unknown" | "expired" | "exhausted" {
  const deadline = typeof deadlineAt === "string" ? Date.parse(deadlineAt) : NaN;
  if (!Number.isFinite(deadline)) return "unknown";
  if (now >= deadline) return "expired";
  const attempt = recoveryAttempt === undefined ? 0 : recoveryAttempt;
  if (typeof attempt !== "number" || !Number.isSafeInteger(attempt) || attempt < 0) return "unknown";
  if (attempt >= SEMANTIC_REVIEW_MAX_ATTEMPTS) return "exhausted";
  return "available";
}
