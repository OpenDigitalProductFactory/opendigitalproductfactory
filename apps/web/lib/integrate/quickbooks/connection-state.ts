import { prisma } from "@dpf/db";
import { decryptJson } from "@/lib/govern/credential-crypto";
import type { QuickBooksReadinessConnection } from "./readiness";

export const QUICKBOOKS_INTEGRATION_ID = "quickbooks-online-accounting";

type IntegrationCredentialRow = Awaited<
  ReturnType<typeof prisma.integrationCredential.findUnique>
>;

/**
 * Map a stored integration-credential row into the QuickBooks connection state.
 * A missing record is "unconfigured" — never a fabricated "connected" fixture.
 */
export function toQuickBooksReadinessConnection(
  record: IntegrationCredentialRow,
): QuickBooksReadinessConnection {
  if (!record) {
    return {
      status: "unconfigured",
      companyName: null,
      realmId: null,
      lastErrorMsg: null,
      lastTestedAt: null,
      environment: null,
    };
  }

  const decoded = decryptJson<{
    companyName?: string;
    realmId?: string;
    environment?: string;
  }>(record.fieldsEnc);

  return {
    status:
      record.status === "connected" || record.status === "error" ? record.status : "unconfigured",
    companyName: typeof decoded?.companyName === "string" ? decoded.companyName : null,
    realmId: typeof decoded?.realmId === "string" ? decoded.realmId : null,
    lastErrorMsg: record.lastErrorMsg,
    lastTestedAt: record.lastTestedAt ? record.lastTestedAt.toISOString() : null,
    environment:
      decoded?.environment === "sandbox" || decoded?.environment === "production"
        ? decoded.environment
        : null,
  };
}

/**
 * Load the real QuickBooks connection state for this install from the
 * integration-credential substrate. Shared by the integration page and the
 * finance accountant work-lane so both reflect the same live connection.
 */
export async function loadQuickBooksReadinessConnection(): Promise<QuickBooksReadinessConnection> {
  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: QUICKBOOKS_INTEGRATION_ID },
  });
  return toQuickBooksReadinessConnection(record);
}
