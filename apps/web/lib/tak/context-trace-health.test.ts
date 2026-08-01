// BI-3E218D80 read half — context-trace health projection.
//
// The assertions that earn this module: a malformed or old row is SKIPPED rather than
// guessed at (an operator is about to make a decision from these averages), and the
// wording reports the DECISION rather than a verdict on answer quality.
import { describe, expect, it } from "vitest";

import {
  describeContextTraceHealth,
  parseStoredTrace,
  summarizeContextTraces,
} from "./context-trace-health";

const trace = (over: Record<string, unknown> = {}) => ({
  version: 1,
  modelTier: "strong",
  budget: { total: 3000, l0: 625, l1: 800, l2: 1575 },
  totalTokens: 2000,
  budgetUtilization: 0.667,
  selected: [{ source: "domain", tier: "L1", tokenCount: 400 }],
  dropped: [],
  ...over,
});

describe("parsing an untrusted JSON column", () => {
  it("accepts a well-formed v1 trace", () => {
    expect(parseStoredTrace(trace())).not.toBeNull();
  });

  it("rejects null, non-objects, and arrays rather than throwing", () => {
    for (const bad of [null, undefined, 42, "trace", [], true]) {
      expect(parseStoredTrace(bad)).toBeNull();
    }
  });

  it("rejects a future or missing version instead of misreading it", () => {
    expect(parseStoredTrace(trace({ version: 2 }))).toBeNull();
    expect(parseStoredTrace(trace({ version: undefined }))).toBeNull();
  });

  it("rejects a row missing the numbers the projection averages", () => {
    expect(parseStoredTrace(trace({ budgetUtilization: "high" }))).toBeNull();
    expect(parseStoredTrace(trace({ totalTokens: null }))).toBeNull();
    expect(parseStoredTrace(trace({ dropped: undefined }))).toBeNull();
  });
});

describe("aggregation", () => {
  it("counts only rows it understood, so a rate is never computed over unreadable rows", () => {
    const health = summarizeContextTraces([
      trace(),
      trace(),
      "garbage",
      null,
      trace({ version: 9 }), // a future shape — skipped, not guessed at
    ]);
    expect(health.turns).toBe(2);
  });

  it("treats a dropped source and a compressed source as loss", () => {
    const health = summarizeContextTraces([
      trace({ dropped: [{ source: "semantic-memory", tier: "L2", tokenCount: 900 }] }),
      trace({ selected: [{ source: "page-data", tier: "L1", tokenCount: 120, usedCompressed: true }] }),
      trace(),
    ]);
    expect(health.turns).toBe(3);
    expect(health.turnsWithLoss).toBe(2);
    expect(health.lossRate).toBe(0.667);
  });

  it("ranks worst-first: dropped outranks compressed, ties break on tokens lost", () => {
    const health = summarizeContextTraces([
      trace({ dropped: [{ source: "semantic-memory", tier: "L2", tokenCount: 900 }] }),
      trace({ dropped: [{ source: "semantic-memory", tier: "L2", tokenCount: 800 }] }),
      trace({ dropped: [{ source: "knowledge", tier: "L2", tokenCount: 300 }] }),
      trace({ selected: [{ source: "page-data", tier: "L1", tokenCount: 10, usedCompressed: true }] }),
    ]);
    expect(health.losses.map((l) => l.source)).toEqual(["semantic-memory", "knowledge", "page-data"]);
    expect(health.losses[0]).toMatchObject({ droppedTurns: 2, droppedTokens: 1700, compressedTurns: 0 });
    expect(health.losses[2]).toMatchObject({ droppedTurns: 0, compressedTurns: 1 });
  });

  it("reports turns at or over the budget ceiling", () => {
    const health = summarizeContextTraces([
      trace({ budgetUtilization: 0.5 }),
      trace({ budgetUtilization: 1 }),
      trace({ budgetUtilization: 1.2 }),
    ]);
    expect(health.turnsAtCeiling).toBe(2);
    expect(health.meanUtilization).toBe(0.9);
  });

  it("splits by model tier, because loss reads differently per tier", () => {
    const health = summarizeContextTraces([
      trace({ modelTier: "basic", dropped: [{ source: "knowledge", tier: "L2", tokenCount: 10 }] }),
      trace({ modelTier: "basic" }),
      trace({ modelTier: "frontier" }),
    ]);
    expect(health.byTier).toEqual([
      { modelTier: "basic", turns: 2, turnsWithLoss: 1 },
      { modelTier: "frontier", turns: 1, turnsWithLoss: 0 },
    ]);
  });

  it("an empty sample is zeroed, never NaN", () => {
    const health = summarizeContextTraces([]);
    expect(health).toMatchObject({ turns: 0, lossRate: 0, meanUtilization: 0, losses: [], byTier: [] });
  });
});

describe("operator sentence", () => {
  // The module can say what the arbitrator DID. It cannot say whether the loss mattered —
  // that needs the answer the coworker gave. Overstating it would rebuild the attestation
  // problem in a dashboard, so this pins the wording.
  it("distinguishes 'nothing recorded yet' from 'nothing lost'", () => {
    expect(describeContextTraceHealth(summarizeContextTraces([]))).toMatch(/No turns .* recorded/);
    expect(describeContextTraceHealth(summarizeContextTraces([trace()]))).toMatch(/nothing dropped or compressed/);
  });

  it("names the rate and the worst source, and claims nothing about answer quality", () => {
    const sentence = describeContextTraceHealth(
      summarizeContextTraces([
        trace({ dropped: [{ source: "semantic-memory", tier: "L2", tokenCount: 900 }] }),
        trace(),
      ]),
    );
    expect(sentence).toContain("1 of 2 sampled turns (50%)");
    expect(sentence).toContain("semantic-memory");
    expect(sentence).not.toMatch(/degrad|worse|quality|wrong/i);
  });
});
