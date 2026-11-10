// Self-healing for the "Enrollment conflict" state.
//
// `selectMainInstallationNode` refuses to guess between installer-managed
// enrollments that both claim this installation — correctly, when both are
// alive. But the common way to reach that state is not two live nodes: it is
// an old installer-managed enrollment (a container-host node from a previous
// install) that stopped heartbeating weeks ago, plus the native node the
// current install enrolled. Leaving that to a human to notice and click Revoke
// made a non-technical operator the platform's garbage collector.
//
// The rule here is deliberately narrow so it never guesses:
//   - only installer-managed, non-revoked nodes are considered;
//   - nothing is retired unless at least one candidate is provably LIVE
//     (heartbeat inside `liveWithinMs`);
//   - a candidate is retired only when it has been silent for at least
//     `staleAfterMs` (a week by default) — far past the offline window;
//   - two live candidates remain a conflict for a human.
// Everything else stays exactly as the readiness surface reports it.

import { revokeEdgeNode, type RevokeEdgeNodeDb } from "./revoke";

/** A week of silence before an installer-managed enrollment is treated as abandoned. */
export const EDGE_STALE_ENROLLMENT_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** A candidate counts as live when it has heartbeated within the last hour. */
export const EDGE_LIVE_ENROLLMENT_WITHIN_MS = 60 * 60 * 1000;

export interface InstallerNodeCandidate {
  id: string;
  nodeId: string;
  trustState: string;
  lastSeenAt: Date | null;
  enrolledAt: Date | null;
}

export interface StaleSupersessionDecision {
  /** The live candidate(s) that make the others provably obsolete. */
  liveNodeIds: string[];
  /** Candidates to retire, with the machine-readable reason to record. */
  retire: Array<{ id: string; nodeId: string; reason: string; silentSinceIso: string | null }>;
  /** Why nothing was retired, when nothing was. */
  skipped: "single-candidate" | "no-live-candidate" | "nothing-stale" | null;
}

function lastSignalAt(node: InstallerNodeCandidate): Date | null {
  return node.lastSeenAt ?? node.enrolledAt ?? null;
}

export function selectSupersededInstallerNodes(input: {
  candidates: readonly InstallerNodeCandidate[];
  now?: Date;
  staleAfterMs?: number;
  liveWithinMs?: number;
}): StaleSupersessionDecision {
  const now = input.now ?? new Date();
  const staleAfterMs = input.staleAfterMs ?? EDGE_STALE_ENROLLMENT_AFTER_MS;
  const liveWithinMs = input.liveWithinMs ?? EDGE_LIVE_ENROLLMENT_WITHIN_MS;
  const candidates = input.candidates.filter((node) => node.trustState !== "revoked");
  if (candidates.length < 2) return { liveNodeIds: [], retire: [], skipped: "single-candidate" };

  const live = candidates.filter((node) => {
    const at = node.lastSeenAt;
    return at !== null && now.getTime() - at.getTime() <= liveWithinMs;
  });
  if (live.length === 0) return { liveNodeIds: [], retire: [], skipped: "no-live-candidate" };

  const liveIds = new Set(live.map((node) => node.id));
  const liveNodeIds = live.map((node) => node.nodeId);
  const retire = candidates
    .filter((node) => !liveIds.has(node.id))
    .filter((node) => {
      const at = lastSignalAt(node);
      return at !== null && now.getTime() - at.getTime() >= staleAfterMs;
    })
    .map((node) => ({
      id: node.id,
      nodeId: node.nodeId,
      silentSinceIso: lastSignalAt(node)?.toISOString() ?? null,
      reason: `superseded-stale-installer-enrollment: silent since ${lastSignalAt(node)?.toISOString() ?? "enrollment"}; `
        + `live installer-managed node ${liveNodeIds.join(", ")} claims this installation`,
    }));
  return { liveNodeIds, retire, skipped: retire.length === 0 ? "nothing-stale" : null };
}

export interface StaleSupersessionDb extends RevokeEdgeNodeDb {
  edgeNode: RevokeEdgeNodeDb["edgeNode"] & {
    findMany(args: unknown): Promise<InstallerNodeCandidate[]>;
  };
}

/**
 * Load this installation's installer-managed enrollments (a consumed
 * auto-approve bootstrap token is what makes a node installer-managed — the
 * same basis `/platform/edge-nodes` uses) and retire the provably superseded
 * ones. Safe to call from the hourly janitor and right after an enrollment.
 */
export async function supersedeStaleInstallerNodes(
  db: StaleSupersessionDb,
  options: { now?: Date; staleAfterMs?: number; liveWithinMs?: number } = {},
): Promise<{ decision: StaleSupersessionDecision; revoked: string[] }> {
  const now = options.now ?? new Date();
  const candidates = await db.edgeNode.findMany({
    where: {
      trustState: { not: "revoked" },
      customerAccountId: null,
      customerSiteId: null,
      consumedTokens: { some: { autoApprove: true } },
    },
    select: { id: true, nodeId: true, trustState: true, lastSeenAt: true, enrolledAt: true },
  });
  const decision = selectSupersededInstallerNodes({ candidates, now, ...options });
  const revoked: string[] = [];
  for (const target of decision.retire) {
    const result = await revokeEdgeNode(db, { edgeNodeId: target.id, reason: target.reason, now });
    if (result.status === "revoked" && result.changed) revoked.push(target.nodeId);
  }
  return { decision, revoked };
}
