import { prisma } from "@dpf/db";
import type { ToolCallConsequence, ToolCallConsequenceInput } from "@/lib/tool-consequence";
import { workCapsuleActor } from "./handler-actor";
import { classifyScopeRelease, type ScopeReleaseRoom } from "./scope-release-authorization";
import { parseScopeReleaseRequest } from "./scope-release-targets";

type Reader = { workroom: { findUnique(args: unknown): Promise<ScopeReleaseRoom | null> } };

export async function scopeReleaseConsequenceForCall(
  call: ToolCallConsequenceInput,
  deps: { db?: Reader; resolveActor?: typeof workCapsuleActor } = {},
): Promise<ToolCallConsequence> {
  const authority = { consequence: "authority" as const, reason: "scope-release-request-unproven" };
  if (!["release_workroom_scope", "release_capsule_scope"].includes(call.toolName)) return authority;
  const request = parseScopeReleaseRequest(call.params);
  if (!request) return authority;
  const { capsuleId, claims, expectedRoomId } = request;
  const db = deps.db ?? prisma as unknown as Reader;
  const room = await db.workroom.findUnique({ where: { capsuleId },
    select: { id: true, capsuleId: true, status: true, archivedAt: true, scopeClaims: true,
      leaseHolderPrincipalId: true, leaseExpiresAt: true } });
  const actor = await (deps.resolveActor ?? workCapsuleActor)(call.userId, call.context);
  return classifyScopeRelease({ room, capsuleId, claims, expectedRoomId,
    callerPrincipalId: actor.principalId, now: call.now ?? new Date() });
}
