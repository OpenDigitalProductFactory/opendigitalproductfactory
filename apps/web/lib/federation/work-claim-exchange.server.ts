// Server wiring for claims at the item's home (BI-30EDDB7F). The exchange
// logic is in work-claim-exchange.ts; this binds it to Prisma, this
// installation's federation identity and the ordinary Workroom claim.

import { prisma } from "@dpf/db";
import type { DemandResponseV1, WorkClaimAction } from "@dpf/db/federated-demand-contract";

import { getErrorMessage } from "@/lib/shared/get-error-message";
import { BacklogItemAlreadyClaimedError } from "@/lib/work-capsules/backlog-workroom-ownership";
import { claimBacklogItemWorkspace } from "@/lib/work-capsules/work-capsule-store";
import type { CapsuleDb } from "@/lib/work-capsules/work-capsule-store-types";

import { resolveFederationIdentity, type FederationIdentityDb } from "./demand-identity";
import {
  handleIncomingWorkClaimRequest,
  reconcileFederatedWorkClaims,
  requestWorkClaim,
  type ClaimForPeer,
  type WorkClaimDecision,
  type WorkClaimHomeDb,
  type WorkClaimRequesterDb,
} from "./work-claim-exchange";

/** The home records a peer's claim through the same path a local claim takes:
 *  the item row is locked and the ordinary live-Workroom check decides. */
export const claimForPeer: ClaimForPeer = async (input) => {
  try {
    const result = await prisma.$transaction((tx) => claimBacklogItemWorkspace({
      db: tx as unknown as CapsuleDb,
      input: {
        backlogItemId: input.itemId,
        repositoryFullName: input.repositoryFullName,
        headBranch: input.headBranch,
        worktreePath: input.worktreePath,
        executorKind: "federated-peer",
        executorRef: input.executorRef,
        title: `Claimed for the paired installation: ${input.itemId}`,
      },
      actor: { userId: `system:federation:${input.linkId}`, agentId: null, principalId: null },
    }));
    return { claimed: true, capsuleId: result.capsuleId };
  } catch (error) {
    if (error instanceof BacklogItemAlreadyClaimedError) {
      return {
        claimed: false,
        holders: error.liveWorkrooms.map((room) => ({
          capsuleId: room.capsuleId,
          executorKind: room.executorKind,
          executorRef: room.executorRef,
          leaseExpiresAt: room.leaseExpiresAt ? new Date(room.leaseExpiresAt) : null,
        })),
      };
    }
    // Any other refusal from the ordinary claim path (repository, branch,
    // readiness) is still a decision. Answering it keeps the requester from
    // retrying a request that can never succeed and leaving its Workroom
    // unconfirmed indefinitely.
    return { claimed: false, refusedReason: getErrorMessage(error) };
  }
};

export async function handleWorkClaimFromPeer(linkId: string, response: DemandResponseV1): Promise<WorkClaimDecision> {
  const identity = await resolveFederationIdentity(prisma as unknown as FederationIdentityDb);
  return handleIncomingWorkClaimRequest(prisma as unknown as WorkClaimHomeDb, linkId, response, {
    selfInstallationId: identity.installationId,
    claimForPeer,
  });
}

export async function requestWorkClaimAtHome(capsuleId: string, action: WorkClaimAction) {
  const identity = await resolveFederationIdentity(prisma as unknown as FederationIdentityDb);
  return requestWorkClaim(prisma as unknown as WorkClaimRequesterDb, { capsuleId, action, identity });
}

export async function runFederatedWorkClaimReconciliation() {
  const identity = await resolveFederationIdentity(prisma as unknown as FederationIdentityDb);
  return reconcileFederatedWorkClaims(prisma as unknown as WorkClaimRequesterDb, { identity });
}
