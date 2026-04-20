import type { GraphData } from "@/lib/actions/graph";
import type { ViewConfig } from "./types";

type FilterGraphOptions = {
  focusNodeId: string | null;
  maxHops: number;
  selectedView: ViewConfig["name"];
  subnetFilter: string;
  viewConfig: ViewConfig;
};

const subnetScopeCache = new WeakMap<GraphData, Map<string, GraphData>>();

export function filterBySubnet(graph: GraphData, subnetId: string): GraphData {
  const cachedBySubnet = subnetScopeCache.get(graph);
  const cached = cachedBySubnet?.get(subnetId);
  if (cached) {
    return cached;
  }

  const scopedIds = new Set<string>([subnetId]);
  for (const link of graph.links) {
    if (link.type === "MEMBER_OF" && link.target === subnetId) {
      scopedIds.add(link.source);
    }
  }

  for (const link of graph.links) {
    if (link.type === "MEMBER_OF") {
      continue;
    }

    if (link.source === subnetId || link.target === subnetId) {
      scopedIds.add(link.source);
      scopedIds.add(link.target);
    }
  }

  const nodes = graph.nodes.filter((node) => scopedIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = graph.links.filter(
    (link) => nodeIds.has(link.source) && nodeIds.has(link.target),
  );
  const next = { nodes, links };

  const nextCache = cachedBySubnet ?? new Map<string, GraphData>();
  nextCache.set(subnetId, next);
  if (!cachedBySubnet) {
    subnetScopeCache.set(graph, nextCache);
  }

  return next;
}

export const selectSubnetScope = filterBySubnet;

export function filterGraphData(
  data: GraphData,
  {
    focusNodeId,
    maxHops,
    selectedView,
    subnetFilter,
    viewConfig,
  }: FilterGraphOptions,
): GraphData {
  let nodes = data.nodes.filter((node) => viewConfig.nodeTypesShown.has(node.label));
  let links = data.links.filter((link) => viewConfig.edgesShown.has(link.type));

  if (selectedView === "subnet-topology" && subnetFilter !== "all") {
    const scoped = filterBySubnet({ nodes, links }, subnetFilter);
    nodes = scoped.nodes;
    links = scoped.links;
  }

  let nodeIds = new Set(nodes.map((node) => node.id));
  links = links.filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target));

  if (focusNodeId && maxHops > 0) {
    const visibleNodeIds = new Set<string>([focusNodeId]);
    const queue: Array<{ depth: number; id: string }> = [{ id: focusNodeId, depth: 0 }];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || current.depth >= maxHops) {
        continue;
      }

      for (const link of links) {
        const adjacentId =
          link.source === current.id
            ? link.target
            : link.target === current.id
              ? link.source
              : null;
        if (adjacentId && !visibleNodeIds.has(adjacentId)) {
          visibleNodeIds.add(adjacentId);
          queue.push({ id: adjacentId, depth: current.depth + 1 });
        }
      }
    }

    nodes = nodes.filter((node) => visibleNodeIds.has(node.id));
    nodeIds = new Set(nodes.map((node) => node.id));
    links = links.filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target));
  }

  return { nodes, links };
}

export function describeGraphScope(
  data: GraphData,
  selectedView: ViewConfig["name"],
  subnetFilter: string,
  availableSubnets: Array<{ id: string; name: string }>,
): string {
  const nodeCount = data.nodes.length;

  if (selectedView === "subnet-topology" && subnetFilter !== "all") {
    const activeSubnet = availableSubnets.find((subnet) => subnet.id === subnetFilter);
    const subnetName = activeSubnet?.name ?? subnetFilter;
    return `Viewing subnet ${subnetName} (${nodeCount} nodes)`;
  }

  return `Viewing full graph (${nodeCount} nodes)`;
}
