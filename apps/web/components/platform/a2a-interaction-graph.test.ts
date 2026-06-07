import { describe, expect, it } from "vitest";
import {
  A2A_GRAPH_LAYOUT,
  a2aEdgeIsGoverned,
  a2aEdgeSourceRecords,
  a2aEdgeVisibleAtReplayTime,
  a2aStateIntent,
  columnPositions,
  coworkerHref,
  edgeKindDash,
  edgePath,
  edgeStrokeWidth,
  graphHeight,
  orderedUnique,
  svgClip,
  titleize,
} from "./a2a-interaction-graph";
import type { OperationsMapA2aEdge } from "@/lib/ai-operations-map/types";

function edge(overrides: Partial<OperationsMapA2aEdge> = {}): OperationsMapA2aEdge {
  return {
    id: "e1",
    edgeKind: "a2a-delegation",
    fromCoworkerId: "a",
    toCoworkerId: "b",
    state: "active",
    label: "Delegated",
    summary: "Summary",
    occurredAt: "2026-06-04T10:00:00.000Z",
    refs: {},
    weight: 2,
    ...overrides,
  };
}

describe("a2a-interaction-graph helpers", () => {
  it("maps interaction state to the shared report-kit intent", () => {
    expect(a2aStateIntent("active")).toBe("accent");
    expect(a2aStateIntent("completed")).toBe("success");
    expect(a2aStateIntent("failed")).toBe("danger");
    expect(a2aStateIntent("blocked")).toBe("warning");
  });

  it("gives each edge kind a distinct dash (non-colour channel)", () => {
    const dashes = new Set([
      String(edgeKindDash("a2a-delegation")),
      edgeKindDash("a2a-handoff"),
      edgeKindDash("a2a-task-lineage"),
      edgeKindDash("a2a-deliberation"),
    ]);
    expect(dashes.size).toBe(4);
    expect(edgeKindDash("a2a-delegation")).toBeUndefined();
  });

  it("scales stroke width with weight and thickens the selected edge", () => {
    expect(edgeStrokeWidth(1, false)).toBeCloseTo(1.6);
    expect(edgeStrokeWidth(100, false)).toBe(4); // clamped
    expect(edgeStrokeWidth(2, true)).toBe(3.2);
  });

  it("orders unique ids by their resolved label", () => {
    const labels: Record<string, string> = { a: "Zeta", b: "Alpha", c: "Mid" };
    expect(orderedUnique(["a", "b", "c", "a"], (id) => labels[id] ?? id)).toEqual(["b", "c", "a"]);
  });

  it("distributes column positions within the graph height", () => {
    const height = graphHeight(3);
    const positions = columnPositions(["x", "y", "z"], height);
    const ys = [positions.get("x")!, positions.get("y")!, positions.get("z")!];
    expect(ys[0]).toBeLessThan(ys[1]!);
    expect(ys[1]).toBeLessThan(ys[2]!);
    // Single-node column is centred within the usable band (between the top
    // and bottom padding), not the raw SVG mid-height.
    const solo = columnPositions(["only"], height);
    const bandCentre = (A2A_GRAPH_LAYOUT.topPad + (height - A2A_GRAPH_LAYOUT.bottomPad)) / 2;
    expect(solo.get("only")).toBeCloseTo(bandCentre, 0);
  });

  it("builds a cubic-bezier path between from and to nodes", () => {
    const d = edgePath({ x: 150, y: 100 }, { x: 610, y: 200 }, 0);
    expect(d.startsWith("M ")).toBe(true);
    expect(d).toContain("C ");
  });

  it("builds an existing build deep-link and surfaces routeless records as plain text", () => {
    const records = a2aEdgeSourceRecords(
      edge({
        buildId: "FB-9",
        refs: { delegationChainId: "del-1", taskRunId: "TR-1", deliberationRunId: "delib-1" },
      }),
    );
    const build = records.find((r) => r.label === "Build");
    expect(build?.href).toBe("/build?buildId=FB-9");

    // No fabricated routes for records without a page surface.
    expect(records.find((r) => r.label === "Delegation chain")?.href).toBeUndefined();
    expect(records.find((r) => r.label === "Task run")?.href).toBeUndefined();
    expect(records.find((r) => r.label === "Deliberation run")?.href).toBeUndefined();
    expect(records.find((r) => r.label === "Delegation chain")?.value).toBe("del-1");
  });

  it("returns no source records when an edge carries no refs or build", () => {
    expect(a2aEdgeSourceRecords(edge())).toEqual([]);
  });

  it("builds coworker detail hrefs", () => {
    expect(coworkerHref("brand-analyst")).toBe("/platform/ai/agent/brand-analyst");
    expect(coworkerHref("a/b")).toBe("/platform/ai/agent/a%2Fb");
  });

  it("shares the replay playhead with the provider timeline", () => {
    // span = 100 min → window = max(45min, 20%*100min=20min) = 45min.
    const range = { start: 0, current: 60 * 60 * 1000, end: 100 * 60 * 1000 };
    const at = (min: number) => new Date(min * 60 * 1000).toISOString();

    // Playhead at/after "current" → everything recent is visible.
    expect(a2aEdgeVisibleAtReplayTime(at(10), range.current, range)).toBe(true);
    expect(a2aEdgeVisibleAtReplayTime(at(90), range.current + 5, range)).toBe(true);

    // Scrubbed back to t=50min: an edge at 48min is within the 45min window and
    // has already occurred → visible; an edge at 55min hasn't occurred yet → hidden.
    const t50 = 50 * 60 * 1000;
    expect(a2aEdgeVisibleAtReplayTime(at(48), t50, range)).toBe(true);
    expect(a2aEdgeVisibleAtReplayTime(at(55), t50, range)).toBe(false);
    // An edge at 2min is older than the 45min look-back from t=50 → hidden.
    expect(a2aEdgeVisibleAtReplayTime(at(2), t50, range)).toBe(false);

    // Undated / unparseable interactions are always visible.
    expect(a2aEdgeVisibleAtReplayTime(null, t50, range)).toBe(true);
    expect(a2aEdgeVisibleAtReplayTime("not-a-date", t50, range)).toBe(true);
  });

  it("classifies governed (authority/sensitivity-bearing) interactions", () => {
    expect(a2aEdgeIsGoverned({ authorityScope: ["brand:read"] })).toBe(true);
    expect(a2aEdgeIsGoverned({ sensitivity: "confidential" })).toBe(true);
    expect(a2aEdgeIsGoverned({ authorityScope: [], sensitivity: "" })).toBe(false);
    expect(a2aEdgeIsGoverned({ authorityScope: [], sensitivity: "  " })).toBe(false);
    expect(a2aEdgeIsGoverned({})).toBe(false);
  });

  it("clips long labels and titleizes ids", () => {
    expect(svgClip("short", 22)).toBe("short");
    expect(svgClip("a-really-long-coworker-label", 10)).toHaveLength(10);
    expect(titleize("brand-analyst")).toBe("Brand Analyst");
  });
});
