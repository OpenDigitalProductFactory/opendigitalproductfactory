import { prisma } from "@dpf/db";
import { decryptSecret } from "@/lib/credential-crypto";
import { isActiveDefaultSubscription } from "@/lib/routing/provider-account-candidates";
export { isActiveDefaultSubscription, isDefaultSubscriptionIdentity } from "@/lib/routing/provider-account-candidates";

export type ActiveAccountSnapshot = { connectionId: string; providerId: string; credentialEntryId: string; updatedAt: Date;
  credentialRevision: { updatedAt: Date; cachedToken: string | null; refreshToken: string | null } };
export const ACCOUNT_CHANGED = "Account changed during verification — retry with its current credentials";

export function matchesCredentialRevision(snapshot: Pick<ActiveAccountSnapshot, "credentialEntryId" | "credentialRevision">, credential: { id: string; updatedAt: Date; cachedToken: string | null; refreshToken: string | null } | null) {
  return !!credential && credential.id === snapshot.credentialEntryId
    && credential.updatedAt.getTime() === snapshot.credentialRevision.updatedAt.getTime()
    && credential.cachedToken === snapshot.credentialRevision.cachedToken && credential.refreshToken === snapshot.credentialRevision.refreshToken;
}

export async function assertActiveAccountSnapshot(snapshot: ActiveAccountSnapshot) {
  const current = await prisma.aiProviderConnection.findUnique({ where: { connectionId: snapshot.connectionId }, include: { credentialEntry: true } });
  if (!isActiveDefaultSubscription(current) || current.providerId !== snapshot.providerId
      || current.credentialEntryId !== snapshot.credentialEntryId || current.updatedAt.getTime() !== snapshot.updatedAt.getTime()
      || !matchesCredentialRevision(snapshot, current.credentialEntry)) {
    throw new Error(ACCOUNT_CHANGED);
  }
}

/** Prisma relation filter pins a credential write to its still-active owner. */
export function activeAccountCredentialWhere(snapshot: ActiveAccountSnapshot) {
  return { id: snapshot.credentialEntryId, ...snapshot.credentialRevision, providerConnection: { is: {
    connectionId: snapshot.connectionId, providerId: snapshot.providerId, credentialEntryId: snapshot.credentialEntryId,
    updatedAt: snapshot.updatedAt, status: "active", organizationId: null,
    authMethod: { in: ["oauth", "oauth2_authorization_code"] },
  } } };
}

export async function getActiveAccountBearerToken(snapshot: ActiveAccountSnapshot): Promise<{ token: string } | { error: string }> {
  try {
    await assertActiveAccountSnapshot(snapshot);
    const credential = await prisma.credentialEntry.findUnique({ where: activeAccountCredentialWhere(snapshot) });
    if (!credential) return { error: ACCOUNT_CHANGED };
    if (!credential.cachedToken) return { error: "OAuth token not found — sign in again" };
    const { refreshOAuthToken, oauthTokenExpiryMs } = await import("@/lib/provider-oauth");
    if (credential.status !== "expired" && credential.tokenExpiresAt && credential.tokenExpiresAt.getTime() > Date.now() + 5 * 60_000) {
      const token = decryptSecret(credential.cachedToken);
      if (!token) return { error: "OAuth token cannot be read — sign in again" };
      const tokenExpiry = oauthTokenExpiryMs(token);
      if (tokenExpiry === null || tokenExpiry > Date.now() + 5 * 60_000) return { token };
    }
    return refreshOAuthToken(snapshot.providerId, snapshot.connectionId, snapshot);
  } catch (error) {
    return { error: error instanceof Error ? error.message : ACCOUNT_CHANGED };
  }
}
