// apps/web/lib/business-activity-sim/coverage.ts
//
// Coverage runner: run a set of scenarios through the flow + all oracles and
// produce a pass/fail report. P1 covers the field-service archetype; P2 extends
// this to a cross-archetype matrix. EP-BUSINESS-ACTIVITY-SIM.

import { runFieldServiceFlow, type FieldServiceScenario } from "./field-service-flow";
import { FIELD_SERVICE_ORACLES, type SimOracleResult } from "./oracles";

export type ScenarioCoverage = {
  scenarioId: string;
  oracles: SimOracleResult[];
  passed: boolean;
};

export type CoverageReport = {
  archetype: string;
  scenarios: ScenarioCoverage[];
  passed: boolean;
  /** Fraction of scenarios with every oracle green (0..1). */
  passRate: number;
};

/**
 * Run every scenario through the field-service flow and all oracles, collecting a
 * diagnosable pass/fail report. Never throws — a scenario that violates an oracle
 * is reported as `passed: false` with the specific violations, not an exception.
 */
export function runFieldServiceCoverage(
  scenarios: FieldServiceScenario[],
  archetype = "field-service",
): CoverageReport {
  const rows: ScenarioCoverage[] = scenarios.map((scenario) => {
    const result = runFieldServiceFlow(scenario);
    const oracles = FIELD_SERVICE_ORACLES.map((oracle) => oracle(result));
    return { scenarioId: scenario.id, oracles, passed: oracles.every((o) => o.ok) };
  });
  const passedCount = rows.filter((r) => r.passed).length;
  return {
    archetype,
    scenarios: rows,
    passed: rows.every((r) => r.passed),
    passRate: rows.length ? passedCount / rows.length : 1,
  };
}

/** Every oracle violation across a report, flattened for a one-line failure summary. */
export function coverageViolations(report: CoverageReport): string[] {
  return report.scenarios.flatMap((s) =>
    s.oracles.filter((o) => !o.ok).flatMap((o) => o.violations.map((v) => `[${s.scenarioId}] ${o.id}: ${v}`)),
  );
}

/**
 * A representative field-service scenario set: full-payment with tax, full-payment
 * without tax, and a legitimate partial payment (leaves a correct outstanding
 * receivable). All are valid business states and must pass every oracle.
 */
export const DEFAULT_FIELD_SERVICE_SCENARIOS: FieldServiceScenario[] = [
  { id: "fs-taxed-full", customerAccountId: "cust-1", subtotal: 300, taxAmount: 30 },
  { id: "fs-untaxed-full", customerAccountId: "cust-2", subtotal: 450 },
  { id: "fs-partial-payment", customerAccountId: "cust-3", subtotal: 200, taxAmount: 20, paymentAmount: 150 },
];
