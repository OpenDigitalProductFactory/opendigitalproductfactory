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
import {
  joinAutonomy,
  resolveVerificationRequirement,
  type JoinedAutonomy,
  type VerificationRequirement,
} from "./hitl-join";
import type { ProactivityActionBoundary } from "@/lib/proactivity/proactivity-types";
import type { VerificationDepth } from "@/lib/golden-triangle";
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
  /**
   * EP-WORK-POSTURE (BI-06C41FDC): the action boundary of the ROOM this turn is
   * happening in. Optional — absent means no room posture applies and the
   * envelope decides alone, exactly as before the join existed. Present, it can
   * only make the turn stricter (hitl-join.ts).
   */
  postureActionBoundary?: ProactivityActionBoundary | null;
  /** EP-WORK-POSTURE (BI-13ED1BE1): verification the room's posture asked for. */
  postureVerificationDepth?: VerificationDepth | null;
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
  /** How the two HITL ladders resolved against each other. */
  autonomyJoin: JoinedAutonomy;
  /** Whether this turn must show verification evidence before it may close. */
  verification: VerificationRequirement;
}

/**
 * Map a coworker's (already risk-capped) autonomy level to the work-case
 * decision mode. Exported so consumers that need only this projection — e.g. the
 * AI-led volunteering resolver — reuse the canonical mapping instead of
 * re-deriving it. `autonomous-action` is the sole mode that permits acting
 * without a human turn.
 */
export function autonomyLevelToDecisionMode(level: AutonomyLevel): WorkCaseAutonomyDecisionMode {
  switch (level) {
    case "shadow":
      return "shadow-only";
    case "propose":
      return "propose-for-approval";
    case "supervised":
      return "supervised-action";
    case "autopilot":
      return "autonomous-action";
  }
}

function toWorkCaseAutonomy(level: AutonomyLevel): {
  autonomyMode: WorkCaseAutonomyMode;
  decisionMode: WorkCaseAutonomyDecisionMode;
} {
  const decisionMode = autonomyLevelToDecisionMode(level);
  const autonomyMode: WorkCaseAutonomyMode =
    level === "shadow" ? "observed" : level === "autopilot" ? "autonomous" : "supervised";
  return { autonomyMode, decisionMode };
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
  const { autonomyMode, decisionMode: envelopeDecisionMode } =
    toWorkCaseAutonomy(effectiveTrustLevel);
  const requiredReceiptKind = receiptKindFor(input.sourceKey);

  // The join: neither ladder may purchase autonomy the other withholds.
  const autonomyJoin = joinAutonomy(envelopeDecisionMode, input.postureActionBoundary);
  const decisionMode = autonomyJoin.decisionMode;
  const verification = resolveVerificationRequirement({
    risk: input.risk,
    verificationDepth: input.postureVerificationDepth,
  });

  return {
    autonomyMode,
    decisionMode,
    autonomyJoin,
    verification,
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
      requiresVerification: verification.required,
    },
    reason:
      autonomyJoin.constrainedBy === "posture"
        ? autonomyJoin.reason
        : effectiveTrustLevel === input.trustLevel
          ? trustRecommendation.reason
          : `trust ${input.trustLevel} capped to ${effectiveTrustLevel} by ${capSourceLabel(input, riskCeiling, ceiling)}`,
  };
}
