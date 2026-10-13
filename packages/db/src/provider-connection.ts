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
  const persisted = await loadDefaultProviderConnectionSource(prisma, entry.providerId);
  const connection = buildDefaultProviderConnection(persisted ?? entry, status);
  if (!connection) return;
  await prisma.aiProviderConnection.upsert({
    where: { connectionId: connection.connectionId },
    update: { label: connection.label },
    create: connection,
  });
  await refreshDefaultProviderConnectionOwners(prisma, entry.providerId);
}

/** Configuration is authoritative; token shape and catalog defaults are not auth evidence. */
async function loadDefaultProviderConnectionSource(prisma: PrismaClient, providerId: string) {
  return prisma.modelProvider.findUnique({
    where: { providerId },
    select: { providerId: true, name: true, category: true, authMethod: true, endpointType: true },
  });
}

type DefaultAuthenticationBasis = { authMethod: string; executionChannel: string; credentialEntryId: string | null };

function modelAccessReset(current: DefaultAuthenticationBasis | null, next: Partial<DefaultAuthenticationBasis>, replaced: boolean) {
  const changed = current && (["authMethod", "executionChannel", "credentialEntryId"] as const)
    .some((key) => key in next && current[key] !== next[key]);
  return changed || replaced ? { accessibleModelIds: [] as string[], modelsVerifiedAt: null } : {};
}

/**
 * Activate a provider and the canonical connection routing evaluates for it.
 *
 * Keeping these writes in one transaction prevents the provider registry from
 * advertising an active provider while its default connection still vetoes
 * dispatch. `update` is intentional: a missing canonical connection is an
 * invariant violation and must roll back the provider activation.
 */
export async function activateProviderWithDefaultConnection(
  prisma: PrismaClient,
  input: { providerId: string; sensitivityClearance: string[] },
): Promise<void> {
  await setProviderStatusWithDefaultConnection(prisma, { ...input, status: "active" });
}

/** Operator eligibility is separate from automatic provider health. */
export async function setProviderStatusWithDefaultConnection(
  prisma: PrismaClient,
  input: { providerId: string; status: "active" | "inactive"; sensitivityClearance?: string[] },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.modelProvider.update({
      where: { providerId: input.providerId },
      data: {
        status: input.status,
        ...(input.sensitivityClearance && { sensitivityClearance: input.sensitivityClearance }),
      },
    });
    await tx.aiProviderConnection.update({
      where: { connectionId: `provider-default-${input.providerId}` },
      data: { status: input.status },
    });
  });
}

export async function refreshDefaultProviderConnectionOwners(
  prisma: PrismaClient,
  providerId: string,
  options: { credentialReplaced?: boolean } = {},
): Promise<void> {
  const connectionId = `provider-default-${providerId}`;
  const [credential, financeProfile, capacityStatus, provider, current] = await Promise.all([
    prisma.credentialEntry.findUnique({
      where: { providerId },
      select: { id: true, providerConnection: { select: { connectionId: true } } },
    }),
    prisma.aiProviderFinanceProfile.findUnique({ where: { providerId }, select: { id: true } }),
    prisma.providerCapacityStatus.findUnique({
      where: { providerId },
      select: { id: true, providerConnection: { select: { connectionId: true } } },
    }),
    loadDefaultProviderConnectionSource(prisma, providerId),
    prisma.aiProviderConnection.findUnique({
      where: { connectionId }, select: { authMethod: true, executionChannel: true, credentialEntryId: true },
    }),
  ]);
  const projection = provider ? buildDefaultProviderConnection(provider) : undefined;
  const data = {
      ...(projection ? { authMethod: projection.authMethod, executionChannel: projection.executionChannel } : {}),
      financeProfileId: financeProfile?.id ?? null,
      ...(!credential?.providerConnection || credential.providerConnection.connectionId === connectionId
        ? { credentialEntryId: credential?.id ?? null }
        : {}),
      ...(!capacityStatus?.providerConnection || capacityStatus.providerConnection.connectionId === connectionId
        ? { capacityStatusId: capacityStatus?.id ?? null }
        : {}),
  };
  const written = await prisma.aiProviderConnection.updateMany({
    where: {
      connectionId,
      ...(current ? { authMethod: current.authMethod, executionChannel: current.executionChannel, credentialEntryId: current.credentialEntryId } : {}),
      ...(provider ? { provider: { authMethod: provider.authMethod, category: provider.category, endpointType: provider.endpointType } } : {}),
    },
    data: { ...data, ...modelAccessReset(current, data, options.credentialReplaced === true) },
  });
  if (current && written.count === 0) throw new Error("Default provider configuration changed during reconciliation; retry the operation.");
}
import type { PrismaClient } from "../generated/client/client";
