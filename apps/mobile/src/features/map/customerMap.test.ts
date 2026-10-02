import type { CustomerSitesMapResponse } from "@dpf/types";
import { defaultColors } from "@/src/lib/theme";
import {
  installOriginPattern,
  mapScreenState,
  phoneMapStyle,
  sceneBounds,
  siteLetter,
  siteMarkers,
} from "./customerMap";

const feature = (siteId: string, longitude: number, latitude: number) => ({
  type: "Feature" as const,
  id: `site:${siteId}`,
  geometry: { type: "Point" as const, coordinates: [longitude, latitude] },
  properties: {
    featureId: `site:${siteId}`,
    featureKind: "placement" as const,
    label: "Acme",
    entityKind: "customer-site",
    entityId: siteId,
    selected: false,
    statusLabel: null,
    sublabel: null,
    intent: null,
  },
});

function response(overrides: Partial<CustomerSitesMapResponse> = {}): CustomerSitesMapResponse {
  return {
    model: {
      viewport: { latitude: 30.27, longitude: -97.74, zoom: 10 },
      bounds: { west: -97.8, south: 30.2, east: -97.7, north: 30.3, crossesAntimeridian: false },
      zones: { type: "FeatureCollection", features: [] },
      placements: { type: "FeatureCollection", features: [feature("s1", -97.74, 30.27)] },
    },
    notOnMap: 1,
    sites: [
      { siteId: "s1", siteName: "HQ", accountId: "a1", accountName: "acme", addressLabel: "1 Main", onMap: true },
      { siteId: "s2", siteName: "Depot", accountId: "a2", accountName: "Bolt", addressLabel: null, onMap: false },
    ],
    pack: { packId: "us-texas", attribution: "© OpenStreetMap contributors", bounds: { west: -107, south: 25, east: -93, north: 37 } },
    basemap: "available",
    ...overrides,
  };
}

describe("mapScreenState (AC-PMR-FALLBACK-1)", () => {
  it("draws the street map when a pack covers the sites", () => {
    expect(mapScreenState({ status: "loaded", response: response(), mapFailed: false })).toEqual({
      kind: "loaded",
      map: "street",
      reason: null,
    });
  });

  it("falls back to a plain background with a reason when no pack covers the sites", () => {
    for (const basemap of ["no-pack-installed", "out-of-coverage"] as const) {
      const state = mapScreenState({ status: "loaded", response: response({ basemap, pack: null }), mapFailed: false });
      expect(state).toMatchObject({ kind: "loaded", map: "plain" });
      expect(state.kind === "loaded" && state.reason).toMatch(/plain background/);
    }
  });

  it("shows only the list, with a reason, when the map fails or cannot load", () => {
    expect(mapScreenState({ status: "loaded", response: response(), mapFailed: true })).toMatchObject({
      map: "none",
      reason: expect.stringMatching(/could not start/),
    });
    expect(mapScreenState({ status: "error", message: "offline" })).toMatchObject({
      map: "none",
      reason: expect.stringMatching(/offline/),
    });
    expect(
      mapScreenState({ status: "loaded", response: response({ model: null, basemap: "nothing-to-show" }), mapFailed: false }),
    ).toMatchObject({ map: "none", reason: expect.stringMatching(/has a location/) });
  });
});

describe("site markers (AC-PMR-SCREEN-1)", () => {
  it("places each mapped site with its customer's initial", () => {
    expect(siteMarkers(response())).toEqual([
      expect.objectContaining({ siteId: "s1", accountId: "a1", letter: "A", longitude: -97.74, latitude: 30.27 }),
    ]);
  });

  it("uses the first letter or digit, and a question mark when there is none", () => {
    expect(siteLetter("  élan")).toBe("É");
    expect(siteLetter("3M")).toBe("3");
    expect(siteLetter("—")).toBe("?");
  });
});

describe("phoneMapStyle", () => {
  it("fills the zones, keeps the install's pack, and leaves out the text layers native cannot draw without glyphs", () => {
    const style = phoneMapStyle({ response: response(), colors: defaultColors, origin: "https://dpf.example", street: true });
    expect(style.sources["dpf-basemap"]).toEqual(expect.objectContaining({ url: "pmtiles://https://dpf.example/api/map-assets/us-texas" }));
    expect(style.layers.map((layer) => layer.id)).not.toContain("dpf-placement-labels");
    expect(style.layers.some((layer) => layer.type === "symbol")).toBe(false);
    expect(JSON.stringify(style)).not.toMatch(/glyphs|sprite/);
  });

  it("draws no street layer on a plain background", () => {
    const style = phoneMapStyle({ response: response(), colors: defaultColors, origin: "https://dpf.example", street: false });
    expect(style.sources["dpf-basemap"]).toBeUndefined();
  });
});

describe("installOriginPattern", () => {
  it("matches the install's own origin only", () => {
    const pattern = new RegExp(installOriginPattern("https://dpf.example:8443"));
    expect(pattern.test("https://dpf.example:8443/api/map-assets/us-texas")).toBe(true);
    expect(pattern.test("https://dpf.example:8443.evil.test/api")).toBe(false);
    expect(pattern.test("https://evil.test/?u=https://dpf.example:8443/")).toBe(false);
  });
});

describe("sceneBounds", () => {
  it("returns west, south, east, north, and nothing across the antimeridian", () => {
    expect(sceneBounds(response())).toEqual([-97.8, 30.2, -97.7, 30.3]);
    const model = { ...response().model!, bounds: { west: 170, south: -20, east: -170, north: -10, crossesAntimeridian: true } };
    expect(sceneBounds(response({ model }))).toBeNull();
  });
});
