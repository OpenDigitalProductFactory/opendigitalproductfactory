// Weekly self-optimization sweep (BI-F95222FA, EP-8DC217EB BET-0e).
//
// The plan §6 standing discipline as a deterministic scheduled task: each run
// (1) reconciles the consolidation-parity conformance issues (BET-0b steward),
// (2) re-measures every bet's code-graph blast radius via the cockpit loader
// (graph offline degrades gracefully), (3) derives STALLED bets — outstanding
// bets with zero in-progress delivery items — and (4) persists a compact
// summary to the platformConfig singleton so operators and the cockpit can see
// when the platform last measured itself. No LLM loop; the deep 8-way mining
// fan-out remains a session-scale activity, this sweep keeps its outputs
// honest between runs.

import { prisma } from "@dpf/db";

import { runConsolidationParitySteward } from "@/lib/ea/consolidation-parity-steward";
import { loadOptimizationCockpitData } from "./load-cockpit-data";

export const SELF_OPTIMIZATION_SWEEP_CONFIG_KEY = "optimization.selfSweep.lastRun";

export type SelfOptimizationSweepSummary = {
  ranAt: string;
  graphAvailable: boolean;
  outstandingBets: string[];
  completedBets: string[];
  /** Outstanding bets whose delivery items are all open/untouched (no in-progress). */
  stalledBets: string[];
  parity: { created: number; updated: number; resolved: number };
  blastRadius: { implementationFileCount: number; relatedTestCount: number };
};

export type SelfOptimizationSweepDeps = {
  steward: typeof runConsolidationParitySteward;
  loadCockpit: typeof loadOptimizationCockpitData;
  writeSummary: (summary: SelfOptimizationSweepSummary) => Promise<void>;
  now: () => Date;
};

const defaultDeps: SelfOptimizationSweepDeps = {
  steward: runConsolidationParitySteward,
  loadCockpit: loadOptimizationCockpitData,
  writeSummary: async (summary) => {
    await prisma.platformConfig.upsert({
      where: { key: SELF_OPTIMIZATION_SWEEP_CONFIG_KEY },
      update: { value: summary },
      create: { key: SELF_OPTIMIZATION_SWEEP_CONFIG_KEY, value: summary },
    });
  },
  now: () => new Date(),
};

export async function runSelfOptimizationSweep(
  deps: Partial<SelfOptimizationSweepDeps> = {},
): Promise<SelfOptimizationSweepSummary> {
  const resolved: SelfOptimizationSweepDeps = { ...defaultDeps, ...deps };

  const parity = await resolved.steward();
  const cockpit = await resolved.loadCockpit();

  const outstanding = new Set(parity.outstandingBets);
  const stalledBets = cockpit.bets
    .filter(
      (projection) =>
        outstanding.has(projection.bet.betKey) &&
        !projection.backlogItems.some((item) => item.status === "in-progress"),
    )
    .map((projection) => projection.bet.betKey);

  const summary: SelfOptimizationSweepSummary = {
    ranAt: resolved.now().toISOString(),
    graphAvailable: cockpit.freshness.available,
    outstandingBets: parity.outstandingBets,
    completedBets: parity.completedBets,
    stalledBets,
    parity: { created: parity.created, updated: parity.updated, resolved: parity.resolved },
    blastRadius: {
      implementationFileCount: cockpit.totals.implementationFileCount,
      relatedTestCount: cockpit.totals.relatedTestCount,
    },
  };

  await resolved.writeSummary(summary);

  console.info(`[tool-trace] vertint.sweep ${JSON.stringify(summary)}`);
  return summary;
}
