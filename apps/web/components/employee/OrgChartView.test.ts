import { describe, expect, it } from "vitest";
import { ORG_NODE_H, ORG_NODE_W } from "@/lib/graph/layout-org-chart";
import { orgFlowNodeShell } from "./OrgChartView";

// Regression guard for the defect that shipped in PR #3801: the org chart rendered every
// person as an island with NO reporting lines, because the node footprint was passed as
// top-level `width`/`height`. React Flow v12 treats those as the internal MEASURED
// dimensions, so `measured` stayed unpopulated, edge paths never computed, and nothing
// warned — not a console message, not a failing test. Model and layout unit tests all
// passed while the chart's single most important visual element was missing.
describe("orgFlowNodeShell", () => {
  const shell = orgFlowNodeShell({ id: "emp-1", position: { x: 10, y: 20 }, draggable: true });

  it("carries the footprint in style, which is what React Flow v12 reads", () => {
    expect(shell.style).toEqual({ width: ORG_NODE_W, height: ORG_NODE_H });
  });

  it("does NOT set top-level width/height — that silently kills every edge path", () => {
    expect(shell).not.toHaveProperty("width");
    expect(shell).not.toHaveProperty("height");
  });

  it("keeps the registered node type so the custom card renders", () => {
    expect(shell.type).toBe("orgPerson");
  });

  it("passes through id, position, and draggability", () => {
    expect(shell.id).toBe("emp-1");
    expect(shell.position).toEqual({ x: 10, y: 20 });
    expect(shell.draggable).toBe(true);
  });

  it("marks the node undraggable when the operator cannot reassign", () => {
    expect(
      orgFlowNodeShell({ id: "e", position: { x: 0, y: 0 }, draggable: false }).draggable,
    ).toBe(false);
  });
});
