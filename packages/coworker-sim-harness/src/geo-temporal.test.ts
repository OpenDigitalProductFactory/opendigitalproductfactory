import { describe, expect, it } from "vitest";

import { MINUTE } from "./virtual-clock";
import {
  type GeoPoint,
  etaAt,
  geoDistanceKm,
  positionAt,
  trafficFactorForHour,
  travelTimeMinutes,
  withinGeofence,
} from "./geo-temporal";

const ORIGIN: GeoPoint = { lat: 0, lng: 0 };
const ONE_DEG_NORTH: GeoPoint = { lat: 1, lng: 0 }; // ~111.2 km from origin

describe("geoDistanceKm", () => {
  it("is zero for the same point", () => {
    expect(geoDistanceKm(ORIGIN, ORIGIN)).toBe(0);
  });
  it("is ~111 km for one degree of latitude", () => {
    expect(geoDistanceKm(ORIGIN, ONE_DEG_NORTH)).toBeCloseTo(111.2, 0);
  });
});

describe("travelTimeMinutes", () => {
  it("is distance / speed, traffic-adjusted", () => {
    const free = travelTimeMinutes(ORIGIN, ONE_DEG_NORTH, { speedKmh: 40 });
    expect(free).toBeCloseTo((111.2 / 40) * 60, 0); // ~166.8 min
    const heavy = travelTimeMinutes(ORIGIN, ONE_DEG_NORTH, { speedKmh: 40, trafficFactor: 1.5 });
    expect(heavy).toBeCloseTo(free * 1.5, 5);
  });
  it("never lets traffic shorten a trip", () => {
    expect(travelTimeMinutes(ORIGIN, ONE_DEG_NORTH, { trafficFactor: 0.1 })).toBe(
      travelTimeMinutes(ORIGIN, ONE_DEG_NORTH, { trafficFactor: 1 }),
    );
  });
});

describe("etaAt + positionAt", () => {
  it("eta is departure plus travel time", () => {
    const eta = etaAt(0, ORIGIN, ONE_DEG_NORTH, { speedKmh: 40 });
    expect(eta).toBeCloseTo(travelTimeMinutes(ORIGIN, ONE_DEG_NORTH, { speedKmh: 40 }) * MINUTE, -3);
  });
  it("interpolates position by fraction of travel and detects arrival", () => {
    const travelMs = travelTimeMinutes(ORIGIN, ONE_DEG_NORTH, { speedKmh: 40 }) * MINUTE;
    const mid = positionAt(ORIGIN, ONE_DEG_NORTH, 0, travelMs / 2, { speedKmh: 40 });
    expect(mid.fractionTraveled).toBeCloseTo(0.5, 5);
    expect(mid.pos.lat).toBeCloseTo(0.5, 5);
    expect(mid.arrived).toBe(false);

    const done = positionAt(ORIGIN, ONE_DEG_NORTH, 0, travelMs, { speedKmh: 40 });
    expect(done.arrived).toBe(true);
    expect(done.pos.lat).toBeCloseTo(1, 5);
  });
});

describe("withinGeofence", () => {
  it("is true inside the radius and false outside", () => {
    expect(withinGeofence(ORIGIN, ORIGIN, 100)).toBe(true);
    // ~111 m north of the site
    const justNorth: GeoPoint = { lat: 0.001, lng: 0 };
    expect(withinGeofence(justNorth, ORIGIN, 100)).toBe(false);
    expect(withinGeofence(justNorth, ORIGIN, 200)).toBe(true);
  });
});

describe("trafficFactorForHour", () => {
  it("raises travel time at rush hours and is free-flow at night", () => {
    expect(trafficFactorForHour(8)).toBe(1.5); // morning rush
    expect(trafficFactorForHour(17)).toBe(1.5); // evening rush
    expect(trafficFactorForHour(12)).toBe(1.15); // midday
    expect(trafficFactorForHour(3)).toBe(1.0); // night
  });
  it("normalizes out-of-range hours", () => {
    expect(trafficFactorForHour(32)).toBe(trafficFactorForHour(8));
    expect(trafficFactorForHour(-1)).toBe(trafficFactorForHour(23));
  });
});
