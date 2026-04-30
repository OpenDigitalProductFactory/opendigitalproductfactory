// apps/web/lib/orchestration/primitives/sequential.ts
// Sequential primitive — run ordered steps, short-circuit on first non-success terminal.
// See: spec §Sequential — Semantics

import { assertNever } from "../assert-never";
import type { Outcome, RunContext } from "../types";

export type Step<T> = (ctx: RunContext) => Promise<Outcome<T>>;

export async function Sequential<T>(
  steps: Step<T>[],
  ctx: RunContext,
): Promise<Outcome<T[]>> {
  const values: T[] = [];
  const evidence = [];

  for (const step of steps) {
    const outcome = await step(ctx);
    switch (outcome.status) {
      case "succeeded":
        values.push(outcome.value);
        evidence.push(...outcome.evidence);
        break;
      case "failed":
      case "exhausted":
      case "cancelled":
        // Short-circuit: return the non-success outcome unchanged.
        return outcome as Outcome<T[]>;
      default:
        assertNever(outcome, "Sequential outcome");
    }
  }

  return { status: "succeeded", value: values, evidence };
}
