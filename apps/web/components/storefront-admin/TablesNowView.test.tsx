import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CartesianSceneCanvasProps } from "@/components/twin/cartesian/CartesianSceneCanvas";

const captured = vi.hoisted(() => ({
  props: null as CartesianSceneCanvasProps | null,
}));

vi.mock("@/components/twin/cartesian/CartesianSceneCanvas", () => ({
  CartesianSceneCanvas: (props: CartesianSceneCanvasProps) => {
    captured.props = props;
    return <div>persisted floor canvas</div>;
  },
}));

vi.mock("@/lib/twin/operational-scene-layout-actions", () => ({
  saveOperationalCartesianScene: vi.fn(),
}));

import { TablesNowView } from "./TablesNowView";

const scene = {
  id: "scene-1",
  version: 4,
  createdFromStarter: false,
  layout: {
    schemaVersion: 1 as const,
    spaceKind: "cartesian-interior" as const,
    viewport: { x: 0, y: 0, zoom: 1 },
    zones: [],
    placements: [
      {
        id: "placement-1",
        entityRef: { kind: "table", id: "table-1" },
        geometry: {
          x: 10,
          y: 20,
          width: 80,
          height: 80,
          rotation: 0,
          shapeKind: "round-table",
        },
      },
    ],
  },
};

describe("TablesNowView persisted restaurant scene", () => {
  it("binds live table state onto the authored scene and enables versioned layout editing", () => {
    const html = renderToStaticMarkup(
      <TablesNowView
        scene={scene}
        tables={[
          {
            key: "table-1",
            label: "Aster",
            seats: 4,
            state: "turning-soon",
            freeInMinutes: 8,
          },
        ]}
      />,
    );

    expect(html).toContain("persisted floor canvas");
    expect(captured.props?.scene).toBe(scene.layout);
    expect(captured.props?.persistence).toMatchObject({
      sceneId: "scene-1",
      version: 4,
    });
    expect(captured.props?.bindings?.["table:table-1"]).toEqual({
      label: "Aster",
      statusLabel: "Turning soon",
      sublabel: "4 seats · Free in 8 min",
      intent: "warning",
    });
    expect(captured.props?.modeOptions).toEqual(["read-only", "configure"]);
  });
});
