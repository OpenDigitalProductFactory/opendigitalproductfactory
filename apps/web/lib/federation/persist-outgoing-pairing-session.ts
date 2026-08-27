// EP-MSP-FEDERATION — persist a freshly requested outgoing pairing session.
//
// Mapping a pairing request onto its row is persistence, not a decision, and it
// does not belong in a server action. Extracting it keeps
// `federation-links.ts` under the module-size soft ceiling the substrate ratchet
// enforces — that file sat one line under the limit, so every addition to it was
// destined to trip the guard until something moved out.

import { prisma } from "@dpf/db";

import { encryptSecret } from "@/lib/govern/credential-crypto";

/** The peer's answer to our pairing request, reduced to what the row needs. */
export interface RequestedPairing {
  pairingId: string;
  matchingCode: string;
  pairingSecret: string;
  peerDisplayName: string;
  peerInstallationId?: string | null;
  peerDeviceId?: string | null;
  peerSigningPublicKey?: string | null;
}

export async function persistOutgoingPairingSession(input: {
  requested: RequestedPairing;
  relationshipPreset: string;
  offeredRole: string;
  localDeviceId: string;
  localSigningPublicKey: string;
  peerAuthorityUrl: string;
  candidateDiscoveryId: string;
  requestedAt: Date;
  expiresAt: Date;
}): Promise<void> {
  await prisma.federationPairingSession.create({
    data: {
      pairingId: input.requested.pairingId,
      direction: "outgoing",
      status: "pending",
      relationshipPreset: input.relationshipPreset,
      projectionTemplateKey: input.relationshipPreset,
      offeredRole: input.offeredRole,
      matchingCode: input.requested.matchingCode,
      sasState: {
        protocolVersion: 1,
        localDeviceId: input.localDeviceId,
        localSigningPublicKey: input.localSigningPublicKey,
        remoteDeviceId: input.requested.peerDeviceId,
        remoteSigningPublicKey: input.requested.peerSigningPublicKey,
      },
      pairingSecretEnc: encryptSecret(input.requested.pairingSecret),
      peerAuthorityUrl: input.peerAuthorityUrl,
      peerDisplayName: input.requested.peerDisplayName,
      peerInstallationId: input.requested.peerInstallationId,
      candidateDiscoveryId: input.candidateDiscoveryId,
      requestedAt: input.requestedAt,
      expiresAt: input.expiresAt,
    },
  });
}
