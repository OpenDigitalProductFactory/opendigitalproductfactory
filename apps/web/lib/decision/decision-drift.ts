// EP-0AF96937: golden-decision drift evaluation.
//
// The last piece of the review/adjust loop (spec §4.3): catch when the *current*
// live principle corpus has drifted a canonical ("golden") decision — either the
// winner flipped, or the margin collapsed toward a coin-flip. Reuses the frozen
// GOLDEN_SCENARIOS panel and the SAME decide() engine the principle_decide MCP
// handler uses (via scoreScenario), so a drift the engine sees is a drift the
// runtime would actually make.
//
// PURE: takes the already-selected commandment set and returns per-scenario
// drift results. The page maps live WikiPage rows → ParsedPrinciplePage →
// selectKernelCommandments → here; tests pass crafted principles directly.

import type { DecisionPrinciple } from "./option-scoring";
import { GOLDEN_SCENARIOS, scoreScenario } from "./golden-decisions";

export type DriftKind = "flip" | "thin-margin";

export type DriftResult = {
  scenarioId: string;
  /** Founder-curated statement of why this decision is doctrine. */
  rationale: string;
  /** The winner the corpus is supposed to produce. */
  expectedWinner: string;
  /** The winner the current corpus actually produces. */
  actualWinner: string;
  margin: number;
  marginFloor: number;
  /** True when the winner flipped OR the margin fell below the scenario floor. */
  drifted: boolean;
  driftKind: DriftKind | null;
  /** Principles that moved the current winner, for human "why did it flip" review. */
  topContributors: Array<{ principle: string; contribution: number }>;
};

/**
 * Score every golden scenario against the supplied commandment set and classify
 * drift. A flip (winner changed) is more severe than a thin margin (winner holds
 * but the call is now near-tied); both are surfaced so the operator can decide
 * whether to revisit a dimension or the principle aggregate.
 */
export function evaluateGoldenDrift(
  principles: DecisionPrinciple[],
): DriftResult[] {
  return GOLDEN_SCENARIOS.map((scenario) => {
    const { snapshot } = scoreScenario(scenario, principles);
    const flipped = snapshot.winner !== scenario.expectedWinner;
    const thin = !flipped && snapshot.margin < scenario.marginFloor;
    return {
      scenarioId: scenario.id,
      rationale: scenario.rationale,
      expectedWinner: scenario.expectedWinner,
      actualWinner: snapshot.winner,
      margin: snapshot.margin,
      marginFloor: scenario.marginFloor,
      drifted: flipped || thin,
      driftKind: flipped ? "flip" : thin ? "thin-margin" : null,
      topContributors: snapshot.topContributors,
    };
  });
}

/** Convenience: only the scenarios that actually drifted (flips first). */
export function driftedScenarios(results: DriftResult[]): DriftResult[] {
  return results
    .filter((r) => r.drifted)
    .sort((a, b) => {
      // Flips before thin-margins; then the biggest margin shortfall first.
      if (a.driftKind !== b.driftKind) return a.driftKind === "flip" ? -1 : 1;
      return a.margin - b.margin;
    });
}
