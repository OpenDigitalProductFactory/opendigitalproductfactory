import { prisma } from "@dpf/db";
import { isProviderQuotaState, type ProviderQuotaObservation } from "@/lib/routing/provider-capacity/types";

type SelectedAccount = {
  connectionId: string;
  providerId: string;
  credentialEntryId: string | null;
};

/** Capture only quota evidence owned by this explicitly selected account. */
export async function captureProviderQuotaObservation(
  account: SelectedAccount,
): Promise<ProviderQuotaObservation | null> {
  if (!account.credentialEntryId) return null;
  const capacity = await prisma.providerCapacityStatus.findUnique({
    where: { providerId: account.providerId },
    select: {
      id: true, providerId: true, state: true, updatedAt: true,
      providerConnection: { select: { connectionId: true } },
    },
  });
  if (!capacity || capacity.providerId !== account.providerId || !isProviderQuotaState(capacity.state)) return null;
  const ownerConnectionId = capacity.providerConnection?.connectionId ?? null;
  if (ownerConnectionId !== null) {
    if (ownerConnectionId !== account.connectionId) return null;
  } else {
    // Legacy capacity can predate its connection link. The default's name alone
    // is not proof: require the same canonical credential owner as well.
    if (account.connectionId !== `provider-default-${account.providerId}`) return null;
    const credential = await prisma.credentialEntry.findUnique({
      where: { providerId: account.providerId },
      select: { id: true, providerConnection: { select: { connectionId: true } } },
    });
    if (!credential || credential.id !== account.credentialEntryId
      || (credential.providerConnection && credential.providerConnection.connectionId !== account.connectionId)) return null;
  }
  return { id: capacity.id, providerId: capacity.providerId, state: capacity.state, updatedAt: capacity.updatedAt, ownerConnectionId };
}
