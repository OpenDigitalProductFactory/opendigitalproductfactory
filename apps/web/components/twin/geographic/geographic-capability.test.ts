import { describe, expect, it } from "vitest";

import { geographicRendererCapability, packCoveringBounds } from "./geographic-capability";

const texas = { packId: "us-texas", bounds: { west: -107, south: 25, east: -93, north: 37 } };
const inTexas = { west: -98, south: 29, east: -97, north: 30, crossesAntimeridian: false };
const inFrance = { west: 2, south: 48, east: 3, north: 49, crossesAntimeridian: false };

describe("packCoveringBounds", () => {
  it("picks a pack that fully contains the scene", () => {
    expect(packCoveringBounds([texas], inTexas)?.packId).toBe("us-texas");
    expect(packCoveringBounds([texas], inFrance)).toBeNull();
  });
  it("never matches a scene that crosses the antimeridian to a pack that does not", () => {
    expect(packCoveringBounds([texas], { ...inTexas, crossesAntimeridian: true })).toBeNull();
  });
});

describe("geographicRendererCapability", () => {
  it("reports webgl-unavailable before anything else", () => {
    expect(geographicRendererCapability({ webgl: false, packs: [texas], bounds: inTexas, requiresBasemap: true }))
      .toEqual({ state: "webgl-unavailable" });
  });
  it("is ready without a pack when the view does not need a street layer", () => {
    expect(geographicRendererCapability({ webgl: true, packs: [], bounds: inTexas, requiresBasemap: false }))
      .toEqual({ state: "renderer-ready", pack: null });
  });
  it("reports region-pack-missing when no pack is installed and a street layer is needed", () => {
    expect(geographicRendererCapability({ webgl: true, packs: [], bounds: inTexas, requiresBasemap: true }))
      .toEqual({ state: "region-pack-missing" });
  });
  it("reports region-out-of-coverage when packs exist but none covers the scene", () => {
    expect(geographicRendererCapability({ webgl: true, packs: [texas], bounds: inFrance, requiresBasemap: true }))
      .toEqual({ state: "region-out-of-coverage" });
  });
  it("is ready with the covering pack", () => {
    expect(geographicRendererCapability({ webgl: true, packs: [texas], bounds: inTexas, requiresBasemap: true }))
      .toEqual({ state: "renderer-ready", pack: texas });
  });
  it("uses a covering pack as an enhancement even when the view does not need one", () => {
    expect(geographicRendererCapability({ webgl: true, packs: [texas], bounds: inTexas, requiresBasemap: false }))
      .toEqual({ state: "renderer-ready", pack: texas });
  });
});
