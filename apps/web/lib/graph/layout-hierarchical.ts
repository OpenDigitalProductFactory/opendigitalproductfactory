import type { GraphData } from "@/lib/actions/graph";
import { computeLayeredPositions } from "./elk-runner";
import type { LayoutResult, PositionedNode } from "./types";

type HierarchicalOptions = {
  direction?: "TB" | "LR";
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
  rootIds?: string[];
};

/**
 * Ranked (Sugiyama) layout for the topology views, on ELK `layered`.
 *
 * Returns node CENTRE points, which is what the canvas renderer draws around. ELK reports
 * top-left corners, so each position is shifted by half the node footprint.
 */
export async function computeHierarchicalLayout(
  data: GraphData,
  options: HierarchicalOptions = {},
): Promise<LayoutResult> {
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

  const positions = await computeLayeredPositions(
    data.nodes.map((node) => ({ id: node.id, width: nodeWidth, height: nodeHeight })),
    data.links,
    { direction, rankSep, nodeSep },
  );

  const nodes: PositionedNode[] = data.nodes.map((node) => {
    const topLeft = positions.get(node.id) ?? { x: 0, y: 0 };
    return {
      ...node,
      x: topLeft.x + nodeWidth / 2,
      y: topLeft.y + nodeHeight / 2,
    };
  });

  return { nodes, links: data.links };
}
