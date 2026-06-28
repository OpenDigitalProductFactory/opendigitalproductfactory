import {
  DEFAULT_RISK_CEILINGS,
  minLevel,
  recommendTrustChange,
  type AgreementWindow,
  type AutonomyLevel,
  type GraduationThreshold,
  type RiskClass,
  type TrustRecommendation,
} from "@/lib/autonomy/trust-graduation";

import { getWorkCaseAction } from "./action-registry";
import type { WorkCaseActionVerb } from "./case-types";
import {
  getWorkCaseSourceEntry,
  type WorkCaseReceiptKind,
} from "./source-registry";
import type { WorkCaseAutonomyMode, WorkCasePolicyEnvelope } from "./policy-envelope";

export type WorkCaseAutonomyDecisionMode =
  | "shadow-only"
  | "propose-for-approval"
  | "supervised-action"
  | "autonomous-action";

export interface WorkCaseAutonomyEnvelopeInput {
  sourceKey: string;
  action: WorkCaseActionVerb;
  trustLevel: AutonomyLevel;
  risk: RiskClass;
  agreementWindow: AgreementWindow;
  thresholds?: Partial<Record<AutonomyLevel, GraduationThreshold>>;
  ceilings?: Record<RiskClass, AutonomyLevel>;
  regulatoryCeiling?: AutonomyLevel;
}

export interface WorkCaseAutonomyEnvelopeResolution {
  autonomyMode: WorkCaseAutonomyMode;
  decisionMode: WorkCaseAutonomyDecisionMode;
  effectiveTrustLevel: AutonomyLevel;
  ceiling: AutonomyLevel;
  trustRecommendation: TrustRecommendation;
  requiresCoworkerEnvelope: boolean;
  envelope: WorkCasePolicyEnvelope;
  reason: string;
}

function toWorkCaseAutonomy(level: AutonomyLevel): {
  autonomyMode: WorkCaseAutonomyMode;
  decisionMode: WorkCaseAutonomyDecisionMode;
} {
  switch (level) {
    case "shadow":
      return { autonomyMode: "observed", decisionMode: "shadow-only" };
    case "propose":
      return { autonomyMode: "supervised", decisionMode: "propose-for-approval" };
    case "supervised":
      return { autonomyMode: "supervised", decisionMode: "supervised-action" };
    case "autopilot":
      return { autonomyMode: "autonomous", decisionMode: "autonomous-action" };
  }
}

function requiresCoworkerEnvelope(
  action: WorkCaseActionVerb,
  autonomyMode: WorkCaseAutonomyMode,
): boolean {
  const descriptor = getWorkCaseAction(action);
  if (!descriptor) return false;
  if (descriptor.requiresCoworkerEnvelope === "always") return true;
  return descriptor.requiresCoworkerEnvelope === "when-supervised" && autonomyMode === "supervised";
}

function receiptKindFor(sourceKey: string): WorkCaseReceiptKind {
  return getWorkCaseSourceEntry(sourceKey)?.receiptPolicy.defaultReceiptKind ?? "governed-action";
}

function capSourceLabel(input: WorkCaseAutonomyEnvelopeInput, riskCeiling: AutonomyLevel, ceiling: AutonomyLevel): string {
  if (input.regulatoryCeiling && ceiling === input.regulatoryCeiling && input.regulatoryCeiling !== riskCeiling) {
    return "regulatory policy";
  }
  return `${input.risk} risk`;
}

export function resolveWorkCaseAutonomyEnvelope(
  input: WorkCaseAutonomyEnvelopeInput,
): WorkCaseAutonomyEnvelopeResolution {
  const riskCeiling = (input.ceilings ?? DEFAULT_RISK_CEILINGS)[input.risk];
  const ceiling = input.regulatoryCeiling
    ? minLevel(riskCeiling, input.regulatoryCeiling)
    : riskCeiling;
  const effectiveTrustLevel = minLevel(input.trustLevel, ceiling);
  const trustRecommendation = recommendTrustChange({
    level: effectiveTrustLevel,
    risk: input.risk,
    window: input.agreementWindow,
    thresholds: input.thresholds,
    ceilings: input.ceilings,
    regulatoryCeiling: input.regulatoryCeiling,
  });
  const { autonomyMode, decisionMode } = toWorkCaseAutonomy(effectiveTrustLevel);
  const requiredReceiptKind = receiptKindFor(input.sourceKey);

  return {
    autonomyMode,
    decisionMode,
    effectiveTrustLevel,
    ceiling,
    trustRecommendation,
    requiresCoworkerEnvelope: requiresCoworkerEnvelope(input.action, autonomyMode),
    envelope: {
      autonomyMode,
      receiptPolicy: {
        required: true,
        kind: requiredReceiptKind,
      },
    },
    reason:
      effectiveTrustLevel === input.trustLevel
        ? trustRecommendation.reason
        : `trust ${input.trustLevel} capped to ${effectiveTrustLevel} by ${capSourceLabel(input, riskCeiling, ceiling)}`,
  };
}
