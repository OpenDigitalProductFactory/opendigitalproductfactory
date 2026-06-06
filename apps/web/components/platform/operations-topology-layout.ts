// Pure layout model for the cohesive three-band AI Operations Map.
//
// One coworker spine in the center; A2A interactions arc to the left, provider
// routes fan to the right. This module is React/DOM-free so row ordering, y
// positions, arc/route lanes, and density warnings are deterministic and unit
// testable before any SVG markup moves (Stage A). The unified canvas (Stage B+)
// consumes this; it is NOT a new source of truth — it is a layout projection of
// the existing `routingTopology`.
//
// Spec: docs/superpowers/specs/2026-06-05-ai-operations-map-three-band-cohesive-layout-design.md §7 Stage A

import type {
  OperationsMapA2aEdge,
  OperationsMapA2aEdgeKind,
  OperationsMapA2aInteractionState,
  OperationsMapRoutingCoworker,
  OperationsMapRoutingMarker,
  OperationsMapRoutingProvider,
  OperationsMapRoutingRoute,
  OperationsMapRoutingRouteState,
  OperationsMapRoutingTimelineMarker,
} from "@/lib/ai-operations-map/types";

export type TopologyViewport = "desktop" | "mobile";

export type OperationsTopologyLayoutInput = {
  /** All known coworkers (provides labels); rows are the participating subset. */
  coworkers: OperationsMapRoutingCoworker[];
  /** Visible providers (already filtered by the caller). */
  providers: OperationsMapRoutingProvider[];
  /** Visible provider routes (already filtered). */
  routes: OperationsMapRoutingRoute[];
  /** Visible A2A edges (already filtered). */
  a2aEdges: OperationsMapA2aEdge[];
  /** Visible markers (already filtered). */
  markers?: OperationsMapRoutingMarker[];
  /** The operator-selected coworker row, if any. */
  selectedCoworkerId?: string | null;
  viewport?: TopologyViewport;
};

export type CoworkerSpineRow = {
  coworkerId: string;
  label: string;
  index: number;
  y: number;
  hasProviderRoute: boolean;
  hasA2aEdge: boolean;
  /** Has a live "active" route or A2A edge. */
  active: boolean;
  /** Has a failover route or a failed/blocked A2A edge — operator attention. */
  attention: boolean;
  selected: boolean;
};

export type TopologyProviderNode = {
  providerId: string;
  label: string;
  index: number;
  y: number;
};

export type A2aArcLayout = {
  edgeId: string;
  edgeKind: OperationsMapA2aEdgeKind;
  state: OperationsMapA2aInteractionState;
  fromCoworkerId: string;
  toCoworkerId: string;
  fromY: number;
  toY: number;
  /** Lane index for left-bulge separation; wider for longer vertical spans. */
  lane: number;
};

export type ProviderRouteLaneLayout = {
  routeId: string;
  coworkerId: string;
  providerId: string;
  state: OperationsMapRoutingRouteState;
  fromY: number;
  providerY: number;
  /** Bend lane for right-side route separation. */
  lane: number;
};

export type TopologyTimelineAnchor = {
  id: string;
  /** 0–100 position across the timeline window. */
  position: number;
  markerType: OperationsMapRoutingTimelineMarker["markerType"];
};

export type TopologyDensityWarning = {
  region: "rows" | "a2a" | "routes";
  count: number;
  threshold: number;
};

export type OperationsTopologyLayout = {
  rows: CoworkerSpineRow[];
  providerNodes: TopologyProviderNode[];
  a2aArcs: A2aArcLayout[];
  routeLanes: ProviderRouteLaneLayout[];
  height: number;
  rowGap: number;
  density: TopologyDensityWarning[];
};

export const TOPOLOGY_LAYOUT_CONSTANTS = {
  topPad: 40,
  bottomPad: 28,
  rowGapDesktop: 56,
  rowGapMobile: 40,
  minRowGap: 36,
  maxArcLane: 4,
  rowDensityThreshold: 24,
  a2aDensityThreshold: 40,
  routeDensityThreshold: 40,
} as const;

// ─── Public composition ────────────────────────────────────────────────

export function buildOperationsTopologyLayout(input: OperationsTopologyLayoutInput): OperationsTopologyLayout {
  const rows = buildCoworkerSpine(input);
  const rowYById = new Map(rows.map((row) => [row.coworkerId, row.y]));
  const rowIndexById = new Map(rows.map((row) => [row.coworkerId, row.index]));
  const rowGap = resolveRowGap(input.viewport);
  const height = TOPOLOGY_LAYOUT_CONSTANTS.topPad + TOPOLOGY_LAYOUT_CONSTANTS.bottomPad + Math.max(rows.length, 1) * rowGap;

  const providerNodes = layoutProviderRoutes(input, height).providerNodes;
  const providerYById = new Map(providerNodes.map((node) => [node.providerId, node.y]));

  const a2aArcs = layoutA2aEdges(input.a2aEdges, rowYById, rowIndexById);
  const routeLanes = layoutProviderRouteLanes(input.routes, rowYById, providerYById);

  const density = measureTopologyDensity({ rowCount: rows.length, a2aCount: a2aArcs.length, routeCount: routeLanes.length });

  return { rows, providerNodes, a2aArcs, routeLanes, height, rowGap, density };
}

// ─── Coworker spine ─────────────────────────────────────────────────────

export function buildCoworkerSpine(input: OperationsTopologyLayoutInput): CoworkerSpineRow[] {
  const labelById = new Map(input.coworkers.map((coworker) => [coworker.agentId, coworker.label]));
  const selectedId = normalize(input.selectedCoworkerId ?? "");

  type Acc = { hasProviderRoute: boolean; hasA2aEdge: boolean; active: boolean; attention: boolean };
  const acc = new Map<string, Acc>();
  const ensure = (id: string): Acc | null => {
    const norm = normalize(id);
    if (!norm) return null;
    let entry = acc.get(norm);
    if (!entry) {
      entry = { hasProviderRoute: false, hasA2aEdge: false, active: false, attention: false };
      acc.set(norm, entry);
    }
    return entry;
  };

  for (const route of input.routes) {
    const entry = ensure(route.coworkerId);
    if (!entry) continue;
    entry.hasProviderRoute = true;
    if (route.state === "active") entry.active = true;
    if (route.state === "failover") entry.attention = true;
  }
  for (const edge of input.a2aEdges) {
    for (const id of [edge.fromCoworkerId, edge.toCoworkerId]) {
      const entry = ensure(id);
      if (!entry) continue;
      entry.hasA2aEdge = true;
      if (edge.state === "active") entry.active = true;
      if (edge.state === "failed" || edge.state === "blocked") entry.attention = true;
    }
  }
  // The selected coworker always gets a row even with no visible edges.
  if (selectedId) ensure(selectedId);

  const rowGap = resolveRowGap(input.viewport);
  const ordered = [...acc.entries()]
    .map(([coworkerId, flags]) => ({
      coworkerId,
      label: labelById.get(coworkerId) ?? titleize(coworkerId),
      ...flags,
      selected: coworkerId === selectedId,
    }))
    // Stable order: selected first, then alphabetical by label. Activity flags
    // are row metadata for emphasis, NOT sort keys — so a filter that removes an
    // edge (but keeps the coworker in the set) never reorders the spine.
    .sort((left, right) => {
      if (left.selected !== right.selected) return left.selected ? -1 : 1;
      return left.label.localeCompare(right.label);
    });

  return ordered.map((row, index) => ({
    coworkerId: row.coworkerId,
    label: row.label,
    index,
    y: TOPOLOGY_LAYOUT_CONSTANTS.topPad + index * rowGap,
    hasProviderRoute: row.hasProviderRoute,
    hasA2aEdge: row.hasA2aEdge,
    active: row.active,
    attention: row.attention,
    selected: row.selected,
  }));
}

// ─── Provider nodes ─────────────────────────────────────────────────────

export function layoutProviderRoutes(
  input: OperationsTopologyLayoutInput,
  height: number,
): { providerNodes: TopologyProviderNode[] } {
  const providers = [...input.providers].sort((left, right) => left.label.localeCompare(right.label));
  const top = TOPOLOGY_LAYOUT_CONSTANTS.topPad;
  const bottom = height - TOPOLOGY_LAYOUT_CONSTANTS.bottomPad;
  const count = Math.max(providers.length, 1);
  const providerNodes = providers.map((provider, index) => ({
    providerId: provider.providerId,
    label: provider.label,
    index,
    y: count === 1 ? (top + bottom) / 2 : top + ((bottom - top) * index) / (count - 1),
  }));
  return { providerNodes };
}

// ─── A2A arcs (left) ────────────────────────────────────────────────────

export function layoutA2aEdges(
  a2aEdges: OperationsMapA2aEdge[],
  rowYById: Map<string, number>,
  rowIndexById: Map<string, number>,
): A2aArcLayout[] {
  const arcs: A2aArcLayout[] = [];
  for (const edge of a2aEdges) {
    const fromY = rowYById.get(normalize(edge.fromCoworkerId));
    const toY = rowYById.get(normalize(edge.toCoworkerId));
    if (fromY === undefined || toY === undefined) continue; // endpoint not on the spine
    const fromIndex = rowIndexById.get(normalize(edge.fromCoworkerId)) ?? 0;
    const toIndex = rowIndexById.get(normalize(edge.toCoworkerId)) ?? 0;
    const span = Math.abs(fromIndex - toIndex);
    arcs.push({
      edgeId: edge.id,
      edgeKind: edge.edgeKind,
      state: edge.state,
      fromCoworkerId: edge.fromCoworkerId,
      toCoworkerId: edge.toCoworkerId,
      fromY,
      toY,
      // Adjacent rows bulge least; farther rows get a wider lane (capped).
      lane: Math.min(Math.max(span - 1, 0), TOPOLOGY_LAYOUT_CONSTANTS.maxArcLane),
    });
  }
  return arcs;
}

// ─── Provider route lanes (right) ───────────────────────────────────────

function layoutProviderRouteLanes(
  routes: OperationsMapRoutingRoute[],
  rowYById: Map<string, number>,
  providerYById: Map<string, number>,
): ProviderRouteLaneLayout[] {
  const lanes: ProviderRouteLaneLayout[] = [];
  // Bend lane per provider so multiple routes into one provider separate.
  const perProviderCount = new Map<string, number>();
  for (const route of routes) {
    const fromY = rowYById.get(normalize(route.coworkerId));
    const providerY = providerYById.get(route.providerId);
    if (fromY === undefined || providerY === undefined) continue;
    const lane = perProviderCount.get(route.providerId) ?? 0;
    perProviderCount.set(route.providerId, lane + 1);
    lanes.push({
      routeId: route.id,
      coworkerId: route.coworkerId,
      providerId: route.providerId,
      state: route.state,
      fromY,
      providerY,
      lane,
    });
  }
  return lanes;
}

// ─── Timeline anchors ───────────────────────────────────────────────────

export function layoutTopologyTimeline(
  timeline: OperationsMapRoutingTimelineMarker[],
  range: { start: number; end: number },
): TopologyTimelineAnchor[] {
  const span = Math.max(1, range.end - range.start);
  return timeline
    .map((marker) => {
      const ts = Date.parse(marker.occurredAt);
      if (!Number.isFinite(ts)) return null;
      const position = Math.min(100, Math.max(0, ((ts - range.start) / span) * 100));
      return { id: marker.id, position, markerType: marker.markerType };
    })
    .filter((anchor): anchor is TopologyTimelineAnchor => anchor !== null);
}

// ─── Density ────────────────────────────────────────────────────────────

export function measureTopologyDensity(counts: {
  rowCount: number;
  a2aCount: number;
  routeCount: number;
}): TopologyDensityWarning[] {
  const warnings: TopologyDensityWarning[] = [];
  if (counts.rowCount > TOPOLOGY_LAYOUT_CONSTANTS.rowDensityThreshold) {
    warnings.push({ region: "rows", count: counts.rowCount, threshold: TOPOLOGY_LAYOUT_CONSTANTS.rowDensityThreshold });
  }
  if (counts.a2aCount > TOPOLOGY_LAYOUT_CONSTANTS.a2aDensityThreshold) {
    warnings.push({ region: "a2a", count: counts.a2aCount, threshold: TOPOLOGY_LAYOUT_CONSTANTS.a2aDensityThreshold });
  }
  if (counts.routeCount > TOPOLOGY_LAYOUT_CONSTANTS.routeDensityThreshold) {
    warnings.push({ region: "routes", count: counts.routeCount, threshold: TOPOLOGY_LAYOUT_CONSTANTS.routeDensityThreshold });
  }
  return warnings;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function resolveRowGap(viewport: TopologyViewport | undefined): number {
  const gap = viewport === "mobile" ? TOPOLOGY_LAYOUT_CONSTANTS.rowGapMobile : TOPOLOGY_LAYOUT_CONSTANTS.rowGapDesktop;
  return Math.max(gap, TOPOLOGY_LAYOUT_CONSTANTS.minRowGap);
}

function normalize(id: string): string {
  return id.trim();
}

function titleize(value: string): string {
  return (
    value
      .split(/[-_:.\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Unknown"
  );
}
