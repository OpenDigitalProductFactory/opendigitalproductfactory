import { prisma } from "@dpf/db";
import { isWorkCapsuleStatus, parseScopeClaims } from "@/lib/work-capsules";
import type { ToolExecutionContext } from "@/lib/mcp-tool-types";
import { isTerminalCapsuleStatus } from "./work-capsule-branch-identity";
import type { ScopeClaimRoom } from "./scope-claim-lease";
import { originalScopeReleaseTargetsMatch, parseOriginalScopeReleaseTargets, type ScopeReleaseTarget } from "./scope-release-targets";

export const OWN_SCOPE_RELEASE_REASON = "owned-workroom-scope-release";
export type ScopeReleaseInput = ScopeReleaseTarget;
export type ScopeReleaseRoom = ScopeClaimRoom & { id?: string; capsuleId: string; scopeClaims: unknown };
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Same ingress shape as the handler; invalid input never earns refinement. */
export function parseScopeReleaseClaims(value: unknown): ScopeReleaseInput[] | null {
  return parseOriginalScopeReleaseTargets(value);
}

/** Positive proof only. Giving back foreign or unproven authority stays gated. */
export function classifyScopeRelease(input: {
  room: ScopeReleaseRoom | null; capsuleId: string; claims: ScopeReleaseInput[] | null;
  expectedRoomId?: string;
  callerPrincipalId: string | null; now: Date;
}): { consequence: "authority" | null; reason: string } {
  const authority = (reason: string) => ({ consequence: "authority" as const, reason });
  const { room, callerPrincipalId, now } = input;
  const claims = parseScopeReleaseClaims(input.claims);
  if (!callerPrincipalId || !claims?.length) return authority("scope-release-identity-unproven");
  if (!room || !isWorkCapsuleStatus(room.status) || room.capsuleId !== input.capsuleId || room.archivedAt != null
    || isTerminalCapsuleStatus(room.status)) return authority("scope-release-room-unavailable");
  if (!originalScopeReleaseTargetsMatch(room, input.expectedRoomId, claims)) return authority("scope-release-target-unproven");
  if (room.leaseHolderPrincipalId !== callerPrincipalId || !room.leaseExpiresAt
    || !(room.leaseExpiresAt.getTime() > now.getTime())) return authority("scope-release-lease-unproven");
  if (!Array.isArray(room.scopeClaims)) return authority("scope-release-ownership-unproven");
  const requested = new Set(claims.map(claim => `${claim.kind}:${claim.value}`));
  for (const entry of room.scopeClaims) {
    const row = record(entry);
    if (!row || !requested.has(`${row.kind}:${row.value}`)) continue;
    const claim = parseScopeClaims([row])[0];
    if (!claim || claim.recordedByPrincipalId !== callerPrincipalId) return authority("scope-release-ownership-unproven");
  }
  return { consequence: null, reason: OWN_SCOPE_RELEASE_REASON };
}

type Decision = {
  actionKey: string; actorRef: string; humanContextRef: string | null;
  agentContextRef: string | null; decision: string; rationale: unknown;
};
type DecisionReader = { authorizationDecisionLog: { findUnique(args: unknown): Promise<Decision | null> } };

/** The monitor supplies this id; no caller parameter is an execution permit. */
export async function scopeReleaseWasOrdinary(
  userId: string, context: ToolExecutionContext | undefined,
  db: DecisionReader = prisma as unknown as DecisionReader,
): Promise<boolean> {
  if (!context?.agentId) return false; // Existing human-owner route.
  if (!context.authorityDecisionId) throw new Error("Scope release authorization decision is unavailable.");
  const decision = await db.authorizationDecisionLog.findUnique({
    where: { decisionId: context.authorityDecisionId },
    select: { actionKey: true, actorRef: true, humanContextRef: true,
      agentContextRef: true, decision: true, rationale: true },
  });
  if (!decision || decision.decision !== "allow" || decision.humanContextRef !== userId
    || decision.actorRef !== context.agentId || decision.agentContextRef !== context.agentId
    || !["release_workroom_scope", "release_capsule_scope"].includes(decision.actionKey)) {
    throw new Error("Scope release authorization decision does not match this caller and action.");
  }
  const refinement = record(record(decision.rationale)?.consequenceRefinement);
  return refinement?.declared === "authority" && refinement.reason === OWN_SCOPE_RELEASE_REASON;
}
