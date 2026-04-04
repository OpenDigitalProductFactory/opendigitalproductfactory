import { Graph } from "dagre-d3-es/src/graphlib/index.js";
import { layout } from "dagre-d3-es/src/dagre/index.js";
import type { GraphData } from "@/lib/actions/graph";
import type { LayoutResult, PositionedNode } from "./types";

type HierarchicalOptions = {
  direction?: "TB" | "LR";
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
  rootIds?: string[];
};

export function computeHierarchicalLayout(
  data: GraphData,
  options: HierarchicalOptions = {},
): LayoutResult {
  const {
    direction = "TB",
    nodeWidth = 60,
    nodeHeight = 30,
    rankSep = 80,
    nodeSep = 40,
  } = options;

  if (data.nodes.length === 0) {
    return { nodes: [], links: [] };
  }

  const g = new Graph({ directed: true, compound: false, multigraph: false });
  g.setGraph({ rankdir: direction, ranksep: rankSep, nodesep: nodeSep });
  g.setDefaultEdgeLabel(() => ({}));

  const nodeIds = new Set(data.nodes.map((n) => n.id));

  for (const node of data.nodes) {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight, label: node.name });
  }

  for (const link of data.links) {
    if (nodeIds.has(link.source) && nodeIds.has(link.target)) {
      g.setEdge(link.source, link.target);
    }
  }

  layout(g, {});

  const nodes: PositionedNode[] = data.nodes.map((node) => {
    const gNode = g.node(node.id);
    return {
      ...node,
      x: gNode?.x ?? 0,
      y: gNode?.y ?? 0,
    };
  });

  return { nodes, links: data.links };
}
