import type { SemanticReviewDecision, SemanticReviewResult } from "@/lib/change-review/semantic-change-review";

/** Execution metadata is separate from an artifact's semantic verdict. */
export type ReviewExecutionMetadata = {
  reviewIncomplete?: boolean;
  usableReviewerCount?: number;
  completedReviewHistory?: { round: number; issues: SemanticReviewResult["issues"] };
};

/** Shared by gates, recovery, history and browser read models; no server imports. */
export function isReviewExecutionIncomplete(review: {
  decision?: SemanticReviewDecision;
  reviewIncomplete?: boolean;
  parseError?: boolean;
} | null | undefined): boolean {
  return !!review && (review.reviewIncomplete === true || review.parseError === true || review.decision === "inconclusive");
}
