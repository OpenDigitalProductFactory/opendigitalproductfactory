import { prisma } from "@dpf/db";

import type {
  InitiativeRecoveryCanonicalArtifact,
  InitiativeRecoveryDispatchContext,
  InitiativeReviewerRecovery,
} from "@/lib/tak/initiative-readiness-tool-grants";

import { projectBacklogItemReadiness } from "./entry-adapter";
import { loadInheritedInitiativeScope } from "./parent-scope-inheritance";
import type { TerminalRecoveryPorts } from "./terminal-recovery";
import type { InitiativeReadinessDecision } from "./types";

/**
 * BI-817556D8: the independent design reviews (design-spec, spec-approval,
 * plan-review) are owed BEFORE delivery. Until an item delivers, its completion
 * decision also carries the acceptance and reconciliation lanes, and those fail
 * closed on "no eligible evidence" — which used to swallow the plan-review route
 * with them, so an OAuth author could never request the review it needed to
 * claim implementation. Route the design reviews first, on their own.
 */
const DESIGN_REVIEW_CODES = new Set<string>([
  "CANONICAL_DESIGN_REQUIRED",
  "SPEC_APPROVAL_REQUIRED",
  // BI-1D8E53D9: the architecture review of the design is owed before plan too.
  "REVIEW_REQUIRED",
  "PLAN_REVIEW_REQUIRED",
  // BI-D9DECD1B: a failed review is owed again at the same point. Every
  // REVIEW_FAILED comes from a pre-delivery lane (spec approval, a specialist
  // review or the plan review), so its re-review reads the head like the first.
  "REVIEW_FAILED",
]);

/**
 * BI-EE99767C: a fix-profile item never carries SPEC_APPROVAL_REQUIRED. Its spec
 * approval is owed as OBJECTIVE_BASELINE_REQUIRED held by the design-checklist
 * reviewer, because that approval mints the baseline. A body baseline is held by
 * the product owner and is never routed to a spec approval.
 */
function isDesignReviewEntry(entry: { code: string; accountableRole?: string }): boolean {
  return DESIGN_REVIEW_CODES.has(entry.code)
    || (entry.code === "OBJECTIVE_BASELINE_REQUIRED" && entry.accountableRole === "design-checklist-reviewer");
}

export function designPhaseReviewDecision(
  decision: InitiativeReadinessDecision,
): InitiativeReadinessDecision | null {
  const isDesignReview = isDesignReviewEntry;
  if (![...decision.blockers, ...decision.unmet].some(isDesignReview)) return null;
  return {
    ...decision,
    blockers: decision.blockers.filter(isDesignReview),
    unmet: decision.unmet.filter(isDesignReview),
  };
}

/** Validate pre-delivery packets against the same obligations their claim uses.
 * Terminal acceptance/research prerequisites cannot suppress an owed design
 * review. Keep filtering in the shared design-phase policy, not the OAuth guard.
 * Exact packet equality still decides whether the requested gate was issued. */
/**
 * BI-D9DECD1B: the archetype reviews (provisioning and completeness) are owed at
 * IMPLEMENTATION, and the claim issues their packets from that decision. Validate
 * them against the same obligations, or the claim's own packets are refused as
 * "changed" and no archetype-profile item can reach implementation.
 */
const ARCHETYPE_REVIEW_CODES = new Set<string>([
  "ARCHETYPE_PROVISIONING_INCOMPLETE",
  "ARCHETYPE_COMPLETENESS_FAILED",
]);

export function archetypePhaseReviewDecision(
  decision: InitiativeReadinessDecision,
): InitiativeReadinessDecision | null {
  const isArchetypeReview = (entry: { code: string }) => ARCHETYPE_REVIEW_CODES.has(entry.code);
  if (![...decision.blockers, ...decision.unmet].some(isArchetypeReview)) return null;
  return {
    ...decision,
    blockers: decision.blockers.filter(isArchetypeReview),
    unmet: decision.unmet.filter(isArchetypeReview),
  };
}

/** True for a decision that owes only the pre-implementation archetype reviews. */
export function isArchetypePhaseReview(decision: InitiativeReadinessDecision): boolean {
  const entries = [...decision.blockers, ...decision.unmet];
  return entries.length > 0 && entries.every((entry) => ARCHETYPE_REVIEW_CODES.has(entry.code));
}

export function decisionForIndependentReview(
  writerToolName: string,
  decisions: Partial<Record<"plan" | "implementation" | "completion", InitiativeReadinessDecision>>,
): InitiativeReadinessDecision | null {
  if (writerToolName === "record_initiative_design_review"
    || writerToolName === "record_initiative_architecture_review") {
    const decision = decisions.implementation ?? decisions.plan;
    if (!decision) return null;
    const owed = designPhaseReviewDecision(decision);
    if (owed) return owed;
    // BI-EE99767C: the claim issuer sequences spec approval before plan coverage
    // when coverage needs a baseline. A fix carries only PLAN_REQUIRED here;
    // completion names its baseline owner. Route that prerequisite, not every
    // completion review, and never revive it once coverage is no longer owed.
    const needsCoverage = [...decision.blockers, ...decision.unmet].some((entry) =>
      entry.code === "PLAN_REQUIRED" && entry.state === "missing");
    if (writerToolName !== "record_initiative_design_review" || !needsCoverage) return null;
    const isMissingReviewBaseline = (entry: InitiativeReadinessDecision["unmet"][number]) =>
      entry.code === "OBJECTIVE_BASELINE_REQUIRED" && entry.state === "missing"
      && entry.accountableRole === "design-checklist-reviewer";
    const blockers = decisions.completion?.blockers.filter(isMissingReviewBaseline) ?? [];
    const unmet = decisions.completion?.unmet.filter(isMissingReviewBaseline) ?? [];
    return blockers.length || unmet.length ? { ...decision, blockers, unmet } : null;
  }
  if (writerToolName === "record_initiative_archetype_review") {
    const preDelivery = decisions.implementation ?? decisions.plan;
    const owed = preDelivery ? archetypePhaseReviewDecision(preDelivery) : null;
    if (owed) return owed;
  }
  return decisions.completion ?? null;
}

/**
 * BI-1D8E53D9: a passing spec-approval MINTS the objective baseline, so an item
 * still owed its design reviews has none yet. Route those reviews against the
 * room's discovered design, exactly as a refused plan claim issues them, before
 * the terminal recovery's baseline chain. Otherwise that recovery, the only one
 * the independent-review lane accepts, answers baseline-not-found and no new
 * item can ever request its own spec review.
 */
export async function routeDesignReviewsBeforeBaseline(args: {
  designPhase: InitiativeReadinessDecision;
  currentAgentId: string | null;
  baseSha: string;
  dispatchContext: InitiativeRecoveryDispatchContext;
  ports: Pick<TerminalRecoveryPorts, "discoverArtifact" | "resolveRecovery" | "loadPlanArtifact">;
}): Promise<InitiativeReviewerRecovery> {
  const { dispatchContext: room, ports } = args;
  const discovered = await ports.discoverArtifact({
    repositoryFullName: room.repositoryFullName,
    baseSha: args.baseSha,
    headSha: room.headSha,
  });
  return ports.resolveRecovery({
    decision: args.designPhase,
    currentAgentId: args.currentAgentId,
    db: prisma as never,
    dispatchContext: args.dispatchContext,
    canonicalArtifact: discovered.resolved
      ? { resolved: true, ...discovered.artifact }
      : { resolved: false, nextAction: discovered.nextAction },
    planArtifact: await ports.loadPlanArtifact({ itemId: args.designPhase.subject.id, repositoryFullName: room.repositoryFullName }),
    expectedCurrentBaselineId: null,
  });
}

const PLAN_UNAVAILABLE: InitiativeRecoveryCanonicalArtifact = {
  resolved: false,
  nextAction: "Record valid plan coverage for the current baseline and this Workroom repository, including the immutable plan commit and blob, then retry plan review.",
};

/** The same baseline-validated plan the implementation claim hands its reviewer. */
export async function loadPlanReviewArtifact(args: {
  itemId: string;
  repositoryFullName: string;
}): Promise<InitiativeRecoveryCanonicalArtifact> {
  const item = await prisma.backlogItem.findUnique({
    where: { itemId: args.itemId },
    include: { activeBuild: { select: { kind: true } }, activities: { orderBy: [{ recordedAt: "asc" }, { id: "asc" }] } },
  });
  if (!item) return PLAN_UNAVAILABLE;
  const inheritedScope = await loadInheritedInitiativeScope(prisma, { childItemId: item.itemId, childRowId: item.id });
  const { planArtifact } = projectBacklogItemReadiness({
    item: { ...item, activeBuildKind: item.activeBuild?.kind ?? null },
    activities: item.activities,
    inheritedScope,
    target: "implementation",
    transitionObject: { kind: "backlog-item", id: item.itemId, expectedVersion: "read-projection", targetState: "implementation" },
    authorization: "pass", capsuleIdentity: "pass", evaluatedAt: new Date().toISOString(),
  });
  return planArtifact && planArtifact.repositoryFullName.toLowerCase() === args.repositoryFullName.toLowerCase()
    ? { resolved: true, path: planArtifact.path, commitSha: planArtifact.commitSha, providerBlobId: planArtifact.providerBlobId }
    : PLAN_UNAVAILABLE;
}
