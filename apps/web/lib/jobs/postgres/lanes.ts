import type { JobConcurrency, JobConcurrencyOption } from "../types";
import { evaluateKey } from "./expressions";

/** One concurrency constraint, resolved for one run (spec 2026-09-25 §5.3). */
export type Lane = { key: string; limit: number };

function constraints(option: JobConcurrencyOption | undefined): JobConcurrency[] {
  if (!option) return [];
  return Array.isArray(option) ? [...option] : [option as JobConcurrency];
}

/**
 * The lanes a run of `functionId` occupies while it runs.
 *
 * A function-scoped constraint is a lane of its own per key value; an
 * `env`/`account` constraint is shared by every function that names the same
 * key, which is how the build-pipeline lane in `lib/queue/admission.ts` bounds
 * its enrolled functions together. Sorted, so every claimer takes the lanes'
 * advisory locks in the same order and two claimers cannot deadlock.
 */
export function lanesFor(functionId: string, option: JobConcurrencyOption | undefined, event: unknown): Lane[] {
  const lanes = constraints(option).map((constraint) => {
    if (!Number.isInteger(constraint.limit) || constraint.limit < 1) {
      throw new Error(`Concurrency limit for ${functionId} must be a positive integer.`);
    }
    const value = constraint.key ? evaluateKey(constraint.key, { event }) : "";
    const scope = constraint.scope ?? "fn";
    const key = scope === "fn" ? `fn:${functionId}:${value}` : `${scope}:${value}`;
    return { key, limit: constraint.limit };
  });
  return lanes.sort((left, right) => left.key.localeCompare(right.key));
}
