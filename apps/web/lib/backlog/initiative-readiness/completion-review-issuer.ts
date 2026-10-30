// The independent completion reviews readiness issues for an item right now,
// read as a given author identity. The platform reviewer dispatch sends these
// packets (server-reviewer-dispatch.ts), and the platform review writer
// re-derives its packet from the same issuer (platform-review-room.ts,
// BI-AA47C672), so a stored packet authorizes nothing by itself.
//
// A leaf on purpose: the writer path must not import the dispatcher, whose
// connection lookup sits on the tool-authority graph.

/** The independent completion reviews readiness issues now, for the author identity it is read as. */
export async function completionOwedRoutes(itemId: string, authorAgentId: string | null, currentUserId: string | undefined) {
  const { getBacklogItem } = await import("@/lib/mcp/packs/backlog-pack-read-tools");
  const item = await getBacklogItem({ itemId }, authorAgentId, currentUserId);
  const decision = (item.data?.readiness as { decisions?: { completion?: unknown } } | undefined)?.decisions?.completion as
    | import("@/lib/backlog/initiative-readiness").InitiativeReadinessDecision
    | undefined;
  if (!item.success || !decision) return null;
  if (decision.verdict === "allowed") return [];
  const { resolveTerminalInitiativeRecovery } = await import("./terminal-recovery");
  const recovery = await resolveTerminalInitiativeRecovery({ decision, currentAgentId: authorAgentId, currentUserId, refusedWorkroomId: null });
  return recovery.reviewerRoutes
    .filter((route) => route.independent)
    .map((route) => ({ workroomId: route.workroomId, requestCoworker: route.requestCoworker as unknown as Record<string, unknown> }));
}

/**
 * The post-implementation review packets readiness issues now for `issuer`,
 * the identity the dispatcher read the item as. Null when readiness could not
 * be read.
 */
export async function issuedPostImplementationReviewPackets(
  itemId: string,
  issuer: { userId: string; agentId: string | null },
): Promise<Array<Record<string, unknown>> | null> {
  const routes = await completionOwedRoutes(itemId, issuer.agentId, issuer.userId);
  return routes && routes.map((route) => route.requestCoworker).filter((packet) => {
    const binding = packet.initiativeReviewBinding as { gate?: unknown; itemId?: unknown } | undefined;
    return binding?.gate === "post-implementation-review" && binding.itemId === itemId;
  });
}
