// Pure Delivery-Flow projection — no server imports. Safe in tests and client
// components. EP-DELIVERY-FLOW BI-1DE21746 (unified surface).
//
// Demand (invest) and Backlog (execute) are two lenses on the SAME BacklogItem.
// The Flow lens renders them as ONE left-to-right river — investment funnel → the
// bet → execution board — so they stop reading as two duplicate boards. This
// module places each item into a single flow lane by its lifecycle position, and
// the surface paints two deliberately different visual languages across the lanes
// (a score-tinted narrowing funnel upstream; a WIP status board downstream, joined
// by the amber "bet" seam).
//
// Spec: docs/superpowers/specs/2026-07-12-delivery-flow-demand-backlog-unification-design.md
// §"The design — one river, two halves, joined by the bet". Placement uses the
// same non-terminal DemandItemView dataset the Demand board already loads, so the
// whole surface is one dataset under a lens switch (no second heavy query).

import { type DemandItemView } from "./board";

/**
 * The lanes of the flow river, left to right:
 * - `funnel_raw` / `funnel_screened` / `funnel_shaped` — the investment funnel
 *   (upstream half): value÷effort, score-tinted, still being shaped.
 * - `bet` — the seam: a `ready` (funded) item that has crossed the governed
 *   funding gate but hasn't been picked up for execution yet. The amber crossing.
 * - `in_progress` — the execution half (downstream): owner + burn-down.
 */
export const FLOW_LANES = ["funnel_raw", "funnel_screened", "funnel_shaped", "bet", "in_progress"] as const;
export type FlowLane = (typeof FLOW_LANES)[number];

/** Which half of the river a lane belongs to — drives the two visual languages. */
export const FLOW_LANE_HALF: Record<FlowLane, "funnel" | "bet" | "board"> = {
  funnel_raw: "funnel",
  funnel_screened: "funnel",
  funnel_shaped: "funnel",
  bet: "bet",
  in_progress: "board",
};

export const FLOW_LANE_LABELS: Record<FlowLane, string> = {
  funnel_raw: "Raw",
  funnel_screened: "Screened",
  funnel_shaped: "Shaped",
  bet: "The bet",
  in_progress: "In progress",
};

/**
 * Place an item into a single flow lane by its lifecycle position. Execution
 * status wins over funnel stage (an item being built is downstream regardless of
 * how it was scored); a `ready`-but-unstarted item sits on the bet; otherwise it
 * falls in the funnel by `demandStage` (missing stage = raw, per the funnel).
 */
export function placeInFlow(item: Pick<DemandItemView, "status" | "demandStage">): FlowLane {
  if (item.status === "in-progress") return "in_progress";
  if (item.demandStage === "ready") return "bet";
  if (item.demandStage === "shaped") return "funnel_shaped";
  if (item.demandStage === "screened") return "funnel_screened";
  return "funnel_raw";
}

export type FlowColumn = {
  lane: FlowLane;
  half: "funnel" | "bet" | "board";
  items: DemandItemView[];
};

/**
 * Group items into the flow lanes in river order. Within a lane, highest
 * demandScore first (unscored last) — matching the Demand funnel's ordering so
 * the two lenses agree on priority.
 */
export function groupByFlowLane(items: DemandItemView[]): FlowColumn[] {
  const lanes: Record<FlowLane, DemandItemView[]> = {
    funnel_raw: [],
    funnel_screened: [],
    funnel_shaped: [],
    bet: [],
    in_progress: [],
  };
  for (const item of items) lanes[placeInFlow(item)].push(item);
  for (const lane of FLOW_LANES) {
    lanes[lane].sort((a, b) => (b.demandScore ?? -Infinity) - (a.demandScore ?? -Infinity));
  }
  return FLOW_LANES.map((lane) => ({ lane, half: FLOW_LANE_HALF[lane], items: lanes[lane] }));
}
