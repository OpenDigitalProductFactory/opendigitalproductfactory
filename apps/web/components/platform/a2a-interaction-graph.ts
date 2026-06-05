// Pure helpers for the AI Operations Map coworker-to-coworker (A2A)
// interaction graph. Kept free of React and DOM so the layout math, edge
// styling, state→intent mapping, and source-record link building are unit
// testable in the default `node` vitest environment.
//
// State colour semantics flow through report-kit `statusColors`
// (`a2aInteraction` domain) — there is intentionally no local colour map here.

import { resolveIntent, type Intent } from "@/components/ui/report-kit/statusColors";
import type {
  OperationsMapA2aEdge,
  OperationsMapA2aEdgeKind,
  OperationsMapA2aInteractionState,
} from "@/lib/ai-operations-map/types";

export const A2A_EDGE_KINDS: OperationsMapA2aEdgeKind[] = [
  "a2a-delegation",
  "a2a-handoff",
  "a2a-task-lineage",
  "a2a-deliberation",
];

export const A2A_STATES: OperationsMapA2aInteractionState[] = [
  "active",
  "completed",
  "failed",
  "blocked",
];

export const EDGE_KIND_LABEL: Record<OperationsMapA2aEdgeKind, string> = {
  "a2a-delegation": "Delegation",
  "a2a-handoff": "Phase handoff",
  "a2a-task-lineage": "Task lineage",
  "a2a-deliberation": "Deliberation",
};

export const STATE_LABEL: Record<OperationsMapA2aInteractionState, string> = {
  active: "Active",
  completed: "Completed",
  failed: "Failed",
  blocked: "Blocked",
};

export const A2A_GRAPH_LAYOUT = {
  width: 760,
  rowHeight: 56,
  topPad: 40,
  bottomPad: 28,
  fromX: 150,
  toX: 610,
  nodeRadius: 7,
};

/** Resolve an A2A interaction state to a report-kit semantic intent. */
export function a2aStateIntent(state: OperationsMapA2aInteractionState): Intent {
  return resolveIntent("a2aInteraction", state);
}

/** Dash pattern per edge kind — the non-colour channel so kinds stay distinct. */
export function edgeKindDash(kind: OperationsMapA2aEdgeKind): string | undefined {
  switch (kind) {
    case "a2a-delegation":
      return undefined; // solid
    case "a2a-handoff":
      return "10 4";
    case "a2a-task-lineage":
      return "3 6";
    case "a2a-deliberation":
      return "1 6";
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** Stroke width grows with edge weight (chain depth / token budget bucket). */
export function edgeStrokeWidth(weight: number, selected: boolean): number {
  if (selected) return 3.2;
  return Math.min(4, 1.2 + weight * 0.4);
}

export function orderedUnique(ids: string[], labelFor: (id: string) => string): string[] {
  return [...new Set(ids)].sort((left, right) => labelFor(left).localeCompare(labelFor(right)));
}

/** Evenly distribute node ids down a column within the SVG height. */
export function columnPositions(ids: string[], height: number): Map<string, number> {
  const positions = new Map<string, number>();
  const top = A2A_GRAPH_LAYOUT.topPad;
  const bottom = height - A2A_GRAPH_LAYOUT.bottomPad;
  const count = Math.max(ids.length, 1);
  ids.forEach((id, index) => {
    const y = count === 1 ? (top + bottom) / 2 : top + ((bottom - top) * index) / (count - 1);
    positions.set(id, y);
  });
  return positions;
}

export function graphHeight(rowCount: number): number {
  return A2A_GRAPH_LAYOUT.topPad + A2A_GRAPH_LAYOUT.bottomPad + Math.max(rowCount, 1) * A2A_GRAPH_LAYOUT.rowHeight;
}

/** Cubic-bezier path from a left (from) node to a right (to) node. */
export function edgePath(start: { x: number; y: number }, end: { x: number; y: number }, index: number): string {
  const bend = index % 2 === 0 ? 0 : 14;
  const midX = (start.x + end.x) / 2;
  const controlAY = start.y + (end.y - start.y) * 0.15 + bend;
  const controlBY = start.y + (end.y - start.y) * 0.85 - bend;
  const r = A2A_GRAPH_LAYOUT.nodeRadius;
  return `M ${start.x + r} ${start.y} C ${midX} ${controlAY}, ${midX} ${controlBY}, ${end.x - r} ${end.y}`;
}

export function coworkerHref(agentId: string): string {
  return `/platform/ai/agent/${encodeURIComponent(agentId)}`;
}

export type A2aSourceRecord = {
  /** Human label for the kind of source record. */
  label: string;
  /** The record identifier shown to the operator. */
  value: string;
  /** Present only when a real page route exists for the record. */
  href?: string;
};

/**
 * Build the click-through source-record list for an A2A edge. Only records
 * with an actual page route get an `href`; the rest are surfaced honestly as
 * identifier text (no dead links). Routes verified 2026-06-05:
 *   - Build Studio deep-links via `/build?buildId=<id>`.
 *   - DelegationChain / PhaseHandoff / TaskRun / DeliberationRun have no
 *     dedicated page route yet, so their ids are shown without a link.
 */
export function a2aEdgeSourceRecords(edge: OperationsMapA2aEdge): A2aSourceRecord[] {
  const records: A2aSourceRecord[] = [];
  if (edge.buildId) {
    records.push({ label: "Build", value: edge.buildId, href: `/build?buildId=${encodeURIComponent(edge.buildId)}` });
  }
  if (edge.refs.delegationChainId) {
    records.push({ label: "Delegation chain", value: edge.refs.delegationChainId });
  }
  if (edge.refs.phaseHandoffId) {
    records.push({ label: "Phase handoff", value: edge.refs.phaseHandoffId });
  }
  if (edge.refs.taskRunId) {
    records.push({ label: "Task run", value: edge.refs.taskRunId });
  }
  if (edge.refs.parentTaskRunId) {
    records.push({ label: "Parent task run", value: edge.refs.parentTaskRunId });
  }
  if (edge.refs.deliberationRunId) {
    records.push({ label: "Deliberation run", value: edge.refs.deliberationRunId });
  }
  return records;
}

export function svgClip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function titleize(value: string): string {
  return (
    value
      .split(/[-_:.\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "Unknown"
  );
}
