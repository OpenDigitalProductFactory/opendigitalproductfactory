import { asString, isRecord } from "@/lib/shared/coerce";

export const LEAVE_DECISION_ACTION = "leave.decide";
export const LEAVE_DECISION_ROUTE = "/employee?view=timeoff";

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
