/**
 * Geo-discovery ("Nearby") wire types — the customer-facing community
 * lookup for "what DPF-powered businesses are local to me right now?"
 *
 * Today the directory endpoint is install-local (single-org: it returns
 * THIS install if its own lat/long falls in the queried radius). The
 * hosted federation directory across many installs is Town M5 — separate
 * spec, deferred. Shape is forward-compatible: federated entries map onto
 * the same NearbyInstance row.
 */

export interface NearbyInstance {
  /** The install's stable instanceId (matches InstanceDescriptor.instanceId). */
  instanceId: string;
  orgName: string;
  /** Public URL of the install — what the mobile app uses to connect. */
  url: string;
  /** Archetype slug (e.g. "trades-maintenance/hvac-contractor"). */
  archetype?: string;
  /** Distance in km from the query point, rounded to one decimal. */
  distanceKm: number;
  /** Display address line for the row (city + region). */
  locality?: string;
}

export interface NearbyQuery {
  /** Latitude in WGS84 decimal degrees. */
  latitude: number;
  /** Longitude in WGS84 decimal degrees. */
  longitude: number;
  /** Search radius in km; clamp 0.1–500, server default 25. */
  radiusKm?: number;
}

export interface NearbyResponse {
  results: NearbyInstance[];
}
