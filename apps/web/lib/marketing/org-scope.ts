// Marketing organization scope resolution.
//
// Every marketing read/drill-in must resolve WHICH organization it is answering
// for before it touches a campaign, publication, or checkpoint row. Campaign
// drill-ins previously resolved a campaign with a bare findUnique on campaignId,
// so a campaign belonging to another organization was readable by id.
//
// The ordering here (oldest organization first) deliberately mirrors
// getMarketingWorkspaceSnapshot in ../marketing so the workspace snapshot, the
// operating snapshot, and the campaign drill-ins all agree on the same
// organization. Resolve through this helper rather than re-inlining the query —
// a second ordering rule would silently split the read model in two.

import { prisma } from "@dpf/db";

/**
 * The organization whose marketing workspace this install answers for, or null
 * when the install has not been set up yet.
 */
export async function resolveMarketingOrganizationId(): Promise<string | null> {
  const organization = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return organization?.id ?? null;
}
