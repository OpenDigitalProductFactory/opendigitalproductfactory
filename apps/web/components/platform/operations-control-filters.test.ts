import { describe, expect, it } from "vitest";
import {
  applyRoutingControlFilters,
  applyA2aControlFilters,
  providerMatchesTypeFilter,
  markerMatchesRouteFilter,
  type A2aControlCriteria,
  type RoutingControlCriteria,
} from "./operations-control-filters";
import { buildOperationsMapTopologyFixture } from "@/test-support/operations-map-fixture";
import type {
  OperationsMapA2aEdgeKind,
  OperationsMapA2aInteractionState,
} from "@/lib/ai-operations-map/types";

const ALL_TYPES: OperationsMapA2aEdgeKind[] = [
  "a2a-delegation",
  "a2a-handoff",
  "a2a-task-lineage",
  "a2a-deliberation",
];
const ALL_STATES: OperationsMapA2aInteractionState[] = ["active", "completed", "failed", "blocked"];

const routing = (overrides: Partial<RoutingControlCriteria> = {}): RoutingControlCriteria => ({
  routeFilter: "all",
  providerTypeFilter: "all",
  providerFilter: "all",
  ...overrides,
});
const a2a = (overrides: Partial<A2aControlCriteria> = {}): A2aControlCriteria => ({
  types: ALL_TYPES,
  states: ALL_STATES,
  actorId: "all",
  actorRole: "either",
  authority: "all",
  ...overrides,
});

describe("applyRoutingControlFilters", () => {
  const topology = buildOperationsMapTopologyFixture();

  it("passes everything through with the default (all) criteria", () => {
    const result = applyRoutingControlFilters(topology, routing());
    expect(result.routes).toHaveLength(4);
    expect(result.providers).toHaveLength(2);
    expect(result.markers).toHaveLength(3);
  });

  it("filters routes by state (active)", () => {
    const result = applyRoutingControlFilters(topology, routing({ routeFilter: "active" }));
    expect(result.routes.map((r) => r.id)).toEqual(["route:active"]);
    // markerMatchesRouteFilter only recognises all/scheduled/failover, so an
    // "active" route filter hides every marker — matching panel behaviour.
    expect(result.markers).toHaveLength(0);
  });

  it("keeps error/failover markers (and their route) under the failover filter", () => {
    const result = applyRoutingControlFilters(topology, routing({ routeFilter: "failover" }));
    expect(result.routes.map((r) => r.id)).toEqual(["route:failover"]);
    expect(result.markers.map((m) => m.id)).toEqual(["marker:d2:error"]);
  });

  it("filters by provider type — mcp removes all-LLM topology", () => {
    const result = applyRoutingControlFilters(topology, routing({ providerTypeFilter: "mcp" }));
    expect(result.routes).toHaveLength(0);
    expect(result.providers).toHaveLength(0);
    expect(result.markers).toHaveLength(0);
  });

  it("filters by a specific provider, dropping other providers' routes and markers", () => {
    const result = applyRoutingControlFilters(topology, routing({ providerFilter: "openai" }));
    expect(result.routes.map((r) => r.id).sort()).toEqual(["route:failover", "route:historical"]);
    expect(result.providers.map((p) => p.providerId)).toEqual(["openai"]);
    // Only the openai-attributed marker survives; anthropic markers drop.
    expect(result.markers.map((m) => m.id)).toEqual(["marker:d2:error"]);
  });

  it("drops a route-attached marker when its route is filtered out", () => {
    // providerFilter anthropic keeps route:active (+ its marker:d1:decision)
    // and route:scheduled; route:failover (openai) is gone so marker:d2:error drops.
    const result = applyRoutingControlFilters(topology, routing({ providerFilter: "anthropic" }));
    expect(result.routes.map((r) => r.id).sort()).toEqual(["route:active", "route:scheduled"]);
    expect(result.markers.map((m) => m.id).sort()).toEqual(["marker:d1:decision", "marker:unattributed"]);
  });
});

describe("applyA2aControlFilters", () => {
  const { a2aEdges } = buildOperationsMapTopologyFixture();

  it("passes every edge with default (all) criteria", () => {
    expect(applyA2aControlFilters(a2aEdges, a2a())).toHaveLength(3);
  });

  it("filters by edge kind", () => {
    const result = applyA2aControlFilters(a2aEdges, a2a({ types: ["a2a-delegation"] }));
    expect(result.map((e) => e.id)).toEqual(["a2a:delegation:1"]);
  });

  it("filters by interaction state", () => {
    const result = applyA2aControlFilters(a2aEdges, a2a({ states: ["completed"] }));
    expect(result.map((e) => e.id)).toEqual(["a2a:handoff:1"]);
  });

  it("filters by actor with role 'to'", () => {
    const result = applyA2aControlFilters(a2aEdges, a2a({ actorId: "brand-analyst", actorRole: "to" }));
    expect(result.map((e) => e.id).sort()).toEqual(["a2a:delegation:1", "a2a:handoff:1"]);
  });

  it("filters by actor with role 'from' (none originate from brand-analyst)", () => {
    const result = applyA2aControlFilters(a2aEdges, a2a({ actorId: "brand-analyst", actorRole: "from" }));
    expect(result).toHaveLength(0);
  });

  it("partitions cleanly by authority (governed ∪ ungoverned === all)", () => {
    const governed = applyA2aControlFilters(a2aEdges, a2a({ authority: "governed" }));
    const ungoverned = applyA2aControlFilters(a2aEdges, a2a({ authority: "ungoverned" }));
    expect(governed.length + ungoverned.length).toBe(a2aEdges.length);
    const ids = new Set([...governed, ...ungoverned].map((e) => e.id));
    expect(ids.size).toBe(a2aEdges.length);
  });
});

describe("shared predicates", () => {
  const { providers, markers } = buildOperationsMapTopologyFixture();

  it("providerMatchesTypeFilter", () => {
    expect(providerMatchesTypeFilter(providers[0], "all")).toBe(true);
    expect(providerMatchesTypeFilter(providers[0], "llm")).toBe(true);
    expect(providerMatchesTypeFilter(providers[0], "mcp")).toBe(false);
    expect(providerMatchesTypeFilter(undefined, "all")).toBe(false);
  });

  it("markerMatchesRouteFilter", () => {
    const decision = markers.find((m) => m.type === "decision")!;
    const error = markers.find((m) => m.type === "error")!;
    expect(markerMatchesRouteFilter(decision, "all")).toBe(true);
    expect(markerMatchesRouteFilter(decision, "failover")).toBe(false);
    expect(markerMatchesRouteFilter(error, "failover")).toBe(true);
    expect(markerMatchesRouteFilter(decision, "scheduled")).toBe(false);
  });
});
