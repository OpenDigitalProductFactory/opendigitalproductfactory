import { prisma, type Prisma } from "@dpf/db";

type SelectedAccount = {
  connectionId: string;
  providerId: string;
  credentialEntryId: string | null;
};

export type ProviderQuotaObservation = {
  id: string;
  providerId: string;
  state: string;
  updatedAt: Date;
  ownerConnectionId: string | null;
};

const QUOTA_STATES = new Set(["quota_resets_at", "rate_limited", "cooling_down"]);

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
  if (!capacity || capacity.providerId !== account.providerId || !QUOTA_STATES.has(capacity.state)) return null;
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

/** Called only after completed inference and the selected connection's CAS. */
export async function reconcileProviderQuotaObservation(
  tx: Prisma.TransactionClient,
  observation: ProviderQuotaObservation,
): Promise<boolean> {
  const now = new Date();
  const updated = await tx.providerCapacityStatus.updateMany({
    where: {
      id: observation.id,
      providerId: observation.providerId,
      state: observation.state,
      updatedAt: observation.updatedAt,
      providerConnection: observation.ownerConnectionId === null
        ? { is: null }
        : { is: { connectionId: observation.ownerConnectionId } },
    },
    data: {
      state: "available", action: "none", retryAt: null, retryAfterSeconds: null,
      providerCode: null, rawSnippet: null, isHumanActionRequired: false,
      safeSummary: "Provider quota recheck completed.", confidence: "exact",
      source: "oauth", lastObservedAt: now, lastSuccessAt: now,
    },
  });
  return updated.count === 1;
}
