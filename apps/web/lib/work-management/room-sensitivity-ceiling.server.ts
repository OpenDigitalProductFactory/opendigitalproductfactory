import { prisma, type Prisma } from "@dpf/db";
import { effectiveBacklogSensitivity } from "@/lib/federation/cross-org-sharing";
import { readWorkroomBoundaryClaim } from "./workroom-boundary-claim";
import { readWorkspaceRoomPolicy } from "./workspace-room-access";

/** The effective sensitivity of a backlog item, or the fail-closed `internal`. */
async function backlogItemCeiling(backlogItemId: string, db: Prisma.TransactionClient): Promise<string> {
  // Callers hold either the semantic BI-* key or the row id.
  const item = await db.backlogItem.findFirst({
    where: { OR: [{ itemId: backlogItemId }, { id: backlogItemId }] },
    select: { sensitivity: true, scopeKind: true, digitalProduct: { select: { productId: true } } },
  });
  if (!item) return "internal";
  return effectiveBacklogSensitivity({
    sensitivity: item.sensitivity,
    scopeKind: item.scopeKind,
    digitalProductId: item.digitalProduct?.productId ?? null,
  });
}

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
  return backlogItemCeiling(room.backlogItemId, db);
}

/**
 * The same rule for a room reached by caseKey (a WorkItem), used by room
 * messaging, invites and the room charter (BI-ED5561BB). The room policy's
 * explicit ceiling wins; otherwise a backlog-item room carries its item's
 * effective sensitivity, so platform work reads as public (DI-5E19848444FC);
 * anything else is the fail-closed `internal`.
 */
export async function resolveWorkItemRoomSensitivityCeiling(
  item: { evidence: unknown; sourceType?: string | null; sourceId?: string | null },
  db: Prisma.TransactionClient = prisma,
): Promise<string> {
  const declared = readWorkspaceRoomPolicy(item.evidence).sensitivityCeiling;
  if (declared) return declared;
  if (item.sourceType !== "backlog-item" || !item.sourceId) return "internal";
  return backlogItemCeiling(item.sourceId, db);
}
