// BI-8C44DB49 — tell "try again" from "cannot ever work".
//
// The self-upgrade wedge of 2026-07-18..21 was not caused by a retry bug. Every
// component behaved correctly on its own terms: the deliberation dispatched, the
// route threw, the watchdog settled the TaskRun stalled and deliberately did NOT
// fail the build (a leaked deliberation must not corrupt a healthy build), so
// the build still needed a deliberation and the sweep re-dispatched it. Forever.
// ~8 builds x ~100 attempts produced 5,026 stalled TaskRuns in four days, and
// because `coworker.reasoning-loop` is a HARD blocker in the quiescence gate,
// the operator's self-upgrade skipped with "activity-in-flight" while the AI
// workforce screen correctly showed nobody working — they were failed
// dispatches, not running coworkers.
//
// The missing concept is this one: some failures are STRUCTURAL. No endpoint
// offers `toolUse`; the prompt is larger than the served context. A thousand
// retries cannot change either. Those must settle once, with the real reason,
// and never re-dispatch.
//
// Deliberately a PURE function over `name` + `message`, importing nothing. Two
// reasons: it is called from the dispatch path AND from operator-facing
// diagnostics, and a shared module that reaches into routing internals is how
// promoter-only code got dragged into the web bundle (BI-76651B7B). It also
// means a non-Error throw, a serialized error crossing a queue boundary, or a
// future error class all classify without a type dependency.

/** Why a dispatch failed, in terms an operator can act on. */
export type DispatchFailureCode =
  | "capability-floor-unmet"
  | "context-overflow"
  | "no-eligible-endpoint"
  | "sensitivity-unsatisfiable"
  | "transient";

export interface DispatchFailureVerdict {
  code: DispatchFailureCode;
  /** False only when retrying is provably pointless. */
  retryable: boolean;
  /** Whether the caller should re-dispatch: retryable AND under the ceiling. */
  shouldRedispatch: boolean;
  /** Operator-facing one-liner naming the real constraint. */
  summary: string;
  /** EP-AGENT-CAP-002 capability the contract required and nothing offered. */
  missingCapability?: string;
}

/**
 * Attempts allowed for a failure we could not prove structural. The flood ran to
 * ~100 attempts per build; a ceiling means an unrecognised-but-permanent failure
 * costs a bounded number of runs instead of an unbounded one. Low enough to stay
 * quiet, high enough to ride out a provider outage across sweep cycles.
 */
export const MAX_DISPATCH_ATTEMPTS = 5;

const CONTEXT_OVERFLOW = /exceed_context_size_error|exceeds the available context size|context length exceeded|maximum context length/i;
const CAPABILITY_FLOOR = /capability floor|EP-AGENT-CAP-002/i;
const MISSING_CAPABILITY = /Missing:\s*([A-Za-z][A-Za-z0-9_]*)/;

function readError(error: unknown): { name: string; message: string; missingCapability?: string } {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { name?: unknown; message?: unknown; missingCapability?: unknown };
    return {
      name: typeof candidate.name === "string" ? candidate.name : "",
      message: typeof candidate.message === "string" ? candidate.message : "",
      missingCapability:
        typeof candidate.missingCapability === "string" ? candidate.missingCapability : undefined,
    };
  }
  return { name: "", message: typeof error === "string" ? error : "" };
}

/**
 * Classify a dispatch failure.
 *
 * Fails SAFE toward retryable: an unrecognised failure stays retryable, because
 * wrongly calling something structural silently abandons recoverable work, which
 * is worse than one extra attempt. The ceiling bounds that unknown case instead.
 */
export function classifyDispatchFailure(
  error: unknown,
  opts: { attempt?: number } = {},
): DispatchFailureVerdict {
  const { name, message, missingCapability } = readError(error);
  const attempt = opts.attempt ?? 1;
  const structural = (
    code: DispatchFailureCode,
    summary: string,
    capability?: string,
  ): DispatchFailureVerdict => ({
    code,
    retryable: false,
    shouldRedispatch: false,
    summary,
    ...(capability ? { missingCapability: capability } : {}),
  });

  if (CONTEXT_OVERFLOW.test(message)) {
    return structural(
      "context-overflow",
      "The request is larger than the endpoint's served context window. Retrying sends the same oversized request. Raise the served context, or reduce the prompt/tool budget.",
    );
  }

  if (CAPABILITY_FLOOR.test(message) || (name === "NoEligibleEndpointsError" && missingCapability)) {
    const capability = missingCapability ?? MISSING_CAPABILITY.exec(message)?.[1];
    return structural(
      "capability-floor-unmet",
      capability
        ? `No configured endpoint offers the required '${capability}' capability. Endpoints exist but were excluded — this is a capability gap, not a missing provider.`
        : "No configured endpoint satisfies this request's capability floor. Endpoints exist but were excluded.",
      capability,
    );
  }

  if (name === "NoEligibleEndpointsError") {
    return structural(
      "no-eligible-endpoint",
      "No endpoint satisfies this request's routing contract. Retrying re-evaluates the same contract against the same endpoints.",
    );
  }

  if (name === "NoAllowedProvidersForSensitivityError" || name === "NoProvidersAvailableError") {
    return structural(
      "sensitivity-unsatisfiable",
      "No provider is permitted for this request's sensitivity or residency policy.",
    );
  }

  return {
    code: "transient",
    retryable: true,
    shouldRedispatch: attempt <= MAX_DISPATCH_ATTEMPTS,
    summary:
      attempt <= MAX_DISPATCH_ATTEMPTS
        ? "Dispatch failed for a reason that may clear on its own."
        : `Dispatch failed ${attempt} times without a recognised structural cause; stopping at the ${MAX_DISPATCH_ATTEMPTS}-attempt ceiling rather than retrying indefinitely.`,
  };
}
