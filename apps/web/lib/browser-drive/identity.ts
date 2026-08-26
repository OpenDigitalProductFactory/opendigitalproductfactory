// Service-account identity for browser-driving (EP-BROWSER-DRIVE, spec §8.8).
//
// An autonomous browser session acts as a service Principal (kind="service"),
// never as a fake human — the human delegate is recorded separately on the
// session's delegatingUserId.
//
// EP-24741BBF · BI-3181909E: the service-account primitive itself now lives in
// the shared identity module (`@/lib/identity/service-account`). This file is a
// thin, browser-drive-flavoured wrapper over it — it owns the NAMESPACE and the
// issuer, nothing more. Keeping the primitive here made this subsystem the
// second home for a shared concern (AGENTS.md §8); it is now one caller among
// future peers, and a service account is a peer shape of the same Principal
// spine as a human employee and an AI coworker.

import {
  SERVICE_ACCOUNT_ALIAS_TYPE,
  buildServiceAccountPrincipalId,
  resolveServiceAccountPrincipal as resolveSharedServiceAccountPrincipal,
} from "@/lib/identity/service-account";

export { SERVICE_ACCOUNT_ALIAS_TYPE };

/** PrincipalAlias.issuer for aliases minted by this subsystem. */
export const BROWSER_DRIVE_ISSUER = "browser-drive";

/** Service-account id namespace owned by browser-driving. */
export const BROWSER_DRIVE_SERVICE_NAMESPACE = "browser-svc";

/**
 * Deterministic service Principal id for a (site, account) pair.
 *
 * Grammar is `browser-svc:<siteKey>:<accountKey>` and is load-bearing —
 * browser-session integration ids embed the whole string, so changing it
 * orphans existing credentials and bindings.
 */
export function serviceAccountPrincipalId(siteKey: string, accountKey: string): string {
  return buildServiceAccountPrincipalId(BROWSER_DRIVE_SERVICE_NAMESPACE, [siteKey, accountKey]);
}

/**
 * Find-or-create the service Principal that a browser-driving session acts as.
 *
 * `accountableOwnerUserId` is REQUIRED: a service account with no accountable
 * human is refused at the shared module boundary, because non-human identity
 * without a named owner is how authority escapes audit.
 */
export async function resolveServiceAccountPrincipal(params: {
  siteKey: string;
  accountKey: string;
  displayName?: string;
  accountableOwnerUserId: string;
}): Promise<{ principalId: string }> {
  return resolveSharedServiceAccountPrincipal({
    namespace: BROWSER_DRIVE_SERVICE_NAMESPACE,
    segments: [params.siteKey, params.accountKey],
    issuer: BROWSER_DRIVE_ISSUER,
    displayName:
      params.displayName ?? `${params.siteKey} service account (${params.accountKey})`,
    accountableOwnerUserId: params.accountableOwnerUserId,
  });
}
