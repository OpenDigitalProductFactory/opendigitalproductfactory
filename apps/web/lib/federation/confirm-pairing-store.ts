// EP-MSP-FEDERATION — the production store behind an organization-trust
// confirmation.
//
// `confirmPairingFromOrganizationTrust` takes its store as a dependency so its
// tests exercise the real refusal logic rather than a mock of Prisma. This is
// the other half: the one place that knows how a pairing session is read and
// written, kept out of the decision module so the rule and the persistence can
// change independently.

import type { PrismaClient } from "@dpf/db";

import type {
  PairingSessionRow,
  TrustConfirmationStore,
} from "./confirm-pairing-from-organization-trust";

export function prismaTrustConfirmationStore(
  prisma: Pick<PrismaClient, "federationPairingSession">,
): TrustConfirmationStore {
  return {
    async findSession(pairingId: string): Promise<PairingSessionRow | null> {
      const row = await prisma.federationPairingSession.findUnique({
        where: { pairingId },
        select: {
          id: true,
          pairingId: true,
          direction: true,
          status: true,
          expiresAt: true,
          sasState: true,
        },
      });
      return row ?? null;
    },
    async recordLocalConfirmation(input) {
      await prisma.federationPairingSession.update({
        where: { id: input.id },
        data: {
          sasConfirmedAtLocal: input.confirmedAt,
          // `approvedByPrincipalId` is deliberately not written. No person
          // confirmed this, and naming one would make the record untrue.
          sasState: input.sasState as never,
        },
      });
    },
  };
}
