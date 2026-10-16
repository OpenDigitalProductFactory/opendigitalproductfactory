import type { DecisionEscalationRoute, Prisma } from "@dpf/db";
import type { DecisionEscalation } from "@/lib/govern/authority/escalation-gate";

/** Retained for old rows and re-exported by the owner queue for compatibility. */
export const UNRESOLVED_OUTCOMES = ["defer", "escalate"] as const;
export type HumanEscalationRow = {
  outcomeType?: string | null;
  escalationRoute?: DecisionEscalationRoute | null;
  escalation?: Pick<DecisionEscalation, "route">;
};

/** Caller constraints are AND-composed, including any existing OR expression. */
export function humanEscalationWhere(existing?: Prisma.DecisionInteractionWhereInput): Prisma.DecisionInteractionWhereInput {
  const predicate: Prisma.DecisionInteractionWhereInput = { OR: [
    { escalationRoute: "human" },
    { escalationRoute: null, outcomeType: { in: [...UNRESOLVED_OUTCOMES] } },
  ] };
  return existing ? { AND: [existing, predicate] } : predicate;
}

export function isHumanEscalation(row: HumanEscalationRow): boolean {
  const route = row.escalationRoute ?? row.escalation?.route;
  return route === "human" || (route == null
    && UNRESOLVED_OUTCOMES.some((outcome) => outcome === row.outcomeType));
}

/** Routed human recommendations use escalation capture; legacy defers retain theirs. */
export function humanCaptureOutcome(row: HumanEscalationRow): typeof UNRESOLVED_OUTCOMES[number] | null {
  if (!isHumanEscalation(row)) return null;
  return (row.escalationRoute ?? row.escalation?.route) === "human" ? "escalate" : row.outcomeType as typeof UNRESOLVED_OUTCOMES[number];
}
