import type { Prisma } from "@dpf/db";

const MISSING_ORGANIZATION_PROFILE = "__missing_organization_profile__";

/**
 * The owner inbox is scoped by the profile that made the decision, not by the
 * page that happened to ask it. This keeps every WWWD entry surface on one
 * ruling path while excluding platform/build decisions.
 */
export function organizationDecisionInboxWhere(
  organizationProfileId: string | null,
  dbNull: typeof Prisma.DbNull,
): Prisma.DecisionInteractionWhereInput {
  if (!organizationProfileId) {
    return { profileId: MISSING_ORGANIZATION_PROFILE };
  }

  return {
    outcomeType: { in: ["defer", "escalate"] },
    profileId: organizationProfileId,
    buildId: null,
    taskRunId: null,
    question: { not: "" },
    humanOutcome: { equals: dbNull },
    NOT: [
      { gateKey: "profession" },
      { domainClass: "kernel-consult" },
      { routeContext: { startsWith: "mcp:principle_decide" } },
    ],
  };
}
