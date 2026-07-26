import {
  AUTONOMY_LEVELS,
  recommendTrustChange,
  type AutonomyLevel,
  type RiskClass,
  type TrustRecommendation,
} from "@/lib/autonomy/trust-graduation";

const RISK_CLASSES: readonly RiskClass[] = [
  "read-only",
  "internal-reversible",
  "internal-irreversible",
  "outbound-or-floor",
];

const DELTA_FIELDS = [
  "toolCallDelta",
  "failureDelta",
  "manualTouchDelta",
  "contextTokenDelta",
  "reviewFailureDelta",
] as const;

type DeltaField = (typeof DELTA_FIELDS)[number];

export type WorkPatternShadowTrial = {
  trialId: string;
  riskClass: RiskClass | null;
  candidateDecision: string;
  actualDecision: string;
  outcome: string | null;
  agreement: boolean;
  toolCallDelta: number;
  failureDelta: number;
  manualTouchDelta: number;
  contextTokenDelta: number;
  reviewFailureDelta: number;
  observedAt: Date | null;
};

export type WorkPatternShadowDecision =
  | "insufficient-evidence"
  | "continue-shadow"
  | "approve-narrower-scope"
  | "reject-candidate";

export type WorkPatternShadowEvaluation = {
  samples: number;
  agreements: number;
  agreementRate: number | null;
  riskClass: RiskClass | null;
  currentLevel: AutonomyLevel;
  trustRecommendation: TrustRecommendation | null;
  decision: WorkPatternShadowDecision;
  activationAllowed: false;
  improvementTotals: Record<DeltaField, number>;
  blockers: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(source: Record<string, unknown>, field: string): string | null {
  const value = source[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberField(source: Record<string, unknown>, field: DeltaField): number {
  const value = source[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function dateFrom(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function parseRiskClass(value: unknown): RiskClass | null {
  return RISK_CLASSES.includes(value as RiskClass) ? (value as RiskClass) : null;
}

export function parseAutonomyLevel(value: unknown): AutonomyLevel | null {
  return AUTONOMY_LEVELS.includes(value as AutonomyLevel) ? (value as AutonomyLevel) : null;
}

export function parseWorkPatternShadowTrials(value: unknown): WorkPatternShadowTrial[] {
  if (!Array.isArray(value)) return [];
  const trials: WorkPatternShadowTrial[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const trialId = stringField(row, "trialId");
    const candidateDecision = stringField(row, "candidateDecision");
    const actualDecision = stringField(row, "actualDecision");
    const agreement = row.agreement;
    const rawRiskClass = row.riskClass;
    const riskClass = rawRiskClass == null ? null : parseRiskClass(rawRiskClass);
    if (
      !trialId ||
      !candidateDecision ||
      !actualDecision ||
      typeof agreement !== "boolean" ||
      (rawRiskClass != null && !riskClass)
    ) {
      continue;
    }
    trials.push({
      trialId,
      riskClass,
      candidateDecision,
      actualDecision,
      outcome: stringField(row, "outcome"),
      agreement,
      toolCallDelta: numberField(row, "toolCallDelta"),
      failureDelta: numberField(row, "failureDelta"),
      manualTouchDelta: numberField(row, "manualTouchDelta"),
      contextTokenDelta: numberField(row, "contextTokenDelta"),
      reviewFailureDelta: numberField(row, "reviewFailureDelta"),
      observedAt: dateFrom(row.observedAt),
    });
  }
  return trials;
}

export function parseLegacyWorkPatternShadowTrials(
  ...sources: unknown[]
): WorkPatternShadowTrial[] {
  const trials: WorkPatternShadowTrial[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (!isRecord(source)) continue;
    for (const trial of parseWorkPatternShadowTrials(source.shadowTrials)) {
      if (seen.has(trial.trialId)) continue;
      seen.add(trial.trialId);
      trials.push(trial);
    }
  }
  return trials;
}

function emptyDeltas(): Record<DeltaField, number> {
  return {
    toolCallDelta: 0,
    failureDelta: 0,
    manualTouchDelta: 0,
    contextTokenDelta: 0,
    reviewFailureDelta: 0,
  };
}

function resolveRiskClass(
  trials: readonly WorkPatternShadowTrial[],
  fallback?: RiskClass | null,
): RiskClass | null {
  if (fallback) return fallback;
  return trials.find((trial) => trial.riskClass)?.riskClass ?? null;
}

function shadowDecision(args: {
  samples: number;
  riskClass: RiskClass | null;
  trustRecommendation: TrustRecommendation | null;
}): WorkPatternShadowDecision {
  if (!args.riskClass || args.samples < 10) return "insufficient-evidence";
  if (args.trustRecommendation?.action === "demote") return "reject-candidate";
  if (args.trustRecommendation?.action === "promote") return "approve-narrower-scope";
  return "continue-shadow";
}

export function evaluateWorkPatternShadowEvidence(input: {
  trials: readonly WorkPatternShadowTrial[];
  currentLevel?: AutonomyLevel | null;
  riskClass?: RiskClass | null;
  regulatoryCeiling?: AutonomyLevel | null;
}): WorkPatternShadowEvaluation {
  const samples = input.trials.length;
  const agreements = input.trials.filter((trial) => trial.agreement).length;
  const agreementRate = samples > 0 ? agreements / samples : null;
  const riskClass = resolveRiskClass(input.trials, input.riskClass);
  const currentLevel = input.currentLevel ?? "shadow";
  const improvementTotals = emptyDeltas();
  const blockers: string[] = [];

  for (const trial of input.trials) {
    for (const field of DELTA_FIELDS) {
      improvementTotals[field] += trial[field];
    }
  }

  if (samples === 0) blockers.push("no-shadow-trials");
  if (!riskClass) blockers.push("missing-risk-class");
  if (samples > 0 && samples < 10) blockers.push("insufficient-shadow-samples");

  const trustRecommendation = riskClass
    ? recommendTrustChange({
        level: currentLevel,
        risk: riskClass,
        window: { samples, agreements },
        regulatoryCeiling: input.regulatoryCeiling ?? undefined,
      })
    : null;
  const decision = shadowDecision({ samples, riskClass, trustRecommendation });

  return {
    samples,
    agreements,
    agreementRate,
    riskClass,
    currentLevel,
    trustRecommendation,
    decision,
    activationAllowed: false,
    improvementTotals,
    blockers,
  };
}
