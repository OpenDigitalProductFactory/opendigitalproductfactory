// apps/web/lib/orchestration/primitives/branch.ts
// Branch primitive — competing strategies that merge into a single outcome.
// See: spec §Branch — Semantics

import type { Outcome, RunContext } from "../types";
import type { Step } from "./sequential";

export type BranchSpec<T> = {
  name: string;
  step: Step<T>;
};

export type BranchOpts<T, U> = {
  merge: (outcomes: Outcome<T>[]) => Outcome<U>;
  // V1 dispatchMode toggle resolves spec Open Question #1: deliberation
  // preserves sequential dispatch; parallel is the natural default elsewhere.
  dispatchMode: "parallel" | "sequential";
  // exitEarly: if provided, the first branch outcome satisfying the predicate
  // cancels remaining branches before merge. Only meaningful for parallel.
  exitEarly?: (outcome: Outcome<T>) => boolean;
};

export async function Branch<T, U>(
  branches: BranchSpec<T>[],
  opts: BranchOpts<T, U>,
  ctx: RunContext,
): Promise<Outcome<U>> {
  if (opts.dispatchMode === "sequential") {
    const outcomes: Outcome<T>[] = [];
    for (const branch of branches) {
      const outcome = await branch.step(ctx);
      outcomes.push(outcome);
      // Sequential exitEarly: stop dispatching further branches; remaining
      // branches receive an upstream-cancelled stub.
      if (opts.exitEarly && opts.exitEarly(outcome)) {
        for (const remaining of branches.slice(outcomes.length)) {
          void remaining;
          outcomes.push({
            status: "cancelled",
            reason: "upstream_cancelled",
            evidence: [],
            attempts: 0,
          });
        }
        break;
      }
    }
    return opts.merge(outcomes);
  }

  // Parallel dispatch.
  if (!opts.exitEarly) {
    const outcomes = await Promise.all(branches.map((b) => b.step(ctx)));
    return opts.merge(outcomes);
  }

  // Parallel with exitEarly: race branches; first satisfier wins. Remaining
  // branches synthesize as upstream-cancelled in the merged result. Real
  // AbortController plumbing into step bodies is a follow-up; the primitive's
  // contract today is "cancelled outcomes appear in the merge input."
  const settled: Outcome<T>[] = [];
  let resolved = false;
  let winnerIndex = -1;

  await new Promise<void>((resolve) => {
    branches.forEach((branch, idx) => {
      branch
        .step(ctx)
        .then((outcome) => {
          if (resolved) return;
          settled[idx] = outcome;
          if (opts.exitEarly && opts.exitEarly(outcome)) {
            resolved = true;
            winnerIndex = idx;
            // Fill any unsettled slots with cancelled.
            for (let i = 0; i < branches.length; i++) {
              if (!settled[i]) {
                settled[i] = {
                  status: "cancelled",
                  reason: "upstream_cancelled",
                  evidence: [],
                  attempts: 0,
                };
              }
            }
            resolve();
          } else {
            // Check if all branches have now settled.
            if (settled.filter(Boolean).length === branches.length && !resolved) {
              resolved = true;
              resolve();
            }
          }
        })
        .catch(() => {
          // Step authors return Outcomes, not throws. A throw here is a
          // contract violation — surface as failed.
          if (resolved) return;
          settled[idx] = {
            status: "failed",
            error: { name: "BranchStepThrew", message: `branch ${branch.name} threw` },
            evidence: [],
          };
          if (settled.filter(Boolean).length === branches.length && !resolved) {
            resolved = true;
            resolve();
          }
        });
    });
  });

  void winnerIndex;
  return opts.merge(settled);
}
