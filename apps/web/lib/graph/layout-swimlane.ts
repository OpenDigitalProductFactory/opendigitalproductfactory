import type { GraphData } from "@/lib/actions/graph";
import type { LayoutResult, PositionedNode } from "./types";

export type PartitionFn = (nodeId: string) => number | string | null;

/**
 * Swimlane layout using ELK.js with partitioning.
 * Supports OSI layer partitioning (numeric) and subnet partitioning (string).
 * Falls back to simple band layout if ELK is unavailable.
 */
export async function computeSwimLaneLayout(
  data: GraphData,
  getPartition: PartitionFn,
  options?: { partitionLabels?: Map<string | number, string> },
): Promise<LayoutResult> {
  if (data.nodes.length === 0) {
    return { nodes: [], links: [] };
  }

  // Build partition index map for ELK (needs integer partition keys)
  const partitionKeys = new Set<string | number>();
  for (const node of data.nodes) {
    const p = getPartition(node.id);
    if (p != null) partitionKeys.add(p);
  }
  const sortedPartitions = [...partitionKeys].sort((a, b) => {
    // Numeric partitions: higher OSI layer first (L7 at top)
    if (typeof a === "number" && typeof b === "number") return b - a;
    // String partitions: physical first (non-172), then Docker (172)
    const aStr = String(a);
    const bStr = String(b);
    const aIsDocker = aStr.startsWith("172.");
    const bIsDocker = bStr.startsWith("172.");
    if (aIsDocker !== bIsDocker) return aIsDocker ? 1 : -1;
    return aStr.localeCompare(bStr);
  });
  const partitionIndex = new Map<string | number, number>();
  sortedPartitions.forEach((key, idx) => partitionIndex.set(key, idx));

  try {
    const ELK = (await import("elkjs/lib/elk.bundled.js")).default;
    const elk = new ELK();

    const nodeIds = new Set(data.nodes.map((n) => n.id));

    const children = data.nodes.map((node) => {
      const partition = getPartition(node.id);
      const idx = partition != null ? partitionIndex.get(partition) : undefined;
      return {
        id: node.id,
        width: 60,
        height: 30,
        ...(idx != null
          ? { layoutOptions: { "elk.partitioning.partition": String(idx) } }
          : {}),
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
      const partition = getPartition(node.id);
      return {
        ...node,
        ...pos,
        osiLayer: typeof partition === "number" ? partition : null,
        partition: partition ?? undefined,
      } as PositionedNode;
    });

    return { nodes, links: data.links };
  } catch {
    return computeFallbackBandLayout(data, getPartition);
  }
}

/** Simple fallback: group nodes into horizontal bands by partition. */
function computeFallbackBandLayout(
  data: GraphData,
  getPartition: PartitionFn,
): LayoutResult {
  const bandHeight = 100;
  const nodeSpacing = 80;

  const byPartition = new Map<string | number, typeof data.nodes>();
  const noPartition: typeof data.nodes = [];

  for (const node of data.nodes) {
    const p = getPartition(node.id);
    if (p != null) {
      if (!byPartition.has(p)) byPartition.set(p, []);
      byPartition.get(p)!.push(node);
    } else {
      noPartition.push(node);
    }
  }

  const nodes: PositionedNode[] = [];
  const sortedKeys = [...byPartition.keys()].sort((a, b) => {
    if (typeof a === "number" && typeof b === "number") return b - a;
    return String(a).localeCompare(String(b));
  });

  for (let bandIdx = 0; bandIdx < sortedKeys.length; bandIdx++) {
    const key = sortedKeys[bandIdx]!;
    const bandNodes = byPartition.get(key)!;
    const y = 40 + bandIdx * bandHeight;

    for (let i = 0; i < bandNodes.length; i++) {
      nodes.push({
        ...bandNodes[i],
        x: 60 + i * nodeSpacing,
        y,
        osiLayer: typeof key === "number" ? key : null,
      });
    }
  }

  const bottomY = 40 + sortedKeys.length * bandHeight;
  for (let i = 0; i < noPartition.length; i++) {
    nodes.push({
      ...noPartition[i],
      x: 60 + i * nodeSpacing,
      y: bottomY,
      osiLayer: null,
    });
  }

  return { nodes, links: data.links };
}
