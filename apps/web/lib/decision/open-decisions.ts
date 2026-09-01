// What counts as a decision still waiting on a human (BI-C62127B9).
//
// ONE definition, imported by everything that claims to show or act on the
// queue: the review workspace, the attention surface, and the concierge sweep.
// Three copies of this predicate already drifted once (BI-6EC1EE25 recorded the
// last time), and the failure is silent in the worst way — the queue says four,
// the sweep works six, and the inbox shows two, with nothing to reconcile them.
//
// Pure Prisma `where` fragments, no client, so a caller composes rather than
// re-derives.

import { Prisma } from "@dpf/db";

/** Outcomes that mean the gate handed the call to a person. */
export const UNRESOLVED_OUTCOMES = ["escalate", "defer"] as const;

/**
 * Rows that are agent-internal rather than owner-actionable: a kernel consult
 * an agent ran for itself, or a bare MCP principle_decide with no build and no
 * task behind it. `isFounderActionable` remains the authoritative predicate in
 * code; this is its DB-pushdown half so `take` stays meaningful.
 */
export const NOT_OWNER_ACTIONABLE: Prisma.DecisionInteractionWhereInput[] = [
  { gateKey: "profession" },
  { buildId: null, taskRunId: null, routeContext: { startsWith: "mcp:principle_decide" } },
  { buildId: null, taskRunId: null, domainClass: "kernel-consult" },
];

/**
 * Decisions waiting on a human: unresolved outcome, nobody has answered, a real
 * question recorded, and not agent-internal.
 */
export function openDecisionWhere(
  extra: Prisma.DecisionInteractionWhereInput = {},
): Prisma.DecisionInteractionWhereInput {
  return {
    outcomeType: { in: [...UNRESOLVED_OUTCOMES] },
    humanOutcome: { equals: Prisma.DbNull },
    question: { not: "" },
    NOT: NOT_OWNER_ACTIONABLE,
    ...extra,
  };
}

/**
 * The subset the concierge sweep will spend a panel on: open, and not already
 * carrying a live drafted resolution. Ordering by risk then age is the caller's
 * job — this only says which rows are in scope.
 */
export function panelCandidateWhere(): Prisma.DecisionInteractionWhereInput {
  return openDecisionWhere({
    riskTier: { in: ["medium", "high", "critical"] },
    resolutionProposals: { none: { status: "proposed", lifecycle: "active" } },
  });
}
