// BI-30EDDB7F — how an item's home names a claim it holds for a peer.
//
// The home records a peer's claim as an ordinary Workroom whose executor is the
// requesting installation (spec 2026-10-27 §5.2 step 2). The executorRef says
// which installation and which of its Workrooms, so the home's work page can
// publish the holder and the requester can recognise its own claim.

import type { FederatedWorkClaimHolderV1 } from "@dpf/db/federated-work-contract";

const PREFIX = "federation:";

export interface FederatedPeerExecutor {
  installationId: string;
  workroomId: string;
}

export const federatedPeerExecutorRef = {
  format(value: FederatedPeerExecutor): string {
    return `${PREFIX}${value.installationId}:${value.workroomId}`;
  },
  parse(value: string | null | undefined): FederatedPeerExecutor | null {
    if (!value?.startsWith(PREFIX)) return null;
    const rest = value.slice(PREFIX.length);
    const split = rest.indexOf(":");
    if (split <= 0 || split === rest.length - 1) return null;
    return { installationId: rest.slice(0, split), workroomId: rest.slice(split + 1) };
  },
};

/** The worktree path a peer's claim records: the work happens on the peer. */
export function federatedPeerWorktreePath(value: FederatedPeerExecutor): string {
  return `federation://${value.installationId}/${value.workroomId}`;
}

/** A peer's claim stops counting once its lease has lapsed past the standard
 *  one-day resume grace every leased Workroom has (WORK_CAPSULE_PAUSE_GRACE_MS). */
const PEER_CLAIM_RESUME_GRACE_MS = 24 * 60 * 60 * 1000;

/** True when a Workroom held for a peer has lapsed: the peer stopped renewing
 *  it, so it no longer holds the item and must not be published as holder. */
export function isLapsedPeerClaim(
  room: { executorKind: string | null; leaseExpiresAt: Date | null },
  now: Date,
): boolean {
  return room.executorKind === "federated-peer"
    && room.leaseExpiresAt !== null
    && room.leaseExpiresAt.getTime() + PEER_CLAIM_RESUME_GRACE_MS <= now.getTime();
}

/** The holder a live Workroom names: the installation that asked for it when it
 *  is a claim held for a peer, otherwise this installation. One definition for
 *  the home's work page and its claim decisions, so they never disagree. */
export function claimHolderOf(
  room: { capsuleId: string; executorKind: string | null; executorRef: string | null; leaseExpiresAt: Date | null },
  selfInstallationId: string,
): FederatedWorkClaimHolderV1 {
  const peer = room.executorKind === "federated-peer" ? federatedPeerExecutorRef.parse(room.executorRef) : null;
  return {
    installationId: peer?.installationId ?? selfInstallationId,
    workroomId: peer?.workroomId ?? room.capsuleId,
    leaseExpiresAt: room.leaseExpiresAt?.toISOString() ?? null,
  };
}
