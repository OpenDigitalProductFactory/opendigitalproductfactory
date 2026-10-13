import { randomUUID } from "node:crypto";
import { prisma, setProviderStatusWithDefaultConnection, type Prisma } from "@dpf/db";
import { encryptSecret } from "@/lib/credential-crypto";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { isLocalProviderId } from "@/lib/routing/provider-locality";
import { normalizeProviderWorkspaceId } from "./provider-workspace";

export const ACCOUNT_ACCESS_RESET = {
  accessibleModelIds: [] as string[], modelsVerifiedAt: null,
  accountClass: "unknown", evidenceStatus: "unreviewed", lastReviewedAt: null,
  supplierContractId: null, contractEvidence: {}, entitlements: {},
};

/** Credential replacement can select a different upstream account. Preserve evidence history, but require fresh proof. */
export async function invalidateProviderAccountProofs(tx: Pick<Prisma.TransactionClient, "complianceEvidence">, connectionDbId: string) {
  await tx.complianceEvidence.updateMany({
    where: { providerConnectionId: connectionDbId, claimKey: { not: null }, status: "active" },
    data: { status: "superseded" },
  });
}

/** A provider account owns credentials and evidence; catalog defaults are never copied as contract proof. */
export async function addProviderAccount(input: {
  providerId: string;
  label: string;
  authMethod: string;
}): Promise<ActionResult<{ connectionId: string }>> {
  const label = input.label.trim();
  if (!label || label.length > 120) return err("Enter an account name of 1–120 characters");
  const provider = await prisma.modelProvider.findUnique({ where: { providerId: input.providerId } });
  if (!provider) return err("Provider not found");
  if (!["api_key", "oauth2_authorization_code", "oauth2_client_credentials"].includes(input.authMethod)
    || !Array.isArray(provider.supportedAuthMethods) || !provider.supportedAuthMethods.includes(input.authMethod)) {
    return err("Choose an authentication method supported by this provider");
  }
  const defaultConnection = await prisma.aiProviderConnection.findUnique({ where: { connectionId: `provider-default-${input.providerId}` } });
  const connectionId = `provider-account-${randomUUID()}`;
  await prisma.$transaction(async (tx) => {
    const credential = await tx.credentialEntry.create({ data: { providerId: null, status: "pending" } });
    await tx.aiProviderConnection.create({ data: {
      connectionId, providerId: input.providerId, label,
      organizationId: defaultConnection?.organizationId ?? null,
      credentialEntryId: credential.id,
      executionChannel: input.authMethod === "oauth2_authorization_code" ? "subscription-cli" : defaultConnection?.executionChannel === "subscription-cli" ? "direct-api" : defaultConnection?.executionChannel ?? "direct-api",
      authMethod: input.authMethod === "api_key" ? "api-key" : input.authMethod === "oauth2_authorization_code" ? "oauth" : "workload-identity",
      status: "unconfigured", accountClass: "unknown", evidenceStatus: "unreviewed",
    } });
  });
  return ok({ connectionId });
}

export async function configureProviderAccount(input: {
  providerWorkspaceId?: string;
  connectionId: string;
  label?: string;
  secretRef?: string;
  clientId?: string;
  clientSecret?: string;
  tokenEndpoint?: string;
  scope?: string;
}): Promise<ActionResult> {
  const connection = await prisma.aiProviderConnection.findUnique({ where: { connectionId: input.connectionId } });
  if (!connection?.credentialEntryId) return err("Account credential not found");
  let providerWorkspaceId: string | null | undefined;
  try { providerWorkspaceId = normalizeProviderWorkspaceId(connection.providerId, input.providerWorkspaceId); }
  catch (error) { return err(error instanceof Error ? error.message : "Invalid workspace ID"); }
  if (providerWorkspaceId && connection.authMethod !== "api-key") return err("Workspace selection requires an Anthropic API key");
  if (input.label !== undefined && (!input.label.trim() || input.label.trim().length > 120)) return err("Enter an account name of 1–120 characters");
  if (input.tokenEndpoint !== undefined) {
    try { if (new URL(input.tokenEndpoint).protocol !== "https:") return err("Token endpoint must use HTTPS"); }
    catch { return err("Enter a valid token endpoint"); }
  }
  const hasCredentials = [input.secretRef, input.clientId, input.clientSecret, input.tokenEndpoint, input.scope, providerWorkspaceId].some((value) => value !== undefined);
  await prisma.$transaction(async (tx) => {
    if (hasCredentials) await invalidateProviderAccountProofs(tx, connection.id);
    if (hasCredentials) await tx.credentialEntry.update({ where: { id: connection.credentialEntryId! }, data: {
      ...(input.secretRef === undefined ? {} : { secretRef: encryptSecret(input.secretRef) }),
      ...(input.clientSecret === undefined ? {} : { clientSecret: encryptSecret(input.clientSecret) }),
      ...(input.clientId === undefined ? {} : { clientId: input.clientId }),
      ...(input.tokenEndpoint === undefined ? {} : { tokenEndpoint: input.tokenEndpoint }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      ...(providerWorkspaceId === undefined ? {} : { providerWorkspaceId }),
      cachedToken: null, refreshToken: null, tokenExpiresAt: null, status: "pending",
    } });
    await tx.aiProviderConnection.update({ where: { connectionId: input.connectionId }, data: {
      ...(input.label === undefined ? {} : { label: input.label.trim() }),
      ...(hasCredentials ? ACCOUNT_ACCESS_RESET : {}),
    } });
    if (hasCredentials) await tx.aiProviderConnection.updateMany({ where: { connectionId: input.connectionId, status: { not: "disabled" } }, data: { status: "unconfigured" } });
  });
  return ok();
}

/** Disabling preserves evidence and credentials. Enabling still requires successful account authentication. */
export async function setProviderAccountEnabled(connectionId: string, enabled: boolean): Promise<ActionResult> {
  const connection = await prisma.aiProviderConnection.findUnique({ where: { connectionId }, include: { credentialEntry: { select: { status: true } } } });
  if (!connection) return err("Provider account not found");
  if (isLocalProviderId(connection.providerId) && connectionId === `provider-default-${connection.providerId}`) {
    if (enabled && connection.status === "paused") {
      const { resumeLocalProvider } = await import("./provider-operator-pause");
      const resumed = await resumeLocalProvider({ providerId: connection.providerId });
      return resumed.outcome === "resumed" ? ok() : err("The pause changed. Refresh before resuming.");
    }
    // Local runtimes have no account credential. Keep the operator control in
    // the same transaction as the provider status so boot cannot heal it away.
    await setProviderStatusWithDefaultConnection(prisma, {
      providerId: connection.providerId, status: enabled ? "active" : "inactive",
    });
    return ok();
  }
  await prisma.aiProviderConnection.update({ where: { connectionId }, data: { status: enabled ? connection.credentialEntry?.status === "ok" ? "active" : "unconfigured" : "disabled" } });
  return ok();
}
