import type { ReadinessShape } from "@/lib/backlog/initiative-readiness/types";
import type { DecisionRiskTier } from "@/lib/decision-perspective/types";
import type { WorkShapeAdvance } from "./work-shapes";

/** Review depth, distinct from a damaging action or permission to execute. */
export const STEP_CRITICALITIES = ["routine", "consequential", "critical"] as const;
export type StepCriticality = (typeof STEP_CRITICALITIES)[number];

export type StepCriticalityInput = {
  /** Already raised by the canonical shape/sensitivity resolver. */
  effectiveShape: ReadinessShape;
  advanceKind: WorkShapeAdvance["kind"];
  riskTier: DecisionRiskTier;
  /** A server-resolved damaging declaration; never inferred from criticality. */
  damaging: boolean;
  declaredCriticality?: StepCriticality;
};

const SHAPE_FLOOR: Record<ReadinessShape, number> = {
  "break-fix": 0,
  small: 0,
  medium: 1,
  large: 2,
  xlarge: 2,
};

const RISK_FLOOR: Record<DecisionRiskTier, number> = {
  low: 0,
  medium: 0,
  high: 1,
  critical: 2,
};

/**
 * Approved design section 3.1: every recorded signal is a floor. This pure
 * calculation grants no authority, selects no human and changes no gate.
 */
export function resolveStepCriticality(input: StepCriticalityInput): StepCriticality {
  const rank = Math.max(
    SHAPE_FLOOR[input.effectiveShape],
    input.advanceKind === "governed-decision" ? 1 : 0,
    RISK_FLOOR[input.riskTier],
    input.damaging ? 2 : 0,
    input.declaredCriticality ? STEP_CRITICALITIES.indexOf(input.declaredCriticality) : 0,
  );
  return STEP_CRITICALITIES[rank]!;
}
