import { describe, expect, expectTypeOf, it } from "vitest";
import {
  TWIN_SPACE_KINDS,
  type CartesianSceneLayout,
  type CartesianScenePlacement,
  type GeographicSceneLayout,
  type GeographicScenePlacement,
  type NodeGraphSceneLayout,
  type NodeGraphScenePlacement,
  type SceneEntityRef,
  type SceneLayout,
} from "./scene-layout";

describe("SceneLayout", () => {
  it("publishes the three closed coordinate spaces", () => {
    expect(TWIN_SPACE_KINDS).toEqual([
      "cartesian-interior",
      "geographic",
      "node-graph",
    ]);
  });

  it("represents a cartesian floor without renderer dependencies", () => {
    const layout = {
      schemaVersion: 1,
      spaceKind: "cartesian-interior",
      viewport: { x: 0, y: 0, zoom: 1 },
      underlayRef: "asset_floor_plan",
      zones: [
        {
          id: "dining-room",
          label: "Dining room",
          geometry: { kind: "rectangle", x: 0, y: 0, width: 900, height: 600 },
        },
      ],
      placements: [
        {
          id: "table-12-placement",
          label: "Table 12",
          entityRef: { kind: "restaurant-table", id: "table-12" },
          geometry: {
            x: 120,
            y: 160,
            width: 96,
            height: 96,
            rotation: 0,
            shapeKind: "round-table",
          },
        },
      ],
    } as const satisfies CartesianSceneLayout;

    expect(layout.placements[0]?.entityRef.id).toBe("table-12");
    expectTypeOf(layout).toMatchTypeOf<SceneLayout>();
  });

  it("represents geographic authored geometry without a GeoJSON dependency", () => {
    const layout = {
      schemaVersion: 1,
      spaceKind: "geographic",
      viewport: { longitude: -87.6298, latitude: 41.8781, zoom: 10 },
      zones: [
        {
          id: "north-zone",
          label: "North service zone",
          geometry: {
            kind: "polygon",
            rings: [
              [
                { longitude: -87.7, latitude: 41.95 },
                { longitude: -87.6, latitude: 41.95 },
                { longitude: -87.6, latitude: 41.88 },
                { longitude: -87.7, latitude: 41.95 },
              ],
            ],
          },
        },
      ],
      placements: [
        {
          id: "depot-placement",
          entityRef: { kind: "service-depot", id: "depot-north" },
          geometry: {
            kind: "point",
            longitude: -87.65,
            latitude: 41.91,
          },
        },
      ],
    } as const satisfies GeographicSceneLayout;

    expect(layout.zones[0]?.geometry.kind).toBe("polygon");
    expectTypeOf(layout).toMatchTypeOf<SceneLayout>();
  });

  it("represents a node graph with connector semantics", () => {
    const layout = {
      schemaVersion: 1,
      spaceKind: "node-graph",
      viewport: { x: 0, y: 0, zoom: 0.8 },
      zones: [],
      placements: [
        {
          id: "station-a",
          entityRef: { kind: "work-center", id: "wc-a" },
          geometry: { x: 20, y: 40 },
        },
        {
          id: "station-b",
          entityRef: { kind: "work-center", id: "wc-b" },
          geometry: { x: 280, y: 40 },
        },
      ],
      connectors: [
        {
          id: "conveyor-a-b",
          sourcePlacementId: "station-a",
          targetPlacementId: "station-b",
          kind: "conveyor",
        },
      ],
    } as const satisfies NodeGraphSceneLayout;

    expect(layout.connectors[0]?.targetPlacementId).toBe("station-b");
    expectTypeOf(layout).toMatchTypeOf<SceneLayout>();
  });

  it("keeps entity references immutable and geometry space-specific", () => {
    expectTypeOf<SceneEntityRef>().toMatchTypeOf<{
      readonly kind: string;
      readonly id: string;
    }>();
    expectTypeOf<CartesianScenePlacement>().not.toMatchTypeOf<GeographicScenePlacement>();
    expectTypeOf<GeographicScenePlacement>().not.toMatchTypeOf<NodeGraphScenePlacement>();
    expectTypeOf<NodeGraphScenePlacement>().not.toMatchTypeOf<CartesianScenePlacement>();
  });
});
