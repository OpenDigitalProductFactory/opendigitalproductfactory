// apps/web/lib/orchestration/primitives/loop.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Loop } from "./loop";
import type { Outcome, RunContext } from "../types";

const ctx = (overrides: Partial<RunContext> = {}): RunContext => ({
  runId: "test-run",
  userId: "u1",
  governanceProfile: "balanced",
  ...overrides,
});

const ok = <T>(value: T, tokensUsed = 0): Outcome<T> & { tokensUsed?: number } => ({
  status: "succeeded",
  value,
  evidence: [],
  tokensUsed,
});

const fail = (message: string, tokensUsed = 0): Outcome<never> & { tokensUsed?: number } => ({
  status: "failed",
  error: { name: "TestError", message },
  evidence: [],
  tokensUsed,
});

describe("Loop", () => {
  it("succeeds when exitWhen returns true", async () => {
    let attempts = 0;
    const result = await Loop<string>(
      async () => {
        attempts += 1;
        return attempts === 2 ? ok("done") : fail("not yet");
      },
      {
        exitWhen: (o) => o.status === "succeeded",
        strategy: () => ({}),
      },
      ctx(),
    );
    expect(result.status).toBe("succeeded");
    expect(attempts).toBe(2);
  });

  it("exhausts with reason 'max_attempts' when budget hits maxAttempts; evidence trail covers all attempts", async () => {
    const result = await Loop<string>(
      async () => fail("never"),
      {
        exitWhen: (o) => o.status === "succeeded",
        strategy: () => ({}),
      },
      // economy profile has maxAttempts=2
      ctx({ governanceProfile: "economy" }),
    );
    expect(result.status).toBe("exhausted");
    if (result.status === "exhausted") {
      expect(result.reason).toBe("max_attempts");
      expect(result.attempts).toBe(2);
      expect(result.evidence.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("exhausts with reason 'deadline' when deadlineMs elapses", async () => {
    vi.useFakeTimers();
    try {
      const promise = Loop<string>(
        async () => {
          // simulate slow step by advancing wall-clock per attempt
          vi.advanceTimersByTime(35_000);
          return fail("slow");
        },
        {
          exitWhen: (o) => o.status === "succeeded",
          strategy: () => ({}),
        },
        // system profile has deadlineMs=60_000
        ctx({ governanceProfile: "system" }),
      );
      // Drain microtasks while ticking time forward.
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.status).toBe("exhausted");
      if (result.status === "exhausted") {
        expect(result.reason).toBe("deadline");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("exhausts with reason 'token_budget' when cumulative tokensUsed exceeds budget", async () => {
    let attempts = 0;
    const result = await Loop<string>(
      async () => {
        attempts += 1;
        return fail(`attempt ${attempts}`, 15_000); // economy.tokenBudget = 20_000
      },
      {
        exitWhen: (o) => o.status === "succeeded",
        strategy: () => ({}),
      },
      ctx({ governanceProfile: "economy" }),
    );
    expect(result.status).toBe("exhausted");
    if (result.status === "exhausted") {
      expect(result.reason).toBe("token_budget");
      // Two attempts at 15k each → 30k > 20k, exhausted on second.
      expect(attempts).toBeGreaterThanOrEqual(2);
    }
  });

  it("strategy is invoked with prior outcomes + attempt number; attempt 0 receives empty priors", async () => {
    const strategy = vi.fn<(priors: Outcome<string>[], attemptNumber: number) => unknown>(
      () => ({}),
    );
    let attempts = 0;
    await Loop<string>(
      async () => {
        attempts += 1;
        return attempts === 3 ? ok("done") : fail("not yet");
      },
      {
        exitWhen: (o) => o.status === "succeeded",
        strategy,
      },
      ctx(),
    );
    expect(strategy).toHaveBeenCalledTimes(3);
    // Attempt 0: empty priors
    expect(strategy.mock.calls[0]?.[0]).toEqual([]);
    expect(strategy.mock.calls[0]?.[1]).toBe(0);
    // Attempt 1: one prior, attemptNumber=1
    expect(strategy.mock.calls[1]?.[0]).toHaveLength(1);
    expect(strategy.mock.calls[1]?.[1]).toBe(1);
    // Attempt 2: two priors
    expect(strategy.mock.calls[2]?.[0]).toHaveLength(2);
    expect(strategy.mock.calls[2]?.[1]).toBe(2);
  });

  it("step returning Outcome.cancelled propagates as Loop cancellation", async () => {
    const result = await Loop<string>(
      async () => ({
        status: "cancelled",
        reason: "user_cancelled",
        evidence: [],
        attempts: 1,
      }),
      {
        exitWhen: (o) => o.status === "succeeded",
        strategy: () => ({}),
      },
      ctx(),
    );
    expect(result.status).toBe("cancelled");
  });
});
