export type DefaultProviderConnectionSource = {
  providerId: string;
  name: string;
  category: string;
  authMethod: string;
  endpointType?: string;
};

/**
 * Conservative cold-start projection for a provider's default connection.
 * It deliberately omits account class, evidence, contracts, and entitlements
 * so database defaults keep every unreviewed connection fail-closed.
 */
export function buildDefaultProviderConnection(
  entry: DefaultProviderConnectionSource,
  status = "unconfigured",
) {
  if (entry.endpointType === "transcription") return undefined;
  const local = entry.providerId === "local" || entry.providerId === "ollama";
  const executionChannel = local
    ? "local-runtime"
    : entry.category === "router"
      ? "hosted-router"
      : entry.authMethod === "oauth2_authorization_code"
        ? "subscription-cli"
        : entry.providerId === "azure-openai" || entry.providerId === "bedrock"
          ? "cloud-tenant"
          : "direct-api";
  const authMethod = entry.authMethod === "api_key"
    ? "api-key"
    : entry.authMethod === "oauth2_authorization_code"
      ? "oauth"
      : entry.authMethod === "oauth2_client_credentials"
        ? "workload-identity"
        : entry.authMethod === "none"
          ? "local"
          : "unknown";

  return {
    connectionId: `provider-default-${entry.providerId}`,
    providerId: entry.providerId,
    label: entry.name,
    status,
    executionChannel,
    commercialBasis: local
      ? "local-compute"
      : entry.authMethod === "oauth2_authorization_code"
        ? "subscription-included"
        : "unknown",
    authMethod,
  };
}

export async function ensureDefaultProviderConnection(
  prisma: PrismaClient,
  entry: DefaultProviderConnectionSource,
  status?: string,
): Promise<void> {
  const connection = buildDefaultProviderConnection(entry, status);
  if (!connection) return;
  await prisma.aiProviderConnection.upsert({
    where: { connectionId: connection.connectionId },
    update: { label: connection.label },
    create: connection,
  });
  await refreshDefaultProviderConnectionOwners(prisma, entry.providerId);
}

export async function refreshDefaultProviderConnectionOwners(
  prisma: PrismaClient,
  providerId: string,
): Promise<void> {
  const connectionId = `provider-default-${providerId}`;
  const [credential, financeProfile, capacityStatus] = await Promise.all([
    prisma.credentialEntry.findUnique({
      where: { providerId },
      select: { id: true, providerConnection: { select: { connectionId: true } } },
    }),
    prisma.aiProviderFinanceProfile.findUnique({ where: { providerId }, select: { id: true } }),
    prisma.providerCapacityStatus.findUnique({
      where: { providerId },
      select: { id: true, providerConnection: { select: { connectionId: true } } },
    }),
  ]);
  await prisma.aiProviderConnection.updateMany({
    where: { connectionId },
    data: {
      financeProfileId: financeProfile?.id ?? null,
      ...(!credential?.providerConnection || credential.providerConnection.connectionId === connectionId
        ? { credentialEntryId: credential?.id ?? null }
        : {}),
      ...(!capacityStatus?.providerConnection || capacityStatus.providerConnection.connectionId === connectionId
        ? { capacityStatusId: capacityStatus?.id ?? null }
        : {}),
    },
  });
}
import type { PrismaClient } from "../generated/client/client";
