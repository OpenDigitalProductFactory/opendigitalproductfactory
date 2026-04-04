import type { GraphData } from "@/lib/actions/graph";
import type { LayoutResult, PositionedNode } from "./types";

/**
 * Swimlane layout using ELK.js with OSI layer partitioning.
 * L7 (application) at the top, L1 (physical) at the bottom.
 * Falls back to simple band layout if ELK is unavailable.
 */
export async function computeSwimLaneLayout(
  data: GraphData,
  getOsiLayer: (nodeId: string) => number | null,
): Promise<LayoutResult> {
  if (data.nodes.length === 0) {
    return { nodes: [], links: [] };
  }

  try {
    // Dynamic import — elkjs is ~400KB, only load when needed
    const ELK = (await import("elkjs/lib/elk.bundled.js")).default;
    const elk = new ELK();

    const nodeIds = new Set(data.nodes.map((n) => n.id));

    const children = data.nodes.map((node) => {
      const layer = getOsiLayer(node.id);
      return {
        id: node.id,
        width: 60,
        height: 30,
        layoutOptions: layer != null
          ? { "elk.partitioning.partition": String(7 - layer) }
          : {},
      };
    });

    const edges = data.links
      .filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target))
      .map((link, i) => ({
        id: `e${i}`,
        sources: [link.source],
        targets: [link.target],
      }));

    const graph = await elk.layout({
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.partitioning.activate": "true",
        "elk.layered.spacing.nodeNodeBetweenLayers": "80",
        "elk.spacing.nodeNode": "30",
      },
      children,
      edges,
    });

    const posMap = new Map<string, { x: number; y: number }>();
    for (const child of graph.children ?? []) {
      posMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
    }

    const nodes: PositionedNode[] = data.nodes.map((node) => {
      const pos = posMap.get(node.id) ?? { x: 0, y: 0 };
      return { ...node, ...pos, osiLayer: getOsiLayer(node.id) };
    });

    return { nodes, links: data.links };
  } catch {
    // Fallback: simple band layout without ELK
    return computeFallbackBandLayout(data, getOsiLayer);
  }
}

/** Simple fallback: group nodes into horizontal bands by OSI layer. */
function computeFallbackBandLayout(
  data: GraphData,
  getOsiLayer: (nodeId: string) => number | null,
): LayoutResult {
  const bandHeight = 100;
  const nodeSpacing = 80;

  // Group by layer
  const byLayer = new Map<number, typeof data.nodes>();
  const noLayer: typeof data.nodes = [];

  for (const node of data.nodes) {
    const layer = getOsiLayer(node.id);
    if (layer != null) {
      if (!byLayer.has(layer)) byLayer.set(layer, []);
      byLayer.get(layer)!.push(node);
    } else {
      noLayer.push(node);
    }
  }

  const nodes: PositionedNode[] = [];

  // Sort layers descending (L7 at top)
  const sortedLayers = [...byLayer.keys()].sort((a, b) => b - a);

  for (let bandIdx = 0; bandIdx < sortedLayers.length; bandIdx++) {
    const layer = sortedLayers[bandIdx]!;
    const layerNodes = byLayer.get(layer)!;
    const y = 40 + bandIdx * bandHeight;

    for (let i = 0; i < layerNodes.length; i++) {
      nodes.push({
        ...layerNodes[i],
        x: 60 + i * nodeSpacing,
        y,
        osiLayer: layer,
      });
    }
  }

  // Place unassigned nodes at the bottom
  const bottomY = 40 + sortedLayers.length * bandHeight;
  for (let i = 0; i < noLayer.length; i++) {
    nodes.push({
      ...noLayer[i],
      x: 60 + i * nodeSpacing,
      y: bottomY,
      osiLayer: null,
    });
  }

  return { nodes, links: data.links };
}
