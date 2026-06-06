// Browser-session credential custody (EP-BROWSER-DRIVE, spec 2026-06-05 §8.8, Q3).
//
// Reuses IntegrationCredential — no parallel browser vault (Verdict 2). The
// `integrationId @unique` constraint forces a deterministic id per (service
// account, site). Secrets (Playwright storageState, or username/password/TOTP
// in `credentialed` mode) live encrypted in `fieldsEnc` via the shared
// credential-crypto path (keyed by CREDENTIAL_ENCRYPTION_KEY). Non-secret
// session metadata (targetDomains) lives on BrowserSessionBinding, not here.

import { prisma } from "@dpf/db";
import { encryptJson, decryptJson } from "@/lib/govern/credential-crypto";

/** IntegrationCredential.provider discriminator for browser-session credentials. */
export const BROWSER_SESSION_PROVIDER = "browser-session";

/** Provisioning mode per (account, site) — Verdict 4. */
export type BrowserProvisioningMode = "storageState" | "credentialed";

/**
 * Encrypted payload stored in IntegrationCredential.fieldsEnc. `mode` co-locates
 * with the secret for slice 1 (spec Q3 permits encoding it in the encrypted JSON);
 * promoting it to a first-class column is a tracked follow-up if the UI needs to
 * filter by it.
 */
export type BrowserCredentialFields =
  | { mode: "storageState"; storageState: unknown }
  | { mode: "credentialed"; username: string; password: string; totpSeed?: string };

/**
 * Deterministic credential id for a (service account, site) pair. Required
 * because IntegrationCredential.integrationId is unique — there is no first-class
 * account↔site relation, so the id carries it.
 */
export function browserSessionIntegrationId(principalId: string, siteKey: string): string {
  return `${BROWSER_SESSION_PROVIDER}:${principalId}:${siteKey}`;
}

/** Upsert (or refresh) the encrypted browser-session credential. Returns the integrationId. */
export async function saveBrowserSessionCredential(params: {
  principalId: string;
  siteKey: string;
  fields: BrowserCredentialFields;
}): Promise<string> {
  const integrationId = browserSessionIntegrationId(params.principalId, params.siteKey);
  const fieldsEnc = encryptJson(params.fields);
  await prisma.integrationCredential.upsert({
    where: { integrationId },
    create: {
      integrationId,
      provider: BROWSER_SESSION_PROVIDER,
      status: "configured",
      fieldsEnc,
    },
    update: {
      provider: BROWSER_SESSION_PROVIDER,
      status: "configured",
      fieldsEnc,
      lastTestedAt: new Date(),
      lastErrorAt: null,
      lastErrorMsg: null,
    },
  });
  return integrationId;
}

/** Decrypt and return the stored browser-session credential fields, or null if absent. */
export async function readBrowserSessionCredential(
  integrationId: string,
): Promise<BrowserCredentialFields | null> {
  const row = await prisma.integrationCredential.findUnique({ where: { integrationId } });
  if (!row?.fieldsEnc) return null;
  return decryptJson<BrowserCredentialFields>(row.fieldsEnc);
}

/** Record a session-freshness failure (expired/redirect-to-auth) without exposing the secret. */
export async function markBrowserSessionCredentialStale(
  integrationId: string,
  reason: string,
): Promise<void> {
  await prisma.integrationCredential.update({
    where: { integrationId },
    data: { status: "needs-reauth", lastErrorAt: new Date(), lastErrorMsg: reason },
  });
}
