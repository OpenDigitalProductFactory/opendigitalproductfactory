// Server shell of the governed work-shape rebind (BI-CB5C0DCE, phase 3).
// planWorkroomShapeRebind decides; this loads the room, resolves who may
// decide, and writes the claim behind compare-and-set together with the
// decision evidence and a `workshape-rebound` activity.

import { ok, type ActionSuccess } from "@/lib/shared/action-result";
import { adoptionScopePatch, scopeChangeEvidence, scopeWriteWhere } from "@/lib/work-capsules/scope-input";
import { publishRecordedWorkCapsuleActivity } from "@/lib/work-capsules/activity-events";
import { recordWorkCapsuleActivity, recordWorkCapsuleEvidence } from "@/lib/work-capsules/work-capsule-activity-store";
import type { CapsuleDb } from "@/lib/work-capsules/work-capsule-store-types";
import { loadRoomAccountabilityBatch, type RoomWorkforceDb } from "./room-workforce.server";
import { resolveStageDecider, stageDeciderRefusal, type StageDecider } from "./workroom-stage-decision";
import {
  buildRebindEvidence,
  planWorkroomShapeRebind,
  rebindRefusal,
  type RebindPlanData,
  type RebindRefusal,
} from "./workroom-shape-rebind";

type FindFirst = { findFirst(args: unknown): Promise<Record<string, unknown> | null> };

export type ShapeRebindDb = RoomWorkforceDb & CapsuleDb & { principal: FindFirst };

/** Prisma's "no row matched the where" — here, the compare-and-set lost. */
function isCasMiss(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "P2025");
}

type RoomRow = {
  id: string;
  capsuleId: string;
  scopeClaims: unknown;
  workspaceState: unknown;
  updatedAt: Date;
  archivedAt: Date | null;
};

export type ShapeRebindInput = {
  /** Either the room row id (portal) or its WC-* id (MCP). */
  roomRowId?: string;
  capsuleId?: string;
  toKey?: string | null;
  toVersion: string;
  rationale?: string | null;
  dryRun?: boolean;
  userId: string;
  agentId?: string | null;
  /** Resolved by the caller from the session's capabilities. */
  callerHasManagePlatform: boolean;
  now?: Date;
};

export type ShapeRebindResult = ActionSuccess<RebindPlanData & { applied: boolean; capsuleId: string }> | RebindRefusal;

async function callerHumanPrincipalId(db: ShapeRebindDb, userId: string): Promise<string | null> {
  const principal = await db.principal.findFirst({
    where: { kind: "human", status: "active", aliases: { some: { aliasType: "user", issuer: "", aliasValue: userId } } },
    select: { id: true },
  });
  return typeof principal?.id === "string" ? principal.id : null;
}

async function loadRoom(db: ShapeRebindDb, input: ShapeRebindInput): Promise<RoomRow | null> {
  const where = input.roomRowId ? { id: input.roomRowId } : input.capsuleId ? { capsuleId: input.capsuleId } : null;
  if (!where) return null;
  const room = await db.workroom.findUnique({
    where,
    select: { id: true, capsuleId: true, scopeClaims: true, workspaceState: true, updatedAt: true, archivedAt: true },
  }) as RoomRow | null;
  return room && !room.archivedAt ? room : null;
}

/** Plan (dryRun) or apply a rebind for the signed-in caller. */
export async function rebindWorkroomShapeForUser(db: ShapeRebindDb, input: ShapeRebindInput): Promise<ShapeRebindResult> {
  const room = await loadRoom(db, input);
  if (!room) return rebindRefusal("room_not_found", "That room could not be found.");
  const owner = (await loadRoomAccountabilityBatch(db, [room.id])).get(room.id)!;
  const decider: StageDecider = resolveStageDecider(owner.accountability, owner.accountableDisplayName);
  const callerPrincipalId = await callerHumanPrincipalId(db, input.userId);
  const isOwner = decider.state === "resolved" && callerPrincipalId !== null && callerPrincipalId === decider.principalId;
  const rationale = input.rationale?.trim() || null;
  const plan = planWorkroomShapeRebind({
    scopeClaims: room.scopeClaims,
    workspaceState: room.workspaceState,
    toKey: input.toKey ?? null,
    toVersion: input.toVersion,
    authorized: isOwner || input.callerHasManagePlatform,
    authorityRefusal: `${stageDeciderRefusal(decider).replace("record this decision", "rebind this room")} A platform manager may also do it.`,
    rationale,
    preview: input.dryRun === true,
  });
  if (!plan.ok) return plan;
  const planned = plan.data;
  if (input.dryRun) return ok({ ...planned, applied: false, capsuleId: room.capsuleId });

  const now = input.now ?? new Date();
  const patch = adoptionScopePatch(room as unknown as Record<string, unknown>, { workShape: planned.toRef }, now);
  const actor = { userId: input.userId, agentId: input.agentId ?? null, principalId: callerPrincipalId };
  const write = async (tx: ShapeRebindDb) => {
    const updated = await tx.workroom.update({ where: scopeWriteWhere(room as unknown as Record<string, unknown>), data: patch });
    await recordWorkCapsuleEvidence({
      db: tx,
      capsuleId: room.capsuleId,
      evidence: buildRebindEvidence({
        plan: planned,
        rationale,
        decidedBy: isOwner ? "accountable-owner" : "platform-manager",
        deciderName: isOwner && decider.state === "resolved" ? decider.name : "A platform manager",
      }),
      actor,
      deferPublication: true,
    });
    return recordWorkCapsuleActivity(tx, {
      workCapsuleId: room.id,
      kind: "workshape-rebound",
      summary: `Rebound from ${planned.fromRef} to ${planned.toRef}.`,
      payload: { scopeChanges: scopeChangeEvidence(room as unknown as Record<string, unknown>, updated), classification: planned.diff.classification },
      actor,
    }, { deferPublication: true });
  };
  try {
    const activity = db.$transaction
      ? await db.$transaction((tx) => write(tx as ShapeRebindDb))
      : await write(db);
    publishRecordedWorkCapsuleActivity(room.id, activity?.id);
  } catch (error) {
    if (!isCasMiss(error)) throw error;
    return rebindRefusal("rebind_conflict", "The room changed while you were deciding. Review the current version and try again.");
  }
  return ok({ ...planned, applied: true, capsuleId: room.capsuleId });
}
