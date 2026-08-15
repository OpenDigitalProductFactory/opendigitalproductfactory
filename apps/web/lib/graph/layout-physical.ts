import type { GraphData } from "@/lib/actions/graph";
import type { LayoutResult, PositionedNode } from "./types";
import { getPhysicalDisplayRank } from "./physical-topology";

const CLIENT_COLUMNS = 5;
const CLIENT_COLUMN_GAP = 100;
const CLIENT_ROW_GAP = 65;
const GROUP_GAP = 80;
const RANK_GAP = 110;
const TOP = 60;

function displayRank(ciType: string | null | undefined) {
  return getPhysicalDisplayRank(ciType) ?? 2;
}

/**
 * Compact top-down layout for the physical network projection.
 *
 * Dagre puts every client on one rank-wide row, which makes a normal site
 * thousands of pixels wide. This layout keeps the infrastructure spine in
 * hierarchy order and wraps leaf clients beneath the AP/switch that observed
 * them. It changes display coordinates only; canonical relationship direction
 * remains owned by the inventory read model.
 */
export function computePhysicalTopologyLayout(data: GraphData): LayoutResult {
  if (data.nodes.length === 0) return { nodes: [], links: [] };

  const nodeIds = new Set(data.nodes.map((node) => node.id));
  const children = new Map<string, string[]>();
  const parentByChild = new Map<string, string>();
  for (const link of data.links) {
    if (!nodeIds.has(link.source) || !nodeIds.has(link.target)) continue;
    const next = children.get(link.source) ?? [];
    next.push(link.target);
    children.set(link.source, next);
    if (!parentByChild.has(link.target)) parentByChild.set(link.target, link.source);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const clientGroups = new Map<string, GraphData["nodes"]>();
  for (const node of data.nodes) {
    if (displayRank(node.ciType) !== 4) continue;
    const parentId = parentByChild.get(node.id) ?? `unattached:${node.id}`;
    const group = clientGroups.get(parentId) ?? [];
    group.push(node);
    clientGroups.set(parentId, group);
  }

  let cursorX = 0;
  for (const [parentId, clients] of clientGroups) {
    const columns = Math.min(CLIENT_COLUMNS, clients.length);
    const groupWidth = Math.max(CLIENT_COLUMN_GAP, columns * CLIENT_COLUMN_GAP);
    for (const [index, client] of clients.entries()) {
      positions.set(client.id, {
        x: cursorX + (index % CLIENT_COLUMNS + 0.5) * CLIENT_COLUMN_GAP,
        y: TOP + 4 * RANK_GAP + Math.floor(index / CLIENT_COLUMNS) * CLIENT_ROW_GAP,
      });
    }
    if (parentId.startsWith("unattached:")) {
      cursorX += groupWidth + GROUP_GAP;
    } else {
      positions.set(parentId, {
        x: cursorX + groupWidth / 2,
        y: TOP + 3 * RANK_GAP,
      });
      cursorX += groupWidth + GROUP_GAP;
    }
  }

  let fallbackX = Math.max(CLIENT_COLUMN_GAP / 2, cursorX);
  for (const rank of [3, 2, 1, 0]) {
    for (const node of data.nodes.filter((candidate) => displayRank(candidate.ciType) === rank)) {
      const childPositions = (children.get(node.id) ?? [])
        .map((id) => positions.get(id))
        .filter((position): position is { x: number; y: number } => Boolean(position));
      const existing = positions.get(node.id);
      const x = childPositions.length > 0
        ? childPositions.reduce((total, position) => total + position.x, 0) / childPositions.length
        : existing?.x ?? fallbackX;
      positions.set(node.id, { x, y: TOP + rank * RANK_GAP });
      if (childPositions.length === 0 && !existing) fallbackX += 150;
    }
  }

  const nodes: PositionedNode[] = data.nodes.map((node) => ({
    ...node,
    ...(positions.get(node.id) ?? { x: fallbackX, y: TOP + displayRank(node.ciType) * RANK_GAP }),
  }));
  return { nodes, links: data.links };
}
