import { describe, expect, it } from "vitest";

import { mapPackFileName, validateMapPackManifest } from "./map-pack-manifest";

const manifest = {
  schemaVersion: 1,
  packId: "us-il-chicago-2026.08",
  locale: "en-US",
  region: "Chicago metropolitan area",
  bounds: { west: -88.3, south: 41.4, east: -87.2, north: 42.2 },
  sourceName: "Open map region provider",
  sourceUrl: "https://example.org/map-source",
  attribution: "Map data © source contributors",
  archiveVersion: "2026.08",
  byteLength: 4_096,
  sha256: "a".repeat(64),
  pmtilesSpecVersion: 3,
  minZoom: 0,
  maxZoom: 14,
  createdAt: "2026-08-01T14:00:00.000Z",
};

describe("map pack manifest", () => {
  it("accepts a complete immutable region-pack identity", () => {
    expect(validateMapPackManifest(manifest)).toEqual({ ok: true, value: manifest });
    expect(mapPackFileName(manifest.packId)).toBe("us-il-chicago-2026.08.pmtiles");
  });

  it.each([
    ["path traversal", { ...manifest, packId: "../../private" }],
    ["untrusted source protocol", { ...manifest, sourceUrl: "file:///private/map" }],
    ["invalid checksum", { ...manifest, sha256: "not-a-checksum" }],
    ["invalid archive length", { ...manifest, byteLength: 0 }],
    ["inverted latitude", { ...manifest, bounds: { ...manifest.bounds, south: 45, north: 40 } }],
    ["unsupported PMTiles version", { ...manifest, pmtilesSpecVersion: 2 }],
  ])("rejects %s", (_label, candidate) => {
    expect(validateMapPackManifest(candidate)).toMatchObject({ ok: false });
  });

  it("never derives a filesystem path from an untrusted id", () => {
    expect(() => mapPackFileName("../secrets")).toThrow("Map pack id is invalid.");
  });
});
