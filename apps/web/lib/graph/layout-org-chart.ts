// Top-down hierarchical layout for the People > Org Chart canvas (BI-HCM-004).
//
// Sits beside `layout-hierarchical.ts` / `layout-swimlane.ts` and reuses the same dagre
// dependency rather than adding a layout library. It is a separate entry point because
// `computeHierarchicalLayout` is bound to `GraphData` (a network/CI shape carrying
// color/size/osiLayer), which does not describe a workforce.
//
// Pure and React-free so the layout is unit-testable without React Flow.

import dagre from "dagre";
import type { OrgEdge } from "@/lib/workforce/org-chart-model";

/** Footprint of an OrgChartNode card. Kept here so layout and render agree on one number. */
export const ORG_NODE_W = 220;
export const ORG_NODE_H = 92;

export type OrgLayoutOptions = {
  nodeWidth?: number;
  nodeHeight?: number;
  /** Vertical gap between management layers. */
  rankSep?: number;
  /** Horizontal gap between peers. */
  nodeSep?: number;
};

export type OrgPosition = { x: number; y: number };

/**
 * Position every employee for a top-down chart.
 *
 * Only solid-line edges drive the layout — dotted lines are advisory relationships and
 * letting them influence ranking pulls people out of their real management layer. They are
 * still drawn, just not ranked.
 *
 * Returns top-left coordinates (React Flow's origin), not dagre's centre points.
 */
export function computeOrgChartLayout(
  employeeIds: string[],
  edges: OrgEdge[],
  options: OrgLayoutOptions = {},
): Record<string, OrgPosition> {
  const {
    nodeWidth = ORG_NODE_W,
    nodeHeight = ORG_NODE_H,
    rankSep = 90,
    nodeSep = 40,
  } = options;

  if (employeeIds.length === 0) return {};

  const g = new dagre.graphlib.Graph({ directed: true, compound: false, multigraph: false });
  g.setGraph({ rankdir: "TB", ranksep: rankSep, nodesep: nodeSep });
  g.setDefaultEdgeLabel(() => ({}));

  const known = new Set(employeeIds);
  for (const id of employeeIds) {
    g.setNode(id, { width: nodeWidth, height: nodeHeight });
  }
  for (const edge of edges) {
    if (edge.kind !== "line") continue;
    if (!known.has(edge.source) || !known.has(edge.target)) continue;
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positions: Record<string, OrgPosition> = {};
  for (const id of employeeIds) {
    const node = g.node(id);
    positions[id] = {
      x: (node?.x ?? 0) - nodeWidth / 2,
      y: (node?.y ?? 0) - nodeHeight / 2,
    };
  }
  return positions;
}
