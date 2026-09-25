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
]);

export function designPhaseReviewDecision(
  decision: InitiativeReadinessDecision,
): InitiativeReadinessDecision | null {
  const isDesignReview = (entry: { code: string }) => DESIGN_REVIEW_CODES.has(entry.code);
  if (![...decision.blockers, ...decision.unmet].some(isDesignReview)) return null;
  return {
    ...decision,
    blockers: decision.blockers.filter(isDesignReview),
    unmet: decision.unmet.filter(isDesignReview),
  };
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
