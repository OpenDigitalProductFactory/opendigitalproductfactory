// Customer sites as a geographic scene (BI-560128FB, design
// docs/superpowers/specs/2026-10-02-customer-map-and-geocoding-design.md).
// Pure: sites with usable coordinates become placements; the rest are named
// with the reason, so the owner can fix them (check the address or pin it).

import type {
  GeographicSceneLayout,
  GeographicScenePlacement,
  GeographicSceneZone,
  GeographicZoneCoverage,
} from "@dpf/storefront-templates";

import { coverageForSites } from "@/lib/twin/geographic-coverage";
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

/** A crew or person a service area can be assigned to (BI-6CC10E4C). */
export type ServiceAreaAssignee = GeographicZoneCoverage & { label: string };

export type ServiceAreaInput = {
  version: number;
  zones: readonly GeographicSceneZone[];
  assignees: readonly ServiceAreaAssignee[];
};

export type ServiceAreaSummary = {
  zoneId: string;
  label: string;
  coveredBy: GeographicZoneCoverage | null;
  coveredByLabel: string | null;
  siteCount: number;
};

export type CustomerMapCoverage = {
  version: number;
  zones: readonly GeographicSceneZone[];
  assignees: readonly ServiceAreaAssignee[];
  areas: ServiceAreaSummary[];
  /** Zone ids containing each placed site. */
  bySite: Record<string, string[]>;
  outside: CustomerMapSite[];
  overlaps: { site: CustomerMapSite; zoneIds: string[] }[];
};

export type CustomerMap = {
  layout: GeographicSceneLayout | null;
  presentations: GeographicScenePresentationMap;
  placedCount: number;
  unplaced: UnplacedCustomerSite[];
  coverage: CustomerMapCoverage;
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

function buildCoverage(
  placed: readonly (CustomerMapSite & { latitude: number; longitude: number })[],
  areas: ServiceAreaInput,
): CustomerMapCoverage {
  const result = coverageForSites(placed, areas.zones);
  const sites = new Map(placed.map((site) => [site.siteId, site]));
  const assigneeLabel = (ref: GeographicZoneCoverage | undefined) =>
    ref ? (areas.assignees.find((item) => item.kind === ref.kind && item.id === ref.id)?.label ?? null) : null;
  const bySite: Record<string, string[]> = {};
  for (const [siteId, zoneIds] of result.bySite) bySite[siteId] = [...zoneIds];
  return {
    version: areas.version,
    zones: areas.zones,
    assignees: areas.assignees,
    areas: areas.zones.map((zone) => ({
      zoneId: zone.id,
      label: zone.label,
      coveredBy: zone.coveredBy ?? null,
      coveredByLabel: assigneeLabel(zone.coveredBy),
      siteCount: Object.values(bySite).filter((zoneIds) => zoneIds.includes(zone.id)).length,
    })),
    bySite,
    outside: areas.zones.length === 0 ? [] : result.outside.flatMap((id) => sites.get(id) ?? []),
    overlaps: result.overlaps.flatMap(({ siteId, zoneIds }) => {
      const site = sites.get(siteId);
      return site ? [{ site, zoneIds: [...zoneIds] }] : [];
    }),
  };
}

const NO_AREAS: ServiceAreaInput = { version: 0, zones: [], assignees: [] };

export function buildCustomerMap(
  sites: readonly CustomerMapSite[],
  serviceAreas: ServiceAreaInput = NO_AREAS,
): CustomerMap {
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

  for (const assignee of serviceAreas.assignees) presentations[assignee.id] = { label: assignee.label, sublabel: "" };
  const coverage = buildCoverage(placed, serviceAreas);
  const zones = serviceAreas.zones;
  if (placements.length === 0 && zones.length === 0) {
    return { layout: null, presentations, placedCount: 0, unplaced, coverage };
  }

  const anchors = placed.length > 0 ? placed : zones.flatMap((zone) => zone.geometry.rings[0] ?? []);
  const latitudes = anchors.map((site) => site.latitude);
  const longitudes = anchors.map((site) => site.longitude);
  const layout: GeographicSceneLayout = {
    schemaVersion: 1,
    spaceKind: "geographic",
    viewport: {
      latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
      longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
      zoom: DEFAULT_ZOOM,
    },
    zones,
    placements,
  };
  return { layout, presentations, placedCount: placements.length, unplaced, coverage };
}
