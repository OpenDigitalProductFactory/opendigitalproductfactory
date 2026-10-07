/**
 * WorkItem → customer sites (BI-C318C227 §2.2). A WorkItem has no site link;
 * its account is resolved from its source (work-item-account-resolution.ts),
 * and the account's live sites are the places the job can be. One site is used
 * directly by the phone; several are offered as a choice.
 */
import { prisma } from "@dpf/db";
import type { WorkItemSite } from "@dpf/types";

import { locationProvenance } from "@/lib/geocoding/provenance";

import { resolveWorkItemAccount, type ResolveWorkItemAccountInput } from "./work-item-account-resolution";

type SiteRow = {
  id: string;
  name: string;
  primaryAddress: { addressLine1: string; latitude: unknown; validationSource: string | null } | null;
};

export function toWorkItemSite(row: SiteRow): WorkItemSite {
  const address = row.primaryAddress;
  const hasLocation = address !== null && address.latitude !== null;
  return {
    id: row.id,
    name: row.name,
    addressLine: address?.addressLine1 ?? null,
    hasAddress: address !== null,
    hasLocation,
    locationConfirmed: hasLocation && locationProvenance(address?.validationSource) === "person-confirmed",
  };
}

export async function resolveWorkItemSites(input: ResolveWorkItemAccountInput): Promise<WorkItemSite[]> {
  const account = await resolveWorkItemAccount(input);
  if (!account) return [];
  const rows = await prisma.customerSite.findMany({
    where: { accountId: account.id, mergedIntoId: null, status: "active" },
    select: {
      id: true,
      name: true,
      primaryAddress: { select: { addressLine1: true, latitude: true, validationSource: true } },
    },
    orderBy: { name: "asc" },
  });
  return rows.map(toWorkItemSite);
}
