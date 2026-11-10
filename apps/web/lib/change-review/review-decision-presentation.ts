import type { SemanticReviewDecision } from "./semantic-change-review";

export type SemanticReviewDecisionPresentation = {
  title: string;
  variant: "success" | "error" | "warn";
};

const DECISION_PRESENTATION: Record<
  SemanticReviewDecision,
  SemanticReviewDecisionPresentation
> = {
  pass: { title: "Review approved", variant: "success" },
  fail: { title: "Changes requested", variant: "error" },
  inconclusive: { title: "Review incomplete", variant: "warn" },
};

export function semanticReviewDecisionPresentation(
  decision: SemanticReviewDecision,
  executionIncomplete = false,
): SemanticReviewDecisionPresentation {
  return DECISION_PRESENTATION[executionIncomplete ? "inconclusive" : decision];
}
