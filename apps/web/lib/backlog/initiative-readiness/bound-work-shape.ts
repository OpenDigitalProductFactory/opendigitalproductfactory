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

/**
 * A shape decided at claim time must outlive the room that decided it
 * (BI-82DCD601).
 *
 * The original read required a LIVE room. By completion the room is closed —
 * that is its correct end state — so the shape became unreadable at exactly the
 * moment the rule needed it. Measured on this install 2026-09-09: 67 merged bug
 * fixes stalled at completion, 0 with a live room, 0 with a readable shape.
 * `smallShapeAcceptance` could therefore never fire for the population it was
 * written to serve.
 *
 * A closed room is now consulted as a FALLBACK, newest first. A live room still
 * wins, so an in-flight re-shape is honoured over a historical one; an
 * `abandoned` room is still never consulted, because abandoning the work is a
 * statement that its shape claim no longer stands.
 */
export async function readBoundWorkShapeRef(db: BoundWorkShapeDb, backlogItemId: string): Promise<string | null> {
  if (!db.workroom?.findFirst) return null;

  const live = await db.workroom.findFirst({
    where: { backlogItemId, archivedAt: null, status: { notIn: ["abandoned", "archived", "superseded"] } },
    orderBy: { updatedAt: "desc" },
    select: { scopeClaims: true },
  });
  const liveRef = readWorkShapeClaim(live?.scopeClaims);
  if (liveRef) return `${liveRef.key}@${liveRef.version}`;

  // No live room, or a live room that never claimed a shape. A completed or
  // archived room's claim is still the shape this work was done under.
  const historical = await db.workroom.findFirst({
    where: { backlogItemId, status: { notIn: ["abandoned", "superseded"] } },
    orderBy: { updatedAt: "desc" },
    select: { scopeClaims: true },
  });
  const ref = readWorkShapeClaim(historical?.scopeClaims);
  return ref ? `${ref.key}@${ref.version}` : null;
}
