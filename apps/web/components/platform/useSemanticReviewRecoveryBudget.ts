"use client";

import { useEffect, useState } from "react";
import { semanticReviewRecoveryBudget, type SemanticReviewBudgetSnapshot } from "@/lib/change-review/semantic-review-recovery-policy";

/** One deadline clock for recovery controls and their current-next-action explanation. */
export function useSemanticReviewRecoveryBudget(budget?: SemanticReviewBudgetSnapshot, enabled = true) {
  const [clockTick, setClockTick] = useState(0);
  const deadline = budget?.deadlineAt ? Date.parse(budget.deadlineAt) : NaN;
  useEffect(() => {
    if (!enabled || !Number.isFinite(deadline) || deadline <= Date.now()) return;
    const timer = setTimeout(() => setClockTick(tick => tick + 1), Math.min(deadline - Date.now(), 2_147_483_647));
    return () => clearTimeout(timer);
  }, [enabled, deadline, clockTick]);
  return { budgetState: semanticReviewRecoveryBudget(budget?.deadlineAt, budget?.recoveryAttempt),
    refreshBudget: () => setClockTick(tick => tick + 1) };
}
