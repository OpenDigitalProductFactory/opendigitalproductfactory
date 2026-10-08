// BI-7D1E43DE (EP-DECISION-OUTCOME-LOOP slice 3). TrustState for governed
// decisions, computed from the shadow ledger, and the report that reads it.
//
// The pure half. It counts; it never decides anything.
//
// REPORT ONLY. Every row is born at `shadow` and nothing here raises a level or
// recommends raising one: the stored recommendation is a fixed hold. Graduation
// is a separate founder decision taken against these numbers, not by them.
//
// Who resolved a decision splits the population, as slice 1 requires (see
// DECISION_RESOLVERS in decision-outcome.ts): an agent agreeing with its own
// kernel consult and a human agreeing with the coworker are different
// measurements and are never pooled. Trust is the coworker measured against a
// human, so only human-resolved rows are samples. Agent self-reports are
// counted beside them, never inside them.

import { agreementRate, DEMOTION_MIN_SAMPLES, type TrustRecommendation } from "@/lib/autonomy/trust-graduation";

/**
 * Below this many human-resolved samples the report withholds the rate. It is
 * the smallest sample the trust rules ever act on (the demotion floor), so the
 * report never shows a rate the rules themselves would refuse to judge.
 */
export const DECISION_TRUST_MIN_SAMPLES = DEMOTION_MIN_SAMPLES;

/** Stored on every governed-decision TrustState row. A hold, at shadow, always. */
export const REPORT_ONLY_RECOMMENDATION = {
  action: "hold",
  level: "shadow",
  reason:
    "Report only (BI-7D1E43DE). Governed-decision trust is measured, not acted on; graduation is a separate founder decision.",
} as const satisfies TrustRecommendation;

/** What the report cannot say. Shown with every report, not on request. */
export const DECISION_TRUST_REPORT_CAVEATS = [
  "Agreement is concordance, not correctness: it says the coworker's recommendation matched what a human chose, not that either was right.",
  "A human who rubber-stamps produces high agreement and no information.",
  "Only human-resolved decisions are samples. A coworker's report on its own decision is counted separately and never pooled into the rate.",
  "Every level shown is read from TrustState. This report authorizes no autonomy; it changes no level.",
] as const;

export type DecisionTrustLedgerRow = {
  ledgerId: string;
  agentId: string;
  activityType: string;
  riskClass: string;
  agreement: boolean | null;
  resolvedBy: string | null;
  recommendedOptionId: string | null;
  observedAt: Date;
};

export type DecisionTrustAggregate = {
  agentId: string;
  activityType: string;
  riskClass: string;
  /** Every ledger row for the key. */
  decisionCount: number;
  /** Human-resolved rows that carry an agreement. The trust denominator. */
  sampleCount: number;
  agreementCount: number;
  agreementRate: number | null;
  /** An agent's report on its own decision. Never in the rate. */
  agentReportedCount: number;
  agentReportedAgreementCount: number;
  /** A recommendation with no known agreement: unreported, or reported unresolved. */
  unresolvedCount: number;
  /** The kernel abstained, so there is nothing to agree with. */
  noRecommendationCount: number;
  lastLedgerId: string | null;
};

function keyOf(row: Pick<DecisionTrustLedgerRow, "agentId" | "activityType" | "riskClass">): string {
  return `${row.agentId}\u0000${row.activityType}\u0000${row.riskClass}`;
}

export function aggregateDecisionTrust(rows: readonly DecisionTrustLedgerRow[]): DecisionTrustAggregate[] {
  const byKey = new Map<string, DecisionTrustAggregate & { lastObservedAt: number }>();
  for (const row of rows) {
    const key = keyOf(row);
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        agentId: row.agentId,
        activityType: row.activityType,
        riskClass: row.riskClass,
        decisionCount: 0,
        sampleCount: 0,
        agreementCount: 0,
        agreementRate: null,
        agentReportedCount: 0,
        agentReportedAgreementCount: 0,
        unresolvedCount: 0,
        noRecommendationCount: 0,
        lastLedgerId: null,
        lastObservedAt: Number.NEGATIVE_INFINITY,
      };
      byKey.set(key, agg);
    }
    agg.decisionCount += 1;
    const observed = row.observedAt.getTime();
    if (observed > agg.lastObservedAt) {
      agg.lastObservedAt = observed;
      agg.lastLedgerId = row.ledgerId;
    }
    if (row.recommendedOptionId === null) {
      agg.noRecommendationCount += 1;
    } else if (row.agreement === null) {
      agg.unresolvedCount += 1;
    } else if (row.resolvedBy === "human") {
      agg.sampleCount += 1;
      if (row.agreement) agg.agreementCount += 1;
    } else {
      agg.agentReportedCount += 1;
      if (row.agreement) agg.agentReportedAgreementCount += 1;
    }
  }
  return [...byKey.values()]
    .map(({ lastObservedAt: _lastObservedAt, ...agg }) => ({
      ...agg,
      agreementRate: agreementRate({ samples: agg.sampleCount, agreements: agg.agreementCount }),
    }))
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

export type DecisionTrustStateRow = {
  agentId: string;
  activityType: string;
  riskClass: string;
  currentLevel: string;
  sampleCount: number;
  agreementCount: number;
  agreementRate: number | null;
  lastEvaluatedAt: Date | null;
};

export type DecisionTrustReportRow = {
  agentId: string;
  activityType: string;
  riskClass: string;
  currentLevel: string;
  decisionCount: number;
  sampleCount: number;
  agreementCount: number;
  /** Null when withheld below the minimum, or when there are no samples. */
  agreementRate: number | null;
  rateDisplay: string;
  agentReportedCount: number;
  unresolvedCount: number;
  noRecommendationCount: number;
  lastEvaluatedAt: string | null;
};

export type DecisionTrustReport = {
  minSamples: number;
  allShadow: boolean;
  rows: DecisionTrustReportRow[];
  /** Coworkers with attributed decisions that no trust row covers yet. Listed, never dropped. */
  unmeasuredCoworkers: Array<{ agentId: string; attributedDecisions: number; inLedger: number }>;
  caveats: readonly string[];
};

function rateDisplay(sampleCount: number, agreementCount: number, rate: number | null): string {
  if (sampleCount < DECISION_TRUST_MIN_SAMPLES || rate === null) {
    return `insufficient samples (${sampleCount} of ${DECISION_TRUST_MIN_SAMPLES})`;
  }
  return `${Math.round(rate * 100)}% (${agreementCount} of ${sampleCount})`;
}

export function buildDecisionTrustReport(input: {
  trustStates: readonly DecisionTrustStateRow[];
  ledger: readonly DecisionTrustAggregate[];
  /** Attributed decisions per (canonical) coworker id, from DecisionInteraction. */
  attributedDecisionsByAgent: Readonly<Record<string, number>>;
}): DecisionTrustReport {
  const ledgerByKey = new Map(input.ledger.map((agg) => [keyOf(agg), agg]));
  const rows = input.trustStates
    .map((state): DecisionTrustReportRow => {
      const agg = ledgerByKey.get(keyOf(state));
      const withheld = state.sampleCount < DECISION_TRUST_MIN_SAMPLES;
      return {
        agentId: state.agentId,
        activityType: state.activityType,
        riskClass: state.riskClass,
        currentLevel: state.currentLevel,
        decisionCount: agg?.decisionCount ?? 0,
        sampleCount: state.sampleCount,
        agreementCount: state.agreementCount,
        agreementRate: withheld ? null : state.agreementRate,
        rateDisplay: rateDisplay(state.sampleCount, state.agreementCount, state.agreementRate),
        agentReportedCount: agg?.agentReportedCount ?? 0,
        unresolvedCount: agg?.unresolvedCount ?? 0,
        noRecommendationCount: agg?.noRecommendationCount ?? 0,
        lastEvaluatedAt: state.lastEvaluatedAt ? state.lastEvaluatedAt.toISOString() : null,
      };
    })
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)));

  const measuredAgents = new Set(rows.map((r) => r.agentId));
  const inLedgerByAgent = new Map<string, number>();
  for (const agg of input.ledger) {
    inLedgerByAgent.set(agg.agentId, (inLedgerByAgent.get(agg.agentId) ?? 0) + agg.decisionCount);
  }
  const unmeasuredCoworkers = Object.entries(input.attributedDecisionsByAgent)
    .filter(([agentId, count]) => count > 0 && !measuredAgents.has(agentId))
    .map(([agentId, attributedDecisions]) => ({
      agentId,
      attributedDecisions,
      inLedger: inLedgerByAgent.get(agentId) ?? 0,
    }))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  return {
    minSamples: DECISION_TRUST_MIN_SAMPLES,
    allShadow: rows.every((r) => r.currentLevel === "shadow"),
    rows,
    unmeasuredCoworkers,
    caveats: DECISION_TRUST_REPORT_CAVEATS,
  };
}
