import { describe, expect, it } from "vitest";

import {
  DECISION_TRUST_MIN_SAMPLES,
  DECISION_TRUST_REPORT_CAVEATS,
  REPORT_ONLY_RECOMMENDATION,
  aggregateDecisionTrust,
  buildDecisionTrustReport,
  type DecisionTrustLedgerRow,
} from "./decision-trust-state";

let seq = 0;
function row(over: Partial<DecisionTrustLedgerRow> = {}): DecisionTrustLedgerRow {
  seq += 1;
  return {
    ledgerId: `DSL-${seq}`,
    agentId: "AGT-A",
    activityType: "governed_decision_kernel_consult",
    riskClass: "internal-reversible",
    agreement: null,
    resolvedBy: null,
    recommendedOptionId: "a",
    observedAt: new Date(Date.UTC(2026, 9, 1, 0, seq)),
    ...over,
  };
}

describe("aggregateDecisionTrust", () => {
  it("keys one aggregate per coworker x activity x risk class", () => {
    const out = aggregateDecisionTrust([
      row(),
      row({ riskClass: "internal-irreversible" }),
      row({ agentId: "AGT-B" }),
      row(),
    ]);
    expect(out.map((a) => `${a.agentId}|${a.riskClass}|${a.decisionCount}`)).toEqual([
      "AGT-A|internal-irreversible|1",
      "AGT-A|internal-reversible|2",
      "AGT-B|internal-reversible|1",
    ]);
  });

  it("counts only human-resolved agreement as a sample, and never pools an agent's own report into it", () => {
    const [agg] = aggregateDecisionTrust([
      row({ agreement: true, resolvedBy: "human" }),
      row({ agreement: false, resolvedBy: "human" }),
      row({ agreement: true, resolvedBy: "agent" }),
      row({ agreement: true, resolvedBy: "agent" }),
    ]);
    expect(agg).toMatchObject({
      decisionCount: 4,
      sampleCount: 2,
      agreementCount: 1,
      agreementRate: 0.5,
      agentReportedCount: 2,
      agentReportedAgreementCount: 2,
      unresolvedCount: 0,
    });
  });

  it("keeps a coworker with decisions but no resolution, with its unresolved count and a null rate", () => {
    const [agg] = aggregateDecisionTrust([row(), row(), row({ recommendedOptionId: null })]);
    expect(agg).toMatchObject({
      decisionCount: 3,
      sampleCount: 0,
      agreementCount: 0,
      agreementRate: null,
      unresolvedCount: 2,
      noRecommendationCount: 1,
    });
  });

  it("names the newest ledger row as the last one evaluated", () => {
    const newest = row({ observedAt: new Date(Date.UTC(2027, 0, 1)) });
    const [agg] = aggregateDecisionTrust([row(), newest, row()]);
    expect(agg!.lastLedgerId).toBe(newest.ledgerId);
  });
});

describe("REPORT_ONLY_RECOMMENDATION", () => {
  it("holds at shadow and never recommends a promotion", () => {
    expect(REPORT_ONLY_RECOMMENDATION).toMatchObject({ action: "hold", level: "shadow" });
  });
});

describe("buildDecisionTrustReport", () => {
  const evaluatedAt = new Date(Date.UTC(2026, 9, 7));

  function state(over: Record<string, unknown> = {}) {
    return {
      agentId: "AGT-A",
      activityType: "governed_decision_kernel_consult",
      riskClass: "internal-reversible",
      currentLevel: "shadow",
      sampleCount: 0,
      agreementCount: 0,
      agreementRate: null as number | null,
      lastEvaluatedAt: evaluatedAt,
      ...over,
    };
  }

  it("withholds a rate below the stated minimum and says insufficient samples", () => {
    const report = buildDecisionTrustReport({
      trustStates: [state({ sampleCount: 2, agreementCount: 2, agreementRate: 1 })],
      ledger: aggregateDecisionTrust([
        row({ agreement: true, resolvedBy: "human" }),
        row({ agreement: true, resolvedBy: "human" }),
      ]),
      attributedDecisionsByAgent: { "AGT-A": 2 },
    });
    const [line] = report.rows;
    expect(line!.agreementRate).toBeNull();
    expect(line!.rateDisplay).toBe(`insufficient samples (2 of ${DECISION_TRUST_MIN_SAMPLES})`);
    expect(report.minSamples).toBe(DECISION_TRUST_MIN_SAMPLES);
  });

  it("shows the rate beside its sample count once the minimum is met", () => {
    const n = DECISION_TRUST_MIN_SAMPLES;
    const report = buildDecisionTrustReport({
      trustStates: [state({ sampleCount: n, agreementCount: n - 1, agreementRate: (n - 1) / n })],
      ledger: [],
      attributedDecisionsByAgent: {},
    });
    expect(report.rows[0]!.agreementRate).toBeCloseTo((n - 1) / n);
    expect(report.rows[0]!.rateDisplay).toBe(`${Math.round(((n - 1) / n) * 100)}% (${n - 1} of ${n})`);
  });

  it("lists a coworker whose decisions are not yet measured instead of dropping it", () => {
    const report = buildDecisionTrustReport({
      trustStates: [],
      ledger: [],
      attributedDecisionsByAgent: { "AGT-NEW": 5 },
    });
    expect(report.unmeasuredCoworkers).toEqual([{ agentId: "AGT-NEW", attributedDecisions: 5, inLedger: 0 }]);
  });

  it("carries the unresolved count from the ledger onto the trust row", () => {
    const report = buildDecisionTrustReport({
      trustStates: [state()],
      ledger: aggregateDecisionTrust([row(), row(), row()]),
      attributedDecisionsByAgent: { "AGT-A": 3 },
    });
    expect(report.rows[0]).toMatchObject({ decisionCount: 3, unresolvedCount: 3, sampleCount: 0 });
    expect(report.unmeasuredCoworkers).toEqual([]);
  });

  it("states that agreement is concordance, not correctness, and that nothing is authorized", () => {
    const text = DECISION_TRUST_REPORT_CAVEATS.join(" ");
    expect(text).toContain("concordance, not correctness");
    expect(text).toContain("rubber-stamps");
    expect(text).toContain("authorizes no autonomy");
    expect(buildDecisionTrustReport({ trustStates: [], ledger: [], attributedDecisionsByAgent: {} }).caveats).toEqual(
      DECISION_TRUST_REPORT_CAVEATS,
    );
  });

  it("reports the level it reads and flags any row that is not shadow", () => {
    const report = buildDecisionTrustReport({
      trustStates: [state({ currentLevel: "propose" })],
      ledger: [],
      attributedDecisionsByAgent: {},
    });
    expect(report.rows[0]!.currentLevel).toBe("propose");
    expect(report.allShadow).toBe(false);
  });
});
