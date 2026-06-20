import { describe, it, expect } from "vitest";
import {
  computeEaLayout,
  placeIncremental,
  pickAutoAlgorithm,
  computeMetrics,
  EA_NODE_W,
  EA_NODE_H,
} from "./canvas-layout";

const nodes = (...ids: string[]) => ids.map((id) => ({ id }));
const edge = (source: string, target: string) => ({ source, target });

const ALGORITHMS = ["auto", "organic", "tree", "layered", "radial"] as const;

describe("computeEaLayout", () => {
  it("returns an empty map for no nodes", async () => {
    expect(await computeEaLayout([], [], { algorithm: "auto" })).toEqual({});
  });

  it("places a single node", async () => {
    const result = await computeEaLayout(nodes("a"), [], { algorithm: "organic" });
    expect(Object.keys(result)).toEqual(["a"]);
  });

  for (const algorithm of ALGORITHMS) {
    it(`${algorithm}: positions every node with finite coordinates`, async () => {
      const result = await computeEaLayout(
        nodes("a", "b", "c", "d", "e"),
        [edge("a", "b"), edge("a", "c"), edge("a", "d"), edge("d", "e")],
        { algorithm },
      );
      expect(Object.keys(result).sort()).toEqual(["a", "b", "c", "d", "e"]);
      for (const pos of Object.values(result)) {
        expect(Number.isFinite(pos.x)).toBe(true);
        expect(Number.isFinite(pos.y)).toBe(true);
      }
    });

    it(`${algorithm}: is deterministic for identical input`, async () => {
      const ns = nodes("a", "b", "c", "d");
      const es = [edge("a", "b"), edge("b", "c"), edge("c", "d")];
      const first = await computeEaLayout(ns, es, { algorithm });
      const second = await computeEaLayout(ns, es, { algorithm });
      expect(first).toEqual(second);
    });
  }

  it("layered: no two nodes overlap (ELK respects node spacing)", async () => {
    const result = await computeEaLayout(
      nodes("a", "b", "c", "d"),
      [edge("a", "b"), edge("b", "c"), edge("c", "d")],
      { algorithm: "layered" },
    );
    const points = Object.values(result);
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const overlap =
          Math.abs(points[i]!.x - points[j]!.x) < EA_NODE_W &&
          Math.abs(points[i]!.y - points[j]!.y) < EA_NODE_H;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe("computeMetrics", () => {
  it("identifies a tree/forest (no cycle)", () => {
    const m = computeMetrics(nodes("a", "b", "c", "d"), [edge("a", "b"), edge("b", "c"), edge("c", "d")]);
    expect(m.isForest).toBe(true);
    expect(m.components).toBe(1);
    expect(m.maxDegree).toBe(2);
    expect(m.isolated).toBe(0);
  });

  it("detects cycles (not a forest) and counts components + isolated nodes", () => {
    // triangle a-b-c-a (cycle) plus an isolated node d
    const m = computeMetrics(nodes("a", "b", "c", "d"), [edge("a", "b"), edge("b", "c"), edge("c", "a")]);
    expect(m.isForest).toBe(false);
    expect(m.components).toBe(2); // {a,b,c} and {d}
    expect(m.isolated).toBe(1);
  });

  it("dedupes parallel edges when counting m", () => {
    const m = computeMetrics(nodes("a", "b"), [edge("a", "b"), edge("b", "a"), edge("a", "b")]);
    expect(m.m).toBe(1);
  });
});

describe("pickAutoAlgorithm", () => {
  it("chooses tree for a forest/tree", () => {
    expect(pickAutoAlgorithm(nodes("a", "b", "c", "d"), [edge("a", "b"), edge("b", "c"), edge("c", "d")])).toBe("tree");
  });

  it("chooses radial for a star (one dominant hub)", () => {
    const star = [edge("h", "a"), edge("h", "b"), edge("h", "c"), edge("h", "d"), edge("h", "e")];
    expect(pickAutoAlgorithm(nodes("h", "a", "b", "c", "d", "e"), star)).toBe("radial");
  });

  it("chooses organic for a dense, cyclic mesh", () => {
    const dense = [
      edge("a", "b"), edge("a", "c"), edge("a", "d"), edge("a", "e"),
      edge("b", "c"), edge("c", "d"), edge("d", "e"), edge("e", "b"),
    ]; // n=5, m=8, density 1.6, has cycles
    expect(pickAutoAlgorithm(nodes("a", "b", "c", "d", "e"), dense)).toBe("organic");
  });

  it("chooses layered for a sparse cyclic (DAG-like) graph", () => {
    const diamond = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("c", "d")]; // cycle, density 1.0
    expect(pickAutoAlgorithm(nodes("a", "b", "c", "d"), diamond)).toBe("layered");
  });
});

describe("placeIncremental", () => {
  it("places a new node nearer its neighbor than the far side of the canvas", () => {
    const existing = { a: { x: 0, y: 0 }, b: { x: 600, y: 600 } };
    const result = placeIncremental(existing, [edge("new", "b")], ["new"]);
    expect(result.new).toBeDefined();
    const distToB = Math.hypot(result.new!.x - 600, result.new!.y - 600);
    const distToA = Math.hypot(result.new!.x - 0, result.new!.y - 0);
    expect(distToB).toBeLessThan(distToA);
  });

  it("does not overlap an existing node", () => {
    const existing = { a: { x: 0, y: 0 } };
    const result = placeIncremental(existing, [edge("new", "a")], ["new"]);
    const overlap =
      Math.abs(result.new!.x - 0) < EA_NODE_W && Math.abs(result.new!.y - 0) < EA_NODE_H;
    expect(overlap).toBe(false);
  });

  it("parks an unconnected node past the right edge of the existing bbox", () => {
    const existing = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
    const result = placeIncremental(existing, [], ["lonely"]);
    expect(result.lonely!.x).toBeGreaterThan(100);
  });

  it("returns positions only for the new ids and does not mutate existing", () => {
    const existing = { a: { x: 0, y: 0 } };
    const result = placeIncremental(existing, [edge("x", "a"), edge("y", "a")], ["x", "y"]);
    expect(Object.keys(result).sort()).toEqual(["x", "y"]);
    expect(existing).toEqual({ a: { x: 0, y: 0 } });
  });
});
