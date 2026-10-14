import { prisma } from "@dpf/db";
import { decryptSecret } from "@/lib/credential-crypto";
import { accountExecutionVersion, ProviderAccountSelectionChangedError } from "../routing/provider-account-candidates";

/** Catalog aliases apply only to the legacy default, never to explicit accounts. */
export function resolveCredentialProviderId(providerId: string): string {
  return providerId === "zai-coding" ? "zai" : providerId;
}

/** Server-only credential boundary. An explicit connection never falls back. */
export async function findProviderCredential(providerId: string, connectionId?: string, expectedExecutionVersion?: string) {
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
