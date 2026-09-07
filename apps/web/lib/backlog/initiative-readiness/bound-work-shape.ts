/**
 * The delivery shape a backlog item is bound to, read from its newest live
 * Workroom's `workShape` scope claim (persisted by claim_backlog_item_for_work,
 * BI-02470C7E). Returned as `key@version` for `readinessShapeFromWorkShape`.
 * Null when no room carries one: the item is unshaped and v2 applies.
 */

import { readWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

export type BoundWorkShapeDb = {
  workroom: { findFirst(args: unknown): Promise<{ scopeClaims?: unknown } | null> };
};

export async function readBoundWorkShapeRef(db: BoundWorkShapeDb, backlogItemId: string): Promise<string | null> {
  if (!db.workroom?.findFirst) return null;
  const room = await db.workroom.findFirst({
    where: { backlogItemId, archivedAt: null, status: { notIn: ["abandoned", "archived", "superseded"] } },
    orderBy: { updatedAt: "desc" },
    select: { scopeClaims: true },
  });
  const ref = readWorkShapeClaim(room?.scopeClaims);
  return ref ? `${ref.key}@${ref.version}` : null;
}
