import { describe, it, expect } from "vitest";
import {
  computeEaLayout,
  placeIncremental,
  pickAutoAlgorithm,
  computeMetrics,
  computeContainmentLayout,
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

  const assertNoOverlap = (result: Record<string, { x: number; y: number }>) => {
    const points = Object.values(result);
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const overlap =
          Math.abs(points[i]!.x - points[j]!.x) < EA_NODE_W &&
          Math.abs(points[i]!.y - points[j]!.y) < EA_NODE_H;
        expect(overlap).toBe(false);
      }
    }
  };

  it("layered: no two nodes overlap (ELK respects node spacing)", async () => {
    assertNoOverlap(
      await computeEaLayout(
        nodes("a", "b", "c", "d"),
        [edge("a", "b"), edge("b", "c"), edge("c", "d")],
        { algorithm: "layered" },
      ),
    );
  });

  it("organic: no two nodes overlap after the separation pass (dense mesh)", async () => {
    const ns = nodes("a", "b", "c", "d", "e", "f");
    const es = [
      edge("a", "b"), edge("a", "c"), edge("a", "d"), edge("a", "e"), edge("a", "f"),
      edge("b", "c"), edge("c", "d"), edge("d", "e"), edge("e", "f"), edge("f", "b"),
    ];
    assertNoOverlap(await computeEaLayout(ns, es, { algorithm: "organic" }));
  });

  it("radial: no two nodes overlap (dense star)", async () => {
    const center = "h";
    const leaves = Array.from({ length: 14 }, (_, i) => `n${i}`);
    const ns = nodes(center, ...leaves);
    const es = leaves.map((l) => edge(center, l));
    assertNoOverlap(await computeEaLayout(ns, es, { algorithm: "radial" }));
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

  it("chooses layered (crossing-min) for a dense, cyclic mesh", () => {
    const dense = [
      edge("a", "b"), edge("a", "c"), edge("a", "d"), edge("a", "e"),
      edge("b", "c"), edge("c", "d"), edge("d", "e"), edge("e", "b"),
    ]; // n=5, m=8, has cycles → mesh → layered minimizes crossings (organic does not)
    expect(pickAutoAlgorithm(nodes("a", "b", "c", "d", "e"), dense)).toBe("layered");
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

describe("computeContainmentLayout", () => {
  const c = (parent: string, child: string) => ({ parent, child });

  it("nests children under parents (parentId) and marks containers", async () => {
    const out = await computeContainmentLayout(["P", "A", "B", "X"], [c("P", "A"), c("P", "B"), c("A", "X")]);
    const by = Object.fromEntries(out.map((n) => [n.id, n]));
    expect(by.P!.parentId).toBeNull();
    expect(by.P!.isContainer).toBe(true);
    expect(by.A!.parentId).toBe("P");
    expect(by.A!.isContainer).toBe(true);
    expect(by.B!.parentId).toBe("P");
    expect(by.B!.isContainer).toBe(false);
    expect(by.X!.parentId).toBe("A");
    expect(by.X!.isContainer).toBe(false);
  });

  it("emits parents before their children (React Flow ordering)", async () => {
    const order = (await computeContainmentLayout(["P", "A", "X"], [c("P", "A"), c("A", "X")])).map((n) => n.id);
    expect(order.indexOf("P")).toBeLessThan(order.indexOf("A"));
    expect(order.indexOf("A")).toBeLessThan(order.indexOf("X"));
  });

  it("sizes a container to enclose its children", async () => {
    const P = (await computeContainmentLayout(["P", "A", "B"], [c("P", "A"), c("P", "B")])).find((n) => n.id === "P")!;
    expect(P.width).toBeGreaterThan(EA_NODE_W);
    expect(P.height).toBeGreaterThan(EA_NODE_H);
  });

  it("lays children out by their cross-edges inside the container (compound)", async () => {
    const out = await computeContainmentLayout(
      ["P", "A", "B", "C"],
      [c("P", "A"), c("P", "B"), c("P", "C")],
      [edge("A", "B"), edge("B", "C")], // cross-edges among siblings drive the inner layout
    );
    const by = Object.fromEntries(out.map((n) => [n.id, n]));
    expect(by.P!.isContainer).toBe(true);
    for (const id of ["A", "B", "C"]) {
      expect(by[id]!.parentId).toBe("P");
      expect(Number.isFinite(by[id]!.x)).toBe(true);
      expect(Number.isFinite(by[id]!.y)).toBe(true);
    }
    // children laid out at distinct positions (not stacked at one point)
    const pts = ["A", "B", "C"].map((id) => `${Math.round(by[id]!.x)},${Math.round(by[id]!.y)}`);
    expect(new Set(pts).size).toBe(3);
  });

  it("treats nodes with no contains-edges as top-level leaves", async () => {
    const out = await computeContainmentLayout(["a", "b", "c"], []);
    expect(out).toHaveLength(3);
    expect(out.every((n) => n.parentId === null && !n.isContainer)).toBe(true);
  });

  it("ignores edges referencing unknown nodes", async () => {
    const out = await computeContainmentLayout(["P", "A"], [c("P", "A"), c("P", "ghost")]);
    expect(out.find((n) => n.id === "ghost")).toBeUndefined();
    expect(out.find((n) => n.id === "A")!.parentId).toBe("P");
  });

  it("emits every node even when containment forms a cycle (no hang, none dropped)", async () => {
    const out = await computeContainmentLayout(["P", "Q"], [c("P", "Q"), c("Q", "P")]);
    expect(out.map((n) => n.id).sort()).toEqual(["P", "Q"]);
  });
});
