// Customer sites as a geographic scene (BI-560128FB, design
// docs/superpowers/specs/2026-10-02-customer-map-and-geocoding-design.md).
// Pure: sites with usable coordinates become placements; the rest are named
// with the reason, so the owner can fix them (check the address or pin it).

import type { GeographicSceneLayout, GeographicScenePlacement } from "@dpf/storefront-templates";

import type { GeographicScenePresentationMap } from "@/lib/twin/geographic-scene";

export type CustomerMapSite = {
  siteId: string;
  siteName: string;
  accountId: string;
  accountName: string;
  addressLabel: string | null;
  hasAddress: boolean;
  latitude: number | null;
  longitude: number | null;
};

export type UnplacedCustomerSite = CustomerMapSite & { reason: "no-address" | "no-coordinates" };

export type CustomerMap = {
  layout: GeographicSceneLayout | null;
  presentations: GeographicScenePresentationMap;
  placedCount: number;
  unplaced: UnplacedCustomerSite[];
};

const DEFAULT_ZOOM = 10;

function usable(site: CustomerMapSite): site is CustomerMapSite & { latitude: number; longitude: number } {
  return (
    typeof site.latitude === "number" &&
    typeof site.longitude === "number" &&
    Number.isFinite(site.latitude) &&
    Number.isFinite(site.longitude) &&
    Math.abs(site.latitude) <= 90 &&
    Math.abs(site.longitude) <= 180
  );
}

export function buildCustomerMap(sites: readonly CustomerMapSite[]): CustomerMap {
  const placed = sites.filter(usable);
  const unplaced: UnplacedCustomerSite[] = sites
    .filter((site) => !usable(site))
    .map((site) => ({ ...site, reason: site.hasAddress ? "no-coordinates" : "no-address" }));

  const presentations: Record<string, { label: string; sublabel: string }> = {};
  const placements: GeographicScenePlacement[] = placed.map((site) => {
    presentations[site.siteId] = { label: site.accountName, sublabel: site.siteName };
    return {
      id: `site:${site.siteId}`,
      entityRef: { kind: "customer-site", id: site.siteId },
      label: site.accountName,
      geometry: { kind: "point", latitude: site.latitude, longitude: site.longitude },
    };
  });

  if (placements.length === 0) return { layout: null, presentations, placedCount: 0, unplaced };

  const latitudes = placed.map((site) => site.latitude);
  const longitudes = placed.map((site) => site.longitude);
  const layout: GeographicSceneLayout = {
    schemaVersion: 1,
    spaceKind: "geographic",
    viewport: {
      latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
      longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
      zoom: DEFAULT_ZOOM,
    },
    zones: [],
    placements,
  };
  return { layout, presentations, placedCount: placements.length, unplaced };
}
