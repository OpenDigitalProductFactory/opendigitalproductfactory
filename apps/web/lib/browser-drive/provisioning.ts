// Service-account provisioning orchestration (EP-BROWSER-DRIVE, spec §9.2).
//
// The one-time attended bootstrap captures the operator's login as Playwright
// storageState (the live-browser capture itself is the runtime step). This
// module persists the result: resolve the service Principal, store the encrypted
// credential, record the binding, and stamp freshness. Reuses Phases 1-3 — no
// new substrate.

import { resolveServiceAccountPrincipal } from "./identity";
import {
  saveBrowserSessionCredential,
  type BrowserCredentialFields,
} from "./credentials";
import { createBrowserSessionBinding } from "./session-binding";

export type ProvisionServiceAccountInput = {
  siteKey: string;
  accountKey: string;
  displayName?: string;
  /** Allowlist the provisioned profile may ever drive (§8.10). */
  targetDomains: string[];
  /** Human who performed the attended bootstrap (act-for attribution). */
  delegatingUserId: string;
  /** The persisted Chromium user-data-dir, e.g. /profiles/<principalId>/<siteKey>/. */
  profileRef: string;
  /** Captured secret: Playwright storageState (default) or full credentials (opt-in). */
  credential: BrowserCredentialFields;
  /** Stable id for the bootstrap session record. */
  sessionId: string;
};

export type ProvisionServiceAccountResult = {
  principalId: string;
  credentialId: string;
};

/**
 * Persist a freshly bootstrapped service-account profile. Idempotent on the
 * Principal (resolve = find-or-create) and the credential (upsert by deterministic
 * id); records a service-account BrowserSessionBinding for the provisioned profile.
 */
export async function provisionServiceAccount(
  input: ProvisionServiceAccountInput,
): Promise<ProvisionServiceAccountResult> {
  if (!input.targetDomains.length) {
    throw new Error("provisionServiceAccount: a service-account profile requires a non-empty targetDomains allowlist");
  }

  const { principalId } = await resolveServiceAccountPrincipal({
    siteKey: input.siteKey,
    accountKey: input.accountKey,
    displayName: input.displayName,
    // The human who performed the attended bootstrap is the accountable owner
    // of the resulting non-human identity (BI-3181909E). Without it the shared
    // primitive refuses to mint the account.
    accountableOwnerUserId: input.delegatingUserId,
  });

  const credentialId = await saveBrowserSessionCredential({
    principalId,
    siteKey: input.siteKey,
    fields: input.credential,
  });

  await createBrowserSessionBinding({
    sessionId: input.sessionId,
    means: "plugin",
    engine: "chromium",
    profileRef: input.profileRef,
    profileKind: "service-account",
    attended: false,
    actingPrincipalId: principalId,
    delegatingUserId: input.delegatingUserId,
    credentialId,
    targetDomains: input.targetDomains,
  });

  return { principalId, credentialId };
}
