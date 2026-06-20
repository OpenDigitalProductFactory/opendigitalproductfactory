// Automatic layout for the EA views/viewpoints canvas (BI-D9F9B34F, EP-ARCH-GRAPH-LIVE).
//
// Reuses the render-agnostic layout engines in `lib/graph/` (dagre / ELK / radial-BFS)
// rather than introducing a new layout library. EA elements + relationships are adapted
// to `GraphData`, an engine is run, and the result is normalized to React Flow top-left
// coordinates keyed by EaViewElement id (the React Flow node id used by EaCanvas).
//
// All functions here are pure (the layered path is async only because ELK is) so they can
// be unit-tested without React Flow or the DB.

import type { GraphData } from "@/lib/actions/graph";
import { computeHierarchicalLayout } from "@/lib/graph/layout-hierarchical";
import { computeRadialLayout } from "@/lib/graph/layout-radial";
import { computeSwimLaneLayout } from "@/lib/graph/layout-swimlane";

export type EaLayoutAlgorithm = "layered" | "radial" | "hierarchical";

export type EaLayoutNode = { id: string };
export type EaLayoutEdge = { source: string; target: string };
export type EaPositions = Record<string, { x: number; y: number }>;

// Footprint of a standard EA element node (EaElementNode renders ~120–160px wide).
// The layout is spaced for this box so auto-laid views don't overlap.
export const EA_NODE_W = 170;
export const EA_NODE_H = 80;
const GAP = 70;
const PITCH_X = EA_NODE_W + GAP;
const PITCH_Y = EA_NODE_H + GAP;
const MARGIN = 40;

export const EA_LAYOUT_LABELS: Record<EaLayoutAlgorithm, string> = {
  layered: "Layered · fewest crossings",
  radial: "Radial · hub & spoke",
  hierarchical: "Hierarchical · top-down",
};

export const EA_LAYOUT_ALGORITHMS: EaLayoutAlgorithm[] = ["layered", "radial", "hierarchical"];

function toGraphData(nodes: EaLayoutNode[], edges: EaLayoutEdge[]): GraphData {
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes: nodes.map((n) => ({ id: n.id, name: n.id, label: n.id, color: "#000", size: 1 })),
    links: edges
      .filter((e) => e.source !== e.target && ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, type: "rel" })),
  };
}

function buildAdjacency(nodes: EaLayoutNode[], edges: EaLayoutEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (adj.has(e.source)) adj.get(e.source)!.push(e.target);
    if (adj.has(e.target)) adj.get(e.target)!.push(e.source);
  }
  return adj;
}

/** Most-connected node — the natural center for a radial layout. */
function highestDegreeId(nodes: EaLayoutNode[], edges: EaLayoutEdge[]): string {
  const adj = buildAdjacency(nodes, edges);
  let best = nodes[0]?.id ?? "";
  let bestDegree = -1;
  for (const n of nodes) {
    const degree = (adj.get(n.id) ?? []).length;
    if (degree > bestDegree) {
      bestDegree = degree;
      best = n.id;
    }
  }
  return best;
}

/**
 * Ring spacing wide enough that the densest ring's nodes don't overlap angularly.
 * `computeRadialLayout` hard-codes 60×30 node sizing, so we size the rings here for the
 * larger EA node footprint instead of editing the shared graph helper.
 */
function radialRingSpacing(nodes: EaLayoutNode[], edges: EaLayoutEdge[], rootId: string): number {
  const adj = buildAdjacency(nodes, edges);
  const depth = new Map<string, number>([[rootId, 0]]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depth.get(current)!;
    for (const neighbor of adj.get(current) ?? []) {
      if (!depth.has(neighbor)) {
        depth.set(neighbor, currentDepth + 1);
        queue.push(neighbor);
      }
    }
  }
  const ringCount = new Map<number, number>();
  for (const d of depth.values()) {
    if (d >= 1) ringCount.set(d, (ringCount.get(d) ?? 0) + 1);
  }
  const maxRing = ringCount.size > 0 ? Math.max(...ringCount.values()) : 1;
  // Arc length per node on the innermost ring (radius = ringSpacing) must be >= PITCH_X.
  const needed = Math.ceil((PITCH_X * maxRing) / (2 * Math.PI));
  return Math.max(220, needed);
}

function fromResult(
  result: { nodes: Array<{ id: string; x: number; y: number }> },
  centerBased: boolean,
): EaPositions {
  const out: EaPositions = {};
  for (const n of result.nodes) {
    out[n.id] = centerBased
      ? { x: n.x - EA_NODE_W / 2, y: n.y - EA_NODE_H / 2 }
      : { x: n.x, y: n.y };
  }
  return out;
}

/** Shift the whole layout so its top-left corner sits at (MARGIN, MARGIN). */
function normalize(positions: EaPositions): EaPositions {
  const values = Object.values(positions);
  if (values.length === 0) return positions;
  const minX = Math.min(...values.map((p) => p.x));
  const minY = Math.min(...values.map((p) => p.y));
  const out: EaPositions = {};
  for (const [id, p] of Object.entries(positions)) {
    out[id] = { x: p.x - minX + MARGIN, y: p.y - minY + MARGIN };
  }
  return out;
}

/**
 * Compute an automatic layout for the given EA nodes + edges.
 * Returns React Flow top-left positions keyed by node id (EaViewElement id).
 */
export async function computeEaLayout(
  nodes: EaLayoutNode[],
  edges: EaLayoutEdge[],
  opts: { algorithm: EaLayoutAlgorithm; direction?: "TB" | "LR" },
): Promise<EaPositions> {
  if (nodes.length === 0) return {};
  if (nodes.length === 1) return { [nodes[0]!.id]: { x: MARGIN, y: MARGIN } };

  const graphData = toGraphData(nodes, edges);

  if (opts.algorithm === "hierarchical") {
    const result = computeHierarchicalLayout(graphData, {
      direction: opts.direction ?? "TB",
      nodeWidth: EA_NODE_W,
      nodeHeight: EA_NODE_H,
      rankSep: PITCH_Y,
      nodeSep: GAP,
    });
    return normalize(fromResult(result, true));
  }

  if (opts.algorithm === "radial") {
    const rootId = highestDegreeId(nodes, edges);
    const result = computeRadialLayout(graphData, {
      rootId,
      ringSpacing: radialRingSpacing(nodes, edges, rootId),
      centerX: 0,
      centerY: 0,
    });
    return normalize(fromResult(result, true));
  }

  // Default: ELK "layered" with no partitions — strongest edge-crossing minimization.
  const result = await computeSwimLaneLayout(graphData, () => null, {
    nodeWidth: EA_NODE_W,
    nodeHeight: EA_NODE_H,
    layerSpacing: PITCH_Y,
    nodeSpacing: GAP,
  });
  return normalize(fromResult(result, false)); // ELK reports top-left already
}

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < EA_NODE_W && Math.abs(a.y - b.y) < EA_NODE_H;
}

/** Nudge a candidate position outward on an expanding ring until it clears all placed nodes. */
function resolveCollision(pos: { x: number; y: number }, placed: EaPositions): { x: number; y: number } {
  const others = Object.values(placed);
  const collides = (p: { x: number; y: number }) => others.some((o) => overlaps(p, o));
  if (!collides(pos)) return pos;
  const step = Math.max(PITCH_X, PITCH_Y) * 0.6;
  for (let ring = 1; ring <= 12; ring += 1) {
    const radius = ring * step;
    const steps = 8 * ring;
    for (let i = 0; i < steps; i += 1) {
      const angle = (2 * Math.PI * i) / steps;
      const candidate = { x: pos.x + radius * Math.cos(angle), y: pos.y + radius * Math.sin(angle) };
      if (!collides(candidate)) return candidate;
    }
  }
  return pos; // give up — accept overlap rather than loop forever
}

/**
 * Place newly-added nodes into an existing layout with minimal disruption.
 * A new node lands at the centroid of its already-placed neighbors (then nudged to avoid
 * overlap); a node with no placed neighbors parks just past the layout's right edge.
 * Existing positions are never moved. Returns positions for `newIds` only.
 */
export function placeIncremental(
  existing: EaPositions,
  edges: EaLayoutEdge[],
  newIds: string[],
): EaPositions {
  const placed: EaPositions = { ...existing };
  const result: EaPositions = {};

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)!.push(e.target);
    adj.get(e.target)!.push(e.source);
  }

  const existingValues = Object.values(existing);
  const bbox = existingValues.length
    ? {
        maxX: Math.max(...existingValues.map((p) => p.x)),
        minY: Math.min(...existingValues.map((p) => p.y)),
      }
    : { maxX: 0, minY: MARGIN };

  let parked = 0;
  for (const id of newIds) {
    if (placed[id]) {
      result[id] = placed[id]!;
      continue;
    }
    const neighbors = (adj.get(id) ?? []).filter((nid) => placed[nid]);
    let target: { x: number; y: number };
    if (neighbors.length > 0) {
      const cx = neighbors.reduce((sum, n) => sum + placed[n]!.x, 0) / neighbors.length;
      const cy = neighbors.reduce((sum, n) => sum + placed[n]!.y, 0) / neighbors.length;
      target = resolveCollision({ x: cx, y: cy }, placed);
    } else {
      target = resolveCollision({ x: bbox.maxX + PITCH_X, y: bbox.minY + parked * PITCH_Y }, placed);
      parked += 1;
    }
    placed[id] = target;
    result[id] = target;
  }
  return result;
}
