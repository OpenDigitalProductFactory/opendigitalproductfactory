import type { semanticReviewRecoveryBudget } from "./semantic-review-recovery-policy";
import { explainExclusion, type RoutingEligibility } from "../inference/routing-exclusion-buckets";

export const SEMANTIC_REVIEW_ELIGIBILITY_ACTION = "Verify an eligible model for the complete review within the required data boundary. Record fresh scoped verification before resuming; an unchanged retry will not help.";
export function semanticReviewEligibilityLabels(eligibility: readonly RoutingEligibility[]) {
  return [...new Set(eligibility.flatMap(entry => [
    `Effective data class: ${entry.sensitivity}. Residency: ${entry.residencyPolicy}. Excluded endpoints: ${entry.excludedCount}.`,
    ...entry.exclusions.map(item => explainExclusion({ ...item, total: entry.excludedCount,
      sampleReason: "", breakdown: entry.exclusions }, { sensitivity: entry.sensitivity }).message),
  ]))];
}

/** Shared explanations; availability never establishes the caller's authority. */
export function semanticReviewRecoveryPresentation(state: ReturnType<typeof semanticReviewRecoveryBudget>, eligibilityBlocked = false) {
  const title = { available: eligibilityBlocked ? "Review needs an eligible endpoint" : "Review awaiting recovery", expired: "Review window expired",
    exhausted: "Recovery limit reached", unknown: "Recovery availability unknown" }[state];
  const nextAction = state === "available"
    ? "The original requester can confirm recovery; authority is checked again when submitted."
    : state === "expired"
      ? "This request cannot resume. The requester must reconcile prior execution and record fresh runtime remediation evidence before confirming one bounded successor through review recovery."
    : state === "unknown"
      ? "Recovery limits could not be read. Inspect the request history before further action."
      : "This request cannot resume. Its deadline and recovery limit stay unchanged; inspect history with the requester.";
  return { title, nextAction: eligibilityBlocked ? `${SEMANTIC_REVIEW_ELIGIBILITY_ACTION}${state !== "available" ? ` ${nextAction}` : ""}` : nextAction };
}

const REASONS: Record<string, string> = {
  "unparseable-review-response": "The reviewer response could not be validated. No review verdict was accepted.",
  "review-response-truncated": "The provider stopped before the review response was complete.",
  "provider-outcome-uncertain": "The provider outcome is uncertain. Inspect the recorded execution before replacing it.",
  "review-capacity-deferred": "Review could not start because provider capacity was unavailable. No verdict was produced.",
  "review-endpoint-ineligible": "No endpoint met the review requirements. The affected branches stopped before provider dispatch; no verdict was produced.",
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
