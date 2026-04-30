// apps/web/lib/orchestration/primitives/loop.ts
// Loop primitive — iterate-with-strategy until success, typed failure, exhaustion, or cancellation.
// See: spec §Loop — Semantics, §Governance Profile Registry

import { startHeartbeat, stopHeartbeat } from "../heartbeat";
import { resolveBudget } from "../governance-profiles";
import type { Outcome, RunContext, Evidence, ExhaustionReason } from "../types";

// Loop steps may attach a tokensUsed marker to their outcome so the runtime
// can enforce token-budget exhaustion. Steps that don't call models simply
// omit the field; resolveBudget's tokenBudget=0 (system profile) means the
// check is skipped for infra polling loops.
type LoopStepOutcome<T> = Outcome<T> & { tokensUsed?: number };

export type LoopStep<T> = (
  ctx: RunContext,
  inputs: unknown,
  attemptNumber: number,
) => Promise<LoopStepOutcome<T>>;

export type LoopOpts<T> = {
  exitWhen: (outcome: Outcome<T>, attemptNumber: number) => boolean;
  strategy: (priorOutcomes: Outcome<T>[], attemptNumber: number) => unknown;
};

function nowIso(): string {
  return new Date().toISOString();
}

function buildEvidence<T>(
  outcome: Outcome<T>,
  attemptNumber: number,
  startedAt: string,
): Evidence {
  return {
    attemptNumber,
    startedAt,
    endedAt: nowIso(),
    summary:
      outcome.status === "succeeded"
        ? "succeeded"
        : outcome.status === "failed"
          ? `failed: ${outcome.error.message}`
          : outcome.status === "exhausted"
            ? `exhausted: ${outcome.reason}`
            : `cancelled: ${outcome.reason}`,
    outcome:
      outcome.status === "succeeded"
        ? "succeeded"
        : outcome.status === "cancelled"
          ? "cancelled"
          : "failed",
  };
}

function exhausted<T>(
  reason: ExhaustionReason,
  evidence: Evidence[],
  attempts: number,
): Outcome<T> {
  return { status: "exhausted", reason, evidence, attempts };
}

export async function Loop<T>(
  step: LoopStep<T>,
  opts: LoopOpts<T>,
  ctx: RunContext,
): Promise<Outcome<T>> {
  const budget = resolveBudget(ctx);
  const startedAt = Date.now();
  const evidence: Evidence[] = [];
  const priorOutcomes: Outcome<T>[] = [];
  let cumulativeTokens = 0;

  startHeartbeat(ctx.runId, budget.heartbeatMs, () => {
    /* heartbeat tick — wired to the event bus in Phase 1B Task 1B.4 */
  });

  try {
    for (let attemptNumber = 0; attemptNumber < budget.maxAttempts; attemptNumber++) {
      // Deadline check at attempt boundary.
      if (Date.now() - startedAt >= budget.deadlineMs) {
        return exhausted<T>("deadline", evidence, attemptNumber);
      }

      // Snapshot priors so strategy callers can't observe mutation if they
      // hold the reference, and so test assertions on call args are stable.
      const inputs = opts.strategy([...priorOutcomes], attemptNumber);
      const attemptStartedAt = nowIso();
      const outcome = await step(ctx, inputs, attemptNumber);

      evidence.push(buildEvidence(outcome, attemptNumber, attemptStartedAt));
      priorOutcomes.push(outcome);

      // Token accounting (only meaningful when budget.tokenBudget > 0).
      if (typeof outcome.tokensUsed === "number") {
        cumulativeTokens += outcome.tokensUsed;
      }

      // Cancellation propagation: a step returning cancelled ends the loop
      // with cancelled. Phase 1C wires bus-level cancellation; this path
      // covers the step-internal route.
      if (outcome.status === "cancelled") {
        return {
          status: "cancelled",
          reason: outcome.reason,
          evidence,
          attempts: attemptNumber + 1,
        };
      }

      if (opts.exitWhen(outcome, attemptNumber)) {
        return outcome;
      }

      // Token-budget exhaustion check after the attempt — gives the just-
      // completed attempt a chance to succeed before we give up.
      if (budget.tokenBudget > 0 && cumulativeTokens >= budget.tokenBudget) {
        return exhausted<T>("token_budget", evidence, attemptNumber + 1);
      }

      // Deadline check after the attempt too — long single attempts shouldn't
      // get a free second iteration.
      if (Date.now() - startedAt >= budget.deadlineMs) {
        return exhausted<T>("deadline", evidence, attemptNumber + 1);
      }
    }

    return exhausted<T>("max_attempts", evidence, budget.maxAttempts);
  } finally {
    stopHeartbeat(ctx.runId);
  }
}
