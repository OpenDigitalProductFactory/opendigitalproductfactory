// D2.2 (BI-4D030159) — surface adapter for the leave-decisioning coworker.
//
// A leave approval is a BUSINESS decision, so it is decided on the WWWD surface
// (`evaluate_org_business_decision` — the organization's own staffing/leave
// doctrine), NOT the platform founder kernel (`principle_decide`/WWMD). This
// module maps that surface's response into the surface-agnostic
// `LeaveDecisionOutcome` that `resolveLeaveDecision` (leave-decision-policy.ts)
// combines with the hard safety guards.
//
// Kernel-validated 2026-08-07: scoring a leave decision through the platform
// kernel is dominated by irrelevant software-delivery commandments ("land via PR
// against main", "DCO sign-off"); the org-business surface grounds in the org's
// own stance and escalates by exception. See the plan §D2.2 for the ledger.

import type { LeaveDecisionOutcome } from "./leave-decision-policy";

/**
 * The subset of the `evaluate_org_business_decision` response this adapter reads.
 * `outcomeType` ∈ recommend | arbitrate | escalate | defer (only recommend and
 * arbitrate carry a `recommendedOptionId`); `allowed` is the gate's act/hold flag.
 */
export type OrgDecisionEvaluation = {
  outcomeType: string;
  recommendedOptionId?: string | null;
  allowed?: boolean;
};

/**
 * Map the WWWD verdict to a leave outcome. Conservative by construction: a
 * recommendation only survives when the surface genuinely recommended (or
 * arbitrated) a KNOWN approve|deny option AND authorized acting. Every other
 * shape — escalate, defer, unknown outcome, missing/unknown option, or a
 * not-allowed verdict — escalates by exception. The coworker never invents a
 * decision the surface declined to make.
 */
export function mapOrgDecisionToLeaveOutcome(ev: OrgDecisionEvaluation): LeaveDecisionOutcome {
  const yieldsRecommendation = ev.outcomeType === "recommend" || ev.outcomeType === "arbitrate";
  if (!yieldsRecommendation) return "escalate";
  if (ev.allowed === false) return "escalate";
  if (ev.recommendedOptionId === "approve") return "recommend-approve";
  if (ev.recommendedOptionId === "deny") return "recommend-deny";
  return "escalate";
}
