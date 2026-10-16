import { PROFESSION_REGISTRY } from "@/lib/decision-perspective/profession-registry";
import { resolveReviewAuthority } from "@/lib/govern/authority/escalation-gate";
import type { WorkroomShapeKey } from "./room-shapes";
import type { ReadinessShape } from "@/lib/backlog/initiative-readiness/types";
import type { DecisionRiskTier } from "@/lib/decision-perspective/types";
import type { WorkShapeAdvance } from "./work-shapes";

import { STEP_CRITICALITIES, type StepCriticality } from "./step-criticality-contract";
export { STEP_CRITICALITIES, type StepCriticality } from "./step-criticality-contract";

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


/** Review need precedes path-to-craft selection. Explicit obligations are never truncated. */
export function resolveStepReviewNeed(input: StepCriticalityInput & {
  collaborationShape?: WorkroomShapeKey | null;
  impactedProfessions: readonly string[];
  requiredProfessions: readonly string[];
}) {
  const criticality = resolveStepCriticality(input);
  const required = new Set(input.requiredProfessions);
  if (criticality !== "routine") for (const profession of input.impactedProfessions) required.add(profession);
  if (criticality === "critical" && (input.collaborationShape !== "craft-stewardship" || input.damaging)) required.add("enterprise-architecture");
  const registered = new Set(PROFESSION_REGISTRY.families.map(family => family.professionKey));
  if ([...required, ...input.impactedProfessions].some(key => !registered.has(key))) throw new Error("Review requirements must use a registered profession.");
  return { criticality, authority: resolveReviewAuthority({ criticality, damaging: input.damaging }),
    requiredReviewProfessions: PROFESSION_REGISTRY.families.map(family => family.professionKey).filter(key => required.has(key)) };
}
