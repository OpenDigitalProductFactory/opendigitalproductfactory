/**
 * The workspace home's main value stream (BI-F19A1128, EP-B70E718D F7).
 *
 * Spec: docs/superpowers/specs/2026-10-02-workroom-flow-map-and-measurement-design.md §7 (L0), §9.
 *
 * The home leads with the archetype's main value-delivery area: its PRIMARY
 * portfolio from the activation profile. When several are primary, the one with
 * the most work in flow wins; when none is declared, the busiest portfolio. The
 * hero then draws that portfolio's busiest shape and names one bottleneck.
 *
 * Pure: the archetype's portfolio decomposition and the portfolio flows in.
 */
import { formatDuration } from "@/lib/datetime";
import { PORTFOLIO_ROLES, type PortfolioRoleKey } from "@/lib/portfolio/portfolio-role";

import type { PortfolioFlow, ShapeFlowRow } from "./portfolio-flow";
import { topByWaitTimesQueue } from "./shape-step-measures";
import { describeHoldCause } from "./workroom-stage-telemetry";

export type PortfolioDecompositionLike = Partial<Record<PortfolioRoleKey, { scope?: string } | undefined>> | null | undefined;

export function resolveHeroPortfolio(
  decomposition: PortfolioDecompositionLike,
  flows: readonly Pick<PortfolioFlow, "key" | "flowLoad">[],
): PortfolioRoleKey {
  const load = (role: PortfolioRoleKey) => flows.find((flow) => flow.key === role)?.flowLoad ?? 0;
  const primary = PORTFOLIO_ROLES.filter((role) => decomposition?.[role]?.scope === "primary");
  const candidates = primary.length > 0 ? primary : [...PORTFOLIO_ROLES];
  return [...candidates].sort((a, b) => load(b) - load(a))[0]!;
}

/** The shape to draw: the one with the most rooms in flow. */
export function heroShape(flow: Pick<PortfolioFlow, "shapes">): ShapeFlowRow | null {
  return flow.shapes[0] ?? null;
}

/** A held step's typical wait, by shape version and step; null when it is too few to measure. */
export type StageWaitOf = (shapeRef: string, stageKey: string) => number | null;

/**
 * One sentence naming where the most waiting accrues, or null when nothing
 * waits. Ranked by rooms held × the step's typical wait (BI-9148060C).
 */
export function bottleneckSentence(
  flow: Pick<PortfolioFlow, "shapes">,
  titleOf: (shapeKey: string) => string,
  waitOf: StageWaitOf = () => null,
): string | null {
  const piles = flow.shapes.flatMap((shape) =>
    shape.held.map((hold) => ({ ...hold, shapeKey: shape.shapeKey, waitMs: waitOf(shape.shapeRef, hold.stageKey) })));
  const top = topByWaitTimesQueue(piles);
  if (!top) return null;
  const { roomsHeld, stageKey, cause, waitMs } = top;
  const why = cause === "awaiting-person" ? describeHoldCause(cause) : `blocked: ${describeHoldCause(cause)}`;
  const typically = waitMs == null ? "" : `, typically waiting ${formatDuration(waitMs)}`;
  return `${roomsHeld} ${roomsHeld === 1 ? "room is" : "rooms are"} held at ${stageKey} in ${titleOf(top.shapeKey)}${typically} (${why}).`;
}
