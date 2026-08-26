import type {
  InitiativeGateKey,
  InitiativeReadinessDecision,
  ReadinessCode,
  ReadinessRequirementResult,
} from "@/lib/backlog/initiative-readiness";
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
  record_plan_backlog_coverage: { capability: "manage_backlog", grant: "backlog_write", gates: ["dependency-disposition"], accountableRoles: ["implementation-planner"], independent: false },
  record_initiative_design_review: { capability: "manage_backlog", grant: "initiative_design_review", gates: ["design-spec", "spec-approval", "plan-review"], accountableRoles: ["design-checklist-reviewer", "plan-reviewer"], independent: true },
  record_initiative_architecture_review: { capability: "manage_ea_model", grant: "initiative_architecture_review", gates: ["architecture-review"], accountableRoles: ["architecture-reviewer"], independent: true },
  record_initiative_data_review: { capability: "manage_ea_model", grant: "initiative_data_review", gates: ["data-review"], accountableRoles: ["data-reviewer"], independent: true },
  record_initiative_ux_review: { capability: "manage_backlog", grant: "initiative_ux_review", gates: ["ux-fit-review"], accountableRoles: ["ux-reviewer"], independent: true },
  record_initiative_security_review: { capability: "manage_compliance", grant: "initiative_security_review", gates: ["security-review"], accountableRoles: ["security-reviewer"], independent: true },
  record_initiative_compliance_review: { capability: "manage_compliance", grant: "initiative_compliance_review", gates: ["compliance-review"], accountableRoles: ["compliance-reviewer"], independent: true },
  record_initiative_domain_review: { capability: "manage_backlog", grant: "initiative_domain_review", gates: ["domain-review"], accountableRoles: ["domain-reviewer"], independent: true },
  record_initiative_archetype_review: { capability: "manage_taxonomy", grant: "initiative_archetype_review", gates: ["archetype-provisioning", "archetype-completeness"], accountableRoles: ["archetype-steward"], independent: true },
};

/** Static mirror keeps source-policy audits and runtime disclosure on one exact grant map. */
export const INITIATIVE_READINESS_TOOL_GRANTS: Record<string, string[]> = {
  record_initiative_evidence: ["initiative_evidence_write"],
  record_plan_backlog_coverage: ["backlog_write"],
  record_initiative_design_review: ["initiative_design_review"],
  record_initiative_architecture_review: ["initiative_architecture_review"],
  record_initiative_data_review: ["initiative_data_review"],
  record_initiative_ux_review: ["initiative_ux_review"],
  record_initiative_security_review: ["initiative_security_review"],
  record_initiative_compliance_review: ["initiative_compliance_review"],
  record_initiative_domain_review: ["initiative_domain_review"],
  record_initiative_archetype_review: ["initiative_archetype_review"],
};

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
    gate: InitiativeGateKey;
    targetAgentId: string;
    targetDisplayName: string;
    independent: boolean;
    workroomId: string;
    repositoryFullName: string;
    branchName: string;
    headSha: string;
    requestCoworker: {
      targetAgent: string;
      objective: string;
      questionPacketSummary: string;
      requestKey: string;
      tier: 2;
      enteredVia: "handoff";
    };
  }>;
  escalations: Array<{
    accountableRole: string;
    toolName: string;
    grant: string;
    /**
     * Why the caller cannot route this gate to a reviewer.
     *
     * - "no-eligible-reviewer": nobody holds the grant in a production, active,
     *   unarchived state. Somebody must be assigned or activated.
     * - "dispatch-context-required": an eligible reviewer WAS found, but no
     *   Workroom branch + immutable head was supplied to bind the request to.
     *   Nothing is wrong with the reviewer roster.
     *
     * These were one value until 2026-08-26. Reporting a found reviewer as
     * "no-eligible-reviewer" reads as a permanent dead end and sends the caller
     * hunting for missing grants instead of supplying the dispatch context.
     */
    reason: "no-eligible-reviewer" | "dispatch-context-required";
    nextAction: string;
  }>;
};

export type InitiativeRecoveryDispatchContext = {
  workroomId: string;
  repositoryFullName: string;
  branchName: string;
  headSha: string;
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
  dispatchContext: InitiativeRecoveryDispatchContext | null;
}): Promise<InitiativeReviewerRecovery> {
  const requirements = [...input.decision.blockers, ...input.decision.unmet];
  const requested: Array<{
    entry: ReadinessRequirementResult;
    role: string;
    route: NonNullable<ReturnType<typeof readinessLaneForRole>>;
    gate: InitiativeGateKey;
  }> = [];
  for (const entry of requirements) {
    const route = readinessLaneForRole(entry.accountableRole);
    const gate = route ? recoveryGate(entry, route.lane) : null;
    if (route && gate) requested.push({ entry, role: entry.accountableRole, route, gate });
  }
  const distinct = [...new Map(requested.map((entry) => [
    `${entry.role}:${entry.route.toolName}:${entry.gate}`,
    entry,
  ])).values()];
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
  const deterministicRows = [...rows].sort((left, right) =>
    left.agent.agentId.localeCompare(right.agent.agentId));

  const reviewerRoutes: InitiativeReviewerRecovery["reviewerRoutes"] = [];
  const escalations: InitiativeReviewerRecovery["escalations"] = [];
  for (const entry of distinct) {
    const candidate = deterministicRows.find((row) =>
      row.grantKey === entry.route.lane.grant
      && row.agent.status === "active"
      && !row.agent.archived
      && row.agent.lifecycleStage === "production"
      && (!entry.route.lane.independent || row.agent.agentId !== input.currentAgentId));
    if (candidate) {
      if (!input.dispatchContext) {
        escalations.push({
          accountableRole: entry.role,
          toolName: entry.route.toolName,
          grant: entry.route.lane.grant,
          reason: "dispatch-context-required",
          nextAction: `Eligible reviewer ${candidate.agent.agentId} holds ${entry.route.lane.grant}; supply the Workroom branch and immutable head to dispatch. Do not synthesize reviewer artifact bindings.`,
        });
        continue;
      }
      const packet = requestCoworkerPacket({
        decision: input.decision,
        gate: entry.gate,
        toolName: entry.route.toolName,
        targetAgentId: candidate.agent.agentId,
        dispatch: input.dispatchContext,
        independent: entry.route.lane.independent,
      });
      reviewerRoutes.push({
        accountableRole: entry.role,
        toolName: entry.route.toolName,
        grant: entry.route.lane.grant,
        gate: entry.gate,
        targetAgentId: candidate.agent.agentId,
        targetDisplayName: candidate.agent.displayName,
        independent: entry.route.lane.independent,
        workroomId: input.dispatchContext.workroomId,
        repositoryFullName: input.dispatchContext.repositoryFullName,
        branchName: input.dispatchContext.branchName,
        headSha: input.dispatchContext.headSha,
        requestCoworker: packet,
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

const REQUIREMENT_GATES: Partial<Record<ReadinessCode, InitiativeGateKey>> = {
  CANONICAL_DESIGN_REQUIRED: "design-spec",
  RESEARCH_REQUIRED: "research",
  SPEC_APPROVAL_REQUIRED: "spec-approval",
  OBJECTIVE_BASELINE_REQUIRED: "spec-approval",
  PLAN_REVIEW_REQUIRED: "plan-review",
  PLAN_COVERAGE_REQUIRED: "dependency-disposition",
  TRACEABILITY_INCOMPLETE: "dependency-disposition",
  DEPENDENCY_UNRESOLVED: "dependency-disposition",
  ARCHETYPE_PROVISIONING_INCOMPLETE: "archetype-provisioning",
  ARCHETYPE_COMPLETENESS_FAILED: "archetype-completeness",
};

function recoveryGate(entry: ReadinessRequirementResult, lane: InitiativeReadinessLane): InitiativeGateKey | null {
  const exact = REQUIREMENT_GATES[entry.code];
  if (exact && lane.gates.includes(exact)) return exact;
  if (["REVIEW_REQUIRED", "REVIEW_FAILED", "BLOCKING_FINDINGS_OPEN"].includes(entry.code)
    && lane.gates.length === 1) return lane.gates[0] ?? null;
  return lane.gates.length === 1 ? lane.gates[0] ?? null : null;
}

function requestCoworkerPacket(args: {
  decision: InitiativeReadinessDecision;
  gate: InitiativeGateKey;
  toolName: string;
  targetAgentId: string;
  dispatch: InitiativeRecoveryDispatchContext;
  independent: boolean;
}) {
  const reviewConstraint = args.independent ? "independently " : "";
  return {
    targetAgent: args.targetAgentId,
    objective: `For ${args.decision.subject.id} in ${args.dispatch.workroomId} on ${args.dispatch.repositoryFullName}#${args.dispatch.branchName} at ${args.dispatch.headSha}, ${reviewConstraint}address ${args.gate} using ${args.toolName}. Verify the canonical immutable artifact and record a governed receipt only when the gate passes.`,
    questionPacketSummary: `${args.gate} for ${args.decision.subject.id} at ${args.dispatch.headSha.slice(0, 12)}`,
    requestKey: `initiative-readiness:${args.decision.subject.id}:${args.gate}:${args.dispatch.headSha}`,
    tier: 2 as const,
    enteredVia: "handoff" as const,
  };
}
