import type { InitiativeReviewBinding } from "./mcp-task-review-contract";
import { loadInitiativeReviewOutcome, loadTaskInitiativeReviewOutcome } from "./mcp-task-review-outcome";
import { refuseReassessmentExecution } from "./routing/reassessment-execution-scope";
import { requiresCanonicalReviewReceipt, type CanonicalReviewReceiptCheck } from "./tak/reassessment-loop";

/** This closure is supplied only by the worker for its authenticated binding. */
export function createReassessmentReceiptCheck(taskRunId: string, binding: InitiativeReviewBinding | undefined): CanonicalReviewReceiptCheck | undefined {
  if (!binding || !requiresCanonicalReviewReceipt(binding)) return undefined;
  return async result => {
    const receiptId = typeof result.data?.receiptId === "string" && result.data.receiptId.trim() ? result.data.receiptId.trim() : null;
    let unavailable = false;
    const outcome = (receiptId ? await loadInitiativeReviewOutcome(binding, receiptId)
      .catch(() => { unavailable = true; return null; }) : null)
      ?? await loadTaskInitiativeReviewOutcome(taskRunId, binding).catch(() => { unavailable = true; return null; });
    if (outcome) return { receiptId: outcome.receiptId, summary: outcome.summary };
    if (unavailable || result.success) refuseReassessmentExecution("reassessment-effect-outcome-uncertain",
      "The canonical review receipt could not be verified. Further execution is held for authoritative readback.");
    return null;
  };
}
