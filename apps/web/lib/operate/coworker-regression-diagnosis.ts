/**
 * Coworker regression diagnosis — Task 3: deterministic probable-cause
 * assembly for a regressed coworker turn.
 *
 * This module is intentionally PURE: no Prisma import, no I/O, no clock. It
 * takes the per-turn facts the detector already has (or can look up from a
 * `CoworkerTurnMetric` row by `(threadId, agentMessageId)`) and maps them to a
 * single deterministic `probableCause` plus a short, description-safe summary.
 *
 * Keeping it framework-free means its unit test loads in this worktree even
 * though there is no generated Prisma client, and it can be composed into the
 * detector's PIR-filing path without dragging the database into the diagnosis
 * decision.
 *
 * Architecture grounding (see
 * docs/superpowers/plans/2026-06-05-self-diagnosing-coworker-regressions.md):
 *  - Deterministic rules only in this BI. No LLM narrative.
 *  - The summary must be safe for `PlatformIssueReport.description`: short,
 *    single-paragraph, no untrusted free text.
 */

export type CoworkerRegressionDiagnosisProbableCause =
  | "nudge-redispatch-loop"
  | "full-tool-surface-on-conversational-turn"
  | "slow-provider-dispatch"
  | "tool-call-exploration"
  | "insufficient-evidence";

export type CoworkerRegressionDiagnosis = {
  probableCause: CoworkerRegressionDiagnosisProbableCause;
  summary: string;
  metrics: {
    dispatches: number | null;
    nudges: number | null;
    toolsAttached: boolean | null;
    executedTools: number | null;
    totalMs: number | null;
    taskType: string | null;
    providerId: string | null;
    modelId: string | null;
  };
};

/**
 * Per-turn facts the diagnosis consumes. All fields are nullable because the
 * exemplar turn may have no persisted `CoworkerTurnMetric` row, in which case
 * the detector passes minimal input and we yield `insufficient-evidence`
 * rather than throwing.
 *
 * `dispatchMs` is the summed adapter dispatch duration for the turn (from
 * `AdapterRunTelemetry.durationMs`); `totalMs` is the wall-clock turn duration
 * from the turn metric. They differ when wall time is dominated by something
 * other than provider dispatch (e.g. tool execution), which is what separates
 * `slow-provider-dispatch` from `tool-call-exploration`.
 */
export type CoworkerRegressionDiagnosisInput = {
  routeContext: string | null;
  taskType: string | null;
  dispatches: number | null;
  nudges: number | null;
  toolsAttached: boolean | null;
  executedTools: number | null;
  totalMs: number | null;
  dispatchMs: number | null;
  providerId: string | null;
  modelId: string | null;
};

/**
 * Fraction of wall-clock turn time consumed by provider dispatch above which we
 * call the dispatch "dominant". Conservative: most of the turn must be the LLM
 * call, not tool round-trips.
 */
const DISPATCH_DOMINANCE_FRACTION = 0.7;

/**
 * `executedTools` count at or above which tool-call exploration is "high"
 * enough to be the probable cause when dispatch is not dominant.
 */
const HIGH_EXECUTED_TOOLS = 3;

/**
 * True when the turn carries enough signal to diagnose at all. We require at
 * least the dispatch/nudge/tool surface to be present; a turn metric row with
 * only ids is not diagnosable.
 */
function hasSufficientEvidence(input: CoworkerRegressionDiagnosisInput): boolean {
  return (
    input.dispatches != null ||
    input.nudges != null ||
    input.toolsAttached != null ||
    input.executedTools != null
  );
}

/** True when the route is the `/build` surface (tools are expected there). */
function isBuildRoute(routeContext: string | null): boolean {
  return routeContext != null && routeContext.startsWith("/build");
}

/** True when dispatch duration dominates the wall-clock turn time. */
function dispatchIsDominant(
  dispatchMs: number | null,
  totalMs: number | null,
): boolean {
  if (dispatchMs == null || totalMs == null || totalMs <= 0) return false;
  return dispatchMs / totalMs >= DISPATCH_DOMINANCE_FRACTION;
}

/**
 * Build a deterministic diagnosis for a regressed coworker turn.
 *
 * PRECEDENCE (evaluated top-to-bottom; first match wins, deterministic):
 *
 *   0. insufficient-evidence — guard. If the turn lacks the core dispatch/
 *      nudge/tool surface, we cannot diagnose, so this short-circuits before
 *      any positive rule. (A turn with the surface present never lands here.)
 *   1. nudge-redispatch-loop — nudges > 0 AND dispatches > 1. A re-ask /
 *      continuation loop is the most actionable and most specific signal, so
 *      it wins over the others even if tools were also attached.
 *   2. full-tool-surface-on-conversational-turn — toolsAttached = true,
 *      executedTools = 0, and the turn is conversational (taskType
 *      "conversation" or missing) on a non-/build route. Attaching the whole
 *      tool surface to a chat turn that used none of it is a concrete,
 *      mechanical cost we rank above the duration-shape rules.
 *   3. slow-provider-dispatch — provider dispatch duration dominates the turn
 *      (dispatchMs / totalMs >= 0.7) and a provider/model is known. When the
 *      LLM call itself is the wall-clock cost, that is the cause.
 *   4. tool-call-exploration — executedTools is high (>= 3) and dispatch is
 *      NOT dominant, i.e. the turn spent its time round-tripping tools.
 *   5. (fallthrough) — evidence exists but matches no positive rule, which we
 *      treat as insufficient-evidence: we have facts but no confident cause.
 *
 * Why this order: 1 and 2 are specific structural defects (loop, mis-attached
 * surface) that are directly fixable; 3 and 4 are duration-shape explanations
 * that are mutually exclusive by construction (dominant vs. not dominant). The
 * loop rule precedes the tool-surface rule because a nudge loop is both more
 * severe and a superset signal (it re-dispatches regardless of tool state).
 */
export function buildCoworkerRegressionDiagnosis(
  input: CoworkerRegressionDiagnosisInput,
): CoworkerRegressionDiagnosis {
  const metrics = {
    dispatches: input.dispatches,
    nudges: input.nudges,
    toolsAttached: input.toolsAttached,
    executedTools: input.executedTools,
    totalMs: input.totalMs,
    taskType: input.taskType,
    providerId: input.providerId,
    modelId: input.modelId,
  };

  // 0. Evidence guard.
  if (!hasSufficientEvidence(input)) {
    return {
      probableCause: "insufficient-evidence",
      summary:
        "Insufficient evidence: no persisted turn metrics for the exemplar turn, so the probable cause cannot be determined deterministically.",
      metrics,
    };
  }

  const nudges = input.nudges ?? 0;
  const dispatches = input.dispatches ?? 0;
  const executedTools = input.executedTools ?? 0;
  const toolsAttached = input.toolsAttached === true;

  // 1. nudge-redispatch-loop
  if (nudges > 0 && dispatches > 1) {
    return {
      probableCause: "nudge-redispatch-loop",
      summary: `Probable cause: nudge-redispatch-loop. The turn issued ${dispatches} provider dispatches with ${nudges} continuation nudge(s), indicating a re-ask/redispatch loop rather than a single completion.`,
      metrics,
    };
  }

  // 2. full-tool-surface-on-conversational-turn
  const isConversational =
    input.taskType === "conversation" || input.taskType == null;
  if (
    toolsAttached &&
    executedTools === 0 &&
    isConversational &&
    !isBuildRoute(input.routeContext)
  ) {
    return {
      probableCause: "full-tool-surface-on-conversational-turn",
      summary:
        "Probable cause: full-tool-surface-on-conversational-turn. The full tool surface was attached to a conversational turn that executed no tools, inflating prompt size and latency without benefit.",
      metrics,
    };
  }

  // 3. slow-provider-dispatch
  if (
    dispatchIsDominant(input.dispatchMs, input.totalMs) &&
    (input.providerId != null || input.modelId != null)
  ) {
    const providerLabel = [input.providerId, input.modelId]
      .filter((v): v is string => v != null && v.length > 0)
      .join("/");
    return {
      probableCause: "slow-provider-dispatch",
      summary: `Probable cause: slow-provider-dispatch. Provider dispatch (${providerLabel || "unknown provider"}) dominated the turn duration, so the latency is in the model call itself rather than tool work or a loop.`,
      metrics,
    };
  }

  // 4. tool-call-exploration
  if (
    executedTools >= HIGH_EXECUTED_TOOLS &&
    !dispatchIsDominant(input.dispatchMs, input.totalMs)
  ) {
    return {
      probableCause: "tool-call-exploration",
      summary: `Probable cause: tool-call-exploration. The turn executed ${executedTools} tools and dispatch did not dominate the duration, so the latency is in tool round-trips rather than the model call.`,
      metrics,
    };
  }

  // 5. Fallthrough: facts exist but no rule fired confidently.
  return {
    probableCause: "insufficient-evidence",
    summary:
      "Insufficient evidence: turn metrics are present but match no deterministic regression pattern, so no confident probable cause can be assigned.",
    metrics,
  };
}
