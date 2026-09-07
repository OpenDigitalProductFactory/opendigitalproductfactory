/**
 * The break-fix expedite lane (BI-F2FEC1EB, design §4 and §5 rulings 1–2).
 *
 * A break-fix is an operational repair of a live defect on the installed
 * runtime: it skips pre-authorisation and owes a post-implementation review
 * receipt within 48 hours by someone other than the declarer. The lane is
 * real, narrow and audited:
 *
 *   - human-only declaring authority (decision 2 at its conservative default);
 *   - WIP 1 per installation — a second declaration while one is open is refused;
 *   - a missed PIR blocks the declarer's next declaration;
 *   - the declaration is recorded on the item (`break_fix_declared`) and the
 *     bound Workroom takes `delivery-break-fix@1.0.0` as its declared shape.
 */

import { DELIVERY_BREAK_FIX_SHAPE_KEY, DELIVERY_SHAPE_VERSION } from "@/lib/work-management/delivery-shapes";
import { readWorkShapeClaim } from "@/lib/work-management/workroom-shape-claim";

export const BREAK_FIX_SHAPE_REF = `${DELIVERY_BREAK_FIX_SHAPE_KEY}@${DELIVERY_SHAPE_VERSION}`;
export const BREAK_FIX_PIR_WINDOW_MS = 48 * 60 * 60 * 1000;
export const BREAK_FIX_DECLARED_KIND = "break_fix_declared";
const TERMINAL_ROOM_STATUSES = ["complete", "abandoned", "archived", "superseded"];

export type BreakFixDeclaration = {
  schemaVersion: 1;
  reason: string;
  declaredByPrincipalId: string | null;
  declaredByUserId: string;
  capsuleId: string;
  declaredAt: string;
  pirDueAt: string;
};

export type DeclareBreakFixDb = {
  backlogItem: { findFirst(args: unknown): Promise<{ id: string; itemId: string; status: string } | null> };
  backlogItemActivity: {
    findMany(args: unknown): Promise<Array<{ id: string; backlogItemId: string; kind: string; gateKey?: string | null; recordedAt: Date; payload: unknown }>>;
    create(args: unknown): Promise<{ id: string }>;
  };
  workroom: {
    findFirst(args: unknown): Promise<{ id: string; capsuleId: string; scopeClaims: unknown } | null>;
    findMany(args: unknown): Promise<Array<{ capsuleId: string; backlogItemId: string | null; scopeClaims: unknown }>>;
    update(args: unknown): Promise<unknown>;
  };
};

export type DeclareBreakFixResult =
  | { ok: true; capsuleId: string; itemId: string; activityId: string; pirDueAt: string }
  | { ok: false; error: "break_fix_declaration_human_only" | "not_found" | "workroom_required" | "break_fix_wip_exceeded" | "break_fix_pir_missed" | "already_declared"; message: string; data?: Record<string, unknown> };

function isBreakFixRoom(scopeClaims: unknown): boolean {
  const ref = readWorkShapeClaim(scopeClaims);
  return ref?.key === DELIVERY_BREAK_FIX_SHAPE_KEY;
}

function declaration(payload: unknown): BreakFixDeclaration | null {
  const row = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
  if (!row || row.schemaVersion !== 1 || typeof row.pirDueAt !== "string" || typeof row.declaredAt !== "string") return null;
  return row as unknown as BreakFixDeclaration;
}

/** Pure: has the declarer an earlier break-fix whose PIR window closed without a receipt? */
export function findMissedPir(
  rows: ReadonlyArray<{ backlogItemId: string; kind: string; gateKey?: string | null; recordedAt: Date; payload: unknown; [extra: string]: unknown }>,
  now: Date,
): { backlogItemId: string; pirDueAt: string } | null {
  const reviewed = new Set(rows.filter((row) => row.kind === "initiative_gate_receipt" && row.gateKey === "post-implementation-review").map((row) => row.backlogItemId));
  for (const row of rows) {
    if (row.kind !== BREAK_FIX_DECLARED_KIND) continue;
    const declared = declaration(row.payload);
    if (!declared || reviewed.has(row.backlogItemId)) continue;
    if (new Date(declared.pirDueAt).getTime() < now.getTime()) return { backlogItemId: row.backlogItemId, pirDueAt: declared.pirDueAt };
  }
  return null;
}

export async function declareBreakFix(args: {
  db: DeclareBreakFixDb;
  itemId: string;
  reason: string;
  actor: { userId: string; agentId: string | null; principalId: string | null };
  now?: Date;
}): Promise<DeclareBreakFixResult> {
  const now = args.now ?? new Date();
  if (args.actor.agentId) {
    return { ok: false, error: "break_fix_declaration_human_only", message: "Only a person declares the expedite lane (design decision 2, default human-only). Ask the item's owner to declare it." };
  }
  const item = await args.db.backlogItem.findFirst({
    where: { OR: [{ itemId: args.itemId }, { id: args.itemId }] },
    select: { id: true, itemId: true, status: true },
  });
  if (!item) return { ok: false, error: "not_found", message: `BacklogItem ${args.itemId} not found.` };

  const room = await args.db.workroom.findFirst({
    where: { backlogItemId: item.itemId, archivedAt: null, status: { notIn: TERMINAL_ROOM_STATUSES } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, capsuleId: true, scopeClaims: true },
  });
  if (!room) return { ok: false, error: "workroom_required", message: `Claim ${item.itemId} into a Workroom first (claim_backlog_item_for_work), then declare the break-fix on it.` };
  if (isBreakFixRoom(room.scopeClaims)) {
    return { ok: false, error: "already_declared", message: `${item.itemId} is already declared break-fix on ${room.capsuleId}.`, data: { capsuleId: room.capsuleId } };
  }

  // WIP 1 per installation.
  const openRooms = await args.db.workroom.findMany({
    where: { archivedAt: null, status: { notIn: TERMINAL_ROOM_STATUSES }, capsuleId: { not: room.capsuleId } },
    select: { capsuleId: true, backlogItemId: true, scopeClaims: true },
  });
  const openBreakFix = openRooms.filter((candidate) => isBreakFixRoom(candidate.scopeClaims));
  if (openBreakFix.length > 0) {
    return {
      ok: false,
      error: "break_fix_wip_exceeded",
      message: `A break-fix is already open on this installation (${openBreakFix.map((candidate) => `${candidate.capsuleId} for ${candidate.backlogItemId ?? "?"}`).join(", ")}). The lane is WIP 1: close it with its post-implementation review first.`,
      data: { open: openBreakFix.map((candidate) => ({ capsuleId: candidate.capsuleId, backlogItemId: candidate.backlogItemId })) },
    };
  }

  // A missed PIR blocks the declarer's next declaration.
  const history = await args.db.backlogItemActivity.findMany({
    where: { OR: [
      { kind: BREAK_FIX_DECLARED_KIND, payload: { path: ["declaredByUserId"], equals: args.actor.userId } },
      { kind: "initiative_gate_receipt", gateKey: "post-implementation-review" },
    ] },
    select: { id: true, backlogItemId: true, kind: true, gateKey: true, recordedAt: true, payload: true },
    take: 500,
  });
  const missed = findMissedPir(history, now);
  if (missed) {
    return {
      ok: false,
      error: "break_fix_pir_missed",
      message: `Your earlier break-fix (${missed.backlogItemId}) missed its post-implementation review (due ${missed.pirDueAt}). Record that PIR receipt before declaring another.`,
      data: missed,
    };
  }

  const payload: BreakFixDeclaration = {
    schemaVersion: 1,
    reason: args.reason,
    declaredByPrincipalId: args.actor.principalId,
    declaredByUserId: args.actor.userId,
    capsuleId: room.capsuleId,
    declaredAt: now.toISOString(),
    pirDueAt: new Date(now.getTime() + BREAK_FIX_PIR_WINDOW_MS).toISOString(),
  };
  const existing = Array.isArray(room.scopeClaims) ? room.scopeClaims as unknown[] : [];
  const preserved = existing.filter((entry) => !(entry && typeof entry === "object" && "workShape" in (entry as Record<string, unknown>)));
  await args.db.workroom.update({
    where: { capsuleId: room.capsuleId },
    data: { scopeClaims: [...preserved, { workShape: BREAK_FIX_SHAPE_REF, recordedAt: payload.declaredAt, source: "declared", declaredByUserId: args.actor.userId }] },
  });
  const activity = await args.db.backlogItemActivity.create({
    data: {
      backlogItemId: item.id,
      kind: BREAK_FIX_DECLARED_KIND,
      summary: `Break-fix declared on ${room.capsuleId}: ${args.reason.slice(0, 160)}`,
      payload,
    },
  });
  return { ok: true, capsuleId: room.capsuleId, itemId: item.itemId, activityId: activity.id, pirDueAt: payload.pirDueAt };
}
