import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { TwinViewProps } from "@/components/twin/TwinView";
import type { CartesianSceneCanvasProps } from "@/components/twin/cartesian/CartesianSceneCanvas";
import type { RestaurantFloorOperationsProps } from "@/components/twin/restaurant/RestaurantFloorOperations";
import type { RoomsOperationsProps } from "@/components/twin/rooms";
import { buildDemoRoomsOperationalView } from "@/lib/twin/rooms-operations-demo";
import type { WorkspaceTwinPresentation } from "@/lib/workspace-home/twin-panel-data";

const captured = vi.hoisted(() => ({
  twin: null as TwinViewProps | null,
  canvas: null as CartesianSceneCanvasProps | null,
  restaurant: null as RestaurantFloorOperationsProps | null,
  rooms: null as RoomsOperationsProps | null,
}));

vi.mock("@/components/twin", () => ({
  TwinView: (props: TwinViewProps) => {
    captured.twin = props;
    return <div>{props.physicalScene}</div>;
  },
}));

vi.mock("@/components/twin/cartesian/CartesianSceneCanvas", () => ({
  CartesianSceneCanvas: (props: CartesianSceneCanvasProps) => {
    captured.canvas = props;
    return <div>workspace floor</div>;
  },
}));

vi.mock("@/components/twin/restaurant/RestaurantFloorOperations", () => ({
  RestaurantFloorOperations: (props: RestaurantFloorOperationsProps) => {
    captured.restaurant = props;
    return <div>live restaurant host stand</div>;
  },
}));

vi.mock("@/components/twin/rooms", () => ({
  RoomsOperations: (props: RoomsOperationsProps) => {
    captured.rooms = props;
    return <div>coordinated room rack</div>;
  },
}));

import { WorkspaceTwinPanel } from "./WorkspaceTwinPanel";

describe("WorkspaceTwinPanel restaurant scene", () => {
  it("uses the business-grade host stand when the live restaurant view is loaded", () => {
    const presentation = {
      restaurantFloor: {
        floor: {
          asOf: "2026-07-31T18:14:00.000Z",
          staffingAvailable: true,
          tables: [],
          demand: [],
        },
        commands: [],
        moves: [],
      },
      scene: null,
    } as unknown as WorkspaceTwinPresentation;

    const html = renderToStaticMarkup(
      <WorkspaceTwinPanel presentation={presentation} />,
    );

    expect(html).toContain("live restaurant host stand");
    expect(captured.restaurant?.view).toBe(presentation.restaurantFloor);
  });

  it("replaces the generic resource grid with the authored floor and live bindings", () => {
    const presentation = {
      archetypeId: "restaurant",
      archetypeName: "Restaurant",
      profile: {
        template: "FLOOR",
        physical: true,
      },
      snapshot: {
        capacityChips: [],
        zones: [
          {
            key: "dining-room",
            units: [
              {
                key: "table-1",
                label: "Aster",
                state: "Occupied",
                intent: "info",
                sublabel: "4 seats",
              },
            ],
          },
        ],
        workItems: [],
        queues: [],
        presence: [],
        feed: [],
        quests: [],
        utility: [],
      },
      operations: null,
      demo: false,
      scene: {
        id: "scene-1",
        version: 2,
        createdFromStarter: false,
        layout: {
          schemaVersion: 1,
          spaceKind: "cartesian-interior",
          viewport: { x: 0, y: 0, zoom: 1 },
          zones: [],
          placements: [
            {
              id: "placement-1",
              entityRef: { kind: "table", id: "table-1" },
              geometry: {
                x: 0,
                y: 0,
                width: 80,
                height: 80,
                rotation: 0,
                shapeKind: "round-table",
              },
            },
          ],
        },
      },
    } as unknown as WorkspaceTwinPresentation;

    const html = renderToStaticMarkup(
      <WorkspaceTwinPanel presentation={presentation} />,
    );

    expect(html).toContain("workspace floor");
    expect(captured.twin?.physicalScene).toBeTruthy();
    expect(captured.canvas?.mode).toBe("read-only");
    expect(captured.canvas?.bindings?.["table:table-1"]).toEqual({
      label: "Aster",
      statusLabel: "Occupied",
      sublabel: "4 seats",
      intent: "info",
    });
  });
});

describe("WorkspaceTwinPanel ROOMS scene", () => {
  it("uses the coordinated room operations renderer instead of the generic card twin", () => {
    captured.twin = null;
    const presentation = {
      restaurantFloor: null,
      roomsOperations: buildDemoRoomsOperationalView({ domain: "lodging" }),
      roomsOperationsDemo: true,
      scene: null,
    } as unknown as WorkspaceTwinPresentation;

    const html = renderToStaticMarkup(
      <WorkspaceTwinPanel presentation={presentation} />,
    );

    expect(html).toContain("coordinated room rack");
    expect(captured.rooms?.demo).toBe(true);
    expect(captured.twin).toBeNull();
  });
});
