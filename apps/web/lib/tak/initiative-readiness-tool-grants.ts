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

/**
 * The exact immutable identity a dispatched reviewer is bound to. Shaped to
 * satisfy `parseInitiativeReviewBinding` so a server-issued route is executable
 * as-issued, without the caller reshaping — or inventing — any part of it.
 */
export type InitiativeReviewBindingPacket = {
  writerToolName: string;
  itemId: string;
  gate: InitiativeGateKey;
  expectedCurrentBaselineId: string | null;
  artifactRef: {
    kind: "repo-blob-at-commit";
    repositoryFullName: string;
    commitSha: string;
    path: string;
    providerBlobId: string;
  };
};

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
      /**
       * Present together or not at all. Absent only for a lane whose writer the
       * binding contract does not cover (`record_plan_backlog_coverage` is not a
       * `record_initiative_*` writer, so `parseInitiativeReviewBinding` rejects
       * it); that lane reviews no immutable bytes and needs no artifact identity.
       */
      requiredToolNames?: string[];
      initiativeReviewBinding?: InitiativeReviewBindingPacket;
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
     * - "no-canonical-artifact": an eligible reviewer AND an immutable head were
     *   both found, but the canonical design could not be resolved from the
     *   repository provider, so no binding can be issued. Again, nothing is
     *   wrong with the reviewer roster.
     *
     * The first two were one value until 2026-08-26. Reporting a found reviewer
     * as "no-eligible-reviewer" reads as a permanent dead end and sends the
     * caller hunting for missing grants instead of supplying what is actually
     * missing.
     */
    reason: "no-eligible-reviewer" | "dispatch-context-required" | "no-canonical-artifact";
    nextAction: string;
  }>;
  /**
   * Unmet requirements whose accountable role has no writer lane. They are
   * reported rather than dropped: a requirement that vanishes from recovery
   * reads as satisfied, which is the worse failure (BI-9FE775F9).
   */
  unroutable: Array<{
    accountableRole: string;
    code: ReadinessCode;
    nextAction: string;
  }>;
};

export type InitiativeRecoveryDispatchContext = {
  workroomId: string;
  repositoryFullName: string;
  branchName: string;
  headSha: string;
};

/**
 * The canonical design the reviewer must inspect, resolved from the repository
 * provider by the caller. This module stays free of provider I/O so it remains
 * a pure routing decision over evidence it is handed.
 */
export type InitiativeRecoveryCanonicalArtifact =
  | { resolved: true; path: string; providerBlobId: string }
  | { resolved: false; nextAction: string };

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
  canonicalArtifact?: InitiativeRecoveryCanonicalArtifact | null;
  expectedCurrentBaselineId?: string | null;
}): Promise<InitiativeReviewerRecovery> {
  const requirements = [...input.decision.blockers, ...input.decision.unmet];
  const requested: Array<{
    entry: ReadinessRequirementResult;
    role: string;
    route: NonNullable<ReturnType<typeof readinessLaneForRole>>;
    gate: InitiativeGateKey;
  }> = [];
  const unroutable: InitiativeReviewerRecovery["unroutable"] = [];
  for (const entry of requirements) {
    const route = readinessLaneForRole(entry.accountableRole);
    const gate = route ? recoveryGate(entry, route.lane) : null;
    if (route && gate) {
      requested.push({ entry, role: entry.accountableRole, route, gate });
      continue;
    }
    unroutable.push({
      accountableRole: entry.accountableRole,
      code: entry.code,
      nextAction: UNROUTABLE_REMEDIES[entry.code]
        ?? `No writer lane records ${entry.code}. Resolve it through the ${entry.accountableRole} surface that owns it.`,
    });
  }
  const sequenced = sequenceBaselineBeforePlanCoverage(
    requested,
    input.expectedCurrentBaselineId ?? null,
  );
  const distinct = [...new Map(sequenced.map((entry) => [
    `${entry.role}:${entry.route.toolName}:${entry.gate}`,
    entry,
  ])).values()];
  if (distinct.length === 0) return { reviewerRoutes: [], escalations: [], unroutable };

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
      // Only an initiative-review writer can carry a binding: the consumer's
      // `parseInitiativeReviewBinding` requires `record_initiative_*`, so
      // binding `record_plan_backlog_coverage` produces a route the callee
      // rejects — the very defect this lane routing exists to end. Plan coverage
      // is not a review of immutable bytes, so it carries no artifact identity
      // and is not blocked by one being unresolvable (BI-9FE775F9).
      const bindable = entry.route.toolName.startsWith("record_initiative_");
      const artifact = input.canonicalArtifact ?? null;
      if (bindable && (!artifact || !artifact.resolved)) {
        // A route without a binding is not a lesser route — it is an unusable
        // one: `request_coworker` rejects `requiredToolNames` unless the binding
        // comes with it, so emitting it would spend a dispatch and a TaskRun to
        // fail at the callee. Escalate with the remedy instead.
        escalations.push({
          accountableRole: entry.role,
          toolName: entry.route.toolName,
          grant: entry.route.lane.grant,
          reason: "no-canonical-artifact",
          nextAction: artifact?.resolved === false
            ? artifact.nextAction
            : "The canonical design artifact could not be resolved from the repository provider, so no immutable reviewer binding can be issued. Resolve the canonical design, then retry.",
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
        artifact: bindable && artifact?.resolved ? artifact : null,
        expectedCurrentBaselineId: input.expectedCurrentBaselineId ?? null,
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
  return { reviewerRoutes, escalations, unroutable };
}

type RequestedRecoveryLane = {
  entry: ReadinessRequirementResult;
  role: string;
  route: NonNullable<ReturnType<typeof readinessLaneForRole>>;
  gate: InitiativeGateKey;
};

/**
 * Plan coverage is validated against the canonical initiative scope baseline.
 * When that baseline does not exist, exposing coverage first produces a packet
 * that is executable but guaranteed to fail. Route the independent approval
 * that creates the baseline first; a later readiness projection will expose
 * coverage after the receipt exists.
 */
function sequenceBaselineBeforePlanCoverage(
  requested: RequestedRecoveryLane[],
  expectedCurrentBaselineId: string | null,
): RequestedRecoveryLane[] {
  if (expectedCurrentBaselineId !== null
    || !requested.some((entry) => entry.route.toolName === "record_plan_backlog_coverage")) {
    return requested;
  }

  const withoutCoverage = requested.filter(
    (entry) => entry.route.toolName !== "record_plan_backlog_coverage",
  );
  if (withoutCoverage.some((entry) =>
    entry.route.toolName === "record_initiative_design_review"
    && entry.gate === "spec-approval")) {
    return withoutCoverage;
  }

  const role = "design-checklist-reviewer";
  const route = readinessLaneForRole(role);
  if (!route) return withoutCoverage;
  return [
    ...withoutCoverage,
    {
      entry: {
        code: "OBJECTIVE_BASELINE_REQUIRED",
        state: "missing",
        accountableRole: role,
        evidenceRefs: [],
      },
      role,
      route,
      gate: "spec-approval",
    },
  ];
}

/**
 * Remedies for requirements whose accountable role owns no writer tool. These
 * are not missing lanes: `ARTIFACT_AUTHOR_REQUIRED` is satisfied by the commit
 * carrying a DCO trailer owned by the Workroom principal, not by anyone
 * recording a receipt. Inventing a lane would invent an approver.
 */
const UNROUTABLE_REMEDIES: Partial<Record<ReadinessCode, string>> = {
  ARTIFACT_AUTHOR_REQUIRED: "Sign the design commit off (git commit -s), push the rewritten sha, then re-sync the workroom head with adopt_worktree.",
  CLASSIFICATION_REQUIRED: "Classify the demand before shaping it: set the investment bucket and score inputs on the backlog item.",
  AUTHORIZATION_DENIED: "The caller's authority does not cover this transition. Re-run from a principal holding the required capability.",
  CAPSULE_IDENTITY_MISMATCH: "The workroom's recorded branch and head no longer match the claim. Re-sync with adopt_worktree(headBranch, headSha).",
  DELIVERY_EVIDENCE_REQUIRED: "Record delivery evidence for the merged change with record_execution_evidence.",
  ACCEPTANCE_EVIDENCE_REQUIRED: "Record acceptance evidence against the objective baseline before closing the item.",
  OBJECTIVE_RECONCILIATION_REQUIRED: "Reconcile delivered outcomes against the objective baseline with record_product_outcome_observation.",
  OBJECTIVE_BASELINE_CONFLICT: "Two objective baselines disagree. Supersede the stale baseline, leaving exactly one chain head.",
  READINESS_PROJECTION_FAILED: "Readiness projection failed to read this item's evidence. Report it; do not retry blindly.",
  STALE_EVIDENCE: "Recorded evidence is bound to a superseded artifact. Re-record it against the current immutable head.",
};

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

/**
 * The immutable reader the dispatched coworker is granted alongside its writer.
 * `initiativeReviewPacket` permits only `read_source_at_version` and
 * `search_source_at_version`; a route binds one exact blob, so the point read is
 * the whole need and the broader search grant is not issued.
 */
const IMMUTABLE_READER_TOOL = "read_source_at_version";

function requestCoworkerPacket(args: {
  decision: InitiativeReadinessDecision;
  gate: InitiativeGateKey;
  toolName: string;
  targetAgentId: string;
  dispatch: InitiativeRecoveryDispatchContext;
  independent: boolean;
  /** Null for a lane whose writer the binding contract does not cover. */
  artifact: { path: string; providerBlobId: string } | null;
  expectedCurrentBaselineId: string | null;
}) {
  const reviewConstraint = args.independent ? "independently " : "";
  const base = {
    targetAgent: args.targetAgentId,
    objective: `For ${args.decision.subject.id} in ${args.dispatch.workroomId} on ${args.dispatch.repositoryFullName}#${args.dispatch.branchName} at ${args.dispatch.headSha}, ${reviewConstraint}address ${args.gate} using ${args.toolName}.${
      args.artifact
        ? ` Read ${args.artifact.path} at that commit with ${IMMUTABLE_READER_TOOL},`
        : ""
    } record a governed receipt only when the gate passes.`,
    questionPacketSummary: `${args.gate} for ${args.decision.subject.id} at ${args.dispatch.headSha.slice(0, 12)}`,
    requestKey: `initiative-readiness:${args.decision.subject.id}:${args.gate}:${args.dispatch.headSha}`,
    tier: 2 as const,
    enteredVia: "handoff" as const,
  };
  // The two fields travel together or not at all: the adapter refuses one
  // without the other, so a partial packet is an unexecutable packet.
  if (!args.artifact) return base;
  return {
    ...base,
    requiredToolNames: [args.toolName, IMMUTABLE_READER_TOOL],
    initiativeReviewBinding: {
      writerToolName: args.toolName,
      itemId: args.decision.subject.id,
      gate: args.gate,
      expectedCurrentBaselineId: args.expectedCurrentBaselineId,
      artifactRef: {
        kind: "repo-blob-at-commit" as const,
        repositoryFullName: args.dispatch.repositoryFullName,
        commitSha: args.dispatch.headSha,
        path: args.artifact.path,
        providerBlobId: args.artifact.providerBlobId,
      },
    },
  };
}
