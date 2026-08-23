// apps/web/lib/decision/uncertain-retry.ts
//
// BI-60B3D270 (spec slice 5). An exit from the UNCERTAIN band that is not a
// human turn.
//
// BI-2107B5D2 shipped VERDICT_RETRY_HINTS — a string per cause naming the input
// to change. A string is advice, not an exit: every uncertain verdict still cost
// an interruption, and a high-stakes hold could have no release path at all.
//
// Two rules make this a retry rather than a loop:
//
//   1. RETRYING IDENTICALLY IS REFUSED. A corpus gap re-run against the same
//      empty corpus returns the same nothing forever. The caller must name what
//      it changed, and repeating the same change is treated as no change.
//   2. THE ATTEMPT COUNT IS BOUNDED AND VISIBLE. An unbounded retry loop is a
//      hang wearing the costume of diligence.
//
// A commandment conflict never enters the loop: it is a decline with a named
// cause, and no amount of retrying resolves a conflict with a commandment.

import {
  readVerdict,
  VERDICT_RETRY_HINTS,
  type DecisionResult,
  type DecisionVerdict,
  type DecisionVerdictCause,
} from "./option-scoring";

export const DEFAULT_MAX_RETRY_ATTEMPTS = 2;

export interface RetryAttemptRecord {
  /** 1-based; attempt 0 is the original decision and is not recorded here. */
  attempt: number;
  /** The cause that justified this attempt. */
  cause: DecisionVerdictCause;
  /** What the caller changed before re-deciding. Recorded, not inferred. */
  changed: string;
  /** The verdict this attempt produced. */
  verdict: DecisionVerdict;
}

export type RetryStopReason =
  | "not-retryable"
  | "attempts-exhausted"
  | "no-change-offered"
  | "unchanged-input";

export interface BoundedRetryOutcome {
  /** The last decision produced — the original when nothing was retried. */
  final: DecisionResult;
  attempts: RetryAttemptRecord[];
  /** True when the final verdict is an assurance (proceed or decline). */
  assured: boolean;
  /** Why the loop stopped; null when it stopped because the verdict became an assurance. */
  stopReason: RetryStopReason | null;
}

export interface NextAttempt {
  /** What the caller changed. An empty or repeated value is refused. */
  changed: string;
  result: DecisionResult;
}

export interface BoundedRetryOptions {
  maxAttempts?: number;
  /**
   * Produce the next attempt for a retryable cause, or null when the caller has
   * nothing left to change. The hint names what SHOULD change; honouring it is
   * the caller's job, because only the caller holds the corpus and the options.
   */
  nextAttempt: (context: {
    cause: DecisionVerdictCause;
    hint: string;
    attempt: number;
    previous: DecisionResult;
  }) => NextAttempt | null;
}

function isAssurance(verdict: DecisionVerdict): boolean {
  return verdict === "proceed" || verdict === "decline";
}

/**
 * Run a bounded retry around an uncertain decision.
 *
 * Returns immediately for an assurance, for a result with no recommendation
 * (nothing was weighed — that is a corpus gap the caller must fill, not a
 * decision to re-run), and for a cause with no retry hint.
 */
export function decideWithBoundedRetry(
  first: DecisionResult,
  options: BoundedRetryOptions,
): BoundedRetryOutcome {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_RETRY_ATTEMPTS;
  const attempts: RetryAttemptRecord[] = [];
  const changesSeen = new Set<string>();

  let current = first;

  for (let attempt = 1; ; attempt += 1) {
    if (!current.recommendation) {
      return { final: current, attempts, assured: false, stopReason: "not-retryable" };
    }
    const { verdict, verdictCause } = readVerdict(current.recommendation, current.flags);
    if (isAssurance(verdict)) {
      return { final: current, attempts, assured: true, stopReason: null };
    }
    if (!verdictCause) {
      return { final: current, attempts, assured: false, stopReason: "not-retryable" };
    }
    const hint = VERDICT_RETRY_HINTS[verdictCause];
    if (!hint) {
      // commandment-conflict, and anything else declared unretryable.
      return { final: current, attempts, assured: false, stopReason: "not-retryable" };
    }
    if (attempt > maxAttempts) {
      return { final: current, attempts, assured: false, stopReason: "attempts-exhausted" };
    }

    const next = options.nextAttempt({ cause: verdictCause, hint, attempt, previous: current });
    if (!next) {
      return { final: current, attempts, assured: false, stopReason: "no-change-offered" };
    }
    const changed = next.changed.trim();
    if (!changed || changesSeen.has(changed)) {
      // Rule 1. Re-running an unchanged input is not a retry; refuse rather
      // than spend an attempt proving the same answer twice.
      return { final: current, attempts, assured: false, stopReason: "unchanged-input" };
    }
    changesSeen.add(changed);

    current = next.result;
    const produced = current.recommendation
      ? readVerdict(current.recommendation, current.flags).verdict
      : "uncertain";
    attempts.push({ attempt, cause: verdictCause, changed, verdict: produced });
  }
}
