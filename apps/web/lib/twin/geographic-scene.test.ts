import type { GeographicSceneLayout } from "@dpf/storefront-templates";
import { describe, expect, it } from "vitest";

import {
  buildGeographicSceneModel,
  geographicBounds,
  validateGeographicSceneLayout,
} from "./geographic-scene";

const layout: GeographicSceneLayout = {
  schemaVersion: 1,
  spaceKind: "geographic",
  viewport: { longitude: -87.6298, latitude: 41.8781, zoom: 10 },
  zones: [{
    id: "north-zone",
    label: "North service zone",
    geometry: {
      kind: "polygon",
      rings: [[
        { longitude: -87.7, latitude: 41.95 },
        { longitude: -87.6, latitude: 41.95 },
        { longitude: -87.6, latitude: 41.88 },
        { longitude: -87.7, latitude: 41.95 },
      ]],
    },
  }],
  placements: [
    {
      id: "depot-placement",
      label: "North depot",
      entityRef: { kind: "service-depot", id: "depot-north" },
      geometry: { kind: "point", longitude: -87.65, latitude: 41.91 },
    },
    {
      id: "route-placement",
      entityRef: { kind: "service-route", id: "route-7" },
      geometry: {
        kind: "line-string",
        coordinates: [
          { longitude: -87.65, latitude: 41.91 },
          { longitude: -87.61, latitude: 41.89 },
        ],
      },
    },
  ],
};

describe("geographic scene adapter", () => {
  it("validates and projects stable domain-neutral GeoJSON features", () => {
    expect(validateGeographicSceneLayout(layout)).toEqual({ ok: true, value: layout });

    const model = buildGeographicSceneModel({
      layout,
      selectedEntityIds: ["depot-north"],
      presentations: {
        "depot-north": { label: "Depot A", statusLabel: "Ready", intent: "success" },
      },
    });

    expect(model.zones.features[0]).toMatchObject({
      id: "north-zone",
      geometry: { type: "Polygon" },
      properties: { featureKind: "zone", label: "North service zone" },
    });
    expect(model.placements.features).toEqual([
      expect.objectContaining({
        id: "depot-placement",
        geometry: { type: "Point", coordinates: [-87.65, 41.91] },
        properties: expect.objectContaining({
          entityId: "depot-north",
          label: "Depot A",
          statusLabel: "Ready",
          selected: true,
        }),
      }),
      expect.objectContaining({
        id: "route-placement",
        // Assert the projected coordinates, not just the geometry type.
        // `objectContaining` only relaxes the keys it is given — the VALUE of
        // `geometry` is still compared with strict deep equality, so a partial
        // `{ type: "LineString" }` can never match a real GeoJSON LineString.
        // Spelling the pairs out also actually exercises the projection this
        // test claims to cover: {longitude, latitude} -> [lng, lat].
        geometry: {
          type: "LineString",
          coordinates: [
            [-87.65, 41.91],
            [-87.61, 41.89],
          ],
        },
        properties: expect.objectContaining({ entityId: "route-7", selected: false }),
      }),
    ]);
  });

  it("rejects invalid coordinates and open polygon rings", () => {
    expect(validateGeographicSceneLayout({
      ...layout,
      viewport: { longitude: 181, latitude: 41.8, zoom: 10 },
    })).toMatchObject({ ok: false });
    expect(validateGeographicSceneLayout({
      ...layout,
      zones: [{
        ...layout.zones[0],
        geometry: {
          kind: "polygon",
          rings: [[
            { longitude: -87.7, latitude: 41.95 },
            { longitude: -87.6, latitude: 41.95 },
            { longitude: -87.6, latitude: 41.88 },
            { longitude: -87.5, latitude: 41.8 },
          ]],
        },
      }],
    })).toMatchObject({ ok: false });
  });

  it("derives the smallest bounds across the antimeridian", () => {
    expect(geographicBounds([
      { longitude: 179, latitude: 10 },
      { longitude: -179, latitude: 12 },
    ])).toEqual({
      west: 179,
      south: 10,
      east: -179,
      north: 12,
      crossesAntimeridian: true,
    });
  });

  it("rejects feature id reuse across zones and placements", () => {
    expect(validateGeographicSceneLayout({
      ...layout,
      placements: [{ ...layout.placements[0], id: "north-zone" }],
    })).toEqual({ ok: false, error: "Geographic placement is invalid or reuses a feature id." });
  });
});
