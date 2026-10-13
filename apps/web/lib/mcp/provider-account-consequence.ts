import type { ToolCallConsequenceRefiner } from "@/lib/tool-consequence";
import { isLocalProviderId } from "@/lib/routing/provider-locality";

/** Narrow account operations by their effect; all unproven cases retain authority. */
export const providerAccountConsequence: ToolCallConsequenceRefiner = async ({ params }) => {
  const explicitAccount = typeof params.connectionId === "string" && Boolean(params.connectionId.trim());
  const identityOnly = Object.keys(params).every((key) => ["operation", "connectionId", "providerId"].includes(key));
  if (params.operation === "discover" && explicitAccount && identityOnly) {
    return { consequence: null, reason: "existing-account-catalog-discovery" };
  }
  const authority = { consequence: "authority" as const, reason: "account-authority-or-unclassified-operation" };
  if (params.operation !== "disable" || !explicitAccount || !identityOnly ||
      (params.providerId !== undefined && typeof params.providerId !== "string")) return authority;

  const [{ prisma }, { loadInstanceStance, prismaInstanceStanceStore }] = await Promise.all([
    import("@dpf/db"), import("@/lib/install/instance-stance"),
  ]);
  const stance = await loadInstanceStance(prismaInstanceStanceStore(prisma));
  if (stance.environmentClass !== "development" || stance.primaryPurpose !== "evolve-dpf") return authority;

  const connection = await prisma.aiProviderConnection.findUnique({
    where: { connectionId: params.connectionId as string },
    select: { connectionId: true, providerId: true, authMethod: true, executionChannel: true, credentialEntryId: true, organizationId: true },
  });
  // These are persisted identities, never a caller's assertion of DEV or locality.
  // Disable changes only routing status; credential/grant writers stay consequential.
  if (!connection || !isLocalProviderId(connection.providerId) ||
      connection.connectionId !== `provider-default-${connection.providerId}` ||
      connection.credentialEntryId !== null || connection.organizationId !== null ||
      connection.authMethod !== "local" || connection.executionChannel !== "local-runtime" ||
      (params.providerId !== undefined && params.providerId !== connection.providerId)) return authority;
  return { consequence: null, reason: "delegated-development-local-containment" };
};
