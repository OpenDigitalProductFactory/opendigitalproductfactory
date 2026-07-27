// Pure control-filter helpers for the Operations Map.
//
// Single source of truth for "which routes / providers / markers / A2A edges
// survive the operator's filter selections". OperationsTopologyControls owns
// the one filter rail; AiOperationsMap applies the same criteria to the
// authoritative OperationsTopologyCanvas.
//
// Replay is intentionally NOT applied here. The shared replay window is layered
// on top by the canvas (routeVisibleAtReplayTime / a2aEdgeVisibleAtReplayTime)
// and by the panels, so control filtering and time scrubbing compose cleanly.

import type {
  OperationsMapRoutingTopology,
  OperationsMapRoutingRoute,
  OperationsMapRoutingProvider,
  OperationsMapRoutingMarker,
  OperationsMapRoutingRouteState,
  OperationsMapA2aEdge,
  OperationsMapA2aEdgeKind,
  OperationsMapA2aInteractionState,
} from "@/lib/ai-operations-map/types";
import { a2aEdgeIsGoverned } from "./a2a-interaction-graph";

export type RoutingRouteFilter = "all" | OperationsMapRoutingRouteState;
export type RoutingProviderTypeFilter = "llm" | "mcp" | "all";

/** Provider-side criteria owned by the unified topology control rail. */
export type RoutingControlCriteria = {
  routeFilter: RoutingRouteFilter;
  providerTypeFilter: RoutingProviderTypeFilter;
  /** A specific providerId, or "all". */
  providerFilter: string;
};

export type A2aActorRole = "either" | "from" | "to";
export type A2aAuthorityFilter = "all" | "governed" | "ungoverned";

/** A2A-side criteria owned by the unified topology control rail. */
export type A2aControlCriteria = {
  types: OperationsMapA2aEdgeKind[];
  states: OperationsMapA2aInteractionState[];
  /** A specific coworker id, or "all". */
  actorId: string;
  actorRole: A2aActorRole;
  authority: A2aAuthorityFilter;
};

export function providerMatchesTypeFilter(
  provider: OperationsMapRoutingProvider | undefined,
  filter: RoutingProviderTypeFilter,
): boolean {
  if (!provider) return false;
  return filter === "all" || provider.providerType === filter;
}

export function markerMatchesRouteFilter(
  marker: OperationsMapRoutingMarker,
  filter: RoutingRouteFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "scheduled") return marker.type === "scheduled";
  if (filter === "failover") return marker.type === "failover" || marker.type === "error";
  return false;
}

/**
 * Apply the provider-side control filters to a topology, returning the routes,
 * provider nodes, and markers that should be visible (before replay). Mirrors
 * the predicates used by the control rail's evidence table.
 */
export function applyRoutingControlFilters(
  topology: Pick<OperationsMapRoutingTopology, "routes" | "providers" | "markers">,
  criteria: RoutingControlCriteria,
): {
  routes: OperationsMapRoutingRoute[];
  providers: OperationsMapRoutingProvider[];
  markers: OperationsMapRoutingMarker[];
} {
  const { routeFilter, providerTypeFilter, providerFilter } = criteria;
  const providersById = new Map(topology.providers.map((provider) => [provider.providerId, provider]));

  const routes = topology.routes.filter((route) => {
    const routeMatches = routeFilter === "all" || route.state === routeFilter;
    const provider = providersById.get(route.providerId);
    const providerMatches = providerFilter === "all"
      ? providerMatchesTypeFilter(provider, providerTypeFilter)
      : route.providerId === providerFilter;
    return routeMatches && providerMatches;
  });

  const providers = topology.providers.filter((provider) => {
    if (!providerMatchesTypeFilter(provider, providerTypeFilter)) return false;
    return providerFilter === "all" || provider.providerId === providerFilter;
  });

  const survivingRouteIds = new Set(routes.map((route) => route.id));
  const markers = topology.markers.filter((marker) => {
    if (!markerMatchesRouteFilter(marker, routeFilter)) return false;
    if (marker.providerId) {
      if (providerFilter !== "all" && marker.providerId !== providerFilter) return false;
      if (!providerMatchesTypeFilter(providersById.get(marker.providerId), providerTypeFilter)) return false;
    }
    // Route-attached markers only survive if their route survived the filters.
    if (marker.routeId) return survivingRouteIds.has(marker.routeId);
    return true;
  });

  return { routes, providers, markers };
}

/**
 * Apply the A2A-side control filters to a set of edges (before replay).
 */
export function applyA2aControlFilters(
  edges: OperationsMapA2aEdge[],
  criteria: A2aControlCriteria,
): OperationsMapA2aEdge[] {
  const { types, states, actorId, actorRole, authority } = criteria;
  return edges.filter((edge) => {
    if (!types.includes(edge.edgeKind)) return false;
    if (!states.includes(edge.state)) return false;
    if (actorId !== "all") {
      const matchesFrom = edge.fromCoworkerId === actorId;
      const matchesTo = edge.toCoworkerId === actorId;
      if (actorRole === "from" && !matchesFrom) return false;
      if (actorRole === "to" && !matchesTo) return false;
      if (actorRole === "either" && !matchesFrom && !matchesTo) return false;
    }
    if (authority !== "all") {
      const governed = a2aEdgeIsGoverned(edge);
      if (authority === "governed" && !governed) return false;
      if (authority === "ungoverned" && governed) return false;
    }
    return true;
  });
}
