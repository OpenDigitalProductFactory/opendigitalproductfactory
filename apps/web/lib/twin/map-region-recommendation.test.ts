import { describe, expect, it } from "vitest";

import { recommendMapRegions, type RegionPoint } from "./map-region-recommendation";

const TEXAS_PACK = { packId: "us-texas", bounds: { west: -106.65, south: 25.84, east: -93.51, north: 36.5 } };

const tx = (latitude: number, longitude: number): RegionPoint => ({
  latitude,
  longitude,
  regionName: "Texas",
  countryName: "United States",
  countryIso2: "US",
});

const AUSTIN = tx(30.2672, -97.7431);
const DALLAS = tx(32.7767, -96.797);
// Outside the Texas pack rectangle (its north edge is 36.5°).
const WICHITA: RegionPoint = { latitude: 37.6872, longitude: -97.3301, regionName: "Kansas", countryName: "United States", countryIso2: "US" };

describe("recommendMapRegions", () => {
  it("reports no locations when nothing is placed", () => {
    expect(recommendMapRegions({ points: [], packs: [TEXAS_PACK] })).toEqual({ status: "no-locations", groups: [] });
  });

  it("reports Texas locations as covered by the installed Texas pack (AC-ALC-REGION-1)", () => {
    const result = recommendMapRegions({ points: [AUSTIN, DALLAS], packs: [TEXAS_PACK] });
    expect(result.status).toBe("covered");
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      label: "Texas, United States",
      suggestedPackId: "us-texas",
      pointCount: 2,
      coveredBy: "us-texas",
    });
  });

  it("recommends a padded region per uncovered state, one group each (AC-ALC-REGION-2)", () => {
    const result = recommendMapRegions({ points: [AUSTIN, WICHITA, DALLAS], packs: [TEXAS_PACK] });
    expect(result.status).toBe("partly-covered");
    const kansas = result.groups.find((g) => g.regionName === "Kansas");
    expect(kansas).toMatchObject({ label: "Kansas, United States", suggestedPackId: "us-kansas", pointCount: 1, coveredBy: null });
    // A single point still gets at least 25 km of padding on every side.
    const b = kansas!.bounds;
    expect(b.north - b.south).toBeGreaterThan(0.44);
    expect(b.west).toBeLessThan(WICHITA.longitude);
    expect(b.east).toBeGreaterThan(WICHITA.longitude);
  });

  it("reports not covered when no pack is installed", () => {
    const result = recommendMapRegions({ points: [AUSTIN], packs: [] });
    expect(result.status).toBe("not-covered");
    expect(result.groups[0].coveredBy).toBeNull();
  });

  it("pads by 10% of a wide group's span rather than 25 km", () => {
    const elPaso = tx(31.7619, -106.485);
    const houston = tx(29.7604, -95.3698);
    const [group] = recommendMapRegions({ points: [elPaso, houston], packs: [] }).groups;
    const span = -95.3698 - -106.485;
    expect(group.bounds.west).toBeCloseTo(-106.485 - span * 0.1, 3);
    expect(group.bounds.east).toBeCloseTo(-95.3698 + span * 0.1, 3);
  });

  it("groups a point with no recorded region by country, and one with no country on its own", () => {
    const noRegion: RegionPoint = { latitude: 40.7, longitude: -74, regionName: null, countryName: "United States", countryIso2: "US" };
    const nothing: RegionPoint = { latitude: 51.5, longitude: -0.12, regionName: null, countryName: null, countryIso2: null };
    const { groups } = recommendMapRegions({ points: [noRegion, nothing], packs: [] });
    expect(groups.map((g) => g.label).sort()).toEqual(["Locations with no recorded country", "United States"]);
    expect(groups.find((g) => g.label === "United States")?.suggestedPackId).toBe("us");
    expect(groups.find((g) => g.countryIso2 === null)?.suggestedPackId).toBeNull();
  });

  it("ignores invalid points", () => {
    const bad: RegionPoint = { ...AUSTIN, latitude: Number.NaN };
    expect(recommendMapRegions({ points: [bad], packs: [] }).status).toBe("no-locations");
  });
});
