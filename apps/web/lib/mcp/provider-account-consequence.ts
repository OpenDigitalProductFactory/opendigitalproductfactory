import type { ToolCallConsequenceRefiner } from "@/lib/tool-consequence";
import { isLocalProviderId } from "@/lib/routing/provider-locality";
import { isActiveDefaultSubscription, isDefaultSubscriptionIdentity } from "@/lib/inference/active-provider-account-verification";

/** Narrow account operations by their effect; all unproven cases retain authority. */
export const providerAccountConsequence: ToolCallConsequenceRefiner = async ({ params }) => {
  const explicitAccount = typeof params.connectionId === "string" && Boolean(params.connectionId.trim());
  const identityOnly = Object.keys(params).every((key) => ["operation", "connectionId", "providerId"].includes(key));
  if (params.operation === "discover" && explicitAccount && identityOnly) {
    return { consequence: null, reason: "existing-account-catalog-discovery" };
  }
  const authority = { consequence: "authority" as const, reason: "account-authority-or-unclassified-operation" };
  if (params.operation === "stop-quota-recovery" && explicitAccount && identityOnly
      && (params.providerId === undefined || typeof params.providerId === "string")) {
    const [{ prisma }, { quotaRecoveryJobId, quotaRecoveryCommission }] = await Promise.all([
      import("@dpf/db"), import("@/lib/inference/subscription-quota-recovery"),
    ]);
    const account = await prisma.aiProviderConnection.findUnique({ where: { connectionId: params.connectionId as string },
      select: { providerId: true, connectionId: true, organizationId: true } });
    if (!account || account.organizationId !== null || !isDefaultSubscriptionIdentity(account.providerId, account.connectionId)
      || params.providerId !== undefined && params.providerId !== account.providerId) return authority;
    const job = await prisma.scheduledJob.findUnique({ where: { jobId: quotaRecoveryJobId(account.connectionId) }, select: { metadata: true } });
    return quotaRecoveryCommission(job?.metadata)
      ? { consequence: null, reason: "stop-existing-subscription-recovery-commission" } : authority;
  }
  const restore = params.operation === "restore-pause" && typeof params.expectedOperationId === "string" && Boolean(params.expectedOperationId.trim())
    && Object.keys(params).every(key => ["operation", "connectionId", "providerId", "expectedOperationId"].includes(key));
  if (!["disable", "test", ...(restore ? ["restore-pause"] : [])].includes(String(params.operation)) || !explicitAccount || (!identityOnly && !restore) ||
      (params.providerId !== undefined && typeof params.providerId !== "string")) return authority;

  const [{ prisma }, { loadInstanceStance, prismaInstanceStanceStore }] = await Promise.all([
    import("@dpf/db"), import("@/lib/install/instance-stance"),
  ]);
  const stance = await loadInstanceStance(prismaInstanceStanceStore(prisma));
  if (stance.environmentClass !== "development" || stance.primaryPurpose !== "evolve-dpf") return authority;

  const connection = await prisma.aiProviderConnection.findUnique({
    where: { connectionId: params.connectionId as string },
    select: { connectionId: true, providerId: true, authMethod: true, executionChannel: true, credentialEntryId: true, organizationId: true, status: true },
  });
  if (params.operation === "test") {
    return isActiveDefaultSubscription(connection) && (params.providerId === undefined || params.providerId === connection.providerId)
      ? { consequence: null, reason: "delegated-development-active-subscription-verification" } : authority;
  }
  // These are persisted identities, never a caller's assertion of DEV or locality.
  // Disable changes only routing status; credential/grant writers stay consequential.
  if (!connection || !isLocalProviderId(connection.providerId) ||
      connection.connectionId !== `provider-default-${connection.providerId}` ||
      connection.credentialEntryId !== null || connection.organizationId !== null ||
      connection.authMethod !== "local" || connection.executionChannel !== "local-runtime" ||
      (params.providerId !== undefined && params.providerId !== connection.providerId)) return authority;
  if (restore) {
    const { readProviderPauseRestoration, providerPauseJobId } = await import("@/lib/inference/provider-operator-pause");
    const job = await prisma.scheduledJob.findUnique({ where: { jobId: providerPauseJobId(connection.providerId) }, select: { jobId: true, metadata: true, lastStatus: true, enabled: true } });
    if (!readProviderPauseRestoration({ providerId: connection.providerId, expectedOperationId: params.expectedOperationId as string, account: connection, job })) return authority;
  }
  return { consequence: null, reason: restore ? "delegated-development-existing-pause-restoration" : "delegated-development-local-containment" };
};
