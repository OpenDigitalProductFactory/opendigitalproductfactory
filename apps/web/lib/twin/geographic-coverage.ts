// Service coverage over geographic zones (BI-6CC10E4C): which zones contain a
// point, which sites sit outside every zone, and which sit in more than one.
// Planar even-odd ray-cast in longitude/latitude, which is accurate at service-
// area scale; zones never cross the antimeridian (validateGeographicSceneLayout).

import type {
  GeographicCoordinate,
  GeographicPolygonGeometry,
  GeographicSceneZone,
} from "@dpf/storefront-templates";

import { pointInRing, type PlanarPoint } from "./ring-ray-cast";

function planar(coordinate: GeographicCoordinate): PlanarPoint {
  return { x: coordinate.longitude, y: coordinate.latitude };
}

/** RFC 7946 polygon: inside the exterior ring and outside every hole. */
export function pointInGeographicPolygon(
  point: GeographicCoordinate,
  polygon: GeographicPolygonGeometry,
): boolean {
  const [exterior, ...holes] = polygon.rings;
  if (!exterior) return false;
  const target = planar(point);
  if (!pointInRing(target, exterior.map(planar))) return false;
  return !holes.some((hole) => pointInRing(target, hole.map(planar)));
}

export interface CoverageSite {
  readonly siteId: string;
  readonly latitude: number;
  readonly longitude: number;
}

export interface SiteCoverage {
  /** Zone ids containing each site, in zone order; empty when outside every zone. */
  readonly bySite: ReadonlyMap<string, readonly string[]>;
  readonly outside: readonly string[];
  readonly overlaps: readonly { siteId: string; zoneIds: readonly string[] }[];
}

export function coverageForSites(
  sites: readonly CoverageSite[],
  zones: readonly GeographicSceneZone[],
): SiteCoverage {
  const bySite = new Map<string, string[]>();
  const outside: string[] = [];
  const overlaps: { siteId: string; zoneIds: string[] }[] = [];
  for (const site of sites) {
    const zoneIds = zones
      .filter((zone) => pointInGeographicPolygon(site, zone.geometry))
      .map((zone) => zone.id);
    bySite.set(site.siteId, zoneIds);
    if (zoneIds.length === 0) outside.push(site.siteId);
    else if (zoneIds.length > 1) overlaps.push({ siteId: site.siteId, zoneIds });
  }
  return { bySite, outside, overlaps };
}
