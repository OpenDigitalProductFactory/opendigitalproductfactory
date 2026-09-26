// Structural invariants for the ELK-layered topology layouts (plan 2026-09-08 S10).
// These assert shape, never engine-specific pixel coordinates.
import { describe, expect, it } from "vitest";
import type { GraphData } from "@/lib/actions/graph";
import { computeHierarchicalLayout } from "@/lib/graph/layout-hierarchical";
import { computeSwimLaneLayout } from "@/lib/graph/layout-swimlane";
import type { PositionedNode } from "@/lib/graph/types";

function graph(ids: string[], links: Array<[string, string]>): GraphData {
  return {
    nodes: ids.map((id) => ({ id, name: id, label: "InfraCI", color: "", size: 1 })),
    links: links.map(([source, target]) => ({ source, target, type: "DEPENDS_ON" })),
  };
}

type Box = { id: string; left: number; top: number; right: number; bottom: number };

function overlapping(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function expectNoOverlap(all: Box[]) {
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      expect(overlapping(all[i]!, all[j]!), `${all[i]!.id} overlaps ${all[j]!.id}`).toBe(false);
    }
  }
}

function expectAllPositioned(nodes: PositionedNode[], ids: string[]) {
  expect(nodes.map((n) => n.id).sort()).toEqual([...ids].sort());
  for (const n of nodes) {
    expect(Number.isFinite(n.x), `${n.id}.x`).toBe(true);
    expect(Number.isFinite(n.y), `${n.id}.y`).toBe(true);
  }
}

const byId = (nodes: PositionedNode[]) => new Map(nodes.map((n) => [n.id, n]));

// A gateway fanning out to two switches, each with hosts, plus an isolated appliance.
const TREE_IDS = ["gw", "sw1", "sw2", "h1", "h2", "h3", "h4", "lonely"];
const TREE_LINKS: Array<[string, string]> = [
  ["gw", "sw1"],
  ["gw", "sw2"],
  ["sw1", "h1"],
  ["sw1", "h2"],
  ["sw2", "h3"],
  ["sw2", "h4"],
];

describe("computeHierarchicalLayout (ELK layered)", () => {
  const W = 60;
  const H = 30;
  // Hierarchical returns centre points.
  const centreBoxes = (nodes: PositionedNode[]): Box[] =>
    nodes.map((n) => ({ id: n.id, left: n.x - W / 2, top: n.y - H / 2, right: n.x + W / 2, bottom: n.y + H / 2 }));

  it("returns an empty result for an empty graph", async () => {
    expect(await computeHierarchicalLayout({ nodes: [], links: [] })).toEqual({ nodes: [], links: [] });
  });

  it("TB: positions every node, orders ranks top-down, and never overlaps", async () => {
    const result = await computeHierarchicalLayout(graph(TREE_IDS, TREE_LINKS), { direction: "TB" });
    expectAllPositioned(result.nodes, TREE_IDS);
    expectNoOverlap(centreBoxes(result.nodes));

    const n = byId(result.nodes);
    expect(n.get("gw")!.y).toBeLessThan(n.get("sw1")!.y);
    expect(n.get("sw1")!.y).toBeLessThan(n.get("h1")!.y);
    // Rank grouping: siblings share a rank.
    expect(n.get("sw1")!.y).toBe(n.get("sw2")!.y);
    expect(new Set(["h1", "h2", "h3", "h4"].map((id) => n.get(id)!.y)).size).toBe(1);
    // Disconnected roots share the first rank rather than being stacked below the tree.
    expect(n.get("lonely")!.y).toBe(n.get("gw")!.y);
  });

  it("TB: consecutive ranks are separated by at least the node height", async () => {
    const result = await computeHierarchicalLayout(graph(TREE_IDS, TREE_LINKS), { direction: "TB" });
    const n = byId(result.nodes);
    expect(n.get("sw1")!.y - n.get("gw")!.y).toBeGreaterThanOrEqual(H);
  });

  it("LR: orders ranks left-to-right and never overlaps", async () => {
    const result = await computeHierarchicalLayout(graph(TREE_IDS, TREE_LINKS), { direction: "LR" });
    expectAllPositioned(result.nodes, TREE_IDS);
    expectNoOverlap(centreBoxes(result.nodes));

    const n = byId(result.nodes);
    expect(n.get("gw")!.x).toBeLessThan(n.get("sw1")!.x);
    expect(n.get("sw1")!.x).toBeLessThan(n.get("h1")!.x);
    expect(n.get("sw1")!.x).toBe(n.get("sw2")!.x);
  });

  it("returns centre points: a lone node's centre is half its footprint from the origin", async () => {
    const result = await computeHierarchicalLayout(graph(["solo"], []));
    expect(result.nodes[0]).toMatchObject({ x: W / 2, y: H / 2 });
  });

  it("survives cycles, self-loops and links to unknown nodes", async () => {
    const result = await computeHierarchicalLayout(
      graph(["a", "b", "c"], [["a", "b"], ["b", "c"], ["c", "a"], ["a", "a"], ["a", "ghost"]]),
    );
    expectAllPositioned(result.nodes, ["a", "b", "c"]);
    expectNoOverlap(centreBoxes(result.nodes));
    // Links pass through untouched for the renderer.
    expect(result.links).toHaveLength(5);
  });
});

describe("computeSwimLaneLayout (ELK layered, partitioned)", () => {
  const W = 60;
  const H = 30;
  // Swimlane returns ELK top-left corners.
  const topLeftBoxes = (nodes: PositionedNode[]): Box[] =>
    nodes.map((n) => ({ id: n.id, left: n.x, top: n.y, right: n.x + W, bottom: n.y + H }));

  /** Vertical extent of each lane, keyed by partition. */
  function laneBounds(nodes: PositionedNode[]) {
    const bounds = new Map<string | number, { top: number; bottom: number }>();
    for (const n of nodes) {
      if (n.partition == null) continue;
      const b = bounds.get(n.partition);
      if (b) {
        b.top = Math.min(b.top, n.y);
        b.bottom = Math.max(b.bottom, n.y + H);
      } else {
        bounds.set(n.partition, { top: n.y, bottom: n.y + H });
      }
    }
    return bounds;
  }

  it("OSI lanes: every node positioned, lanes ordered L7 first, disjoint, no overlaps", async () => {
    const osi: Record<string, number> = { app: 7, api: 7, tls: 6, tcp: 4, ip1: 3, ip2: 3, eth: 2, phy: 1 };
    const ids = Object.keys(osi);
    // Edges go both up and down the stack, and two components are disconnected from each other.
    const data = graph(ids, [["app", "tls"], ["tls", "tcp"], ["ip1", "tcp"], ["ip1", "eth"], ["phy", "eth"]]);
    const result = await computeSwimLaneLayout(data, (id) => osi[id] ?? null);

    expectAllPositioned(result.nodes, ids);
    expectNoOverlap(topLeftBoxes(result.nodes));
    for (const n of result.nodes) {
      expect(n.osiLayer).toBe(osi[n.id]);
      expect(n.partition).toBe(osi[n.id]);
    }

    // Lanes are disjoint bands ordered from the highest OSI layer down: each lane sits
    // entirely below the one before it, so every node is inside its own lane's band.
    const bounds = laneBounds(result.nodes);
    const order = [...bounds.keys()].sort((a, b) => Number(b) - Number(a));
    for (let i = 1; i < order.length; i++) {
      const above = bounds.get(order[i - 1]!)!;
      const below = bounds.get(order[i]!)!;
      expect(below.top, `L${String(order[i])} starts below L${String(order[i - 1])}`).toBeGreaterThanOrEqual(above.bottom);
    }
  });

  it("subnet lanes: physical subnets before Docker (172.*) subnets", async () => {
    const subnet: Record<string, string> = {
      a1: "10.0.0.0/24",
      a2: "10.0.0.0/24",
      b1: "192.168.1.0/24",
      d1: "172.17.0.0/16",
      d2: "172.17.0.0/16",
    };
    const ids = Object.keys(subnet);
    const result = await computeSwimLaneLayout(graph(ids, [["d1", "a1"], ["a2", "b1"]]), (id) => subnet[id] ?? null);

    expectAllPositioned(result.nodes, ids);
    expectNoOverlap(topLeftBoxes(result.nodes));
    const bounds = laneBounds(result.nodes);
    const order = ["10.0.0.0/24", "192.168.1.0/24", "172.17.0.0/16"];
    for (let i = 1; i < order.length; i++) {
      expect(bounds.get(order[i]!)!.top).toBeGreaterThanOrEqual(bounds.get(order[i - 1]!)!.bottom);
    }
  });

  it("returns an empty result for an empty graph", async () => {
    expect(await computeSwimLaneLayout({ nodes: [], links: [] }, () => null)).toEqual({ nodes: [], links: [] });
  });
});
