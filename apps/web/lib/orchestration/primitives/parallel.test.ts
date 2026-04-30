// apps/web/lib/orchestration/primitives/parallel.test.ts

import { describe, expect, it, vi } from "vitest";
import { Parallel } from "./parallel";
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

describe("Parallel", () => {
  it("all_must_succeed: any failure returns failed with full trail", async () => {
    const s1 = vi.fn(async () => ok("a"));
    const s2 = vi.fn(async () => fail("boom"));
    const s3 = vi.fn(async () => ok("c"));

    const result = await Parallel(
      [s1, s2, s3],
      {
        errorPolicy: "all_must_succeed",
        synthesize: (outcomes) => ({
          status: "succeeded",
          value: collectValues(outcomes),
          evidence: [],
        }),
      },
      ctx,
    );

    expect(result.status).toBe("failed");
    // All three steps still ran (Promise.allSettled semantics).
    expect(s1).toHaveBeenCalled();
    expect(s2).toHaveBeenCalled();
    expect(s3).toHaveBeenCalled();
  });

  it("best_effort: synthesizes over succeeded; zero-succeeded returns failed", async () => {
    const partial = await Parallel(
      [async () => ok("a"), async () => fail("x"), async () => ok("c")],
      {
        errorPolicy: "best_effort",
        synthesize: (outcomes) => ({
          status: "succeeded",
          value: collectValues(outcomes),
          evidence: [],
        }),
      },
      ctx,
    );
    expect(partial.status).toBe("succeeded");
    if (partial.status === "succeeded") {
      expect(partial.value).toEqual(["a", "c"]);
    }

    const allFailed = await Parallel(
      [async () => fail("x"), async () => fail("y")],
      {
        errorPolicy: "best_effort",
        synthesize: (outcomes) => ({
          status: "succeeded",
          value: collectValues(outcomes),
          evidence: [],
        }),
      },
      ctx,
    );
    expect(allFailed.status).toBe("failed");
  });

  it("quorum: passes at minSucceeded, fails below", async () => {
    const passes = await Parallel(
      [async () => ok("a"), async () => ok("b"), async () => fail("x")],
      {
        errorPolicy: "quorum",
        minSucceeded: 2,
        synthesize: (outcomes) => ({
          status: "succeeded",
          value: collectValues(outcomes),
          evidence: [],
        }),
      },
      ctx,
    );
    expect(passes.status).toBe("succeeded");

    const fails = await Parallel(
      [async () => ok("a"), async () => fail("x"), async () => fail("y")],
      {
        errorPolicy: "quorum",
        minSucceeded: 2,
        synthesize: (outcomes) => ({
          status: "succeeded",
          value: collectValues(outcomes),
          evidence: [],
        }),
      },
      ctx,
    );
    expect(fails.status).toBe("failed");
  });

  it("quorum without minSucceeded throws at construction", async () => {
    // The discriminated union enforces minSucceeded at compile time. To exercise the
    // runtime guard (defense in depth — the type can be subverted via `as` or JS callers),
    // we cast through `unknown` to a malformed shape.
    const malformedOpts = {
      errorPolicy: "quorum" as const,
      synthesize: (outcomes: Outcome<string>[]) => ({
        status: "succeeded" as const,
        value: collectValues(outcomes),
        evidence: [],
      }),
    } as unknown as Parameters<typeof Parallel<string, string[]>>[1];

    await expect(
      Parallel([async () => ok("a")], malformedOpts, ctx),
    ).rejects.toThrow(/minSucceeded/i);
  });
});
