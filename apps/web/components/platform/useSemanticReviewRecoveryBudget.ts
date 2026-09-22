"use client";

import { useDeadlineClock } from "@/components/ui/useDeadlineClock";
import { semanticReviewRecoveryBudget, type SemanticReviewBudgetSnapshot } from "@/lib/change-review/semantic-review-recovery-policy";

/** One deadline clock for recovery controls and their current-next-action explanation. */
export function useSemanticReviewRecoveryBudget(budget?: SemanticReviewBudgetSnapshot, enabled = true) {
  const deadline = budget?.deadlineAt ? Date.parse(budget.deadlineAt) : NaN;
  const { refreshClock } = useDeadlineClock(deadline, enabled);
  return { budgetState: semanticReviewRecoveryBudget(budget?.deadlineAt, budget?.recoveryAttempt),
    refreshBudget: refreshClock };
}
