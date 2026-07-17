type ContributionDecisionInput = {
  disposition?: string | null;
  dispositionSuggested?: string | null;
  dispositionSuggestionReason?: string | null;
};

export type ContributionDecisionView = {
  currentLabel: string;
  currentDetail: string;
  recommendationLabel: string;
  reason: string;
  canShare: boolean;
};

export function deriveContributionDecisionView(input: ContributionDecisionInput): ContributionDecisionView {
  const disposition = input.disposition === "shareable" ? "shareable" : "private";
  const suggested = input.dispositionSuggested === "shareable" ? "shareable" : "private";
  const hasAssessment = typeof input.dispositionSuggested === "string" || !!input.dispositionSuggestionReason?.trim();

  return {
    currentLabel: disposition === "shareable" ? "Approved to share" : "Kept on this system",
    currentDetail: disposition === "shareable"
      ? "The operator has approved this change for the community-sharing lane. It still will not leave this system unless the governed contribution step succeeds."
      : "This change is private right now. It stays on this install unless the operator explicitly chooses to share it.",
    recommendationLabel: suggested === "shareable"
      ? "Recommended: Share with the community"
      : "Recommended: Keep on my system",
    reason: input.dispositionSuggestionReason?.trim()
      || (hasAssessment
        ? "The coworker did not provide more detail for this recommendation."
        : "No contribution assessment has been captured yet. Keep this change on your system until the coworker assesses project fit and archetype/market usefulness."),
    canShare: disposition === "shareable" || suggested === "shareable",
  };
}
