// The steering engine must degrade on schedule (BI-D8D1371B).
//
// principle_decide is deterministic MCDA and its scoring was never the problem.
// Its RETRIEVAL depends on an embedding provider, and each attempt carries a 30s
// abort. One decide call issues several — two wiki searches that embed
// internally, one embedding per candidate principle lacking a dimensionVector
// (~49 concurrent on a sparse call), one per option. Nothing bounded the total,
// so a provider that STALLS rather than fails fast produced a 60-120s hang past
// any client timeout. Two governed architecture decisions timed out that way on
// 2026-09-03 and were recorded as unratified judgment.
//
// These tests exercise the real helper, not a copy of it — a test that
// reimplements the race would keep passing while the shipped one regressed.
//
// They deliberately do NOT assert that the availability probe moved earlier:
// BI-512FBD20 decided not to pay a 5s probe on healthy calls, and that decision
// still stands. The defect was the missing budget, not the probe's position.

import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_RETRIEVAL_BUDGET_MS,
  createRetrievalBudget,
  resolveRetrievalBudgetMs,
  retrievePrincipleTiers,
} from "./retrieval-budget";

const never = <T,>(): Promise<T> => new Promise<T>(() => {});

describe("createRetrievalBudget", () => {
  it("returns the fallback instead of waiting on a stalled provider", async () => {
    vi.useFakeTimers();
    try {
      const budget = createRetrievalBudget(8000);
      const result = budget.run(never<string[]>(), []);
      await vi.advanceTimersByTimeAsync(8000);
      expect(await result).toEqual([]);
      expect(budget.exceeded()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds the caller's wait well below the 30s embedding abort", async () => {
    vi.useFakeTimers();
    try {
      const budget = createRetrievalBudget(8000);
      const result = budget.run(never<number[] | undefined>(), undefined);
      await vi.advanceTimersByTimeAsync(8000);
      expect(await result).toBeUndefined();
      // Settled without needing the provider's own 30s abort.
      await vi.advanceTimersByTimeAsync(30_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is inert on the healthy path", async () => {
    // The overwhelmingly common case must be unchanged and unmarked.
    const budget = createRetrievalBudget(8000);
    const rows = [{ id: "p1" }];
    expect(await budget.run(Promise.resolve(rows), [])).toBe(rows);
    expect(budget.exceeded()).toBe(false);
  });

  it("bounds a fan-out the same way it bounds one call", async () => {
    // ~49 concurrent embeddings against a runner already hosting a 27B model:
    // the burst contributed to the contention it then waited on.
    vi.useFakeTimers();
    try {
      const budget = createRetrievalBudget(8000);
      const fanOut = Promise.all(Array.from({ length: 49 }, () => never<number[] | undefined>()));
      const result = budget.run(fanOut, Array.from({ length: 49 }, () => undefined));
      await vi.advanceTimersByTimeAsync(8000);
      expect(await result).toHaveLength(49);
      expect(budget.exceeded()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("resolveRetrievalBudgetMs", () => {
  it("defaults when unset, and rejects nonsense rather than disabling the budget", () => {
    expect(resolveRetrievalBudgetMs({})).toBe(DEFAULT_RETRIEVAL_BUDGET_MS);
    for (const bad of ["0", "-1", "abc", ""]) {
      expect(
        resolveRetrievalBudgetMs({ PRINCIPLE_DECIDE_RETRIEVAL_BUDGET_MS: bad }),
        bad,
      ).toBe(DEFAULT_RETRIEVAL_BUDGET_MS);
    }
    expect(resolveRetrievalBudgetMs({ PRINCIPLE_DECIDE_RETRIEVAL_BUDGET_MS: "1500" })).toBe(1500);
  });
});

describe("retrievePrincipleTiers", () => {
  const args = {
    query: "q",
    organizationId: "org",
    callingPopulation: "external_coding_agent",
    ringScope: undefined,
    contextualThreshold: 0.6,
  };

  it("returns both tiers when retrieval is healthy", async () => {
    const budget = createRetrievalBudget(8000);
    const search = vi.fn(async (input: Record<string, unknown>) =>
      input["principleTier"] === "core" ? [{ id: "c1" }] : [{ id: "x1" }],
    );
    const { core, contextual } = await retrievePrincipleTiers({ search, budget, ...args });
    expect(core).toEqual([{ id: "c1" }]);
    expect(contextual).toEqual([{ id: "x1" }]);
    expect(budget.exceeded()).toBe(false);
  });

  it("yields empty tiers instead of throwing when a lookup fails", async () => {
    // Commandments come from Postgres and are unaffected; a broken vector store
    // must degrade the optional tiers, never fail the decision outright.
    const budget = createRetrievalBudget(8000);
    const search = vi.fn(async () => {
      throw new Error("qdrant down");
    });
    const { core, contextual } = await retrievePrincipleTiers({ search, budget, ...args });
    expect(core).toEqual([]);
    expect(contextual).toEqual([]);
  });

  it("yields empty tiers and marks the budget when the provider stalls", async () => {
    vi.useFakeTimers();
    try {
      const budget = createRetrievalBudget(8000);
      const search = vi.fn(() => never<unknown>());
      const p = retrievePrincipleTiers({ search, budget, ...args });
      await vi.advanceTimersByTimeAsync(16_000);
      const { core, contextual } = await p;
      expect(core).toEqual([]);
      expect(contextual).toEqual([]);
      expect(budget.exceeded()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes the contextual score threshold only to the contextual tier", async () => {
    const budget = createRetrievalBudget(8000);
    const seen: Array<Record<string, unknown>> = [];
    const search = vi.fn(async (input: Record<string, unknown>) => {
      seen.push(input);
      return [];
    });
    await retrievePrincipleTiers({ search, budget, ...args });
    const core = seen.find((s) => s["principleTier"] === "core");
    const contextual = seen.find((s) => s["principleTier"] === "contextual");
    expect(core?.["scoreThreshold"]).toBeUndefined();
    expect(contextual?.["scoreThreshold"]).toBe(0.6);
  });
});
