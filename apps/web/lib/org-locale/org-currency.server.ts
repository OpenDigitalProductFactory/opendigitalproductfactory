import "server-only";

import { prisma } from "@dpf/db";

import { resolveOrgBaseCurrency, type OrgLocaleClient } from "./org-locale";

/**
 * The deployment org's base currency, read from `OrgSettings`. The server-side
 * answer for every "no currency was given" write, so no install has GBP (or any
 * other currency) invented for it (BI-6030131C). `org-locale.ts` stays DB-free;
 * this is the one place that binds it to the live client.
 */
export function getOrgBaseCurrency(): Promise<string> {
  return resolveOrgBaseCurrency(prisma as unknown as OrgLocaleClient);
}
