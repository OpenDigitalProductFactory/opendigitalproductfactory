import { describe, it, expect } from "vitest";
import {
  summarizeThreadSpend,
  combineThreadSpend,
  formatThreadSpend,
  EMPTY_THREAD_SPEND,
  type SpendRow,
} from "./thread-cost-ledger";

describe("summarizeThreadSpend", () => {
  it("returns empty spend for no rows", () => {
    expect(summarizeThreadSpend([])).toEqual(EMPTY_THREAD_SPEND);
  });

  it("sums inference and tool rows and counts each source", () => {
    const rows: SpendRow[] = [
      { source: "inference", inputTokens: 100, outputTokens: 50, costUsd: 0.01 },
      { source: "inference", inputTokens: 200, outputTokens: 80, costUsd: 0.02 },
      { source: "tool", inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
    ];
    const s = summarizeThreadSpend(rows);
    expect(s.inputTokens).toBe(310);
    expect(s.outputTokens).toBe(135);
    expect(s.totalTokens).toBe(445);
    expect(s.costUsd).toBeCloseTo(0.031, 6);
    expect(s.inferenceRuns).toBe(2);
    expect(s.toolCalls).toBe(1);
  });

  it("treats null token/cost fields as zero", () => {
    const rows: SpendRow[] = [
      { source: "inference", inputTokens: null, outputTokens: null, costUsd: null },
      { source: "tool", inputTokens: 7, outputTokens: null, costUsd: null },
    ];
    const s = summarizeThreadSpend(rows);
    expect(s.inputTokens).toBe(7);
    expect(s.outputTokens).toBe(0);
    expect(s.costUsd).toBe(0);
    expect(s.inferenceRuns).toBe(1);
    expect(s.toolCalls).toBe(1);
  });

  // BI-CCF1ACBB: Anthropic's inputTokens is the UNCACHED input only. A turn
  // served from a prompt-cache prefix reports ~17 there and carries the prompt
  // the model actually read in the cache fields. The ledger must count all of
  // it as input, and keep the cache split visible for pricing.
  it("folds prompt-cache tokens into inputTokens and keeps the cache split visible", () => {
    const rows: SpendRow[] = [
      {
        source: "inference",
        inputTokens: 17,
        outputTokens: 900,
        costUsd: null,
        cacheCreationInputTokens: 12_000,
        cachedInputTokens: 30_000,
      },
      // A local model: no caching, fields absent — behaves exactly as before.
      { source: "inference", inputTokens: 3_000, outputTokens: 700, costUsd: null },
      // A tool row never carries cache fields.
      { source: "tool", inputTokens: 10, outputTokens: 5, costUsd: 0.001, cachedInputTokens: null },
    ];
    const s = summarizeThreadSpend(rows);
    expect(s.inputTokens).toBe(17 + 12_000 + 30_000 + 3_000 + 10);
    expect(s.cacheCreationInputTokens).toBe(12_000);
    expect(s.cachedInputTokens).toBe(30_000);
    expect(s.outputTokens).toBe(1_605);
    expect(s.totalTokens).toBe(s.inputTokens + s.outputTokens);
    expect(s.inferenceRuns).toBe(2);
    expect(s.toolCalls).toBe(1);
  });
});

describe("combineThreadSpend", () => {
  it("sums several thread rollups into an effort total", () => {
    const a = summarizeThreadSpend([
      { source: "inference", inputTokens: 100, outputTokens: 40, costUsd: 0.01 },
    ]);
    const b = summarizeThreadSpend([
      { source: "tool", inputTokens: 20, outputTokens: 10, costUsd: 0.002 },
      { source: "inference", inputTokens: 50, outputTokens: 25, costUsd: 0.005 },
    ]);
    const total = combineThreadSpend([a, b]);
    expect(total.inputTokens).toBe(170);
    expect(total.outputTokens).toBe(75);
    expect(total.totalTokens).toBe(245);
    expect(total.costUsd).toBeCloseTo(0.017, 6);
    expect(total.inferenceRuns).toBe(2);
    expect(total.toolCalls).toBe(1);
  });

  it("carries the cache split through an effort total", () => {
    const a = summarizeThreadSpend([
      { source: "inference", inputTokens: 10, outputTokens: 1, costUsd: null, cacheCreationInputTokens: 100, cachedInputTokens: 1_000 },
    ]);
    const b = summarizeThreadSpend([
      { source: "inference", inputTokens: 20, outputTokens: 2, costUsd: null, cachedInputTokens: 2_000 },
    ]);
    const total = combineThreadSpend([a, b]);
    expect(total.inputTokens).toBe(10 + 100 + 1_000 + 20 + 2_000);
    expect(total.cacheCreationInputTokens).toBe(100);
    expect(total.cachedInputTokens).toBe(3_000);
  });

  it("is empty for no threads", () => {
    expect(combineThreadSpend([])).toEqual(EMPTY_THREAD_SPEND);
  });
});

describe("formatThreadSpend", () => {
  it("uses 2-decimal dollars above a cent and singular/plural counts", () => {
    const s = summarizeThreadSpend([
      { source: "inference", inputTokens: 1000, outputTokens: 500, costUsd: 1.5 },
    ]);
    const out = formatThreadSpend(s);
    expect(out).toContain("1,500 tokens");
    expect(out).toContain("$1.50");
    expect(out).toContain("1 inference run");
    expect(out).toContain("0 tool calls");
  });

  it("uses 4-decimal dollars for sub-cent spend", () => {
    const s = summarizeThreadSpend([
      { source: "tool", inputTokens: 10, outputTokens: 5, costUsd: 0.0012 },
    ]);
    expect(formatThreadSpend(s)).toContain("$0.0012");
  });
});
