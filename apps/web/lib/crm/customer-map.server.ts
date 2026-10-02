import "server-only";

// Loads customer sites for the customer map (BI-560128FB). Live, non-merged
// sites of live accounts, with whatever coordinates their address has.

import { prisma } from "@dpf/db";
import { EXCLUDE_TOMBSTONED } from "@dpf/db/customer-lifecycle";

import { loadServiceAreas, type ServiceAreaDatabase } from "@/lib/twin/service-area-layout";

import {
  buildCustomerMap,
  type CustomerMap,
  type CustomerMapSite,
  type ServiceAreaAssignee,
  type ServiceAreaInput,
} from "./customer-map";

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

/** The organization's service areas and who they can be assigned to (BI-6CC10E4C). */
export async function loadServiceAreaInput(): Promise<ServiceAreaInput> {
  const organization = await prisma.organization.findFirst({ select: { id: true, orgId: true } });
  if (!organization) return { version: 0, zones: [], assignees: [] };
  const [areas, crews, employees] = await Promise.all([
    loadServiceAreas(prisma as unknown as ServiceAreaDatabase, organization.orgId),
    prisma.staffingCrew.findMany({
      where: { organizationId: organization.id },
      select: { crewId: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.employeeProfile.findMany({
      where: { status: { in: ["active", "onboarding"] } },
      select: { employeeId: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
  ]);
  const assignees: ServiceAreaAssignee[] = [
    ...crews.map((crew) => ({ kind: "staffing-crew" as const, id: crew.crewId, label: crew.name ?? crew.crewId })),
    ...employees.map((person) => ({ kind: "employee" as const, id: person.employeeId, label: person.displayName })),
  ];
  return { version: areas.version, zones: areas.zones, assignees };
}

export async function loadCustomerMap(): Promise<CustomerMap> {
  const [sites, serviceAreas] = await Promise.all([loadCustomerMapSites(), loadServiceAreaInput()]);
  return buildCustomerMap(sites, serviceAreas);
}
