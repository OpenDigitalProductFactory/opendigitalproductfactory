import { describe, expect, it } from "vitest";

import { fitNodesToViewport } from "@/lib/graph/viewport-fit";

describe("fitNodesToViewport", () => {
  it("fits a wide physical hierarchy inside the initial canvas", () => {
    const transform = fitNodesToViewport(
      [
        { x: 30, y: 30 },
        { x: 6_930, y: 430 },
      ],
      { width: 2_000, height: 800 },
      { padding: 60 },
    );

    expect(transform.zoom).toBeLessThan(1);
    for (const node of [{ x: 30, y: 30 }, { x: 6_930, y: 430 }]) {
      const x = node.x * transform.zoom + transform.pan.x;
      const y = node.y * transform.zoom + transform.pan.y;
      expect(x).toBeGreaterThanOrEqual(60);
      expect(x).toBeLessThanOrEqual(1_940);
      expect(y).toBeGreaterThanOrEqual(60);
      expect(y).toBeLessThanOrEqual(740);
    }
  });

  it("does not enlarge a compact hierarchy beyond 100 percent", () => {
    const transform = fitNodesToViewport(
      [{ x: 100, y: 100 }, { x: 300, y: 300 }],
      { width: 800, height: 500 },
    );

    expect(transform.zoom).toBe(1);
    expect(transform.pan).toEqual({ x: 200, y: 50 });
  });

  it("returns the neutral transform when no positioned nodes exist", () => {
    expect(fitNodesToViewport([], { width: 800, height: 500 })).toEqual({
      zoom: 1,
      pan: { x: 0, y: 0 },
    });
  });
});
