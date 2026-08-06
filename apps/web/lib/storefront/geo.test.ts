import { describe, it, expect } from "vitest";
import {
  extractCoordinates,
  haversineMeters,
  parseQueryCoordinates,
} from "./geo";

describe("extractCoordinates", () => {
  it("reads top-level lat/lng numbers", () => {
    expect(extractCoordinates({ lat: 37.7749, lng: -122.4194 })).toEqual({
      lat: 37.7749,
      lng: -122.4194,
    });
  });

  it("reads latitude/longitude spellings and numeric strings", () => {
    expect(
      extractCoordinates({ latitude: "40.7128", longitude: "-74.0060" }),
    ).toEqual({ lat: 40.7128, lng: -74.006 });
  });

  it("reads coordinates nested under geo/coordinates/location", () => {
    expect(extractCoordinates({ geo: { lat: 1, lng: 2 } })).toEqual({
      lat: 1,
      lng: 2,
    });
    expect(
      extractCoordinates({ coordinates: { latitude: 3, lon: 4 } }),
    ).toEqual({ lat: 3, lng: 4 });
  });

  it("returns null for addresses with no coordinates or out-of-range values", () => {
    expect(extractCoordinates({ city: "Springfield", postal: "12345" })).toBeNull();
    expect(extractCoordinates({ lat: 200, lng: 0 })).toBeNull();
    expect(extractCoordinates(null)).toBeNull();
    expect(extractCoordinates("123 Main St")).toBeNull();
  });
});

describe("haversineMeters", () => {
  it("is zero for identical points", () => {
    expect(haversineMeters({ lat: 10, lng: 10 }, { lat: 10, lng: 10 })).toBe(0);
  });

  it("approximates a known short distance (SF Ferry Building → Coit Tower ≈ 1.5 km)", () => {
    const d = haversineMeters(
      { lat: 37.7955, lng: -122.3937 },
      { lat: 37.8024, lng: -122.4058 },
    );
    // ~1.28 km great-circle; allow a tolerant band.
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(1600);
  });

  it("is symmetric", () => {
    const a = { lat: 51.5, lng: -0.12 };
    const b = { lat: 48.85, lng: 2.35 };
    expect(haversineMeters(a, b)).toBe(haversineMeters(b, a));
  });
});

describe("parseQueryCoordinates", () => {
  it("parses a valid pair", () => {
    expect(parseQueryCoordinates("37.77", "-122.41")).toEqual({
      lat: 37.77,
      lng: -122.41,
    });
  });

  it("rejects missing, non-numeric, or out-of-range input", () => {
    expect(parseQueryCoordinates(null, "1")).toBeNull();
    expect(parseQueryCoordinates("1", null)).toBeNull();
    expect(parseQueryCoordinates("abc", "1")).toBeNull();
    expect(parseQueryCoordinates("91", "0")).toBeNull();
    expect(parseQueryCoordinates("0", "181")).toBeNull();
  });
});
