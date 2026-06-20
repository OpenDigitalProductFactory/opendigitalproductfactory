// Automatic layout for the EA views/viewpoints canvas (BI-D9F9B34F, BI-20F95B0E; EP-ARCH-GRAPH-LIVE).
//
// EA views are SysML/ArchiMate graphs: mostly containment trees/forests (Package⊃Part⊃Port)
// stored as flat "contains" edges, plus cross-cutting association/flow edges. Many large views
// are trees (e.g. ~615-node route trees) or dependency meshes with disconnected islands.
//
// We reuse ELK (already a dependency) directly — calling the right algorithm for the graph's
// shape and ALWAYS separating connected components so disconnected nodes pack tightly instead
// of sprawling. "radial" stays a hand-rolled BFS (good hub-and-spoke). No new layout library.
//
// All functions are pure (ELK paths are async only because ELK is) and unit-testable without
// React Flow or the DB.

import type { GraphData } from "@/lib/actions/graph";
import { computeRadialLayout } from "@/lib/graph/layout-radial";

// "auto" inspects the graph shape and dispatches to the best concrete algorithm.
export type EaLayoutAlgorithm = "auto" | "organic" | "tree" | "layered" | "radial";
export type ConcreteLayoutAlgorithm = Exclude<EaLayoutAlgorithm, "auto">;

export type EaLayoutNode = { id: string };
export type EaLayoutEdge = { source: string; target: string };
export type EaPositions = Record<string, { x: number; y: number }>;

// Footprint of a standard EA element node (EaElementNode renders ~120–160px wide).
export const EA_NODE_W = 170;
export const EA_NODE_H = 80;
const GAP = 60;
const PITCH_X = EA_NODE_W + GAP;
const PITCH_Y = EA_NODE_H + GAP;
const MARGIN = 40;

export const EA_LAYOUT_ALGORITHMS: EaLayoutAlgorithm[] = ["auto", "organic", "tree", "layered", "radial"];

export const EA_LAYOUT_LABELS: Record<EaLayoutAlgorithm, string> = {
  auto: "Auto · best fit",
  organic: "Organic · clustered",
  tree: "Tree · hierarchy",
  layered: "Layered · directed flow",
  radial: "Radial · hub & spoke",
};

// Shared ELK options: separate + pack disconnected components (the de-sprawl fix), and keep
// the packed result roughly 16:10 rather than a long strip.
const ELK_SHARED: Record<string, string> = {
  "elk.separateConnectedComponents": "true",
  "elk.spacing.componentComponent": "60",
  "elk.aspectRatio": "1.6",
};

function elkOptionsFor(algo: "organic" | "tree" | "layered"): Record<string, string> {
  if (algo === "organic") {
    // ELK stress majorization — the clustered, force-directed "organic" look. iterationLimit
    // is capped (ELK's default is effectively unbounded) so big views stay responsive.
    return {
      ...ELK_SHARED,
      "elk.algorithm": "stress",
      "elk.stress.desiredEdgeLength": String(PITCH_X),
      "elk.stress.iterationLimit": "200",
      "elk.spacing.nodeNode": String(GAP),
    };
  }
  if (algo === "tree") {
    // ELK mrtree (Walker's tree layout) — compact, legible trees/forests.
    return {
      ...ELK_SHARED,
      "elk.algorithm": "mrtree",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": String(GAP),
    };
  }
  // layered — Sugiyama; best for directed flow/DAGs. thoroughness lowered from the default 7
  // so 600-node views lay out quickly.
  return {
    ...ELK_SHARED,
    "elk.algorithm": "layered",
    "elk.direction": "DOWN",
    "elk.layered.spacing.nodeNodeBetweenLayers": String(PITCH_Y),
    "elk.spacing.nodeNode": String(GAP),
    "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    "elk.layered.thoroughness": "4",
    "elk.edgeRouting": "ORTHOGONAL",
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

export type GraphMetrics = {
  n: number;
  m: number; // unique undirected edges
  components: number;
  isForest: boolean; // no cycle → tree/forest
  maxDegree: number;
  density: number; // m / n
  isolated: number; // degree-0 nodes
};

// Single pass: union-find for components + cycle detection, plus degree stats.
export function computeMetrics(nodes: EaLayoutNode[], edges: EaLayoutEdge[]): GraphMetrics {
  const index = new Map<string, number>();
  nodes.forEach((node, i) => index.set(node.id, i));
  const parent = nodes.map((_, i) => i);
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[x] !== root) {
      const next = parent[x]!;
      parent[x] = root;
      x = next;
    }
    return root;
  };

  const degree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const seen = new Set<string>();
  let m = 0;
  let hasCycle = false;
  for (const e of edges) {
    if (e.source === e.target) continue;
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a === undefined || b === undefined) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) continue; // dedupe parallel edges
    seen.add(key);
    m += 1;
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) hasCycle = true;
    else parent[ra] = rb;
  }

  const roots = new Set<number>();
  for (let i = 0; i < nodes.length; i += 1) roots.add(find(i));
  let maxDegree = 0;
  let isolated = 0;
  for (const d of degree.values()) {
    if (d > maxDegree) maxDegree = d;
    if (d === 0) isolated += 1;
  }
  const n = nodes.length;
  return { n, m, components: roots.size, isForest: !hasCycle, maxDegree, density: n ? m / n : 0, isolated };
}

/**
 * Pick the best concrete algorithm from the graph's shape:
 * - tree/forest → mrtree (or radial when one node dominates, i.e. a star)
 * - dense / many isolated / many components → stress (organic)
 * - otherwise → layered (directed flow)
 */
export function pickAutoAlgorithm(nodes: EaLayoutNode[], edges: EaLayoutEdge[]): ConcreteLayoutAlgorithm {
  if (nodes.length <= 2) return "layered";
  const x = computeMetrics(nodes, edges);
  if (x.isForest) {
    return x.maxDegree / x.n > 0.5 ? "radial" : "tree";
  }
  if (x.density > 1.5 || x.isolated > x.n * 0.2 || x.components > Math.max(3, x.n * 0.15)) {
    return "organic";
  }
  return "layered";
}

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

// Ring spacing wide enough that the densest ring's nodes don't overlap angularly
// (computeRadialLayout hard-codes 60×30 sizing, so we size rings for the EA footprint here).
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
  const needed = Math.ceil((PITCH_X * maxRing) / (2 * Math.PI));
  return Math.max(220, needed);
}

function toGraphData(nodes: EaLayoutNode[], edges: EaLayoutEdge[]): GraphData {
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes: nodes.map((n) => ({ id: n.id, name: n.id, label: n.id, color: "#000", size: 1 })),
    links: edges
      .filter((e) => e.source !== e.target && ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, type: "rel" })),
  };
}

function fromCenter(result: { nodes: Array<{ id: string; x: number; y: number }> }): EaPositions {
  const out: EaPositions = {};
  for (const n of result.nodes) out[n.id] = { x: n.x - EA_NODE_W / 2, y: n.y - EA_NODE_H / 2 };
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

async function runElk(
  nodes: EaLayoutNode[],
  edges: EaLayoutEdge[],
  algo: "organic" | "tree" | "layered",
): Promise<EaPositions> {
  const ELK = (await import("elkjs/lib/elk.bundled.js")).default;
  const elk = new ELK();
  const ids = new Set(nodes.map((n) => n.id));
  const children = nodes.map((n) => ({ id: n.id, width: EA_NODE_W, height: EA_NODE_H }));
  const elkEdges = edges
    .filter((e) => e.source !== e.target && ids.has(e.source) && ids.has(e.target))
    .map((e, i) => ({ id: `e${i}`, sources: [e.source], targets: [e.target] }));

  const graph = await elk.layout({
    id: "root",
    layoutOptions: elkOptionsFor(algo),
    children,
    edges: elkEdges,
  });

  const out: EaPositions = {};
  for (const child of graph.children ?? []) {
    out[child.id] = { x: child.x ?? 0, y: child.y ?? 0 }; // ELK reports top-left
  }
  // Defensive: ensure every node got a position.
  let parked = 0;
  for (const n of nodes) {
    if (!out[n.id]) {
      out[n.id] = { x: parked * PITCH_X, y: -PITCH_Y };
      parked += 1;
    }
  }
  return normalize(out);
}

/**
 * Compute an automatic layout for the given EA nodes + edges.
 * Returns React Flow top-left positions keyed by node id (EaViewElement id).
 */
export async function computeEaLayout(
  nodes: EaLayoutNode[],
  edges: EaLayoutEdge[],
  opts: { algorithm: EaLayoutAlgorithm },
): Promise<EaPositions> {
  if (nodes.length === 0) return {};
  if (nodes.length === 1) return { [nodes[0]!.id]: { x: MARGIN, y: MARGIN } };

  const algo: ConcreteLayoutAlgorithm =
    opts.algorithm === "auto" ? pickAutoAlgorithm(nodes, edges) : opts.algorithm;

  if (algo === "radial") {
    const rootId = highestDegreeId(nodes, edges);
    const result = computeRadialLayout(toGraphData(nodes, edges), {
      rootId,
      ringSpacing: radialRingSpacing(nodes, edges, rootId),
      centerX: 0,
      centerY: 0,
    });
    return normalize(fromCenter(result));
  }

  return runElk(nodes, edges, algo); // organic | tree | layered
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
