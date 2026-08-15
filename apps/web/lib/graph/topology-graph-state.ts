import type { GraphData } from "@/lib/actions/graph";
import { hasSubnetScopeNode } from "./scope-helpers";
import { projectPhysicalTopology } from "./physical-topology";
import { filterBySubnet, filterGraphData } from "./subnet-scope";
import { VIEW_CONFIGS } from "./view-config";
import type { GraphViewName } from "./types";

export function createScopeToken(
  sequence: number,
  selectedView: GraphViewName,
  activeSubnetId: string | null,
) {
  return `${selectedView}:${activeSubnetId ?? "all"}:${sequence}`;
}

export function resolveSubnetScopeState(
  graph: GraphData,
  selectedView: GraphViewName,
  activeSubnetId: string | null,
): { graphData: GraphData; activeSubnetId: string | null; invalidScope: boolean } {
  if (selectedView !== "subnet-topology" || !activeSubnetId) {
    return { graphData: graph, activeSubnetId: null, invalidScope: false };
  }
  if (!hasSubnetScopeNode(graph, activeSubnetId)) {
    return { graphData: graph, activeSubnetId: null, invalidScope: true };
  }
  return {
    graphData: filterBySubnet(graph, activeSubnetId),
    activeSubnetId,
    invalidScope: false,
  };
}

export function resolveDisplayedGraphData(
  graph: GraphData,
  selectedView: GraphViewName,
  activeSubnetId: string | null,
  focusNodeId: string | null,
  maxHops: number,
  hideDocker = false,
) {
  const viewConfig = VIEW_CONFIGS[selectedView];
  const projectedGraph = selectedView === "network-topology"
    ? projectPhysicalTopology(graph).data
    : graph;
  const scopeState = resolveSubnetScopeState(projectedGraph, selectedView, activeSubnetId);
  return filterGraphData(scopeState.graphData, {
    focusNodeId,
    maxHops,
    selectedView,
    subnetFilter: "all",
    viewConfig,
    hideDocker,
  });
}

export function isResetScopeKey(key: string) {
  return key === "Enter" || key === " ";
}

export const isSubnetSelectorKey = isResetScopeKey;

export function shouldShowViewportReset(
  selectedView: GraphViewName,
  hasViewportInteraction: boolean,
  zoom: number,
  pan: { x: number; y: number },
) {
  if (selectedView === "network-topology") return hasViewportInteraction;
  return zoom !== 1 || pan.x !== 0 || pan.y !== 0;
}
