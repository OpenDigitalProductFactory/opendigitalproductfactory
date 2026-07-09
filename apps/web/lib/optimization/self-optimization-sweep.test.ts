// Tests for the weekly self-optimization sweep (BI-F95222FA): parity + blast
// radius + stalled-bet derivation + summary persistence, all via injected deps.

import { describe, expect, it, vi } from "vitest";

import {
  runSelfOptimizationSweep,
  type SelfOptimizationSweepSummary,
} from "./self-optimization-sweep";

function stewardResult(over: Record<string, unknown> = {}) {
  return {
    created: 1,
    updated: 0,
    resolved: 2,
    outstandingBets: ["BET-11", "BET-12"],
    completedBets: ["BET-6"],
    ...over,
  };
}

function cockpitResult(bets: Array<{ betKey: string; statuses: Array<string | null> }>) {
  return {
    freshness: {
      available: true,
      indexStatus: "ready",
      lastIndexedAt: new Date("2026-07-09T00:00:00Z"),
      indexedFileCount: 4000,
      warnings: [],
      summary: "ok",
    },
    bets: bets.map(({ betKey, statuses }) => ({
      bet: { betKey } as never,
      backlogItems: statuses.map((status, index) => ({
        itemId: `BI-${betKey}-${index}`,
        status,
        title: null,
      })),
      blastRadius: null,
      fileCoverage: null,
    })),
    totals: {
      betCount: bets.length,
      backlogDone: 0,
      backlogInProgress: 0,
      backlogOpen: 0,
      implementationFileCount: 42,
      relatedTestCount: 7,
    },
  };
}

describe("runSelfOptimizationSweep", () => {
  it("derives stalled bets (outstanding with no in-progress item) and persists the summary", async () => {
    const written: SelfOptimizationSweepSummary[] = [];
    const summary = await runSelfOptimizationSweep({
      steward: vi.fn().mockResolvedValue(stewardResult()) as never,
      loadCockpit: vi.fn().mockResolvedValue(
        cockpitResult([
          { betKey: "BET-11", statuses: ["open"] }, // outstanding, nothing moving -> stalled
          { betKey: "BET-12", statuses: ["in-progress"] }, // outstanding but moving
          { betKey: "BET-6", statuses: ["done"] }, // completed
        ]),
      ) as never,
      writeSummary: async (entry) => {
        written.push(entry);
      },
      now: () => new Date("2026-07-09T05:00:00Z"),
    });

    expect(summary.stalledBets).toEqual(["BET-11"]);
    expect(summary.outstandingBets).toEqual(["BET-11", "BET-12"]);
    expect(summary.completedBets).toEqual(["BET-6"]);
    expect(summary.parity).toEqual({ created: 1, updated: 0, resolved: 2 });
    expect(summary.blastRadius).toEqual({ implementationFileCount: 42, relatedTestCount: 7 });
    expect(summary.ranAt).toBe("2026-07-09T05:00:00.000Z");
    expect(written).toEqual([summary]);
  });

  it("propagates graph unavailability into the summary", async () => {
    const cockpit = cockpitResult([{ betKey: "BET-11", statuses: ["open"] }]);
    cockpit.freshness.available = false;
    cockpit.totals.implementationFileCount = 0;
    cockpit.totals.relatedTestCount = 0;

    const summary = await runSelfOptimizationSweep({
      steward: vi.fn().mockResolvedValue(stewardResult({ outstandingBets: ["BET-11"] })) as never,
      loadCockpit: vi.fn().mockResolvedValue(cockpit) as never,
      writeSummary: async () => {},
      now: () => new Date("2026-07-09T05:00:00Z"),
    });

    expect(summary.graphAvailable).toBe(false);
    expect(summary.blastRadius.implementationFileCount).toBe(0);
  });
});
