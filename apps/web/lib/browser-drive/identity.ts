// Service-account identity for browser-driving (EP-BROWSER-DRIVE, spec §8.8).
//
// An autonomous browser session acts as a service Principal (kind="service"),
// never as a fake human — the human delegate is recorded separately on the
// session's delegatingUserId. Identity resolves through Principal/PrincipalAlias
// per the Principal-convergence rule (AGENTS.md §11); no parallel identity table.

import { prisma } from "@dpf/db";

/** PrincipalAlias.aliasType for browser-driving service accounts. */
export const SERVICE_ACCOUNT_ALIAS_TYPE = "service-account";
/** PrincipalAlias.issuer for aliases minted by this subsystem. */
export const BROWSER_DRIVE_ISSUER = "browser-drive";

/** Deterministic service Principal id for a (site, account) pair. */
export function serviceAccountPrincipalId(siteKey: string, accountKey: string): string {
  return `browser-svc:${siteKey}:${accountKey}`;
}

/**
 * Find-or-create the service Principal that a browser-driving session acts as.
 * Idempotent: re-resolving an existing account returns it without mutating the
 * alias set.
 */
export async function resolveServiceAccountPrincipal(params: {
  siteKey: string;
  accountKey: string;
  displayName?: string;
}): Promise<{ principalId: string }> {
  const principalId = serviceAccountPrincipalId(params.siteKey, params.accountKey);
  const principal = await prisma.principal.upsert({
    where: { principalId },
    create: {
      principalId,
      kind: "service",
      status: "active",
      displayName: params.displayName ?? `${params.siteKey} service account (${params.accountKey})`,
      aliases: {
        create: {
          aliasType: SERVICE_ACCOUNT_ALIAS_TYPE,
          aliasValue: principalId,
          issuer: BROWSER_DRIVE_ISSUER,
        },
      },
    },
    update: {},
    select: { principalId: true },
  });
  return { principalId: principal.principalId };
}
