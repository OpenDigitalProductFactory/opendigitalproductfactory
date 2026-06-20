/**
 * Geo helpers for the Nearby directory endpoint — kept separate from the
 * route so the math is unit-testable without spinning up Prisma.
 *
 * Distances are computed via the haversine formula (great-circle distance
 * on a sphere). DPF's Nearby radii are ≤ 500 km, well inside the regime
 * where haversine is accurate to < 0.5% even at the equator-vs-poles
 * Earth-shape edge cases.
 */

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/**
 * Distance in km between two WGS84 points. Returns `Infinity` if either
 * point is missing valid coordinates, so callers using `<= radiusKm` filter
 * out malformed rows automatically.
 */
export function haversineKm(a: GeoPoint | null, b: GeoPoint | null): number {
  if (!a || !b) return Infinity;
  if (
    !Number.isFinite(a.latitude) ||
    !Number.isFinite(a.longitude) ||
    !Number.isFinite(b.latitude) ||
    !Number.isFinite(b.longitude)
  ) {
    return Infinity;
  }
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return EARTH_RADIUS_KM * c;
}

/** Round km to one decimal place — the row-display precision. */
export function roundKm(km: number): number {
  if (!Number.isFinite(km)) return km;
  return Math.round(km * 10) / 10;
}

/** Clamp the radius to the server's safe operating range. */
export function clampRadiusKm(input: number | undefined): number {
  const v = Number(input);
  if (!Number.isFinite(v) || v <= 0) return 25;
  return Math.min(Math.max(v, 0.1), 500);
}

/** Parse + validate { latitude, longitude } from a URL searchParams set. */
export function parseQueryPoint(
  params: URLSearchParams,
): GeoPoint | null {
  // `URLSearchParams.get` returns `null` when the key is absent and `""`
  // when present-but-empty. Both are missing for our purposes — and we
  // must reject before Number() coercion, since Number("") is 0 and would
  // happily pass a -180..180 range check.
  const latRaw = params.get("lat");
  const lngRaw = params.get("lng");
  if (latRaw == null || latRaw.length === 0) return null;
  if (lngRaw == null || lngRaw.length === 0) return null;
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}

/**
 * Extract a latitude/longitude pair from the Organization.address JSON
 * blob. The Prisma column is `Json?` (free-form) — we accept both top-level
 * lat/lng and snake-/camel-cased variants so the install operator's seed
 * can use whichever convention without code changes.
 */
export function extractOrgLatLng(addressJson: unknown): GeoPoint | null {
  if (!addressJson || typeof addressJson !== "object") return null;
  const obj = addressJson as Record<string, unknown>;
  const latRaw = (obj.latitude ?? obj.lat) as unknown;
  const lngRaw = (obj.longitude ?? obj.lng ?? obj.long) as unknown;
  const lat = typeof latRaw === "number" ? latRaw : Number(latRaw);
  const lng = typeof lngRaw === "number" ? lngRaw : Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;
  return { latitude: lat, longitude: lng };
}
