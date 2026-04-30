// apps/web/lib/orchestration/primitives/parallel.ts
// Parallel primitive — run independent work concurrently, synthesize via explicit policy.
// See: spec §Parallel — Semantics

import type { Outcome, RunContext } from "../types";
import type { Step } from "./sequential";

export type ParallelOpts<T, U> =
  | {
      errorPolicy: "all_must_succeed";
      synthesize: (outcomes: Outcome<T>[]) => Outcome<U>;
    }
  | {
      errorPolicy: "best_effort";
      synthesize: (outcomes: Outcome<T>[]) => Outcome<U>;
    }
  | {
      errorPolicy: "quorum";
      minSucceeded: number;
      synthesize: (outcomes: Outcome<T>[]) => Outcome<U>;
    };

export async function Parallel<T, U>(
  steps: Step<T>[],
  opts: ParallelOpts<T, U>,
  ctx: RunContext,
): Promise<Outcome<U>> {
  // Validate construction-time invariants. quorum without minSucceeded is a
  // contract violation; fail loud at the boundary rather than silently
  // proceeding with an undefined threshold.
  if (opts.errorPolicy === "quorum" && typeof opts.minSucceeded !== "number") {
    throw new Error("Parallel quorum policy requires opts.minSucceeded (number)");
  }

  // Run all branches concurrently. Step functions return Outcomes (not throw),
  // so allSettled is overkill — Promise.all suffices given the contract that
  // step authors handle their own errors and produce typed outcomes.
  const outcomes = await Promise.all(steps.map((step) => step(ctx)));

  const succeededCount = outcomes.filter((o) => o.status === "succeeded").length;

  switch (opts.errorPolicy) {
    case "all_must_succeed":
      if (succeededCount < outcomes.length) {
        return {
          status: "failed",
          error: {
            name: "ParallelPartialFailure",
            message: `${outcomes.length - succeededCount} of ${outcomes.length} branches failed under all_must_succeed`,
          },
          evidence: outcomes.flatMap((o) => o.evidence),
        };
      }
      return opts.synthesize(outcomes);

    case "best_effort":
      if (succeededCount === 0) {
        return {
          status: "failed",
          error: {
            name: "ParallelAllFailed",
            message: "All branches failed under best_effort policy",
          },
          evidence: outcomes.flatMap((o) => o.evidence),
        };
      }
      return opts.synthesize(outcomes);

    case "quorum":
      if (succeededCount < opts.minSucceeded) {
        return {
          status: "failed",
          error: {
            name: "ParallelQuorumNotMet",
            message: `quorum policy required ${opts.minSucceeded} successes; got ${succeededCount}`,
          },
          evidence: outcomes.flatMap((o) => o.evidence),
        };
      }
      return opts.synthesize(outcomes);
  }
}
