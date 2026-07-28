// Pure demand-board projection — no server imports. Safe in tests and client
// components. Groups scored backlog items into the demand funnel and the
// value x effort matrix that the Demand board renders.
//
// Spec: docs/superpowers/specs/2026-07-10-demand-management-design.md §9.

import { DEMAND_STAGE_VALUES, type DemandStage } from "../explore/backlog";
import { classifyValueEffort, EFFORT_SIZE_TO_JOB_SIZE, type ValueEffortQuadrant } from "./scoring";
import type { DemandActivationState } from "./activation";

/** The subset of a backlog item the Demand board needs. */
export type DemandItemView = {
  itemId: string;
  title: string;
  problemStatement?: string | null;
  status: string;
  workType: string | null;
  epicId: string | null;
  demandStage: string | null;
  demandScore: number | null;
  demandScoreFramework: string | null;
  effortSize: string | null;
  jobSize: number | null;
  impact: number | null;
  investmentBucket: string | null;
  // Estimate provenance (EP-DELIVERY-FLOW): the attributed AI/human effort
  // numbers, whose estimate is effective, and whether they still diverge — so the
  // Delivery Flow can show the estimate chip and the ⇄ reconcile affordance.
  estimateAiJobSize: number | null;
  estimateHumanJobSize: number | null;
  estimateSource: string | null;
  estimateAgreed: boolean | null;
  // AI-led volunteering (EP-DELIVERY-FLOW BI-A6648529): when a funded bet has been
  // offered to a coworker (ask-first pickup gate), claimStatus="offered" and
  // claimedByAgentId names the volunteer — the bet card shows "🙋 volunteered".
  claimStatus: string | null;
  claimedByAgentId: string | null;
  organizationId?: string | null;
  productLineId?: string | null;
  businessProductId?: string | null;
  digitalProductId?: string | null;
  evidenceLinks?: Array<{
    evidenceLinkId: string;
    sourceKind: string;
    sourceRef: string;
    title: string;
    summary: string | null;
    confidence: number | null;
    reviewedAt: string | null;
  }>;
  decisionHistory?: Array<{
    kind: string;
    summary: string;
    recordedAt: string;
    payload: Record<string, unknown>;
  }>;
  activation?: DemandActivationState;
  fundingDecisionCount?: number;
};

export type FunnelColumn = {
  stage: "unclassified" | DemandStage;
  items: DemandItemView[];
};

/**
 * Group items into the explicit classification queue plus the four funnel
 * columns. A null stage is historical ambiguity, not permission to call it raw.
 */
export function groupByFunnelStage(items: DemandItemView[]): FunnelColumn[] {
  const columns: Record<"unclassified" | DemandStage, DemandItemView[]> = {
    unclassified: [],
    raw: [],
    screened: [],
    shaped: [],
    ready: [],
  };
  for (const item of items) {
    const stage: "unclassified" | DemandStage = (DEMAND_STAGE_VALUES as readonly string[]).includes(item.demandStage ?? "")
      ? (item.demandStage as DemandStage)
      : "unclassified";
    columns[stage].push(item);
  }
  // Within a column, highest demandScore first (unscored last).
  for (const stage of ["unclassified", ...DEMAND_STAGE_VALUES] as const) {
    columns[stage].sort((a, b) => (b.demandScore ?? -Infinity) - (a.demandScore ?? -Infinity));
  }
  return (["unclassified", ...DEMAND_STAGE_VALUES] as const).map((stage) => ({
    stage,
    items: columns[stage],
  }));
}

/** Effort as a number: explicit jobSize, else the t-shirt projection. */
export function itemEffort(item: DemandItemView): number | null {
  if (typeof item.jobSize === "number" && item.jobSize > 0) return item.jobSize;
  if (item.effortSize && item.effortSize in EFFORT_SIZE_TO_JOB_SIZE) return EFFORT_SIZE_TO_JOB_SIZE[item.effortSize];
  return null;
}

/** Value as a number for the matrix: the computed score, else raw impact. */
export function itemValue(item: DemandItemView): number | null {
  if (typeof item.demandScore === "number") return item.demandScore;
  if (typeof item.impact === "number") return item.impact;
  return null;
}

export type MatrixPoint = {
  item: DemandItemView;
  value: number;
  effort: number;
  quadrant: ValueEffortQuadrant;
};

export type DemandMatrix = {
  points: MatrixPoint[];
  valueMid: number;
  effortMid: number;
  /** Items lacking a value or effort — cannot be plotted yet. */
  unplotted: DemandItemView[];
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Build the value x effort matrix. Midpoints are the medians of the plottable
 * items' values and efforts, so the quadrants split the actual population
 * (not an arbitrary absolute threshold).
 */
export function buildValueEffortMatrix(items: DemandItemView[]): DemandMatrix {
  const plottable: Array<{ item: DemandItemView; value: number; effort: number }> = [];
  const unplotted: DemandItemView[] = [];
  for (const item of items) {
    const value = itemValue(item);
    const effort = itemEffort(item);
    if (value === null || effort === null) unplotted.push(item);
    else plottable.push({ item, value, effort });
  }
  const valueMid = median(plottable.map((p) => p.value));
  const effortMid = median(plottable.map((p) => p.effort));
  const points: MatrixPoint[] = plottable.map((p) => ({
    ...p,
    quadrant: classifyValueEffort(p.value, p.effort, valueMid, effortMid),
  }));
  return { points, valueMid, effortMid, unplotted };
}

export const QUADRANT_LABELS: Record<ValueEffortQuadrant, string> = {
  quick_win: "Quick wins",
  big_bet: "Big bets",
  fill_in: "Fill-ins",
  time_sink: "Time sinks",
};

export const STAGE_LABELS: Record<DemandStage, string> = {
  raw: "Raw",
  screened: "Screened",
  shaped: "Shaped",
  ready: "Ready",
};

export const ACTIVATION_STAGE_LABELS: Record<"unclassified" | DemandStage, string> = {
  unclassified: "Needs classification",
  ...STAGE_LABELS,
};

export function demandStageLabel(value: string | null): string {
  return (DEMAND_STAGE_VALUES as readonly string[]).includes(value ?? "")
    ? STAGE_LABELS[value as DemandStage]
    : ACTIVATION_STAGE_LABELS.unclassified;
}

/** Plain-language "how valuable" band for a card front (layman-first). */
export function valueBand(item: DemandItemView): "high" | "medium" | "low" | "unscored" {
  if (item.demandScore === null || item.demandScore === undefined) return "unscored";
  if (item.demandScore >= 100) return "high";
  if (item.demandScore >= 10) return "medium";
  return "low";
}
