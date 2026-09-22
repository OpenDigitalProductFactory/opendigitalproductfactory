import type { semanticReviewRecoveryBudget } from "./semantic-review-recovery-policy";

/** Shared explanations; availability never establishes the caller's authority. */
export function semanticReviewRecoveryPresentation(state: ReturnType<typeof semanticReviewRecoveryBudget>) {
  const title = { available: "Review awaiting recovery", expired: "Review window expired",
    exhausted: "Recovery limit reached", unknown: "Recovery availability unknown" }[state];
  const nextAction = state === "available"
    ? "The original requester can confirm recovery; authority is checked again when submitted."
    : state === "unknown"
      ? "Recovery limits could not be read. Inspect the request history before further action."
      : "This request cannot resume. Its deadline and recovery limit stay unchanged; inspect history with the requester.";
  return { title, nextAction };
}

const REASONS: Record<string, string> = {
  "unparseable-review-response": "The reviewer response could not be validated. No review verdict was accepted.",
  "review-response-truncated": "The provider stopped before the review response was complete.",
  "provider-outcome-uncertain": "The provider outcome is uncertain. Inspect the recorded execution before replacing it.",
  "provider-outcome-uncertain-after-restart": "Execution restarted before a provider outcome was recorded.",
  "submitting-authority-no-longer-valid": "The original request no longer has valid authority.",
  "failure-analysis-evidence-changed": "The request's verification evidence is no longer current.",
  "review-deadline-exhausted": "The review deadline has passed.",
  "review-branch-capacity-or-transport-failure": "A required review branch did not finish. Its cause needs inspection.",
};
export function semanticReviewReasonLabel(reason: string | null): string {
  if (!reason) return "No reason recorded.";
  return [...new Set(reason.split(",").map(value => value.trim()).filter(Boolean))]
    .map(value => REASONS[value] ?? `Recorded reason: ${value}`).join(" ");
}

export function semanticReviewActionLabel(action: string): string {
  return ({ publish: "Inspect the verified receipt and publication gates.",
    repair: "Address the recorded review findings, then request review of the revised change.",
    "retry-review": "Inspect the request history and current recovery limits.",
    "operator-review": "The accountable operator must inspect the review evidence.",
    "shadow-observe": "Inspect the recorded review and the current publication policy.",
    "internal-review-recovery": "Inspect the recorded recovery requirements." } as Record<string, string>)[action] ?? action;
}
