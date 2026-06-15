// Coworker Simulation & Eval Harness — geo-temporal model (H0/H1).
//
// Deterministic geography + travel-time math for routing simulation. The
// dispatcher's routing inputs (ETA, on-my-way, running-late) are driven by
// mobile-device sensors in production; here the harness computes the same
// quantities from a seeded geo-temporal model so routing can be tested against
// realistic geo + temporal situations without a real device or wall-clock.
//
// Pure: distances and travel times are functions of coordinates, speed, and a
// traffic factor; positions are functions of the injected `Instant`. See
// 2026-06-14-coworker-simulation-eval-harness-design.html (R12 GeoTemporalSimulation).

import type { Instant } from "./virtual-clock";
import { MINUTE } from "./virtual-clock";

export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle (haversine) distance between two points, in kilometres. */
export function geoDistanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface TravelOptions {
  /** Free-flow road speed in km/h. Default 40 (urban service driving). */
  speedKmh?: number;
  /** Congestion multiplier on travel time; >= 1. 1 = free-flow, 1.5 = heavy. */
  trafficFactor?: number;
}

const DEFAULT_SPEED_KMH = 40;

/** Deterministic travel time in minutes for a trip, traffic-adjusted. */
export function travelTimeMinutes(from: GeoPoint, to: GeoPoint, opts?: TravelOptions): number {
  const speed = opts?.speedKmh ?? DEFAULT_SPEED_KMH;
  const traffic = Math.max(1, opts?.trafficFactor ?? 1);
  if (speed <= 0) throw new Error("travelTimeMinutes: speedKmh must be > 0");
  const km = geoDistanceKm(from, to);
  return (km / speed) * 60 * traffic;
}

/** Arrival instant if departing `from` at `departAt`. */
export function etaAt(departAt: Instant, from: GeoPoint, to: GeoPoint, opts?: TravelOptions): Instant {
  return departAt + Math.round(travelTimeMinutes(from, to, opts) * MINUTE);
}

export interface PositionSample {
  pos: GeoPoint;
  /** 0 at departure, 1 on arrival. */
  fractionTraveled: number;
  arrived: boolean;
}

/**
 * Position along the straight-line route at time `t`, departing `from` at
 * `departAt`. Linear interpolation — adequate for deterministic routing
 * simulation (real routing uses roads; the harness only needs reproducible,
 * monotone progress and a defensible ETA).
 */
export function positionAt(
  from: GeoPoint,
  to: GeoPoint,
  departAt: Instant,
  t: Instant,
  opts?: TravelOptions,
): PositionSample {
  const travelMs = travelTimeMinutes(from, to, opts) * MINUTE;
  const elapsed = t - departAt;
  const fraction = travelMs <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / travelMs));
  return {
    pos: {
      lat: from.lat + (to.lat - from.lat) * fraction,
      lng: from.lng + (to.lng - from.lng) * fraction,
    },
    fractionTraveled: fraction,
    arrived: fraction >= 1,
  };
}

/** True when `pos` is within `radiusMeters` of `site` (geofence arrival/exit detection). */
export function withinGeofence(pos: GeoPoint, site: GeoPoint, radiusMeters: number): boolean {
  return geoDistanceKm(pos, site) * 1000 <= radiusMeters;
}

/**
 * A realistic time-of-day congestion factor (local hour 0–23). Morning (7–9) and
 * evening (16–18) rush raise travel time; midday is mildly congested; night is
 * free-flow. Lets scenarios inject temporal realism into routing/ETA.
 */
export function trafficFactorForHour(hour: number): number {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if ((h >= 7 && h <= 9) || (h >= 16 && h <= 18)) return 1.5; // rush
  if (h >= 10 && h <= 15) return 1.15; // midday
  if (h >= 19 && h <= 21) return 1.1; // evening tail
  return 1.0; // night / early morning
}
