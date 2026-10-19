// Is a scope claim an ordinary act on the caller's own room, or does it take
// authority from someone else? (BI-2D65BD1B)
//
// One predicate serves both the authority gate, which decides whether the call
// needs a person, and the store, which refuses the write. Keeping them on the
// same rule means the gate's "ordinary" verdict cannot be outrun by the write:
// a claim that would take another principal's live lease is either forced (and
// gated) or refused.
//
// Pure module: no DB.

import { isTerminalCapsuleStatus } from "./work-capsule-branch-identity";

export type ScopeClaimRoom = {
  status: string | null;
  archivedAt: Date | null;
  leaseHolderPrincipalId: string | null;
  leaseExpiresAt: Date | null;
};

export type ScopeClaimConsequenceReason =
  | "forced-co-claim"
  | "room-not-claimable"
  | "live-lease-held-by-another"
  | "ordinary-claim";

/** A live lease exists and a different principal holds it. */
export function liveLeaseHeldByAnother(
  room: Pick<ScopeClaimRoom, "leaseHolderPrincipalId" | "leaseExpiresAt">,
  callerPrincipalId: string | null,
  now: Date,
): boolean {
  if (!room.leaseHolderPrincipalId) return false;
  if (!room.leaseExpiresAt || room.leaseExpiresAt.getTime() <= now.getTime()) return false;
  return room.leaseHolderPrincipalId !== callerPrincipalId;
}

/**
 * `authority` keeps the tool's declared consequence (a person decides);
 * `null` makes this call ordinary. Unknown or unclaimable rooms stay gated:
 * the store refuses them anyway, and a refusal never needs to be cheaper.
 */
export function classifyScopeClaim(input: {
  force: boolean;
  room: ScopeClaimRoom | null;
  callerPrincipalId: string | null;
  now: Date;
}): { consequence: "authority" | null; reason: ScopeClaimConsequenceReason } {
  if (input.force) return { consequence: "authority", reason: "forced-co-claim" };
  const room = input.room;
  if (!room || room.archivedAt != null || isTerminalCapsuleStatus(room.status)) {
    return { consequence: "authority", reason: "room-not-claimable" };
  }
  if (liveLeaseHeldByAnother(room, input.callerPrincipalId, input.now)) {
    return { consequence: "authority", reason: "live-lease-held-by-another" };
  }
  return { consequence: null, reason: "ordinary-claim" };
}

/** Thrown when a non-forced claim would take another principal's live lease. */
export class ScopeClaimLeaseHeldError extends Error {
  readonly holderPrincipalId: string;
  readonly leaseExpiresAt: Date;
  constructor(holderPrincipalId: string, leaseExpiresAt: Date) {
    super(
      "Another session holds this room's live lease. Wait for it to lapse, ask its holder to hand the room over, "
        + "or claim with force=true, which needs approval.",
    );
    this.name = "ScopeClaimLeaseHeldError";
    this.holderPrincipalId = holderPrincipalId;
    this.leaseExpiresAt = leaseExpiresAt;
  }
}

/** Store-side refusal, on the same rule the gate used. */
export function assertScopeClaimLease(
  room: ScopeClaimRoom,
  callerPrincipalId: string | null,
  force: boolean,
  now: Date,
): void {
  if (force || !liveLeaseHeldByAnother(room, callerPrincipalId, now)) return;
  throw new ScopeClaimLeaseHeldError(room.leaseHolderPrincipalId as string, room.leaseExpiresAt as Date);
}
