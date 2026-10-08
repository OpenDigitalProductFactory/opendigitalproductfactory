import { describe, expect, it } from "vitest";
import {
  SITE_CONFIRM_FAR_M,
  SITE_CONFIRM_MAX_ACCURACY_M,
  addressGeofence,
  haversineMeters,
  withinGeofence,
} from "@dpf/types";

const AUSTIN = { latitude: 30.2672, longitude: -97.7431 };
const DALLAS = { latitude: 32.7767, longitude: -96.797 };

describe("haversineMeters", () => {
  it("is zero for the same point", () => {
    expect(haversineMeters(AUSTIN, AUSTIN)).toBe(0);
  });

  it("measures Austin to Dallas at about 292 km", () => {
    const d = haversineMeters(AUSTIN, DALLAS);
    expect(d).toBeGreaterThan(290_000);
    expect(d).toBeLessThan(294_000);
  });

  it("returns Infinity for a missing or non-finite point", () => {
    expect(haversineMeters(null, AUSTIN)).toBe(Infinity);
    expect(haversineMeters(AUSTIN, { latitude: Number.NaN, longitude: 0 })).toBe(Infinity);
  });
});

describe("withinGeofence", () => {
  it("includes a point inside the radius and excludes one outside", () => {
    const fence = addressGeofence(AUSTIN, 1_000);
    expect(withinGeofence({ latitude: 30.27, longitude: -97.7431 }, fence)).toBe(true);
    expect(withinGeofence(DALLAS, fence)).toBe(false);
  });

  it("refuses a non-positive or non-finite radius", () => {
    expect(() => addressGeofence(AUSTIN, 0)).toThrow();
    expect(() => addressGeofence(AUSTIN, Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("site confirmation thresholds", () => {
  it("match the design: 50 m accuracy and 1,000 m before asking", () => {
    expect(SITE_CONFIRM_MAX_ACCURACY_M).toBe(50);
    expect(SITE_CONFIRM_FAR_M).toBe(1_000);
  });
});
