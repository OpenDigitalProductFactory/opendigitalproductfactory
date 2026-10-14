import { prisma } from "@dpf/db";
import { decryptSecret, encryptSecret } from "@/lib/credential-crypto";
import { accountExecutionVersion, ProviderAccountSelectionChangedError } from "../routing/provider-account-candidates";

/** Catalog aliases apply only to the legacy default, never to explicit accounts. */
export function resolveCredentialProviderId(providerId: string): string {
  return providerId === "zai-coding" ? "zai" : providerId;
}

/** An optional coding key overrides the documented shared legacy Z.ai key. */
export async function findDefaultProviderCredential(providerId: string) {
  if (providerId === "zai-coding") {
    const override = await prisma.credentialEntry.findUnique({ where: { providerId } });
    if (override?.secretRef) return override;
  }
  return prisma.credentialEntry.findUnique({ where: { providerId: resolveCredentialProviderId(providerId) } });
}

/** Server-only credential boundary. An explicit connection never falls back. */
export async function findProviderCredential(providerId: string, connectionId?: string, expectedExecutionVersion?: string) {
  if (connectionId === undefined) {
    return findDefaultProviderCredential(providerId);
  }
  if (!connectionId.trim()) throw new Error("Provider connection identity is required");
  const connection = await prisma.aiProviderConnection.findUnique({
    where: { connectionId }, include: { credentialEntry: true },
  });
  if (!connection) throw new Error("Provider connection not found");
  if (connection.providerId !== providerId) throw new Error("Connection belongs to a different provider");
  if (expectedExecutionVersion && accountExecutionVersion(connection) !== expectedExecutionVersion) {
    throw new ProviderAccountSelectionChangedError(providerId, "Selected provider credential changed before dispatch");
  }
  return connection.credentialEntry;
}

/** Decrypt the API key / client secret for a provider (server-only).
 *  Returns null when the credential row is missing OR when decryption fails
 *  (e.g. the encryption key was rotated after these credentials were stored). */
export async function getDecryptedCredential(providerId: string, connectionId?: string, expectedExecutionVersion?: string) {
  const cred = await findProviderCredential(providerId, connectionId, expectedExecutionVersion);
  if (!cred) {
    // CodeQL js/log-injection: providerId is user-influenced. JSON.stringify
    // is a CodeQL-recognised sanitiser — escapes CR/LF, quotes the value.
    console.warn(`[credentials] getDecryptedCredential(${JSON.stringify(providerId)}) → null: row not found`);
    return null;
  }
  return decryptProviderCredential(cred, providerId);
}

/** Decrypt one captured row; token writers retain its encrypted CAS snapshot. */
export function decryptProviderCredential(cred: NonNullable<Awaited<ReturnType<typeof findProviderCredential>>>, providerId: string) {
  const secretRef    = cred.secretRef    ? decryptSecret(cred.secretRef)    : null;
  const clientSecret = cred.clientSecret ? decryptSecret(cred.clientSecret) : null;
  const cachedToken  = cred.cachedToken  ? decryptSecret(cred.cachedToken)  : null;
  const refreshToken = cred.refreshToken ? decryptSecret(cred.refreshToken) : null;
  // If every encrypted field failed to decrypt, the key was rotated — treat as no credential.
  const hadEncrypted = [cred.secretRef, cred.clientSecret, cred.cachedToken, cred.refreshToken]
    .some(v => v?.startsWith("enc:"));
  const allFailed = hadEncrypted && !secretRef && !clientSecret && !cachedToken && !refreshToken;
  if (allFailed) {
    // CodeQL js/log-injection: providerId is user-influenced. JSON.stringify
    // is a CodeQL-recognised sanitiser — escapes CR/LF, quotes the value.
    const safeProviderId = JSON.stringify(providerId);
    console.warn(`[credentials] All encrypted fields for ${safeProviderId} failed to decrypt — re-configure this provider.`);
    console.warn(`[credentials] Diagnostic for ${safeProviderId}: ` +
      `secretRef=${cred.secretRef ? `enc(${cred.secretRef.slice(0,8)})→${secretRef ? "ok" : "null"}` : "none"}, ` +
      `clientSecret=${cred.clientSecret ? `enc(${cred.clientSecret.slice(0,8)})→${clientSecret ? "ok" : "null"}` : "none"}, ` +
      `cachedToken=${cred.cachedToken ? `enc(${cred.cachedToken.slice(0,8)})→${cachedToken ? "ok" : "null"}` : "none"}, ` +
      `refreshToken=${cred.refreshToken ? `enc(${cred.refreshToken.slice(0,8)})→${refreshToken ? "ok" : "null"}` : "none"}`);
    // Flag for the admin UI so it stops showing green.  Fire-and-forget — we
    // already know the decrypt failed, so we return null either way.  See
    // PROVIDER-ACTIVATION-AUDIT.md F-16.
    if (cred.status !== "key_rotated") {
      prisma.credentialEntry
        .updateMany({ where: { id: cred.id, updatedAt: cred.updatedAt, secretRef: cred.secretRef, clientSecret: cred.clientSecret, cachedToken: cred.cachedToken, refreshToken: cred.refreshToken }, data: { status: "key_rotated" } })
        // CodeQL #47 (js/tainted-format-string) + js/log-injection:
        // providerId is user-influenced. JSON.stringify is the recognised
        // sanitiser; the format string is constant so %s can't be hijacked.
        .catch((err) => console.warn("[credentials] Failed to mark %s as key_rotated: %s",
          JSON.stringify(providerId),
          err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err))));
    }
    return null;
  }
  return { ...cred, secretRef, clientSecret, cachedToken, refreshToken };
}

/** OAuth token exchange — obtain or refresh bearer token for a provider.
 *  Dispatches by authMethod: oauth2_authorization_code uses refreshOAuthToken,
 *  oauth2_client_credentials uses the client_credentials grant.
 */
export async function getProviderBearerToken(providerId: string, connectionId?: string, expectedExecutionVersion?: string): Promise<{ token: string } | { error: string }> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { error: "Provider not found" };

  const connection = connectionId ? await prisma.aiProviderConnection.findUnique({ where: { connectionId }, include: { credentialEntry: true } }) : null;
  if (connectionId && (!connection || connection.providerId !== providerId)) return { error: "Provider connection not found" };
  if (connection?.status === "disabled") return { error: "Provider account is disabled" };
  if (connection && expectedExecutionVersion && accountExecutionVersion(connection) !== expectedExecutionVersion) {
    throw new ProviderAccountSelectionChangedError(providerId, "Selected provider account changed before token exchange");
  }
  if (["oauth", "oauth2_authorization_code"].includes(connection?.authMethod ?? provider.authMethod)) {
    const { refreshOAuthToken } = await import("@/lib/provider-oauth");
    const credential = await getDecryptedCredential(providerId, connectionId, expectedExecutionVersion);
    if (!credential) return { error: "No credential configured" };

    if (credential.status === "ok" && credential.cachedToken && credential.tokenExpiresAt) {
      const buffer = 5 * 60 * 1000;
      if (credential.tokenExpiresAt.getTime() > Date.now() + buffer) {
        return { token: credential.cachedToken };
      }
    }
    // chatgpt shares Codex OAuth — refresh via codex provider (has tokenUrl/clientId)
    const refreshProviderId = !connectionId && providerId === "chatgpt" ? "codex" : providerId;
    const refreshed = await refreshOAuthToken(refreshProviderId, connectionId);
    if ("token" in refreshed && expectedExecutionVersion) await findProviderCredential(providerId, connectionId, expectedExecutionVersion);
    return refreshed;
  }

  // Existing client_credentials flow
  const storedCredential = connectionId ? connection?.credentialEntry ?? null : null;
  const credential = connectionId ? storedCredential && decryptProviderCredential(storedCredential, providerId) : await getDecryptedCredential(providerId);
  if (!credential) return { error: "No credential configured" };
  if (!credential.clientId || !credential.clientSecret || !credential.tokenEndpoint) {
    return { error: "OAuth credentials incomplete — need client ID, secret, and token endpoint" };
  }

  // Return cached token if still valid (5-minute buffer)
  if (credential.status === "ok" && credential.cachedToken && credential.tokenExpiresAt) {
    const buffer = 5 * 60 * 1000;
    if (credential.tokenExpiresAt.getTime() > Date.now() + buffer) {
      return { token: credential.cachedToken };
    }
  }

  // Exchange for new token
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credential.clientId,
    client_secret: credential.clientSecret,
    ...(credential.scope ? { scope: credential.scope } : {}),
  });

  try {
    const res = await fetch(credential.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { error: `Token exchange failed: HTTP ${res.status}` };

    const body = await res.json() as { access_token: string; expires_in: number };
    const expiresAt = new Date(Date.now() + body.expires_in * 1000);

    const data = { cachedToken: encryptSecret(body.access_token), tokenExpiresAt: expiresAt, status: "ok" };
    if (connectionId) {
      const written = await prisma.credentialEntry.updateMany({ where: {
        id: credential.id, updatedAt: credential.updatedAt,
        ...(storedCredential ? { secretRef: storedCredential.secretRef, clientSecret: storedCredential.clientSecret, cachedToken: storedCredential.cachedToken, refreshToken: storedCredential.refreshToken } : {}),
        providerConnection: { is: { connectionId, providerId, credentialEntryId: credential.id,
          updatedAt: connection!.updatedAt, status: connection!.status } },
      }, data });
      if (written.count !== 1) {
        const error = "Selected provider account changed during token exchange";
        if (expectedExecutionVersion) throw new ProviderAccountSelectionChangedError(providerId, error);
        return { error };
      }
    } else await prisma.credentialEntry.update({ where: { id: credential.id }, data });

    return { token: body.access_token };
  } catch (err) {
    if (err instanceof ProviderAccountSelectionChangedError) throw err;
    return { error: err instanceof Error ? err.message : "Token exchange error" };
  }
}
