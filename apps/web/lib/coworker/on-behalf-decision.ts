// BI-7BCC87BB (plan B8, AC-OVERRIDE): the record an admin leaves when deciding
// another person's coworker request. Pure and client-safe, so the decision
// actions, the outcome history and the card read one shape.
import { isRecord } from "@/lib/shared/coerce";

/** Who decided another person's request, for whom, and why. */
export type OnBehalfDecision = { decision: "approved" | "declined"; by: string; onBehalfOf: string; reason: string };

/** The on-behalf record on a request's argsJson, or null for the delegate's own decision. */
export function readOnBehalfDecision(argsJson: unknown): OnBehalfDecision | null {
  if (!isRecord(argsJson)) return null;
  const record = (value: unknown, decision: OnBehalfDecision["decision"]): OnBehalfDecision | null =>
    isRecord(value) && typeof value.by === "string" && typeof value.onBehalfOf === "string" && typeof value.reason === "string"
      ? { decision, by: value.by, onBehalfOf: value.onBehalfOf, reason: value.reason }
      : null;
  return record(argsJson.humanApproval, "approved") ?? record(argsJson.humanDecline, "declined");
}

/** Name each person by a label (their sign-in email), falling back to the id. */
export function labelOnBehalfDecision(decision: OnBehalfDecision, labels: Map<string, string>): OnBehalfDecision {
  return { ...decision, by: labels.get(decision.by) ?? decision.by, onBehalfOf: labels.get(decision.onBehalfOf) ?? decision.onBehalfOf };
}
