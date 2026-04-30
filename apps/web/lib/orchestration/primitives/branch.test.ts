// apps/web/lib/orchestration/primitives/branch.test.ts

import { describe, expect, it, vi } from "vitest";
import { Branch } from "./branch";
import type { Outcome, RunContext } from "../types";

const ctx: RunContext = {
  runId: "test-run",
  userId: "u1",
  governanceProfile: "balanced",
};

const ok = <T>(value: T): Outcome<T> => ({
  status: "succeeded",
  value,
  evidence: [],
});

const fail = (message: string): Outcome<never> => ({
  status: "failed",
  error: { name: "TestError", message },
  evidence: [],
});

const collectValues = <T>(outcomes: Outcome<T>[]): T[] =>
  outcomes
    .filter((o): o is Extract<Outcome<T>, { status: "succeeded" }> => o.status === "succeeded")
    .map((o) => o.value);

describe("Branch", () => {
  it("all branches succeed: merge invoked with all outcomes; returns merged success", async () => {
    const merge = vi.fn(
      (outcomes: Outcome<string>[]): Outcome<string[]> => ({
        status: "succeeded",
        value: collectValues(outcomes),
        evidence: [],
      }),
    );
    const result = await Branch<string, string[]>(
      [
        { name: "A", step: async () => ok("a") },
        { name: "B", step: async () => ok("b") },
        { name: "C", step: async () => ok("c") },
      ],
      { merge, dispatchMode: "parallel" },
      ctx,
    );
    expect(result.status).toBe("succeeded");
    expect(merge).toHaveBeenCalledTimes(1);
    if (result.status === "succeeded") {
      expect(result.value.sort()).toEqual(["a", "b", "c"]);
    }
  });

  it("mixed outcomes: merge receives all; merge logic decides terminal", async () => {
    const merge = (outcomes: Outcome<string>[]): Outcome<string[]> => {
      const succeeded = collectValues(outcomes);
      return succeeded.length >= 2
        ? { status: "succeeded", value: succeeded, evidence: [] }
        : {
            status: "failed",
            error: { name: "InsufficientSuccesses", message: `${succeeded.length} succeeded` },
            evidence: [],
          };
    };

    const passes = await Branch<string, string[]>(
      [
        { name: "A", step: async () => ok("a") },
        { name: "B", step: async () => ok("b") },
        { name: "C", step: async () => fail("x") },
      ],
      { merge, dispatchMode: "parallel" },
      ctx,
    );
    expect(passes.status).toBe("succeeded");

    const failsToMeet = await Branch<string, string[]>(
      [
        { name: "A", step: async () => ok("a") },
        { name: "B", step: async () => fail("x") },
        { name: "C", step: async () => fail("y") },
      ],
      { merge, dispatchMode: "parallel" },
      ctx,
    );
    expect(failsToMeet.status).toBe("failed");
  });

  it("exitEarly: first satisfying branch wins; remaining branches receive cancelled outcome from runtime", async () => {
    const slowSteps = {
      A: vi.fn(async (): Promise<Outcome<string>> => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return ok("a-fast");
      }),
      B: vi.fn(async (): Promise<Outcome<string>> => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return ok("b-slow");
      }),
      C: vi.fn(async (): Promise<Outcome<string>> => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return ok("c-slow");
      }),
    };
    const result = await Branch<string, string>(
      [
        { name: "A", step: slowSteps.A },
        { name: "B", step: slowSteps.B },
        { name: "C", step: slowSteps.C },
      ],
      {
        merge: (outcomes): Outcome<string> => {
          const winner = outcomes.find((o) => o.status === "succeeded");
          return winner && winner.status === "succeeded"
            ? { status: "succeeded", value: winner.value, evidence: [] }
            : { status: "failed", error: { name: "NoWinner", message: "" }, evidence: [] };
        },
        dispatchMode: "parallel",
        exitEarly: (o) => o.status === "succeeded",
      },
      ctx,
    );
    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.value).toBe("a-fast");
    }
  });

  it("dispatchMode 'sequential' runs branches one at a time", async () => {
    const order: string[] = [];
    const result = await Branch<string, string[]>(
      [
        {
          name: "A",
          step: async () => {
            order.push("A-start");
            await new Promise((resolve) => setTimeout(resolve, 5));
            order.push("A-end");
            return ok("a");
          },
        },
        {
          name: "B",
          step: async () => {
            order.push("B-start");
            await new Promise((resolve) => setTimeout(resolve, 5));
            order.push("B-end");
            return ok("b");
          },
        },
      ],
      {
        merge: (outcomes): Outcome<string[]> => ({
          status: "succeeded",
          value: collectValues(outcomes),
          evidence: [],
        }),
        dispatchMode: "sequential",
      },
      ctx,
    );
    expect(result.status).toBe("succeeded");
    // Sequential dispatch: A finishes before B starts.
    expect(order).toEqual(["A-start", "A-end", "B-start", "B-end"]);
  });
});
