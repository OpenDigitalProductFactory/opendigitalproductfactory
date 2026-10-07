import { asString, isRecord } from "@/lib/shared/coerce";

export const LEAVE_DECISION_ACTION = "leave.decide";
export const LEAVE_DECISION_ROUTE = "/employee?view=timeoff";

/**
 * Why the generic proposal verbs refuse a leave.decide proposal (BI-4E192035):
 * approving a "deny" recommendation used to approve the leave. The leave is
 * decided only by the explicit Approve leave / Deny leave actions
 * (approveLeaveRequest / rejectLeaveRequest).
 */
export const LEAVE_DECISION_VERB_REFUSAL =
  "Leave is decided with Approve leave / Deny leave, not by approving or rejecting the advisor's recommendation.";

export type LeaveDecisionProposalParameters = {
  requestId: string;
  recommendation: "approve" | "deny" | "escalate";
  rationale: string | null;
  guardReasons: string[];
};

/** Read the stable, presentation-safe portion of a leave decision proposal. */
export function parseLeaveDecisionProposalParameters(
  value: unknown,
): LeaveDecisionProposalParameters | null {
  if (!isRecord(value)) return null;
  const requestId = asString(value["requestId"]);
  const rawRecommendation = asString(value["recommendation"]);
  const recommendation =
    rawRecommendation === "approve" || rawRecommendation === "deny" || rawRecommendation === "escalate"
      ? rawRecommendation
      : null;
  if (!requestId || !recommendation) return null;

  const rawReasons = value["guardReasons"];
  return {
    requestId,
    recommendation,
    rationale: asString(value["rationale"]) ?? null,
    guardReasons: Array.isArray(rawReasons)
      ? rawReasons.filter((reason): reason is string => typeof reason === "string")
      : [],
  };
}
