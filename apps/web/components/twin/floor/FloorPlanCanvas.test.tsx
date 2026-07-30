import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CartesianSceneCanvasProps } from "@/components/twin/cartesian/CartesianSceneCanvas";
import type { FloorScene } from "@/lib/storefront/floor-layout";

const capture = vi.hoisted(() => ({
  props: null as CartesianSceneCanvasProps | null,
}));

vi.mock("@/components/twin/cartesian/CartesianSceneCanvas", async () => {
  const React = await import("react");
  return {
    CartesianSceneCanvas: (props: CartesianSceneCanvasProps) => {
      capture.props = props;
      return React.createElement("div", { "data-testid": "generic-canvas" });
    },
  };
});

import { FloorPlanCanvas } from "./FloorPlanCanvas";

beforeEach(() => {
  capture.props = null;
});

describe("FloorPlanCanvas compatibility adapter", () => {
  it("maps legacy floor geometry and live state into the generic scene contract", () => {
    const floor: FloorScene = {
      width: 800,
      height: 500,
      zones: [
        {
          section: "main",
          label: "Dining room",
          x: 20,
          y: 30,
          w: 500,
          h: 320,
        },
      ],
      placements: [
        {
          key: "table-1",
          label: "Table 1",
          x: 80,
          y: 90,
          w: 72,
          h: 72,
          shape: "round",
          section: "main",
          seats: 4,
          state: "turning-soon",
          stateLabel: "Turning soon",
          intent: "warning",
          freeInMinutes: 8,
        },
      ],
    };

    renderToStaticMarkup(<FloorPlanCanvas scene={floor} />);

    expect(capture.props).toMatchObject({
      ariaLabel: "Restaurant floor",
      mode: "read-only",
      scene: {
        spaceKind: "cartesian-interior",
        zones: [
          {
            id: "main",
            geometry: {
              kind: "rectangle",
              x: 20,
              y: 30,
              width: 500,
              height: 320,
            },
          },
        ],
        placements: [
          {
            id: "table-1",
            entityRef: { kind: "table", id: "table-1" },
            geometry: {
              x: 80,
              y: 90,
              width: 72,
              height: 72,
              shapeKind: "round-table",
            },
          },
        ],
      },
      bindings: {
        "table:table-1": {
          label: "Table 1",
          statusLabel: "Turning soon",
          sublabel: "4 seats · Free in 8 min",
          intent: "warning",
        },
      },
    });
  });
});
