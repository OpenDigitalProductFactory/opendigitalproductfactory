import "server-only";

// Load the business's placed locations and the installed map packs, then
// recommend street-map regions (BI-C318C227 §2.3). Reads only; nothing is
// fetched or installed here.

import { prisma } from "@dpf/db";

import { extractOrgLatLng } from "@/lib/api/nearby-geo";
import { parseOrgAddress } from "@/lib/shared/org-address";

import { listInstalledMapPacks } from "./map-assets.server";
import { recommendMapRegions, type RegionPoint, type RegionRecommendation } from "./map-region-recommendation";

export async function loadMapRegionRecommendation(): Promise<RegionRecommendation> {
  const [addresses, org, packs] = await Promise.all([
    prisma.address.findMany({
      where: {
        latitude: { not: null },
        status: "active",
        OR: [{ customerSites: { some: { mergedIntoId: null } } }, { workLocations: { some: {} } }],
      },
      select: {
        latitude: true,
        longitude: true,
        city: { select: { region: { select: { name: true, country: { select: { name: true, iso2: true } } } } } },
      },
    }),
    prisma.organization.findFirst({ select: { address: true }, orderBy: { createdAt: "asc" } }),
    listInstalledMapPacks(),
  ]);

  const points: RegionPoint[] = addresses.map((a) => ({
    latitude: Number(a.latitude),
    longitude: Number(a.longitude),
    regionName: a.city.region.name,
    countryName: a.city.region.country.name,
    countryIso2: a.city.region.country.iso2,
  }));

  const orgPoint = org ? extractOrgLatLng(org.address) : null;
  if (org && orgPoint) {
    const address = parseOrgAddress(org.address);
    points.push({
      ...orgPoint,
      regionName: address.region ?? null,
      countryName: address.country ?? null,
      countryIso2: address.countryCode ?? null,
    });
  }

  return recommendMapRegions({ points, packs: packs.map(({ packId, bounds }) => ({ packId, bounds })) });
}
