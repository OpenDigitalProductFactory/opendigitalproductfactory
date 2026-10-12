import { prisma } from "@dpf/db";

/** Catalog aliases apply only to the legacy default, never to explicit accounts. */
export function resolveCredentialProviderId(providerId: string): string {
  return providerId === "zai-coding" ? "zai" : providerId;
}

/** Server-only credential boundary. An explicit connection never falls back. */
export async function findProviderCredential(providerId: string, connectionId?: string) {
  if (connectionId === undefined) {
    return prisma.credentialEntry.findUnique({
      where: { providerId: resolveCredentialProviderId(providerId) },
    });
  }
  if (!connectionId.trim()) throw new Error("Provider connection identity is required");
  const connection = await prisma.aiProviderConnection.findUnique({
    where: { connectionId }, include: { credentialEntry: true },
  });
  if (!connection) throw new Error("Provider connection not found");
  if (connection.providerId !== providerId) throw new Error("Connection belongs to a different provider");
  return connection.credentialEntry;
}
