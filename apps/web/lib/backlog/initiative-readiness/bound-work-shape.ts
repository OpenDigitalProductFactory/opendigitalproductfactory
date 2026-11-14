/**
 * The delivery shape a backlog item is bound to, read from its newest live
 * Workroom's `workShape` scope claim (persisted by claim_backlog_item_for_work,
 * BI-02470C7E). Returned as `key@version` for `readinessShapeFromWorkShape`.
 * Null when no room carries one: the item is unshaped and v2 applies.
 */

import { readWorkShapeClaim, resolveWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";
import { isRecord } from "@/lib/shared/coerce";
import { scopeClaimEntries } from "@/lib/work-capsules/scope-input";
import { isTerminalCapsuleStatus } from "@/lib/work-capsules/work-capsule-branch-identity";

/** Strict inspection for missing-only native recovery; tolerant item readers below stay unchanged. */
export function inspectNativeDeliveryClaim(carrier: unknown): { kind: "missing" | "invalid" } | { kind: "bound"; workShape: string } {
  const entries = scopeClaimEntries(carrier);
  if ((!Array.isArray(carrier) && !isRecord(carrier)) || entries.some(entry => !isRecord(entry))) return { kind: "invalid" };
  const declarations = entries.filter(entry => isRecord(entry)
    && ["workShape", "workShapeKey", "workShapeVersion"].some(key => Object.hasOwn(entry, key)));
  if (!declarations.length) return { kind: "missing" };
  const declaration = declarations[0];
  const mixed = isRecord(declaration) && Object.hasOwn(declaration, "workShape")
    && (Object.hasOwn(declaration, "workShapeKey") || Object.hasOwn(declaration, "workShapeVersion"));
  if (declarations.length !== 1 || mixed || !resolveWorkShapeClaim([declaration])) return { kind: "invalid" };
  const ref = readWorkShapeClaim([declaration])!;
  return { kind: "bound", workShape: `${ref.key}@${ref.version}` };
}

type NativeBuildRoom = {
  id: string; capsuleId: string; executorKind: string | null; executorRef: string | null;
  featureBuildId: string | null; backlogItemId: string | null; status: string;
  archivedAt: unknown; scopeClaims: unknown;
};
export type NativeBuildRoomDb = { workroom?: { findMany?(args: unknown): Promise<NativeBuildRoom[]> } };
export type NativeBuildRoomBinding = {
  buildId: string; buildRowId: string; itemId: string; itemRowId: string;
  expectedWorkroom?: { id: string; capsuleId: string };
};

/** Review entry reads one carrier for BOTH facts; another room's recency grants no fallback. */
export async function readNativeBuildDeliveryFacts(db: NativeBuildRoomDb, binding: NativeBuildRoomBinding) {
  if (!db.workroom?.findMany) return null;
  const rooms = await db.workroom.findMany({
    where: { executorKind: "build-studio", executorRef: binding.buildId, archivedAt: null,
      status: { notIn: ["complete", "abandoned", "archived", "superseded"] } },
    take: 2,
    select: { id: true, capsuleId: true, executorKind: true, executorRef: true, featureBuildId: true,
      backlogItemId: true, status: true, archivedAt: true, scopeClaims: true },
  });
  const room = rooms[0];
  if (rooms.length !== 1 || !room || room.executorKind !== "build-studio" || room.executorRef !== binding.buildId
    || room.featureBuildId !== binding.buildRowId || ![binding.itemId, binding.itemRowId].includes(room.backlogItemId ?? "")
    || room.archivedAt != null || isTerminalCapsuleStatus(room.status) || room.status === "superseded"
    || (binding.expectedWorkroom && (room.id !== binding.expectedWorkroom.id || room.capsuleId !== binding.expectedWorkroom.capsuleId))) return null;
  const declaration = inspectNativeDeliveryClaim(room.scopeClaims);
  return declaration.kind === "bound" ? {
    room: { id: room.id, capsuleId: room.capsuleId }, workShape: declaration.workShape,
    declaredPaths: editPathsOf(scopeClaimEntries(room.scopeClaims)) ?? [],
  } : null;
}

export type BoundWorkShapeDb = {
  workroom: { findFirst(args: unknown): Promise<{ scopeClaims?: unknown } | null> };
  /** BI-BAB5E837: lets a semantic item id (BI-…) resolve to the row id the room stores. */
  backlogItem?: { findFirst(args: unknown): Promise<{ id: string } | null> };
};

/**
 * Workroom.backlogItemId holds the BacklogItem ROW id, while every caller of
 * this reader passes the semantic id (BI-…). The lookup never matched, so a
 * bound shape was invisible to readiness everywhere except the claim that
 * persisted it, and every item was gated as unshaped (live install
 * 2026-09-23: a room carrying delivery-small@1.0.0, a decision with
 * shapeDecision absent). Accept either id: a semantic id resolves to its row.
 *
 * BI-454451F1: the column holds BOTH forms. Build Studio rooms store the row id
 * (build-studio-attachment.ts); rooms claimed or adopted from a CLI store the
 * semantic id (337 of 439 on the dev install). So the lookup matches either,
 * as work-capsule-terminal-transition.ts already does.
 */
async function resolveBacklogRowId(db: BoundWorkShapeDb, backlogItemId: string): Promise<string> {
  if (!/^BI-/i.test(backlogItemId) || !db.backlogItem?.findFirst) return backlogItemId;
  const row = await db.backlogItem.findFirst({ where: { itemId: backlogItemId }, select: { id: true } });
  return row?.id ?? backlogItemId;
}

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
export async function readBoundWorkShapeRef(db: BoundWorkShapeDb, backlogItemRef: string): Promise<string | null> {
  const ref = await readBoundRoomClaim(db, backlogItemRef, readWorkShapeClaim);
  return ref ? `${ref.key}@${ref.version}` : null;
}

/**
 * The paths the bound Workroom declared it EDITS (claim_workroom_scope), read
 * the same way as the shape: live room first, then the newest closed one, so
 * completion re-reads what the change said it touches (BI-243BC956). Empty when
 * no room declared any: sensitivity then falls back to what the body cites.
 */
export async function readBoundEditPaths(db: BoundWorkShapeDb, backlogItemRef: string): Promise<string[]> {
  return (await readBoundRoomClaim(db, backlogItemRef, editPathsOf)) ?? [];
}

const EDIT_PATH_KINDS = new Set(["path", "module", "package"]);

function editPathsOf(scopeClaims: unknown): string[] | null {
  if (!Array.isArray(scopeClaims)) return null;
  const paths = scopeClaims.flatMap((entry) => {
    const claim = entry as { kind?: unknown; intent?: unknown; value?: unknown } | null;
    return claim && EDIT_PATH_KINDS.has(String(claim.kind)) && claim.intent === "edit"
      && typeof claim.value === "string" && claim.value.trim()
      ? [claim.value.trim()]
      : [];
  });
  return paths.length > 0 ? paths : null;
}

async function readBoundRoomClaim<T>(
  db: BoundWorkShapeDb,
  backlogItemRef: string,
  read: (scopeClaims: unknown) => T | null,
): Promise<T | null> {
  if (!db.workroom?.findFirst) return null;
  const rowId = await resolveBacklogRowId(db, backlogItemRef);
  const backlogItemId = rowId === backlogItemRef ? rowId : { in: [backlogItemRef, rowId] };

  const live = await db.workroom.findFirst({
    where: { backlogItemId, archivedAt: null, status: { notIn: ["abandoned", "archived", "superseded"] } },
    orderBy: { updatedAt: "desc" },
    select: { scopeClaims: true },
  });
  const liveClaim = read(live?.scopeClaims);
  if (liveClaim) return liveClaim;

  // No live room, or a live room that never claimed a shape. A completed or
  // archived room's claim is still the shape this work was done under.
  const historical = await db.workroom.findFirst({
    where: { backlogItemId, status: { notIn: ["abandoned", "superseded"] } },
    orderBy: { updatedAt: "desc" },
    select: { scopeClaims: true },
  });
  return read(historical?.scopeClaims);
}
