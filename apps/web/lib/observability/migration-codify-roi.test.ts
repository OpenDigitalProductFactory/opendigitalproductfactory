import { describe, expect, it } from "vitest";

import {
  rankByCodifyRoi,
  summarizeCostPerPattern,
  type CodifyCandidate,
  type PatternCostSample,
} from "./migration-codify-roi";

function sample(over: Partial<PatternCostSample> & { costUsd: number }): PatternCostSample {
  return { agentId: "a", toolName: "t", inputShape: "s", totalTokens: 0, ...over };
}

describe("summarizeCostPerPattern", () => {
  it("groups by (agent x tool x input-shape) and sums cost + tokens", () => {
    const out = summarizeCostPerPattern([
      sample({ costUsd: 0.1, totalTokens: 100 }),
      sample({ costUsd: 0.3, totalTokens: 300 }),
      sample({ agentId: "b", costUsd: 1.0, totalTokens: 50 }),
    ]);
    expect(out["a t s"]!.invocations).toBe(2);
    expect(out["a t s"]!.totalCostUsd).toBeCloseTo(0.4, 6);
    expect(out["a t s"]!.avgCostUsd).toBeCloseTo(0.2, 6);
    expect(out["a t s"]!.totalTokens).toBe(400);
    expect(out["b t s"]!.invocations).toBe(1);
  });

  it("treats non-finite/negative cost and tokens as zero", () => {
    const out = summarizeCostPerPattern([
      sample({ costUsd: Number.NaN, totalTokens: -5 }),
      sample({ costUsd: -1, totalTokens: Number.POSITIVE_INFINITY }),
      sample({ costUsd: 0.5, totalTokens: 10 }),
    ]);
    expect(out["a t s"]!.invocations).toBe(3);
    expect(out["a t s"]!.totalCostUsd).toBeCloseTo(0.5, 6);
    expect(out["a t s"]!.totalTokens).toBe(10);
  });

  it("returns an empty object for no samples", () => {
    expect(summarizeCostPerPattern([])).toEqual({});
  });
});

describe("rankByCodifyRoi", () => {
  const cand = (over: Partial<CodifyCandidate>): CodifyCandidate => ({
    agentId: "a",
    toolName: "t",
    inputShape: "s",
    recurrence: 10,
    ...over,
  });

  it("ranks codify candidates by total cost burned, highest first", () => {
    const costByKey = {
      "a cheap s": { invocations: 50, totalCostUsd: 1.0, avgCostUsd: 0.02, totalTokens: 0 },
      "a pricey s": { invocations: 20, totalCostUsd: 8.0, avgCostUsd: 0.4, totalTokens: 0 },
    };
    const ranked = rankByCodifyRoi([cand({ toolName: "cheap" }), cand({ toolName: "pricey" })], costByKey);
    expect(ranked[0]!.toolName).toBe("pricey");
    expect(ranked[0]!.totalCostUsd).toBe(8.0);
    expect(ranked[1]!.toolName).toBe("cheap");
  });

  it("sorts candidates with no cost data last", () => {
    const costByKey = { "a known s": { invocations: 10, totalCostUsd: 2.0, avgCostUsd: 0.2, totalTokens: 0 } };
    const ranked = rankByCodifyRoi([cand({ toolName: "unknown" }), cand({ toolName: "known" })], costByKey);
    expect(ranked[0]!.toolName).toBe("known");
    expect(ranked[1]!.totalCostUsd).toBe(0);
  });

  it("breaks cost ties by recurrence desc", () => {
    const ranked = rankByCodifyRoi([cand({ toolName: "x", recurrence: 5 }), cand({ toolName: "y", recurrence: 50 })], {});
    expect(ranked[0]!.toolName).toBe("y");
  });

  it("returns an empty array for no candidates", () => {
    expect(rankByCodifyRoi([], {})).toEqual([]);
  });
});
