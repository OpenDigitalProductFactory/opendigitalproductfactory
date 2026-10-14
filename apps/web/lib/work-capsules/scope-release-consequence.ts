import { prisma } from "@dpf/db";
import type { ToolCallConsequence, ToolCallConsequenceInput } from "@/lib/tool-consequence";
import { workCapsuleActor } from "./handler-actor";
import { classifyScopeRelease, parseScopeReleaseClaims, type ScopeReleaseRoom } from "./scope-release-authorization";

type Reader = { workroom: { findUnique(args: unknown): Promise<ScopeReleaseRoom | null> } };

export async function scopeReleaseConsequenceForCall(
  call: ToolCallConsequenceInput,
  deps: { db?: Reader; resolveActor?: typeof workCapsuleActor } = {},
): Promise<ToolCallConsequence> {
  const authority = { consequence: "authority" as const, reason: "scope-release-request-unproven" };
  if (!["release_workroom_scope", "release_capsule_scope"].includes(call.toolName)
    || Object.keys(call.params).some(key => !["capsuleId", "claims", "commandId"].includes(key))) return authority;
  const capsuleId = typeof call.params.capsuleId === "string" ? call.params.capsuleId.trim() : "";
  const claims = parseScopeReleaseClaims(call.params.claims);
  if (!capsuleId || !claims) return authority;
  const db = deps.db ?? prisma as unknown as Reader;
  const room = await db.workroom.findUnique({ where: { capsuleId },
    select: { capsuleId: true, status: true, archivedAt: true, scopeClaims: true,
      leaseHolderPrincipalId: true, leaseExpiresAt: true } });
  const actor = await (deps.resolveActor ?? workCapsuleActor)(call.userId, call.context);
  return classifyScopeRelease({ room, capsuleId, claims,
    callerPrincipalId: actor.principalId, now: call.now ?? new Date() });
}
