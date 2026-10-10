// Which street-map regions a business needs (BI-C318C227 §2.3). Pure: given
// the business's placed locations and the installed packs' manifest bounds, it
// groups the locations by state or province, pads each group's bounds, and says
// whether an installed pack already covers it. The operator is never asked to
// choose a region.

import { packCoveringBounds, type InstalledPack } from "./map-pack-coverage";

export type RegionPoint = {
  latitude: number;
  longitude: number;
  regionName: string | null;
  countryName: string | null;
  /** ISO 3166-1 alpha-2. */
  countryIso2: string | null;
};

export type RegionBounds = { west: number; south: number; east: number; north: number };

export type RegionGroup = {
  label: string;
  regionName: string | null;
  countryIso2: string | null;
  /** Matches the installed-pack naming, e.g. `us-texas`; null when the country is unknown. */
  suggestedPackId: string | null;
  pointCount: number;
  /** Padded bounds to extract, in manifest order. */
  bounds: RegionBounds;
  /** The installed pack covering every point in the group, or null. */
  coveredBy: string | null;
};

export type RegionRecommendation = {
  status: "no-locations" | "covered" | "partly-covered" | "not-covered";
  groups: RegionGroup[];
};

const MIN_PAD_KM = 25;
const PAD_FRACTION = 0.1;
const KM_PER_DEGREE_LAT = 111.32;

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isValid(p: RegionPoint): boolean {
  return Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;
}

function groupKey(p: RegionPoint): string {
  if (!p.countryIso2) return "?";
  return p.regionName ? `${p.countryIso2.toUpperCase()}|${p.regionName}` : p.countryIso2.toUpperCase();
}

function paddedBounds(points: readonly RegionPoint[]): RegionBounds {
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);
  const midLat = (south + north) / 2;
  const kmPerDegreeLng = KM_PER_DEGREE_LAT * Math.max(Math.cos((midLat * Math.PI) / 180), 0.01);
  const padLat = Math.max(MIN_PAD_KM / KM_PER_DEGREE_LAT, (north - south) * PAD_FRACTION);
  const padLng = Math.max(MIN_PAD_KM / kmPerDegreeLng, (east - west) * PAD_FRACTION);
  return {
    west: Math.max(-180, west - padLng),
    south: Math.max(-90, south - padLat),
    east: Math.min(180, east + padLng),
    north: Math.min(90, north + padLat),
  };
}

function exactBounds(points: readonly RegionPoint[]) {
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  return {
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
    crossesAntimeridian: false,
  };
}

export function recommendMapRegions(input: {
  points: readonly RegionPoint[];
  packs: readonly InstalledPack[];
}): RegionRecommendation {
  const groups = new Map<string, RegionPoint[]>();
  for (const point of input.points) {
    if (!isValid(point)) continue;
    const key = groupKey(point);
    const list = groups.get(key);
    if (list) list.push(point);
    else groups.set(key, [point]);
  }
  if (groups.size === 0) return { status: "no-locations", groups: [] };

  const result: RegionGroup[] = [...groups.values()].map((points) => {
    const first = points[0]!;
    const iso2 = first.countryIso2?.toUpperCase() ?? null;
    const country = first.countryName ?? iso2;
    const label = !iso2
      ? "Locations with no recorded country"
      : first.regionName
        ? `${first.regionName}, ${country}`
        : (country ?? iso2);
    const suggestedPackId = !iso2 ? null : first.regionName ? `${iso2.toLowerCase()}-${slug(first.regionName)}` : iso2.toLowerCase();
    return {
      label,
      regionName: first.regionName,
      countryIso2: iso2,
      suggestedPackId,
      pointCount: points.length,
      bounds: paddedBounds(points),
      // Coverage is judged on the points themselves, not the padding, so an
      // installed pack that holds every location counts as enough.
      coveredBy: packCoveringBounds(input.packs, exactBounds(points))?.packId ?? null,
    };
  });

  result.sort((a, b) => b.pointCount - a.pointCount || a.label.localeCompare(b.label));
  const covered = result.filter((g) => g.coveredBy).length;
  const status = covered === result.length ? "covered" : covered === 0 ? "not-covered" : "partly-covered";
  return { status, groups: result };
}
