import { describe, expect, it } from "vitest";
import type { OrgEdge } from "@/lib/workforce/org-chart-model";
import { computeOrgChartLayout, ORG_NODE_H } from "./layout-org-chart";

describe("computeOrgChartLayout", () => {
  it("returns an empty map for an empty workforce", () => {
    expect(computeOrgChartLayout([], [])).toEqual({});
  });

  it("positions every supplied employee", () => {
    const edges: OrgEdge[] = [{ source: "ceo", target: "vp", kind: "line" }];
    const positions = computeOrgChartLayout(["ceo", "vp"], edges);

    expect(Object.keys(positions).sort()).toEqual(["ceo", "vp"]);
  });

  it("places a report below their manager", () => {
    const edges: OrgEdge[] = [{ source: "ceo", target: "vp", kind: "line" }];
    const positions = computeOrgChartLayout(["ceo", "vp"], edges);

    expect(positions["vp"]!.y).toBeGreaterThan(positions["ceo"]!.y);
  });

  it("puts peers on the same rank", () => {
    const edges: OrgEdge[] = [
      { source: "ceo", target: "a", kind: "line" },
      { source: "ceo", target: "b", kind: "line" },
    ];
    const positions = computeOrgChartLayout(["ceo", "a", "b"], edges);

    expect(positions["a"]!.y).toBe(positions["b"]!.y);
    expect(positions["a"]!.x).not.toBe(positions["b"]!.x);
  });

  // Dotted lines are advisory; ranking on them drags people out of their real layer.
  it("ignores dotted edges when ranking", () => {
    const withDotted = computeOrgChartLayout(
      ["ceo", "vp", "lead"],
      [
        { source: "ceo", target: "vp", kind: "line" },
        { source: "ceo", target: "lead", kind: "line" },
        { source: "lead", target: "vp", kind: "dotted" },
      ],
    );

    expect(withDotted["vp"]!.y).toBe(withDotted["lead"]!.y);
  });

  it("ignores edges pointing outside the supplied set", () => {
    const positions = computeOrgChartLayout(
      ["ceo"],
      [{ source: "ceo", target: "not-rendered", kind: "line" }],
    );

    expect(Object.keys(positions)).toEqual(["ceo"]);
  });

  it("lays out disconnected roots without overlapping vertically", () => {
    const positions = computeOrgChartLayout(["a", "b"], []);

    expect(positions["a"]!.y).toBe(positions["b"]!.y);
  });

  it("returns top-left coordinates, not dagre centre points", () => {
    const positions = computeOrgChartLayout(["solo"], [], { nodeHeight: ORG_NODE_H });

    // dagre centres a lone node at height/2; the top-left origin must therefore be 0.
    expect(positions["solo"]!.y).toBe(0);
  });
});
