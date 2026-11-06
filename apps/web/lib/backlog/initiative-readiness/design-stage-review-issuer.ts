// The independent design-stage reviews readiness issues for an item right now,
// read as a given author identity. The platform review writer re-derives its
// packet from the same issuer (platform-review-room.ts, BI-9CCB88C4), so a
// stored packet authorizes nothing by itself.
//
// A leaf on purpose: the writer path must not import the dispatcher, whose
// connection lookup sits on the tool-authority graph.

const DESIGN_STAGE_STEWARD_GATES = new Set(["design-spec", "spec-approval", "architecture-review"]);

/** The independent design-phase reviewer routes the implementation recovery issues now. */
export async function designPhaseOwedRecoveryRoutes(
  itemId: string,
  authorAgentId: string | null,
  currentUserId?: string,
) {
  const { getBacklogItem } = await import("@/lib/mcp/packs/backlog-pack-read-tools");
  const item = await getBacklogItem({ itemId }, authorAgentId, currentUserId);
  const decision = (item.data?.readiness as { decisions?: { implementation?: unknown } } | undefined)?.decisions?.implementation as
    | import("@/lib/backlog/initiative-readiness").InitiativeReadinessDecision
    | undefined;
  if (!item.success || !decision) return null;
  if (decision.verdict === "allowed") return [];
  const { designPhaseReviewDecision } = await import("./design-phase-recovery");
  const designPhase = designPhaseReviewDecision(decision);
  if (!designPhase) return [];
  const { resolveTerminalInitiativeRecovery } = await import("./terminal-recovery");
  const recovery = await resolveTerminalInitiativeRecovery({
    decision: designPhase, currentAgentId: authorAgentId, currentUserId, refusedWorkroomId: null,
  });
  return recovery.reviewerRoutes.filter((route) => route.independent);
}

/**
 * The design-spec / spec-approval / architecture-review packets readiness
 * issues now for `issuer`. Null when readiness could not be read. Pass `gate`
 * to keep only that steward gate.
 */
export async function issuedDesignStageReviewPackets(
  itemId: string,
  issuer: { userId: string; agentId: string | null },
  gate?: string,
): Promise<Array<Record<string, unknown>> | null> {
  const routes = await designPhaseOwedRecoveryRoutes(itemId, issuer.agentId, issuer.userId);
  return routes && routes.map((route) => route.requestCoworker as unknown as Record<string, unknown>).filter((packet) => {
    const binding = packet.initiativeReviewBinding as { gate?: unknown; itemId?: unknown } | undefined;
    if (binding?.itemId !== itemId || typeof binding.gate !== "string" || !DESIGN_STAGE_STEWARD_GATES.has(binding.gate)) {
      return false;
    }
    return gate === undefined || binding.gate === gate;
  });
}
