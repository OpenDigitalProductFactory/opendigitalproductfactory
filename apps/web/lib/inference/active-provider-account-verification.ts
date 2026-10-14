import { prisma } from "@dpf/db";
import { decryptSecret } from "@/lib/credential-crypto";

type Account = { connectionId: string; providerId: string; organizationId: string | null; authMethod: string; status: string; credentialEntryId: string | null };
export type ActiveAccountSnapshot = { connectionId: string; providerId: string; credentialEntryId: string; updatedAt: Date };
export const ACCOUNT_CHANGED = "Account changed during verification — retry with its current credentials";

export function isDefaultSubscriptionIdentity(providerId: string, connectionId?: string) {
  return (providerId === "chatgpt" || providerId === "codex") && connectionId === `provider-default-${providerId}`;
}

/** One eligibility predicate for classification and execution; never grants authority. */
export function isActiveDefaultSubscription(account: Account | null): account is Account & { credentialEntryId: string } {
  return !!account && isDefaultSubscriptionIdentity(account.providerId, account.connectionId)
    && account.organizationId === null && account.status === "active"
    && ["oauth", "oauth2_authorization_code"].includes(account.authMethod) && !!account.credentialEntryId;
}

export async function assertActiveAccountSnapshot(snapshot: ActiveAccountSnapshot) {
  const current = await prisma.aiProviderConnection.findUnique({ where: { connectionId: snapshot.connectionId } });
  if (!isActiveDefaultSubscription(current) || current.providerId !== snapshot.providerId
      || current.credentialEntryId !== snapshot.credentialEntryId || current.updatedAt.getTime() !== snapshot.updatedAt.getTime()) {
    throw new Error(ACCOUNT_CHANGED);
  }
}

/** Prisma relation filter pins a credential write to its still-active owner. */
export function activeAccountCredentialWhere(snapshot: ActiveAccountSnapshot) {
  return { id: snapshot.credentialEntryId, providerConnection: { is: {
    connectionId: snapshot.connectionId, providerId: snapshot.providerId, credentialEntryId: snapshot.credentialEntryId,
    updatedAt: snapshot.updatedAt, status: "active", organizationId: null,
    authMethod: { in: ["oauth", "oauth2_authorization_code"] },
  } } };
}

export async function getActiveAccountBearerToken(snapshot: ActiveAccountSnapshot): Promise<{ token: string } | { error: string }> {
  try {
    await assertActiveAccountSnapshot(snapshot);
    const credential = await prisma.credentialEntry.findUnique({ where: { id: snapshot.credentialEntryId } });
    if (!credential?.cachedToken) return { error: "OAuth token not found — sign in again" };
    if (credential.tokenExpiresAt && credential.tokenExpiresAt.getTime() > Date.now() + 5 * 60_000) {
      const token = decryptSecret(credential.cachedToken);
      return token ? { token } : { error: "OAuth token cannot be read — sign in again" };
    }
    const { refreshOAuthToken } = await import("@/lib/provider-oauth");
    return refreshOAuthToken(snapshot.providerId, snapshot.connectionId, snapshot);
  } catch (error) {
    return { error: error instanceof Error ? error.message : ACCOUNT_CHANGED };
  }
}
