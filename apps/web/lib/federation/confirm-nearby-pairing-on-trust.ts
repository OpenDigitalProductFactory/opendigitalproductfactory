// EP-MSP-FEDERATION — the production assembly for an organization-trust
// confirmation.
//
// `confirmPairingFromOrganizationTrust` is dependency-injected so its tests
// exercise the real refusal logic rather than a mock of Prisma and the network.
// Someone still has to supply those dependencies, and the pairing action is the
// wrong place: an action module should ask a question, not assemble the
// machinery that answers it. That is the same split
// `resolve-nearby-candidate-pairing` already makes for the verdict.
//
// Keeping it here also keeps the action under the module-size soft ceiling. The
// substrate ratchet caught the alternative — inlining this block pushed
// `federation-links.ts` from 796 to 825 lines and raised the platform hotspot
// count, which is the ratchet doing its job.

import { prisma } from "@dpf/db";

import {
  confirmPairingFromOrganizationTrust,
  type TrustConfirmationResult,
} from "./confirm-pairing-from-organization-trust";
import { prismaTrustConfirmationStore } from "./confirm-pairing-store";
import { confirmNearbyPairingPeer } from "./nearby-pairing";
import type { NearbyCandidatePairingVerdict } from "./resolve-nearby-candidate-pairing";

/**
 * Confirm a freshly created pairing session when organization trust earned it.
 *
 * Returns the confirmation result so the caller can report what happened.
 * Anything short of `auto-enroll` refuses inside the decision module, leaving
 * the code comparison exactly as it was.
 */
export async function confirmNearbyPairingOnTrust(input: {
  pairingId: string;
  verdict: NearbyCandidatePairingVerdict;
  candidateEndpoint: string;
  peerOrganizationRef: string | null;
  pairingSecret: string;
  now: Date;
}): Promise<TrustConfirmationResult> {
  return confirmPairingFromOrganizationTrust({
    pairingId: input.pairingId,
    decision: { mode: input.verdict.mode, explanation: input.verdict.explanation },
    evidence: {
      certificateVerified: input.verdict.evidence.certificateVerified,
      presentedRootFingerprint: input.verdict.evidence.presentedRootFingerprint,
      peerOrganizationRef: input.peerOrganizationRef,
    },
    store: prismaTrustConfirmationStore(prisma),
    confirmWithPeer: async (pairingId) => {
      const peer = await confirmNearbyPairingPeer({
        candidateEndpoint: input.candidateEndpoint,
        pairingId,
        pairingSecret: input.pairingSecret,
      });
      return { ok: peer.ok };
    },
    now: input.now,
  });
}
