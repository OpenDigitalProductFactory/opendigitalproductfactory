import { describe, it, expect } from "vitest";
import {
  clampRadiusKm,
  extractOrgLatLng,
  haversineKm,
  parseQueryPoint,
  roundKm,
} from "./nearby-geo";

describe("haversineKm", () => {
  // London (51.5074, -0.1278) to Paris (48.8566, 2.3522) ≈ 343.5 km
  it("computes a known London–Paris distance within 1%", () => {
    const km = haversineKm(
      { latitude: 51.5074, longitude: -0.1278 },
      { latitude: 48.8566, longitude: 2.3522 },
    );
    expect(km).toBeGreaterThan(340);
    expect(km).toBeLessThan(347);
  });

  it("returns 0 for identical points", () => {
    const p = { latitude: 40, longitude: -75 };
    expect(haversineKm(p, p)).toBeCloseTo(0);
  });

  it("returns Infinity when either endpoint is null", () => {
    expect(haversineKm(null, { latitude: 0, longitude: 0 })).toBe(Infinity);
    expect(haversineKm({ latitude: 0, longitude: 0 }, null)).toBe(Infinity);
  });

  it("returns Infinity for NaN / non-finite coordinates", () => {
    expect(
      haversineKm(
        { latitude: NaN, longitude: 0 },
        { latitude: 0, longitude: 0 },
      ),
    ).toBe(Infinity);
  });
});

describe("roundKm", () => {
  it("rounds to one decimal", () => {
    expect(roundKm(3.14159)).toBe(3.1);
    expect(roundKm(2.95)).toBe(3);
  });
  it("passes Infinity through", () => {
    expect(roundKm(Infinity)).toBe(Infinity);
  });
});

describe("clampRadiusKm", () => {
  it("defaults to 25 km for missing / non-positive values", () => {
    expect(clampRadiusKm(undefined)).toBe(25);
    expect(clampRadiusKm(0)).toBe(25);
    expect(clampRadiusKm(-12)).toBe(25);
    expect(clampRadiusKm(Number.NaN)).toBe(25);
  });
  it("clamps to 0.1 .. 500", () => {
    expect(clampRadiusKm(0.05)).toBe(0.1);
    expect(clampRadiusKm(1200)).toBe(500);
    expect(clampRadiusKm(10)).toBe(10);
  });
});

describe("parseQueryPoint", () => {
  function qs(input: string): URLSearchParams {
    return new URLSearchParams(input);
  }
  it("returns null when either coordinate is missing or NaN", () => {
    expect(parseQueryPoint(qs("lat=51.5"))).toBeNull();
    expect(parseQueryPoint(qs("lng=-0.1"))).toBeNull();
    expect(parseQueryPoint(qs("lat=abc&lng=-0.1"))).toBeNull();
  });
  it("rejects out-of-range coordinates rather than silently clamping", () => {
    expect(parseQueryPoint(qs("lat=200&lng=0"))).toBeNull();
    expect(parseQueryPoint(qs("lat=0&lng=-181"))).toBeNull();
  });
  it("accepts the geographic extremes (north/south pole, antimeridian)", () => {
    expect(parseQueryPoint(qs("lat=90&lng=180"))).toEqual({
      latitude: 90,
      longitude: 180,
    });
  });
});

describe("extractOrgLatLng", () => {
  it("returns null for non-object inputs", () => {
    expect(extractOrgLatLng(null)).toBeNull();
    expect(extractOrgLatLng("legacy-string")).toBeNull();
    expect(extractOrgLatLng(42)).toBeNull();
  });
  it("reads canonical { latitude, longitude } pairs", () => {
    expect(extractOrgLatLng({ latitude: 51.5, longitude: -0.1 })).toEqual({
      latitude: 51.5,
      longitude: -0.1,
    });
  });
  it("accepts short aliases (lat / lng / long) so seed conventions work", () => {
    expect(extractOrgLatLng({ lat: 40, lng: -75 })).toEqual({
      latitude: 40,
      longitude: -75,
    });
    expect(extractOrgLatLng({ lat: 40, long: -75 })).toEqual({
      latitude: 40,
      longitude: -75,
    });
  });
  it("returns null when coordinates are absent / out of range / non-numeric", () => {
    expect(extractOrgLatLng({ city: "London" })).toBeNull();
    expect(extractOrgLatLng({ lat: 200, lng: 0 })).toBeNull();
    expect(extractOrgLatLng({ lat: "north", lng: 0 })).toBeNull();
  });
});
