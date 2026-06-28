import {
  agreementRate,
  type AgreementWindow,
  type AutonomyLevel,
  recommendTrustChange,
  type RiskClass,
  type TrustRecommendation,
} from "./trust-graduation";

export type DecisionShadowLedgerAgreement = {
  agreement: boolean | null;
  observedAt?: Date | string | null;
};

export type ComputeTrustStateInput = {
  agentId: string;
  activityType: string;
  riskClass: RiskClass;
  currentLevel?: AutonomyLevel | null;
  regulatoryCeiling?: AutonomyLevel | null;
  rows: readonly DecisionShadowLedgerAgreement[];
};

export type ComputedTrustState = {
  agentId: string;
  activityType: string;
  riskClass: RiskClass;
  currentLevel: AutonomyLevel;
  regulatoryCeiling: AutonomyLevel | null;
  window: AgreementWindow;
  agreementRate: number | null;
  latestObservedAt: Date | null;
  recommendation: TrustRecommendation;
};

export function trustStateKey(input: Pick<ComputeTrustStateInput, "agentId" | "activityType" | "riskClass">): string {
  return `${input.agentId}:${input.activityType}:${input.riskClass}`;
}

export function computeTrustStateFromLedger(input: ComputeTrustStateInput): ComputedTrustState {
  const window = input.rows.reduce<AgreementWindow>(
    (acc, row) => {
      if (row.agreement === null) return acc;
      return {
        samples: acc.samples + 1,
        agreements: acc.agreements + (row.agreement ? 1 : 0),
      };
    },
    { samples: 0, agreements: 0 },
  );
  const currentLevel = input.currentLevel ?? "shadow";
  return {
    agentId: input.agentId,
    activityType: input.activityType,
    riskClass: input.riskClass,
    currentLevel,
    regulatoryCeiling: input.regulatoryCeiling ?? null,
    window,
    agreementRate: agreementRate(window),
    latestObservedAt: latestObservedAt(input.rows),
    recommendation: recommendTrustChange({
      level: currentLevel,
      risk: input.riskClass,
      window,
      regulatoryCeiling: input.regulatoryCeiling ?? undefined,
    }),
  };
}

function latestObservedAt(rows: readonly DecisionShadowLedgerAgreement[]): Date | null {
  let latest: Date | null = null;
  for (const row of rows) {
    if (!row.observedAt) continue;
    const value = row.observedAt instanceof Date ? row.observedAt : new Date(row.observedAt);
    if (Number.isNaN(value.getTime())) continue;
    if (!latest || value > latest) latest = value;
  }
  return latest;
}
