import type { InitiativeGateKey, InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness";
import type { ToolDefinition } from "@/lib/mcp-tools";

export type InitiativeReadinessLane = {
  capability: NonNullable<ToolDefinition["requiredCapability"]>;
  grant: string;
  gates: readonly InitiativeGateKey[];
  accountableRoles: readonly string[];
  independent: boolean;
};

/** One registry drives disclosure, receipt validation, and recovery routing. */
export const INITIATIVE_READINESS_LANES: Record<string, InitiativeReadinessLane> = {
  record_initiative_evidence: { capability: "manage_backlog", grant: "initiative_evidence_write", gates: ["classification", "research", "dependency-disposition"], accountableRoles: ["design-author", "portfolio-management"], independent: false },
  record_initiative_design_review: { capability: "manage_backlog", grant: "initiative_design_review", gates: ["design-spec", "spec-approval", "plan-review"], accountableRoles: ["design-checklist-reviewer", "plan-reviewer"], independent: true },
  record_initiative_architecture_review: { capability: "manage_ea_model", grant: "initiative_architecture_review", gates: ["architecture-review"], accountableRoles: ["architecture-reviewer"], independent: true },
  record_initiative_data_review: { capability: "manage_ea_model", grant: "initiative_data_review", gates: ["data-review"], accountableRoles: ["data-reviewer"], independent: true },
  record_initiative_ux_review: { capability: "manage_backlog", grant: "initiative_ux_review", gates: ["ux-fit-review"], accountableRoles: ["ux-reviewer"], independent: true },
  record_initiative_security_review: { capability: "manage_compliance", grant: "initiative_security_review", gates: ["security-review"], accountableRoles: ["security-reviewer"], independent: true },
  record_initiative_compliance_review: { capability: "manage_compliance", grant: "initiative_compliance_review", gates: ["compliance-review"], accountableRoles: ["compliance-reviewer"], independent: true },
  record_initiative_domain_review: { capability: "manage_backlog", grant: "initiative_domain_review", gates: ["domain-review"], accountableRoles: ["domain-reviewer"], independent: true },
  record_initiative_archetype_review: { capability: "manage_taxonomy", grant: "initiative_archetype_review", gates: ["archetype-provisioning", "archetype-completeness"], accountableRoles: ["archetype-steward"], independent: true },
};

export const INITIATIVE_READINESS_TOOL_GRANTS = Object.fromEntries(
  Object.entries(INITIATIVE_READINESS_LANES).map(([tool, lane]) => [tool, [lane.grant]]),
) as Record<string, string[]>;

export function readinessLaneForRole(role: string): { toolName: string; lane: InitiativeReadinessLane } | null {
  for (const [toolName, lane] of Object.entries(INITIATIVE_READINESS_LANES)) {
    if (lane.accountableRoles.includes(role)) return { toolName, lane };
  }
  return null;
}

export type InitiativeReviewerRecovery = {
  reviewerRoutes: Array<{
    accountableRole: string;
    toolName: string;
    grant: string;
    targetAgentId: string;
    targetDisplayName: string;
    independent: boolean;
  }>;
  escalations: Array<{
    accountableRole: string;
    toolName: string;
    grant: string;
    reason: "no-eligible-reviewer";
    nextAction: string;
  }>;
};

type ReviewerRouteDb = {
  agentToolGrant?: {
    findMany(args: unknown): Promise<Array<{
      grantKey: string;
      agent: {
        agentId: string;
        displayName: string;
        status: string;
        archived: boolean;
        lifecycleStage: string;
      };
    }>>;
  };
};

/** Resolve actionable, exact-grant reviewer routes without changing readiness. */
export async function resolveInitiativeReviewerRecovery(input: {
  decision: InitiativeReadinessDecision;
  currentAgentId: string | null;
  db: ReviewerRouteDb;
}): Promise<InitiativeReviewerRecovery> {
  const requirements = [...input.decision.blockers, ...input.decision.unmet];
  const requested = requirements
    .map((entry) => ({ role: entry.accountableRole, route: readinessLaneForRole(entry.accountableRole) }))
    .filter((entry): entry is { role: string; route: NonNullable<ReturnType<typeof readinessLaneForRole>> } => Boolean(entry.route));
  const distinct = [...new Map(requested.map((entry) => [`${entry.role}:${entry.route.toolName}`, entry])).values()];
  if (distinct.length === 0) return { reviewerRoutes: [], escalations: [] };

  const grants = [...new Set(distinct.map((entry) => entry.route.lane.grant))];
  const rows = input.db.agentToolGrant
    ? await input.db.agentToolGrant.findMany({
        where: {
          grantKey: { in: grants },
          agent: { status: "active", archived: false, lifecycleStage: "production" },
        },
        select: {
          grantKey: true,
          agent: { select: { agentId: true, displayName: true, status: true, archived: true, lifecycleStage: true } },
        },
      })
    : [];

  const reviewerRoutes: InitiativeReviewerRecovery["reviewerRoutes"] = [];
  const escalations: InitiativeReviewerRecovery["escalations"] = [];
  for (const entry of distinct) {
    const candidate = rows.find((row) =>
      row.grantKey === entry.route.lane.grant
      && row.agent.status === "active"
      && !row.agent.archived
      && row.agent.lifecycleStage === "production"
      && (!entry.route.lane.independent || row.agent.agentId !== input.currentAgentId));
    if (candidate) {
      reviewerRoutes.push({
        accountableRole: entry.role,
        toolName: entry.route.toolName,
        grant: entry.route.lane.grant,
        targetAgentId: candidate.agent.agentId,
        targetDisplayName: candidate.agent.displayName,
        independent: entry.route.lane.independent,
      });
      continue;
    }
    escalations.push({
      accountableRole: entry.role,
      toolName: entry.route.toolName,
      grant: entry.route.lane.grant,
      reason: "no-eligible-reviewer",
      nextAction: `Assign or activate a production reviewer with exact grant ${entry.route.lane.grant}; do not proxy the receipt.`,
    });
  }
  return { reviewerRoutes, escalations };
}
