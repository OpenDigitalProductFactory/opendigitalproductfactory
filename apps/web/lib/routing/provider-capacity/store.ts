import { prisma, type Prisma } from "@dpf/db";

import type { ProviderCapacityClassification, ProviderQuotaObservation, ProviderQuotaReconciliation } from "./types";

export type ProviderCapacitySource = "api" | "cli" | "opencode" | "oauth" | "manual";

export async function recordProviderCapacityStatus(input: {
  providerId: string;
  classification: ProviderCapacityClassification;
  source: ProviderCapacitySource;
  observedAt?: Date;
  rawSnippet?: string;
}): Promise<void> {
  const observedAt = input.observedAt ?? new Date();
  const data = {
    state: input.classification.state,
    action: input.classification.action,
    retryAt: input.classification.retryAt ?? null,
    retryAfterSeconds: input.classification.retryAfterSeconds ?? null,
    providerCode: input.classification.providerCode ?? null,
    safeSummary: input.classification.safeSummary,
    confidence: input.classification.confidence,
    isHumanActionRequired: input.classification.isHumanActionRequired,
    lastObservedAt: observedAt,
    source: input.source,
    rawSnippet: input.rawSnippet?.slice(0, 500) ?? null,
  };

  await prisma.providerCapacityStatus.upsert({
    where: { providerId: input.providerId },
    create: {
      providerId: input.providerId,
      ...data,
    },
    update: data,
  });
}

function availableCapacityData(input: {
  source: ProviderCapacitySource;
  observedAt?: Date;
  safeSummary?: string;
}) {
  const observedAt = input.observedAt ?? new Date();
  const data = {
    state: "available",
    action: "none",
    retryAt: null,
    retryAfterSeconds: null,
    providerCode: null,
    safeSummary: input.safeSummary ?? "Provider is available.",
    confidence: "exact",
    isHumanActionRequired: false,
    lastObservedAt: observedAt,
    lastSuccessAt: observedAt,
    source: input.source,
    rawSnippet: null,
  } satisfies Prisma.ProviderCapacityStatusUpdateManyMutationInput
    & Pick<ProviderCapacityClassification, "state" | "action" | "confidence">
    & { source: ProviderCapacitySource };
  return data;
}

export async function clearProviderCapacityStatus(input: {
  providerId: string;
  source: ProviderCapacitySource;
  observedAt?: Date;
}): Promise<void> {
  const data = availableCapacityData(input);

  await prisma.providerCapacityStatus.upsert({
    where: { providerId: input.providerId },
    create: {
      providerId: input.providerId,
      ...data,
    },
    update: data,
  });
}

/** Called only after completed inference and the selected connection's CAS. */
export async function reconcileProviderQuotaObservation(
  tx: Prisma.TransactionClient,
  observation: ProviderQuotaObservation,
): Promise<ProviderQuotaReconciliation> {
  await tx.$executeRaw`SAVEPOINT dpf_provider_quota_reconciliation`;
  try {
    const updated = await tx.providerCapacityStatus.updateMany({
      where: {
        id: observation.id, providerId: observation.providerId, state: observation.state,
        updatedAt: observation.updatedAt,
        providerConnection: observation.ownerConnectionId === null
          ? { is: null }
          : { is: { connectionId: observation.ownerConnectionId } },
      },
      data: availableCapacityData({ source: "oauth", safeSummary: "Provider quota recheck completed." }),
    });
    await tx.$executeRaw`RELEASE SAVEPOINT dpf_provider_quota_reconciliation`;
    return updated.count === 1 ? "cleared" : "changed";
  } catch {
    // Catching a SQL error alone leaves its transaction aborted. Isolate the
    // quota write so earlier authentication survives only a successful commit.
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT dpf_provider_quota_reconciliation`;
    await tx.$executeRaw`RELEASE SAVEPOINT dpf_provider_quota_reconciliation`;
    return "write-failed";
  }
}
