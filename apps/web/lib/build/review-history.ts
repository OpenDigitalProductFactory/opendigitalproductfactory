import { computeReviewDelta, isOscillating, type ReviewResult } from "@/lib/feature-build-types";
import { mergeReviews } from "./build-reviewers";
import { isReviewExecutionIncomplete } from "./review-execution-state";

type History = { round: number; issues: ReviewResult["issues"] };
function readHistory(value: unknown, round: unknown): History {
  const issues = Array.isArray(value) ? value.filter((issue): issue is ReviewResult["issues"][number] =>
    issue && ["critical", "important", "minor"].includes(issue.severity) && typeof issue.description === "string",
  ) : [];
  return { round: typeof round === "number" && Number.isSafeInteger(round) && round >= 0 ? round : 0, issues };
}

/** Read semantic history only. Old incomplete rows contain synthetic findings. */
export function readReviewHistory(value: unknown): History {
  const review = value as Partial<ReviewResult> | null;
  if (isReviewExecutionIncomplete(review)) {
    return readHistory(review?.completedReviewHistory?.issues, review?.completedReviewHistory?.round);
  }
  return readHistory(review?.issues, review?.iteration?.round);
}

/** A missing member of the two-reviewer panel cannot silently approve work. */
export function assembleReviewPanel(first: ReviewResult | null, second: ReviewResult | null): ReviewResult {
  const usable = [first, second].filter((review): review is ReviewResult =>
    review !== null && !isReviewExecutionIncomplete(review),
  );
  if (usable.length === 2) return { ...mergeReviews(usable[0], usable[1]), usableReviewerCount: 2 };
  return {
    decision: "fail", // Existing recovery consumers use fail + reviewIncomplete.
    reviewIncomplete: true,
    usableReviewerCount: usable.length,
    issues: usable.flatMap(review => review.issues),
    summary: `Review incomplete: ${usable.length} of 2 reviewers returned a usable verdict. Retry the review; do not revise the document for a reviewer outage.`,
  };
}

/** Transport attempts preserve the last completed round instead of spending it. */
export function finishReviewIteration(review: ReviewResult, prior: History): ReviewResult {
  if (isReviewExecutionIncomplete(review)) {
    return { ...review, completedReviewHistory: prior, iteration: { round: prior.round } };
  }
  const delta = prior.issues.length ? computeReviewDelta(prior.issues, review.issues) : undefined;
  return { ...review, iteration: {
    round: prior.round + 1,
    ...(delta ? { prior: delta, oscillating: isOscillating(delta, review.issues.length) } : {}),
  } };
}
