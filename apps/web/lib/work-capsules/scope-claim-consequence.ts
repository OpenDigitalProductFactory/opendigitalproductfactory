// Server-side refiner for claim_workroom_scope's declared `authority`
// consequence (BI-2D65BD1B). Reads the room and resolves the caller exactly as
// the handler will, then applies the shared lease rule in scope-claim-lease.ts.

import { prisma } from "@dpf/db";

import type { ToolCallConsequence, ToolCallConsequenceInput } from "@/lib/tool-consequence";
import { workCapsuleActor } from "./handler-actor";
import { classifyScopeClaim } from "./scope-claim-lease";

type RoomReader = {
  workroom: {
    findUnique(args: unknown): Promise<{
      status: string | null;
      archivedAt: Date | null;
      leaseHolderPrincipalId: string | null;
      leaseExpiresAt: Date | null;
    } | null>;
  };
};

export async function scopeClaimConsequenceForCall(
  call: ToolCallConsequenceInput,
  deps: { db?: RoomReader; resolveActor?: typeof workCapsuleActor } = {},
): Promise<ToolCallConsequence> {
  const db = deps.db ?? (prisma as unknown as RoomReader);
  const resolveActor = deps.resolveActor ?? workCapsuleActor;
  const capsuleId = typeof call.params.capsuleId === "string" ? call.params.capsuleId.trim() : "";
  const room = capsuleId
    ? await db.workroom.findUnique({
        where: { capsuleId },
        select: { status: true, archivedAt: true, leaseHolderPrincipalId: true, leaseExpiresAt: true },
      })
    : null;
  const actor = await resolveActor(call.userId, call.context);
  return classifyScopeClaim({
    force: call.params.force === true,
    room,
    callerPrincipalId: actor.principalId ?? null,
    now: call.now ?? new Date(),
  });
}
