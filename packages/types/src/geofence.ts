/**
 * One geofence primitive for web and phone (BI-C318C227 design §2.4).
 *
 * A geofence is a centre and a radius. The walk-up front door's "address
 * geofence" is `addressGeofence(organization point, radius)`; site
 * confirmation at check-in and map coverage use the same distance.
 * Pure math only: no I/O, so it runs identically on the server and the device.
 */

const EARTH_RADIUS_M = 6_371_000;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface Geofence {
  centre: GeoPoint;
  radiusMeters: number;
}

/** A position fix must be this accurate (metres) to confirm a site's location. */
export const SITE_CONFIRM_MAX_ACCURACY_M = 50;

/** Beyond this distance (metres) from the address's looked-up point, ask "are you at the site?". */
export const SITE_CONFIRM_FAR_M = 1_000;

function isValidPoint(p: GeoPoint | null | undefined): p is GeoPoint {
  return (
    !!p &&
    Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) &&
    Math.abs(p.latitude) <= 90 &&
    Math.abs(p.longitude) <= 180
  );
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance in metres. Returns `Infinity` when either point is
 * missing or invalid, so a `<= radius` test excludes malformed rows.
 */
export function haversineMeters(
  a: GeoPoint | null | undefined,
  b: GeoPoint | null | undefined,
): number {
  if (!isValidPoint(a) || !isValidPoint(b)) return Infinity;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A geofence centred on an address's point. */
export function addressGeofence(centre: GeoPoint, radiusMeters: number): Geofence {
  if (!isValidPoint(centre)) throw new RangeError("Geofence centre must be a valid point");
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    throw new RangeError("Geofence radius must be a positive, finite number of metres");
  }
  return { centre, radiusMeters };
}

export function withinGeofence(point: GeoPoint | null | undefined, fence: Geofence): boolean {
  return haversineMeters(point, fence.centre) <= fence.radiusMeters;
}
