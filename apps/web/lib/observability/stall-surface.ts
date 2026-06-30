// apps/web/lib/observability/stall-surface.ts
//
// When the watchdog detects a stalled build-phase TaskRun it records a
// StallEvent + Notification, but historically left the FeatureBuild itself
// untouched: phase stayed "build", buildExecState stayed mid-step, and the
// progress panel surfaced no failureAxis. The build just sat quiet — exactly
// the FB-69231490 symptom ("agent quiet 11+ min, never advanced").
//
// This module derives the build-state mutations that turn a silent stall into
// an ACTIONABLE blocked state: flip buildExecState to a failed checkpoint (which
// lights up the existing Reset/Resume recovery affordances) and stamp a
// failureAxis the progress visibility layer (deriveFailureAxis) can surface.
//
// Pure + unit-tested; the watchdog applies the result in its stall transaction.

import type { BuildFailureAxis } from "@/lib/build/progress-visibility-types";
import { resolveProactivityPlan } from "@/lib/proactivity/proactivity-resolver";
import type { ProactivityPlan } from "@/lib/proactivity/proactivity-types";

export type StallReason =
  | "heartbeat_timeout"
  | "total_timeout"
  | "never_started"
  | "parent_stalled"
  | "parent_abandoned";

/**
 * Map a watchdog stall reason to a closed BuildFailureAxis. From the build's
 * perspective every stall is a timeout — work went quiet and never produced a
 * verdict — so "timeout" is the honest closed-axis value.
 */
export function stallReasonToFailureAxis(_reason: StallReason): BuildFailureAxis {
  return "timeout";
}

export type StallSurface = {
  failureAxis: BuildFailureAxis;
  error: string;
  proactivityPlan: ProactivityPlan;
  /** New buildExecState JSON to persist (failed checkpoint). */
  execState: Record<string, unknown>;
  /** Patch to merge into verificationOut so deriveFailureAxis surfaces it. */
  verificationPatch: {
    failureAxis: BuildFailureAxis;
    stalledByWatchdog: true;
    observedAt: string;
    proactivity: ProactivityPlan;
  };
};

/**
 * Derive the build-state mutations for a stalled build-phase TaskRun.
 *
 * The failed checkpoint reuses the last in-flight step as `failedAt` so the
 * resume path (taskrunRetry "resume-build" → runBuildPipeline(existingState))
 * picks up where it stalled. Terminal/absent steps fall back to
 * "code_generated" — the step before verification, the common stall point.
 */
export function buildStallSurface(args: {
  reason: StallReason;
  phase: string | null;
  heartbeatTimeoutSeconds: number;
  totalPhaseTimeoutSeconds: number;
  priorExecState: Record<string, unknown> | null;
  now: string;
}): StallSurface {
  const failureAxis = stallReasonToFailureAxis(args.reason);
  const error =
    `Build ${args.phase ?? "build"} phase stalled (${args.reason}) — no heartbeat within ` +
    `${args.heartbeatTimeoutSeconds}s (total budget ${args.totalPhaseTimeoutSeconds}s). ` +
    `Surfaced by the watchdog; resume to re-run from the last checkpoint.`;

  const prior = args.priorExecState ?? {};
  const priorStep = typeof prior.step === "string" ? prior.step : undefined;
  const priorFailedAt = typeof prior.failedAt === "string" ? prior.failedAt : undefined;
  const failedAt =
    priorStep && priorStep !== "failed" && priorStep !== "complete"
      ? priorStep
      : priorFailedAt ?? "code_generated";
  const proactivityPlan = resolveProactivityPlan({
    activityFamily: "build-studio-custodian",
    statusSignal: "stalled",
    routeContext: "build-studio",
  });

  return {
    failureAxis,
    error,
    proactivityPlan,
    execState: { ...prior, step: "failed", failedAt, error, stalledByWatchdog: true },
    verificationPatch: { failureAxis, stalledByWatchdog: true, observedAt: args.now, proactivity: proactivityPlan },
  };
}

/** Merge the verification patch over an existing verificationOut JSON value. */
export function mergeVerificationPatch(
  existing: unknown,
  patch: StallSurface["verificationPatch"],
): Record<string, unknown> {
  const base = existing && typeof existing === "object" && !Array.isArray(existing)
    ? (existing as Record<string, unknown>)
    : {};
  return { ...base, ...patch };
}
