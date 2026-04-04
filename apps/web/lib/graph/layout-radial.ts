import type { GraphData } from "@/lib/actions/graph";
import type { LayoutResult, PositionedNode } from "./types";

type RadialOptions = {
  rootId: string;
  ringSpacing?: number;
  centerX?: number;
  centerY?: number;
};

export function computeRadialLayout(
  data: GraphData,
  options: RadialOptions,
): LayoutResult {
  const { rootId, ringSpacing = 120, centerX = 400, centerY = 300 } = options;

  if (data.nodes.length === 0) {
    return { nodes: [], links: [] };
  }

  // Build bidirectional adjacency list
  const adjacency = new Map<string, string[]>();
  for (const node of data.nodes) {
    adjacency.set(node.id, []);
  }
  for (const link of data.links) {
    adjacency.get(link.source)?.push(link.target);
    adjacency.get(link.target)?.push(link.source);
  }

  // BFS from root to assign depth
  const depth = new Map<string, number>();
  const queue: string[] = [rootId];
  depth.set(rootId, 0);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depth.get(current)!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!depth.has(neighbor)) {
        depth.set(neighbor, currentDepth + 1);
        queue.push(neighbor);
      }
    }
  }

  // Group nodes by ring (depth)
  const rings = new Map<number, string[]>();
  for (const [nodeId, d] of depth) {
    if (!rings.has(d)) rings.set(d, []);
    rings.get(d)!.push(nodeId);
  }

  // Position: root at center, each ring at increasing radius
  const positionMap = new Map<string, { x: number; y: number }>();
  positionMap.set(rootId, { x: centerX, y: centerY });

  for (const [ring, nodeIds] of rings) {
    if (ring === 0) continue;
    const radius = ring * ringSpacing;
    nodeIds.forEach((nodeId, i) => {
      const angle = (2 * Math.PI * i) / nodeIds.length - Math.PI / 2;
      positionMap.set(nodeId, {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      });
    });
  }

  // Nodes not reachable from root get placed at the edge
  const nodes: PositionedNode[] = data.nodes.map((node) => {
    const pos = positionMap.get(node.id) ?? {
      x: centerX + (Math.random() - 0.5) * 100,
      y: centerY + (Math.random() - 0.5) * 100,
    };
    return { ...node, ...pos };
  });

  return { nodes, links: data.links };
}
