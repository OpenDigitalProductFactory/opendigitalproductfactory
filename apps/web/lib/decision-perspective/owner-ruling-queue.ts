// The owner's "Waiting on your call" inbox predicate.
//
// BI-EB5E9BE3: this used to select on `routeContext: "/coworker-business"`.
// That is a ROUTE, not an ownership boundary, so a WWWD decision raised
// anywhere else — `approve_demand_for_funding` writes `/ops/demand` — was
// invisible to the owner even though it was theirs to rule on. Verified on
// origin/main @ 2cc2845398: 14 unresolved, unanswered `/ops/demand`
// interactions carrying the organization profile were excluded from the queue,
// leaving approved standing-Workroom prerequisites unfunded.
//
// The canonical boundary is the organization decision profile: a decision the
// owner rules on is one scored against THEIR profile. Route is incidental.
import type { Prisma } from "@dpf/db";
import { humanEscalationWhere, isHumanEscalation, type HumanEscalationRow } from "./human-escalation";

/** Outcome types that still need a human ruling. */
export { UNRESOLVED_OUTCOMES } from "./human-escalation";

/**
 * Rows that are never the owner's to rule on, regardless of profile:
 * platform/kernel judgement, and decisions bound to a build or task run
 * (those belong to their own gates, not the business inbox).
 */
export function excludedFromOwnerRulingQueue(): Prisma.DecisionInteractionWhereInput[] {
  return [
    { gateKey: "profession" },
    { domainClass: "kernel-consult" },
    { routeContext: { startsWith: "mcp:principle_decide" } },
  ];
}

/**
 * The inbox predicate. `organizationProfileIds` is the ownership boundary — an
 * empty list selects nothing rather than falling back to every profile, so a
 * misconfigured install shows an empty queue instead of platform decisions.
 */
export function ownerRulingQueueWhere(
  organizationProfileIds: readonly string[],
  // `humanOutcome` is a JSON column, so "unanswered" is Prisma.DbNull rather
  // than SQL NULL. It is injected so this module stays free of a Prisma runtime
  // import and the rule lives in exactly one place.
  unansweredSentinel: unknown,
): Prisma.DecisionInteractionWhereInput {
  return {
    AND: [humanEscalationWhere()],
    buildId: null,
    taskRunId: null,
    question: { not: "" },
    humanOutcome: { equals: unansweredSentinel as never },
    profileId: { in: [...organizationProfileIds] },
    NOT: excludedFromOwnerRulingQueue(),
  };
}

/** One interaction, reduced to the fields the predicate reads. */
export type OwnerRulingCandidate = HumanEscalationRow & {
  outcomeType: string;
  buildId: string | null;
  taskRunId: string | null;
  question: string;
  humanOutcome: unknown;
  profileId: string | null;
  routeContext: string | null;
  domainClass: string | null;
  gateKey: string | null;
};

/**
 * Same rules, evaluated in process. Kept beside `ownerRulingQueueWhere` so the
 * acceptance cases are testable without a database, and so the two cannot drift
 * silently — the test asserts them against one shared fixture set.
 */
export function isOwnerRulingQueueRow(
  row: OwnerRulingCandidate,
  organizationProfileIds: readonly string[],
): boolean {
  if (!isHumanEscalation(row)) return false;
  if (row.buildId !== null || row.taskRunId !== null) return false;
  if (!row.question) return false;
  if (row.humanOutcome !== null && row.humanOutcome !== undefined) return false;
  if (row.gateKey === "profession") return false;
  if (row.domainClass === "kernel-consult") return false;
  if ((row.routeContext ?? "").startsWith("mcp:principle_decide")) return false;
  if (!row.profileId || !organizationProfileIds.includes(row.profileId)) return false;
  return true;
}
