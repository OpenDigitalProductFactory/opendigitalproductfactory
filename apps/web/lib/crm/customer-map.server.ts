import "server-only";

// Loads customer sites for the customer map (BI-560128FB). Live, non-merged
// sites of live accounts, with whatever coordinates their address has.

import { prisma } from "@dpf/db";
import { EXCLUDE_TOMBSTONED } from "@dpf/db/customer-lifecycle";

import { buildCustomerMap, type CustomerMap, type CustomerMapSite } from "./customer-map";

export async function loadCustomerMapSites(): Promise<CustomerMapSite[]> {
  const sites = await prisma.customerSite.findMany({
    where: { mergedIntoId: null, status: { not: "superseded" }, account: { ...EXCLUDE_TOMBSTONED, mergedIntoId: null } },
    select: {
      id: true,
      name: true,
      account: { select: { id: true, name: true } },
      primaryAddress: {
        select: {
          addressLine1: true,
          postalCode: true,
          latitude: true,
          longitude: true,
          city: { select: { name: true } },
        },
      },
    },
    orderBy: [{ account: { name: "asc" } }, { name: "asc" }],
  });
  return sites.map((site) => {
    const address = site.primaryAddress;
    return {
      siteId: site.id,
      siteName: site.name,
      accountId: site.account.id,
      accountName: site.account.name,
      hasAddress: Boolean(address),
      addressLabel: address ? `${address.addressLine1}, ${address.city.name} ${address.postalCode}`.trim() : null,
      latitude: address?.latitude == null ? null : Number(address.latitude),
      longitude: address?.longitude == null ? null : Number(address.longitude),
    };
  });
}

export async function loadCustomerMap(): Promise<CustomerMap> {
  return buildCustomerMap(await loadCustomerMapSites());
}
