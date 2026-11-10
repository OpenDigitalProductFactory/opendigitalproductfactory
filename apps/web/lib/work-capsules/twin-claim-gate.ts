// Claims see the paired install's work (BI-91FC6B9A, spec 2026-10-28 §3.5).
//
// A defect the paired install is already working must not be started again
// here by accident. Claiming an item whose same-origin twin is in progress (or
// claimed) on the peer, or claiming the peer's own mirror, is refused unless
// the caller deliberately co-claims with force + overrideReason, which is
// recorded on the Workroom. A re-claim of a room this branch already holds is
// not a new start and is not re-gated.

import type { ToolResult } from "@/lib/mcp-tool-types";
import {
  federatedWorkOrigin,
  isFederatedMirror,
  loadFederatedTwins,
  loadMirrorClaim,
  peerWorkInProgress,
  type FederatedTwin,
  type FederatedTwinDb,
  type TwinCandidate,
} from "@/lib/federation/federated-twins";

/** Mirrors TERMINAL_CAPSULE_STATUSES (apps/web/lib/build/unified-wip-query.ts). */
const TERMINAL_WORKROOM_STATUSES = ["complete", "abandoned", "archived"] as const;

export type TwinClaimBlocker = Pick<FederatedTwin, "itemId" | "status" | "peer" | "claim"> & {
  reason: "peer-mirror" | "peer-twin-in-progress";
};

/** Pure: what stands in the way of claiming `item` here. */
export function twinClaimBlockers(
  item: TwinCandidate,
  mirrorClaim: FederatedTwin["claim"],
  twins: readonly FederatedTwin[],
): TwinClaimBlocker[] {
  const blockers: TwinClaimBlocker[] = [];
  if (isFederatedMirror(item.body)) {
    blockers.push({ itemId: item.itemId, status: item.status, peer: federatedWorkOrigin(item.body), claim: mirrorClaim, reason: "peer-mirror" });
  }
  for (const twin of twins) {
    if (peerWorkInProgress(twin)) blockers.push({ itemId: twin.itemId, status: twin.status, peer: twin.peer, claim: twin.claim, reason: "peer-twin-in-progress" });
  }
  return blockers;
}

export type TwinGateDb = FederatedTwinDb & {
  backlogItem: FederatedTwinDb["backlogItem"] & { findFirst(args: unknown): Promise<TwinCandidate | null> };
  workroom: { count(args: unknown): Promise<number> };
};

export type TwinGateOutcome =
  | { kind: "clear" }
  | { kind: "refused"; result: ToolResult }
  | { kind: "overridden"; blockers: TwinClaimBlocker[]; reason: string };

export async function evaluateTwinClaimGate(db: TwinGateDb, input: {
  itemId: string;
  headBranch: string;
  force: boolean;
  overrideReason: string | null;
}): Promise<TwinGateOutcome> {
  const item = await db.backlogItem.findFirst({
    where: { OR: [{ itemId: input.itemId }, { id: input.itemId }] },
    select: { id: true, itemId: true, status: true, body: true },
  });
  if (!item) return { kind: "clear" };
  const reclaim = await db.workroom.count({
    where: {
      backlogItemId: { in: [item.itemId, item.id] },
      headBranch: input.headBranch,
      status: { notIn: [...TERMINAL_WORKROOM_STATUSES] },
    },
  });
  if (reclaim > 0) return { kind: "clear" };

  const mirrorClaim = isFederatedMirror(item.body) ? await loadMirrorClaim(db, item.itemId) : null;
  const blockers = twinClaimBlockers(item, mirrorClaim, await loadFederatedTwins(db, item));
  if (blockers.length === 0) return { kind: "clear" };
  if (input.force && input.overrideReason) return { kind: "overridden", blockers, reason: input.overrideReason };

  const named = blockers
    .map((b) => b.reason === "peer-mirror"
      ? `${b.itemId} is the paired installation's own record (${b.status})`
      : `the paired installation is working the same defect as ${b.itemId} (${b.status}${b.claim?.active ? `, claimed${b.claim.workrooms ? `, ${b.claim.workrooms} live Workroom(s)` : ""}` : ""})`)
    .join("; ");
  return {
    kind: "refused",
    result: {
      success: false,
      error: "federated_twin_in_progress",
      message: `Not claimed: ${named}. Coordinate with the paired installation, or deliberately co-claim with force=true and overrideReason.`,
      data: { backlogItemId: item.itemId, twins: blockers },
    },
  };
}
