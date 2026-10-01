import { prisma, type Prisma } from "@dpf/db";
import { effectiveBacklogSensitivity } from "@/lib/federation/cross-org-sharing";
import { readWorkroomBoundaryClaim } from "./workroom-boundary-claim";

/**
 * The sensitivity a Workroom's own information carries (BI-0A5EE9C1): the
 * ceiling declared on its boundary, otherwise the effective sensitivity of the
 * backlog item it serves, otherwise the fail-closed `internal`. A case policy
 * ceiling, when one was set, is enforced on top of this by the caller.
 */
export async function resolveRoomSensitivityCeiling(
  room: { scopeClaims: unknown; backlogItemId: string | null },
  db: Prisma.TransactionClient = prisma,
): Promise<string> {
  const declared = readWorkroomBoundaryClaim(room.scopeClaims)?.sensitivityCeiling;
  if (declared) return declared;
  if (!room.backlogItemId) return "internal";
  // Workroom.backlogItemId holds either the semantic BI-* key or the row id.
  const item = await db.backlogItem.findFirst({
    where: { OR: [{ itemId: room.backlogItemId }, { id: room.backlogItemId }] },
    select: { sensitivity: true, scopeKind: true, digitalProduct: { select: { productId: true } } },
  });
  if (!item) return "internal";
  return effectiveBacklogSensitivity({
    sensitivity: item.sensitivity,
    scopeKind: item.scopeKind,
    digitalProductId: item.digitalProduct?.productId ?? null,
  });
}
