// apps/web/lib/business-activity-sim/matrix.ts
//
// Business Activity Simulator — cross-archetype coverage matrix (P2).
// EP-BUSINESS-ACTIVITY-SIM · BI-78B83F58.
//
// Runs every archetype flow's default scenarios through the SHARED financial +
// lifecycle oracles and reports a per-archetype pass/fail matrix. This is the
// "does the operational surface actually work across every archetype?" answer,
// runnable in CI. P3 renders this matrix graphically; P4 drives it on the live
// portal.

import { ARCHETYPE_FLOWS, type ArchetypeFlow } from "./archetype-flows";
import { FINANCIAL_ORACLES, type SimOracleResult } from "./oracles";

export type ArchetypeScenarioResult = {
  scenarioId: string;
  oracles: SimOracleResult[];
  passed: boolean;
};

export type ArchetypeCoverage = {
  archetypeId: string;
  label: string;
  scenarios: ArchetypeScenarioResult[];
  passed: boolean;
};

export type ArchetypeMatrixReport = {
  archetypes: ArchetypeCoverage[];
  passed: boolean;
  /** Fraction of archetypes with every scenario × oracle green (0..1). */
  passRate: number;
};

/**
 * Run the coverage matrix. Never throws — a scenario that violates an oracle is
 * reported as `passed: false` with the specific violations, so a failing matrix
 * points straight at the archetype + scenario + invariant that broke.
 */
export function runArchetypeMatrix(
  flows: ArchetypeFlow[] = ARCHETYPE_FLOWS,
): ArchetypeMatrixReport {
  const archetypes: ArchetypeCoverage[] = flows.map((flow) => {
    const scenarios: ArchetypeScenarioResult[] = flow.defaultScenarios.map((scenario) => {
      const result = flow.run(scenario);
      const oracles = FINANCIAL_ORACLES.map((oracle) => oracle(result));
      return { scenarioId: scenario.id, oracles, passed: oracles.every((o) => o.ok) };
    });
    return {
      archetypeId: flow.archetypeId,
      label: flow.label,
      scenarios,
      passed: scenarios.every((s) => s.passed),
    };
  });
  const passedCount = archetypes.filter((a) => a.passed).length;
  return {
    archetypes,
    passed: archetypes.every((a) => a.passed),
    passRate: archetypes.length ? passedCount / archetypes.length : 1,
  };
}

/** Every oracle violation across the matrix, flattened for a one-line summary. */
export function matrixViolations(report: ArchetypeMatrixReport): string[] {
  return report.archetypes.flatMap((a) =>
    a.scenarios.flatMap((s) =>
      s.oracles
        .filter((o) => !o.ok)
        .flatMap((o) => o.violations.map((v) => `[${a.archetypeId}/${s.scenarioId}] ${o.id}: ${v}`)),
    ),
  );
}
