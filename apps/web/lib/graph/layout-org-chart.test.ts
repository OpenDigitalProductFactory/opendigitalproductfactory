import { describe, expect, it } from "vitest";
import type { OrgEdge } from "@/lib/workforce/org-chart-model";
import { computeOrgChartLayout, ORG_NODE_H, ORG_NODE_W } from "./layout-org-chart";

type Box = { id: string; x: number; y: number; w: number; h: number };

function boxes(positions: Record<string, { x: number; y: number }>): Box[] {
  return Object.entries(positions).map(([id, p]) => ({ id, x: p.x, y: p.y, w: ORG_NODE_W, h: ORG_NODE_H }));
}

function overlapping(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function expectNoOverlap(positions: Record<string, { x: number; y: number }>) {
  const all = boxes(positions);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      expect(overlapping(all[i]!, all[j]!), `${all[i]!.id} overlaps ${all[j]!.id}`).toBe(false);
    }
  }
}

const line = (source: string, target: string): OrgEdge => ({ source, target, kind: "line" });

describe("computeOrgChartLayout", () => {
  it("returns an empty map for an empty workforce", async () => {
    expect(await computeOrgChartLayout([], [])).toEqual({});
  });

  it("positions every supplied employee with finite coordinates", async () => {
    const positions = await computeOrgChartLayout(["ceo", "vp"], [line("ceo", "vp")]);

    expect(Object.keys(positions).sort()).toEqual(["ceo", "vp"]);
    for (const p of Object.values(positions)) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("places a report a full rank below their manager", async () => {
    const positions = await computeOrgChartLayout(["ceo", "vp"], [line("ceo", "vp")]);

    // Top-down: the report's card starts below the bottom of the manager's card.
    expect(positions["vp"]!.y).toBeGreaterThanOrEqual(positions["ceo"]!.y + ORG_NODE_H);
  });

  it("orders ranks top-down along a reporting chain", async () => {
    const positions = await computeOrgChartLayout(
      ["ceo", "vp", "lead", "ic"],
      [line("ceo", "vp"), line("vp", "lead"), line("lead", "ic")],
    );

    expect(positions["ceo"]!.y).toBeLessThan(positions["vp"]!.y);
    expect(positions["vp"]!.y).toBeLessThan(positions["lead"]!.y);
    expect(positions["lead"]!.y).toBeLessThan(positions["ic"]!.y);
  });

  it("puts peers on the same rank, side by side", async () => {
    const positions = await computeOrgChartLayout(["ceo", "a", "b"], [line("ceo", "a"), line("ceo", "b")]);

    expect(positions["a"]!.y).toBe(positions["b"]!.y);
    expect(positions["a"]!.x).not.toBe(positions["b"]!.x);
    expectNoOverlap(positions);
  });

  it("keeps the supplied order for peers, so the chart reads the same between renders", async () => {
    const reports = ["r1", "r2", "r3", "r4"];
    const positions = await computeOrgChartLayout(
      ["ceo", ...reports],
      reports.map((r) => line("ceo", r)),
    );

    const xs = reports.map((r) => positions[r]!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  // Dotted lines are advisory; ranking on them drags people out of their real layer.
  it("ignores dotted edges when ranking", async () => {
    const withDotted = await computeOrgChartLayout(
      ["ceo", "vp", "lead"],
      [line("ceo", "vp"), line("ceo", "lead"), { source: "lead", target: "vp", kind: "dotted" }],
    );

    expect(withDotted["vp"]!.y).toBe(withDotted["lead"]!.y);
  });

  it("ignores edges pointing outside the supplied set", async () => {
    const positions = await computeOrgChartLayout(["ceo"], [line("ceo", "not-rendered")]);

    expect(Object.keys(positions)).toEqual(["ceo"]);
  });

  it("puts disconnected roots on the first rank without overlapping", async () => {
    const positions = await computeOrgChartLayout(["a", "b", "c"], []);

    expect(positions["a"]!.y).toBe(positions["b"]!.y);
    expect(positions["b"]!.y).toBe(positions["c"]!.y);
    expectNoOverlap(positions);
  });

  it("returns top-left coordinates with the bounding box at the origin", async () => {
    const positions = await computeOrgChartLayout(["solo"], []);

    expect(positions["solo"]).toEqual({ x: 0, y: 0 });
  });

  it("lays out a realistic workforce: two trees, a reporting loop, no overlaps", async () => {
    const ids = ["ceo", "cfo", "cto", "fin1", "fin2", "eng1", "eng2", "eng3", "x", "y"];
    const edges: OrgEdge[] = [
      line("ceo", "cfo"),
      line("ceo", "cto"),
      line("cfo", "fin1"),
      line("cfo", "fin2"),
      line("cto", "eng1"),
      line("cto", "eng2"),
      line("cto", "eng3"),
      // A reporting loop the chart flags; layout must still place both people.
      line("x", "y"),
      line("y", "x"),
      { source: "eng1", target: "fin1", kind: "dotted" },
    ];
    const positions = await computeOrgChartLayout(ids, edges);

    expect(Object.keys(positions).sort()).toEqual([...ids].sort());
    expectNoOverlap(positions);
    for (const [manager, report] of [
      ["ceo", "cfo"],
      ["cfo", "fin1"],
      ["cto", "eng3"],
    ] as const) {
      expect(positions[report]!.y).toBeGreaterThan(positions[manager]!.y);
    }
    // Peers under one manager share a rank.
    expect(new Set(["eng1", "eng2", "eng3"].map((id) => positions[id]!.y)).size).toBe(1);
  });
});
