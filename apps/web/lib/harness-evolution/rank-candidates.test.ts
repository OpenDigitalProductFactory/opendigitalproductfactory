import { describe, expect, it } from "vitest";

import {
  rankHarnessCandidates,
  resolveHarnessEvolutionBudget,
  resolveSeedItemIds,
  type SignalRow,
} from "./rank-candidates";

// BI-49BC21C1 slice 1 (spec 2026-10-28-harness-evolution-loop-design.md,
// AC-3/AC-4): the ranking is pure, seed items lead, and nothing without a
// trajectory reference survives to a probe.

const NOW = new Date("2026-10-28T04:17:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function signal(overrides: Partial<SignalRow> & { signalId: string }): SignalRow {
  return {
    sourceType: "mcp-call-efficiency",
    title: `signal ${overrides.signalId}`,
    recurrenceCount: 1,
    lastSeenAt: NOW,
    toolName: null,
    backlogItemId: null,
    evidence: { sampleIds: ["te-1"] },
    ...overrides,
  };
}

describe("resolveHarnessEvolutionBudget", () => {
  it("defaults every cap when the task carries no config", () => {
    expect(resolveHarnessEvolutionBudget(null)).toEqual({
      maxCandidates: 10,
      maxProbeReplays: 20,
      tokenCap: 200_000,
      lookbackDays: 30,
    });
  });

  it("clamps an operator's values into the allowed ranges", () => {
    expect(
      resolveHarnessEvolutionBudget({ maxCandidates: 500, maxProbeReplays: -3, tokenCap: 9e9, lookbackDays: 0 }),
    ).toEqual({ maxCandidates: 25, maxProbeReplays: 0, tokenCap: 2_000_000, lookbackDays: 1 });
  });

  it("ignores values that are not finite numbers", () => {
    expect(resolveHarnessEvolutionBudget({ maxCandidates: "lots", tokenCap: Number.NaN }).maxCandidates).toBe(10);
    expect(resolveHarnessEvolutionBudget({ tokenCap: Number.NaN }).tokenCap).toBe(200_000);
  });
});

describe("resolveSeedItemIds", () => {
  it("keeps configured order and drops blanks and duplicates", () => {
    expect(resolveSeedItemIds({ seedItemIds: ["BI-B", " ", "BI-A", "BI-B", 7] })).toEqual(["BI-B", "BI-A"]);
    expect(resolveSeedItemIds(undefined)).toEqual([]);
  });
});

describe("rankHarnessCandidates", () => {
  it("puts seed items first in configured order, then signals by score", () => {
    const result = rankHarnessCandidates({
      now: NOW,
      maxCandidates: 10,
      seedItemIds: ["BI-SEED-2", "BI-SEED-1"],
      seedItems: [
        { itemId: "BI-SEED-1", title: "one", status: "open" },
        { itemId: "BI-SEED-2", title: "two", status: "triaging" },
      ],
      signals: [
        signal({ signalId: "IS-LOW", recurrenceCount: 2 }),
        signal({ signalId: "IS-HIGH", recurrenceCount: 9 }),
      ],
    });
    expect(result.ranked.map((c) => c.candidateKey)).toEqual([
      "seed:BI-SEED-2",
      "seed:BI-SEED-1",
      "signal:IS-HIGH",
      "signal:IS-LOW",
    ]);
    expect(result.ranked.map((c) => c.rank)).toEqual([1, 2, 3, 4]);
    expect(result.ranked[0]).toMatchObject({
      origin: "seed-queue",
      backlogItemId: "BI-SEED-2",
      score: null,
      trajectory: [{ kind: "backlog-item", itemId: "BI-SEED-2" }],
    });
  });

  it("weights critical severity and decays stale signals", () => {
    const result = rankHarnessCandidates({
      now: NOW,
      maxCandidates: 10,
      seedItemIds: [],
      seedItems: [],
      signals: [
        signal({ signalId: "IS-OLD", recurrenceCount: 10, lastSeenAt: daysAgo(28) }),
        signal({ signalId: "IS-CRIT", recurrenceCount: 4, evidence: { severity: "critical", sampleIds: ["te-2"] } }),
        signal({ signalId: "IS-FRESH", recurrenceCount: 5 }),
      ],
    });
    // 10·e^-2 ≈ 1.35 < 4·2 = 8 > 5.
    expect(result.ranked.map((c) => c.signalId)).toEqual(["IS-CRIT", "IS-FRESH", "IS-OLD"]);
    expect(result.ranked[0]!.score).toBe(8);
    expect(result.ranked[2]!.score).toBeCloseTo(10 * Math.exp(-2), 6);
  });

  it("breaks ties on newest lastSeenAt, then on key, so order is stable", () => {
    const input = {
      now: NOW,
      maxCandidates: 10,
      seedItemIds: [],
      seedItems: [],
      signals: [
        signal({ signalId: "IS-B", recurrenceCount: 3 }),
        signal({ signalId: "IS-A", recurrenceCount: 3 }),
      ],
    };
    expect(rankHarnessCandidates(input).ranked.map((c) => c.signalId)).toEqual(["IS-A", "IS-B"]);
    expect(rankHarnessCandidates({ ...input, signals: [...input.signals].reverse() }).ranked.map((c) => c.signalId))
      .toEqual(["IS-A", "IS-B"]);
  });

  it("carries tool executions or the pattern key as trajectory evidence", () => {
    const result = rankHarnessCandidates({
      now: NOW,
      maxCandidates: 10,
      seedItemIds: [],
      seedItems: [],
      signals: [
        signal({ signalId: "IS-TE", recurrenceCount: 3, evidence: { sampleIds: ["a", "b", "c", "d", "e", "f"] } }),
        signal({
          signalId: "IS-PK",
          sourceType: "work_pattern_observer",
          recurrenceCount: 2,
          evidence: { signal: "tool-failure", patternKey: "tool-failure:agt|/build|x" },
        }),
      ],
    });
    expect(result.ranked[0]!.trajectory).toEqual(
      ["a", "b", "c", "d", "e"].map((toolExecutionId) => ({ kind: "tool-execution", toolExecutionId })),
    );
    expect(result.ranked[1]!.trajectory).toEqual([{ kind: "pattern-key", patternKey: "tool-failure:agt|/build|x" }]);
  });

  it("rejects candidates with no trajectory and seed items that are missing or terminal", () => {
    const result = rankHarnessCandidates({
      now: NOW,
      maxCandidates: 10,
      seedItemIds: ["BI-GONE", "BI-DONE", "BI-RETIRED"],
      seedItems: [
        { itemId: "BI-DONE", title: "done", status: "done" },
        { itemId: "BI-RETIRED", title: "retired", status: "retired" },
      ],
      signals: [signal({ signalId: "IS-BARE", recurrenceCount: 50, evidence: {} })],
    });
    expect(result.ranked).toEqual([]);
    expect(result.rejected).toEqual([
      { candidateKey: "seed:BI-GONE", reason: "seed-missing" },
      { candidateKey: "seed:BI-DONE", reason: "seed-terminal", detail: "done" },
      { candidateKey: "seed:BI-RETIRED", reason: "seed-terminal", detail: "retired" },
      { candidateKey: "signal:IS-BARE", reason: "no-trajectory" },
    ]);
  });

  it("stops at maxCandidates and counts what it left for the next run", () => {
    const result = rankHarnessCandidates({
      now: NOW,
      maxCandidates: 2,
      seedItemIds: ["BI-S"],
      seedItems: [{ itemId: "BI-S", title: "s", status: "open" }],
      signals: [signal({ signalId: "IS-1", recurrenceCount: 3 }), signal({ signalId: "IS-2", recurrenceCount: 2 })],
    });
    expect(result.ranked.map((c) => c.candidateKey)).toEqual(["seed:BI-S", "signal:IS-1"]);
    expect(result.deferred).toBe(1);
  });

  it("hints the component tier from the signal source", () => {
    const result = rankHarnessCandidates({
      now: NOW,
      maxCandidates: 10,
      seedItemIds: [],
      seedItems: [],
      signals: [
        signal({ signalId: "IS-MCP", recurrenceCount: 4 }),
        signal({ signalId: "IS-CUR", sourceType: "curator-finding", recurrenceCount: 3 }),
        signal({ signalId: "IS-WP", sourceType: "work_pattern_observer", recurrenceCount: 2 }),
        signal({ signalId: "IS-OTHER", sourceType: "workroom-flow-bottleneck", recurrenceCount: 1 }),
      ],
    });
    expect(Object.fromEntries(result.ranked.map((c) => [c.signalId, c.componentHint]))).toEqual({
      "IS-MCP": "gate-hook-script",
      "IS-CUR": "skill",
      "IS-WP": "gate-hook-script",
      "IS-OTHER": "unclassified",
    });
  });
});
