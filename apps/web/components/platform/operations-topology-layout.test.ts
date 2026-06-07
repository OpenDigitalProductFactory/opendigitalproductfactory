import { describe, expect, it } from "vitest";
import {
  buildCoworkerSpine,
  buildOperationsTopologyLayout,
  layoutA2aEdges,
  layoutTopologyTimeline,
  measureTopologyDensity,
  TOPOLOGY_LAYOUT_CONSTANTS,
  type OperationsTopologyLayoutInput,
} from "./operations-topology-layout";
import { buildOperationsMapTopologyFixture } from "@/test-support/operations-map-fixture";
import type { OperationsMapA2aEdge, OperationsMapRoutingRoute } from "@/lib/ai-operations-map/types";

function inputFromFixture(overrides: Partial<OperationsTopologyLayoutInput> = {}): OperationsTopologyLayoutInput {
  const t = buildOperationsMapTopologyFixture();
  return {
    coworkers: t.coworkers,
    providers: t.providers,
    routes: t.routes,
    a2aEdges: t.a2aEdges,
    markers: t.markers,
    ...overrides,
  };
}

describe("operations topology layout — coworker spine", () => {
  it("builds one row per participating coworker in stable alphabetical order", () => {
    const rows = buildCoworkerSpine(inputFromFixture());
    expect(rows.map((r) => r.coworkerId)).toEqual(["brand-analyst", "build-specialist", "ceo-coworker"]);
    expect(rows.map((r) => r.label)).toEqual(["Brand Analyst", "Build Specialist", "CEO Coworker"]);
    // Deterministic y positions: topPad + index * rowGap (desktop).
    const gap = TOPOLOGY_LAYOUT_CONSTANTS.rowGapDesktop;
    expect(rows.map((r) => r.y)).toEqual([
      TOPOLOGY_LAYOUT_CONSTANTS.topPad,
      TOPOLOGY_LAYOUT_CONSTANTS.topPad + gap,
      TOPOLOGY_LAYOUT_CONSTANTS.topPad + 2 * gap,
    ]);
  });

  it("floats the selected coworker to the top without reordering the rest", () => {
    const rows = buildCoworkerSpine(inputFromFixture({ selectedCoworkerId: "ceo-coworker" }));
    expect(rows[0].coworkerId).toBe("ceo-coworker");
    expect(rows[0].selected).toBe(true);
    expect(rows.slice(1).map((r) => r.coworkerId)).toEqual(["brand-analyst", "build-specialist"]);
  });

  it("preserves provider topology labels and marks provider-only vs A2A-only coworkers", () => {
    const input = inputFromFixture({
      // brand-analyst: A2A only (no route). zeta-provider-only: route only, no A2A.
      routes: [
        { id: "r1", coworkerId: "zeta-provider-only", providerId: "anthropic", state: "active", label: "x", summary: "", occurredAt: null, decisionId: null, trafficWeight: 1, markerIds: [] },
      ],
      a2aEdges: [
        { id: "e1", edgeKind: "a2a-delegation", fromCoworkerId: "ceo-coworker", toCoworkerId: "brand-analyst", state: "active", label: "d", summary: "", occurredAt: null, refs: {}, weight: 1 },
      ],
      coworkers: [
        { agentId: "ceo-coworker", label: "CEO Coworker", stationLabel: null },
        { agentId: "brand-analyst", label: "Brand Analyst", stationLabel: null },
        // zeta has no coworkers entry → label falls back to titleized id.
      ],
    });
    const rows = buildCoworkerSpine(input);
    const byId = new Map(rows.map((r) => [r.coworkerId, r]));
    expect(byId.get("zeta-provider-only")?.hasProviderRoute).toBe(true);
    expect(byId.get("zeta-provider-only")?.hasA2aEdge).toBe(false);
    expect(byId.get("zeta-provider-only")?.label).toBe("Zeta Provider Only"); // titleized fallback
    expect(byId.get("brand-analyst")?.hasA2aEdge).toBe(true);
    expect(byId.get("brand-analyst")?.hasProviderRoute).toBe(false);
    expect(byId.get("brand-analyst")?.label).toBe("Brand Analyst"); // preserved label
  });

  it("dedupes a coworker that appears in both provider routes and A2A edges into one row", () => {
    const rows = buildCoworkerSpine(inputFromFixture());
    const ceo = rows.filter((r) => r.coworkerId === "ceo-coworker");
    expect(ceo).toHaveLength(1);
    expect(ceo[0].hasProviderRoute).toBe(true);
    expect(ceo[0].hasA2aEdge).toBe(true);
  });

  it("does not reorder rows when a filter removes an edge but keeps the coworker in the set", () => {
    const full = buildCoworkerSpine(inputFromFixture());
    // Drop the failed lineage edge (ceo→build); both endpoints still have other edges.
    const t = buildOperationsMapTopologyFixture();
    const filtered = buildCoworkerSpine(
      inputFromFixture({ a2aEdges: t.a2aEdges.filter((e) => e.id !== "a2a:lineage:1") }),
    );
    expect(filtered.map((r) => r.coworkerId)).toEqual(full.map((r) => r.coworkerId));
  });

  it("tightens the row gap on mobile", () => {
    const rows = buildCoworkerSpine(inputFromFixture({ viewport: "mobile" }));
    expect(rows[1].y - rows[0].y).toBe(TOPOLOGY_LAYOUT_CONSTANTS.rowGapMobile);
  });
});

describe("operations topology layout — composition", () => {
  it("composes spine + provider nodes + arcs + route lanes deterministically", () => {
    const layout = buildOperationsTopologyLayout(inputFromFixture());
    expect(layout.rows).toHaveLength(3);
    // Providers sorted by label, distributed across the usable height.
    expect(layout.providerNodes.map((p) => p.providerId)).toEqual(["anthropic", "openai"]);
    expect(layout.providerNodes[0].y).toBeLessThan(layout.providerNodes[1].y);
    // One arc per fixture A2A edge; one route lane per fixture route.
    expect(layout.a2aArcs).toHaveLength(3);
    expect(layout.routeLanes).toHaveLength(4);
    expect(layout.density).toEqual([]);
  });

  it("anchors A2A arcs to the from/to row y positions", () => {
    const input = inputFromFixture();
    const rows = buildCoworkerSpine(input);
    const yById = new Map(rows.map((r) => [r.coworkerId, r.y]));
    const idxById = new Map(rows.map((r) => [r.coworkerId, r.index]));
    const arcs = layoutA2aEdges(input.a2aEdges, yById, idxById);
    const delegation = arcs.find((a) => a.edgeId === "a2a:delegation:1")!;
    expect(delegation.fromY).toBe(yById.get("ceo-coworker"));
    expect(delegation.toY).toBe(yById.get("brand-analyst"));
    expect(delegation.lane).toBeGreaterThanOrEqual(0);
  });

  it("drops an arc whose endpoint is not on the spine", () => {
    const input = inputFromFixture();
    const rows = buildCoworkerSpine(input);
    const yById = new Map(rows.map((r) => [r.coworkerId, r.y]));
    const idxById = new Map(rows.map((r) => [r.coworkerId, r.index]));
    const orphan: OperationsMapA2aEdge = {
      id: "orphan", edgeKind: "a2a-delegation", fromCoworkerId: "ceo-coworker", toCoworkerId: "ghost", state: "active",
      label: "x", summary: "", occurredAt: null, refs: {}, weight: 1,
    };
    expect(layoutA2aEdges([orphan], yById, idxById)).toEqual([]);
  });

  it("separates multiple routes into the same provider onto distinct bend lanes", () => {
    const routes: OperationsMapRoutingRoute[] = [
      { id: "ra", coworkerId: "ceo-coworker", providerId: "anthropic", state: "active", label: "", summary: "", occurredAt: null, decisionId: null, trafficWeight: 1, markerIds: [] },
      { id: "rb", coworkerId: "brand-analyst", providerId: "anthropic", state: "secondary", label: "", summary: "", occurredAt: null, decisionId: null, trafficWeight: 1, markerIds: [] },
    ];
    const layout = buildOperationsTopologyLayout(inputFromFixture({ routes, a2aEdges: [] }));
    const anthropicLanes = layout.routeLanes.filter((l) => l.providerId === "anthropic").map((l) => l.lane).sort();
    expect(anthropicLanes).toEqual([0, 1]);
  });
});

describe("operations topology layout — density + timeline", () => {
  it("warns on high row / arc density", () => {
    const coworkers = Array.from({ length: 30 }, (_, i) => ({ agentId: `cw-${i}`, label: `Coworker ${i}`, stationLabel: null }));
    const a2aEdges: OperationsMapA2aEdge[] = Array.from({ length: 45 }, (_, i) => ({
      id: `e-${i}`, edgeKind: "a2a-delegation", fromCoworkerId: `cw-${i % 30}`, toCoworkerId: `cw-${(i + 1) % 30}`,
      state: "active", label: "", summary: "", occurredAt: null, refs: {}, weight: 1,
    }));
    const layout = buildOperationsTopologyLayout({ coworkers, providers: [], routes: [], a2aEdges });
    expect(layout.density.find((d) => d.region === "rows")?.count).toBe(30);
    expect(layout.density.find((d) => d.region === "a2a")?.count).toBe(45);
  });

  it("measureTopologyDensity is a pure threshold check", () => {
    expect(measureTopologyDensity({ rowCount: 1, a2aCount: 1, routeCount: 1 })).toEqual([]);
    expect(measureTopologyDensity({ rowCount: 100, a2aCount: 0, routeCount: 0 })).toEqual([
      { region: "rows", count: 100, threshold: TOPOLOGY_LAYOUT_CONSTANTS.rowDensityThreshold },
    ]);
  });

  it("maps timeline markers to 0–100 anchor positions", () => {
    const anchors = layoutTopologyTimeline(buildOperationsMapTopologyFixture().timeline, {
      start: Date.parse("2026-06-05T10:00:00.000Z"),
      end: Date.parse("2026-06-05T10:15:00.000Z"),
    });
    expect(anchors[0].position).toBeCloseTo(0, 0);
    expect(anchors[anchors.length - 1].position).toBeCloseTo(100, 0);
    anchors.forEach((a) => expect(a.position).toBeGreaterThanOrEqual(0));
  });
});
