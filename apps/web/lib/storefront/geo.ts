/**
 * Geo helpers for the anonymous walk-up discovery endpoint
 * (GET /api/storefront/nearby). Pure functions — no I/O — so they unit-test
 * without a DB. Spec: docs/superpowers/specs/2026-08-05-viral-walkup-consumer-
 * front-door-design.md (BI-9FEB61B8).
 */

/** Coordinates extracted from a business's published address. */
export interface Coordinates {
  lat: number;
  lng: number;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Parse a coordinate out of a value that may be a number or a numeric string
 * (address JSON is untyped — operators may have stored "37.77" or 37.77).
 * Returns null for anything else.
 */
function coerceCoord(v: unknown): number | null {
  if (isFiniteNumber(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Extract { lat, lng } from an Organization.address JSON blob. Tolerates the
 * common key spellings (lat/latitude, lng/lon/longitude) at the top level or
 * nested under a `geo`/`coordinates` object. Returns null when no valid,
 * in-range pair is present — the caller then surfaces the business with a
 * null distance rather than failing.
 */
export function extractCoordinates(address: unknown): Coordinates | null {
  if (typeof address !== "object" || address === null) return null;
  const roots: Record<string, unknown>[] = [address as Record<string, unknown>];
  for (const key of ["geo", "coordinates", "location"]) {
    const nested = (address as Record<string, unknown>)[key];
    if (typeof nested === "object" && nested !== null) {
      roots.push(nested as Record<string, unknown>);
    }
  }
  for (const root of roots) {
    const lat = coerceCoord(root.lat ?? root.latitude);
    const lng = coerceCoord(root.lng ?? root.lon ?? root.longitude);
    if (lat === null || lng === null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    return { lat, lng };
  }
  return null;
}

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle (haversine) distance in metres between two coordinates.
 * Returned value is rounded to the nearest metre.
 */
export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(EARTH_RADIUS_M * c);
}

/** Validate a query coordinate pair from the request. Returns null if invalid. */
export function parseQueryCoordinates(
  latRaw: string | null,
  lngRaw: string | null,
): Coordinates | null {
  if (latRaw === null || lngRaw === null) return null;
  const lat = coerceCoord(latRaw);
  const lng = coerceCoord(lngRaw);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
