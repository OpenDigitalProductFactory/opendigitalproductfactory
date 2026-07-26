import type { RiskClass } from "@/lib/autonomy/trust-graduation";

export const WORK_PATTERN_PROMOTION_DECISIONS = [
  "continue",
  "activate",
  "reject",
  "rollback",
  "escalate",
] as const;

export type WorkPatternPromotionDecision =
  (typeof WORK_PATTERN_PROMOTION_DECISIONS)[number];

export type WorkPatternObjectiveDeltas = {
  correctness: number;
  security: number;
  migrationSafety: number;
  customerImpact: number;
  speed: number;
  cost: number;
};

export type WorkPatternPromotionPolicy = {
  policyKey: string;
  version: number;
  accountableOwner: string;
  supportedActivityKeys: readonly string[];
  supportedRiskClasses: readonly RiskClass[];
  minimumValidPairCount: number;
  requiredCellKeys: readonly string[];
  minimumObjectiveImprovement: number;
  nonRegressionTolerance: Pick<
    WorkPatternObjectiveDeltas,
    "correctness" | "security" | "migrationSafety" | "customerImpact"
  >;
  freshnessWindowDays: number;
  rollbackRequired: boolean;
};

export type WorkPatternPromotionEvidence = {
  activityKey: string;
  riskClass: RiskClass;
  validPairCount: number;
  invalidPairCount: number;
  completedCellKeys: readonly string[];
  freshnessAt: Date;
  rollbackBindingId: string | null;
  objectiveDeltas: WorkPatternObjectiveDeltas;
  commandmentGateRegression: boolean;
  criticalFindingReproduced: boolean;
  regulatoryHumanControlRequired: boolean;
  activeBindingHealthRegression: boolean;
};

export type WorkPatternPromotionVerdict = {
  decision: WorkPatternPromotionDecision;
  reasons: string[];
};

export const DEFAULT_WORK_PATTERN_PROMOTION_POLICY: WorkPatternPromotionPolicy = {
  policyKey: "governed-build-playbook-promotion",
  version: 1,
  accountableOwner: "build-studio-governance",
  supportedActivityKeys: ["build.implement"],
  supportedRiskClasses: ["read-only", "internal-reversible"],
  minimumValidPairCount: 8,
  requiredCellKeys: ["control", "method", "model", "interaction"],
  minimumObjectiveImprovement: 0.01,
  nonRegressionTolerance: {
    correctness: 0,
    security: 0,
    migrationSafety: 0,
    customerImpact: 0,
  },
  freshnessWindowDays: 30,
  rollbackRequired: true,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function hardRegressionReasons(
  policy: WorkPatternPromotionPolicy,
  evidence: WorkPatternPromotionEvidence,
): string[] {
  const reasons: string[] = [];
  if (evidence.commandmentGateRegression) reasons.push("commandment_gate_regression");
  if (evidence.criticalFindingReproduced) reasons.push("critical_finding_reproduced");
  for (const key of [
    "correctness",
    "security",
    "migrationSafety",
    "customerImpact",
  ] as const) {
    if (evidence.objectiveDeltas[key] < -policy.nonRegressionTolerance[key]) {
      reasons.push(`${key}_regression`);
    }
  }
  return reasons;
}

export function evaluateWorkPatternPromotion(input: {
  policy: WorkPatternPromotionPolicy;
  evidence: WorkPatternPromotionEvidence;
  now: Date;
}): WorkPatternPromotionVerdict {
  const { policy, evidence, now } = input;
  if (
    !policy.supportedActivityKeys.includes(evidence.activityKey)
    || !policy.supportedRiskClasses.includes(evidence.riskClass)
  ) {
    return { decision: "escalate", reasons: ["unsupported_activity_or_risk"] };
  }
  if (evidence.regulatoryHumanControlRequired) {
    return { decision: "escalate", reasons: ["regulatory_human_control_required"] };
  }
  if (evidence.activeBindingHealthRegression) {
    return evidence.rollbackBindingId
      ? { decision: "rollback", reasons: ["active_binding_health_regression"] }
      : { decision: "escalate", reasons: ["rollback_target_missing"] };
  }

  const regressionReasons = hardRegressionReasons(policy, evidence);
  if (regressionReasons.length > 0) {
    return { decision: "reject", reasons: regressionReasons };
  }

  const continueReasons: string[] = [];
  if (evidence.validPairCount < policy.minimumValidPairCount) {
    continueReasons.push("minimum_valid_pairs_not_met");
  }
  if (evidence.invalidPairCount > 0) continueReasons.push("invalid_pair_present");
  const completed = new Set(evidence.completedCellKeys);
  if (policy.requiredCellKeys.some((cellKey) => !completed.has(cellKey))) {
    continueReasons.push("required_cell_missing");
  }
  const freshnessAge = now.getTime() - evidence.freshnessAt.getTime();
  if (
    !Number.isFinite(freshnessAge)
    || freshnessAge < 0
    || freshnessAge > policy.freshnessWindowDays * DAY_MS
  ) {
    continueReasons.push("evidence_stale");
  }
  if (policy.rollbackRequired && !evidence.rollbackBindingId) {
    continueReasons.push("rollback_target_missing");
  }
  if (continueReasons.length > 0) {
    return { decision: "continue", reasons: continueReasons };
  }

  const improved = Object.values(evidence.objectiveDeltas).some(
    (delta) => delta >= policy.minimumObjectiveImprovement,
  );
  return improved
    ? { decision: "activate", reasons: [] }
    : { decision: "continue", reasons: ["objective_improvement_not_met"] };
}
