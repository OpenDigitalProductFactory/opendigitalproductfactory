// BI-C5794F1D — status writes on a peer-owned work-sync mirror are refused.
//
// A mirror (BI-FF8A57EF) carries the `[origin:federatedWork:<inst>:<id>]`
// marker line and belongs to the installation it came from: only the origin
// mutates (spec 2026-08-23 §4 invariant 6), and every five-minute pull
// overwrites the local copy. A local status write is therefore never kept; it
// is reverted silently on the next pull. Every local status writer (MCP tools,
// portal editor and grid, ops route, acceptance sweep) asks this module first
// and refuses with the owner's name. Work sync writes rows directly and never
// passes through here, so the origin's changes still land.

import { parseFederatedWorkOriginMarker } from "@dpf/db/federated-work-contract";

export const PEER_OWNED_ERROR_CODE = "peer_owned_item";

export type PeerOwnedRefusal = {
  error: typeof PEER_OWNED_ERROR_CODE;
  message: string;
  originInstallationId: string;
};

/** The refusal for a status write on `itemId`, or null when this install owns it. */
export function peerOwnedStatusRefusal(itemId: string, body: string | null | undefined): PeerOwnedRefusal | null {
  const origin = parseFederatedWorkOriginMarker(body);
  if (!origin) return null;
  return {
    error: PEER_OWNED_ERROR_CODE,
    originInstallationId: origin.originInstallationId,
    message:
      `${itemId} is owned by installation ${origin.originInstallationId}; change it there — `
      + "local edits are overwritten by work sync.",
  };
}

export type PeerOwnedLookupDb = {
  backlogItem: {
    findUnique(args: { where: { itemId: string }; select: { body: true } }): Promise<{ body: string | null } | null>;
  };
};

/** Read the item by semantic id and return the refusal, if any. A missing item is left to the caller. */
export async function peerOwnedStatusRefusalFor(db: PeerOwnedLookupDb, itemId: string): Promise<PeerOwnedRefusal | null> {
  const row = await db.backlogItem.findUnique({ where: { itemId }, select: { body: true } });
  return row ? peerOwnedStatusRefusal(itemId, row.body) : null;
}
