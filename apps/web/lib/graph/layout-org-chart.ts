// Top-down hierarchical layout for the People > Org Chart canvas (BI-HCM-004).
//
// Sits beside `layout-hierarchical.ts` / `layout-swimlane.ts` and uses the same ELK `layered`
// runner (`elk-runner.ts`) rather than a second layout library. It is a separate entry point
// because `computeHierarchicalLayout` is bound to `GraphData` (a network/CI shape carrying
// color/size/osiLayer), which does not describe a workforce.
//
// Pure and React-free so the layout is unit-testable without React Flow. Async because ELK is.

import type { OrgEdge } from "@/lib/workforce/org-chart-model";
import { computeLayeredPositions } from "./elk-runner";

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
 * Returns top-left coordinates (React Flow's origin); the chart's bounding box starts at 0,0.
 */
export async function computeOrgChartLayout(
  employeeIds: string[],
  edges: OrgEdge[],
  options: OrgLayoutOptions = {},
): Promise<Record<string, OrgPosition>> {
  const {
    nodeWidth = ORG_NODE_W,
    nodeHeight = ORG_NODE_H,
    rankSep = 90,
    nodeSep = 40,
  } = options;

  if (employeeIds.length === 0) return {};

  const laid = await computeLayeredPositions(
    employeeIds.map((id) => ({ id, width: nodeWidth, height: nodeHeight })),
    edges.filter((edge) => edge.kind === "line"),
    { direction: "TB", rankSep, nodeSep },
  );

  const positions: Record<string, OrgPosition> = {};
  for (const id of employeeIds) {
    positions[id] = laid.get(id) ?? { x: 0, y: 0 };
  }
  return positions;
}
