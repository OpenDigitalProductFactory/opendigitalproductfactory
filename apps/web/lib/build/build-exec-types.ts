// apps/web/lib/build-exec-types.ts
// Types for the checkpoint-based build execution pipeline.

import type { SandboxSourceCurrencySnapshot } from "./sandbox/sandbox-source-currency";
import type { AutonomousRecoveryStateV1 } from "@/lib/build/autonomous-recovery-policy";
import type { AutonomousBuildPhaseRuntimeRecord } from "@/lib/build/autonomous-build-phase-runtime";

export type BuildExecStep =
  | "pending"
  | "slot_queued"        // transient — emitted only; never persisted as a checkpoint
  | "sandbox_created"
  | "workspace_initialized"
  | "db_ready"
  | "deps_installed"
  | "code_generated"
  | "tests_run"
  | "complete"
  | "failed";

export type BuildExecutionState = {
  step: BuildExecStep;
  failedAt?: string;
  error?: string;
  retryCount: number;
  containerId?: string;
  dbContainerId?: string;
  neo4jContainerId?: string;
  qdrantContainerId?: string;
  networkId?: string;
  hostPort?: number;
  sourceCurrency?: SandboxSourceCurrencySnapshot | null;
  autonomousRecovery?: AutonomousRecoveryStateV1;
  autonomousCustody?: AutonomousBuildPhaseRuntimeRecord;
  startedAt: string;
  completedAt?: string;
};

export const STEP_ORDER: BuildExecStep[] = [
  "pending",
  "sandbox_created",
  "workspace_initialized",
  "db_ready",
  "deps_installed",
  "code_generated",
  "tests_run",
  "complete",
];

export const STEP_LABELS: Record<BuildExecStep, string> = {
  pending: "Pending",
  slot_queued: "Waiting for sandbox slot…",
  sandbox_created: "Creating sandbox...",
  workspace_initialized: "Copying project...",
  db_ready: "Initializing database...",
  deps_installed: "Installing dependencies...",
  code_generated: "Generating code...",
  tests_run: "Running tests...",
  complete: "Complete",
  failed: "Failed",
};

export const MAX_RETRIES: Record<BuildExecStep, number> = {
  pending: 0,
  slot_queued: 0,   // not a real step — never retried
  sandbox_created: 3,
  workspace_initialized: 2,
  db_ready: 3,
  deps_installed: 2,
  code_generated: 2,
  // tests_run is the dispatch slot that runs stepComplete (the diff/commit
  // capture step). Diff extraction can fail transiently when the sandbox is
  // mid-rebuild or the index lock is briefly held — give it retry budget so
  // a one-off hiccup doesn't strand an otherwise-complete build.
  tests_run: 2,
  complete: 0,
  failed: 0,
};

export const RETRY_DELAYS_MS = [2000, 4000, 8000];

export function initialExecState(): BuildExecutionState {
  return {
    step: "pending",
    retryCount: 0,
    startedAt: new Date().toISOString(),
  };
}

// ─── Contradictory-checkpoint classification & recovery ──────────────────────
// Single source of truth for the "stuck build" engine-reliability fixes
// (spec §3.1 engine-first / FB-78E967D4 / FB-F0476EF3). Pure, dependency-light
// functions so BOTH the UI affordance (build-studio-workflow-actions.ts) AND
// the boot reconciler (instrumentation.ts) classify and recover the same way —
// no drift between what the UI calls "stuck" and what the auto-recovery fixes.

/**
 * The minimal shape these classifiers read. A loosened view of
 * BuildExecutionState because persisted rows predate the current type
 * (e.g. a checkpoint written before `step` existed reads as `step: undefined`),
 * and the `verificationOut` cross-check lives on the FeatureBuild row, not the
 * exec state.
 */
export type ExecStateLike = {
  step?: BuildExecStep | null;
  error?: string | null;
  failedAt?: string | null;
} & Record<string, unknown>;

/** Why a checkpoint is contradictory — drives the recovery decision + the log line. */
export type ContradictoryExecReason =
  | "missing-step"        // state object has content but no `step` (restart-killed before step 1)
  | "error-without-fail"  // a non-`failed` step carrying an error/failedAt breadcrumb
  | "complete-no-verify"; // step=complete but verificationOut never populated

/**
 * Classify a buildExecState (+ optional verificationOut) as one of the three
 * contradictory shapes the existing recovery paths refuse to handle, or null
 * if the state is internally consistent.
 *
 * Mirrors the detection PR #859 added; `failed` is a legitimate terminal step
 * that `retryBuildExecution` already handles, so it is NOT contradictory.
 */
export function classifyContradictoryExecState(
  state: ExecStateLike | null | undefined,
  verificationOut?: unknown,
): ContradictoryExecReason | null {
  if (!state) return null;
  // Pipeline died before setting the first step (e.g. portal restart killed
  // the fire-and-forget autoExecuteBuild during stepCreateSandbox). The object
  // has content (sourceCurrency, …) but no `step` key.
  if (state.step == null) return "missing-step";
  // A non-`failed` step carrying an error/failedAt breadcrumb is the
  // FB-F0476EF3 "silent complete past the failed step" relic.
  if (state.step !== "failed" && (state.error != null || state.failedAt != null)) {
    return "error-without-fail";
  }
  // step=complete but tests never ran — unreachable via resume (no diff) and
  // via advance-phase (verificationOut null blocks the review gate).
  if (state.step === "complete" && verificationOut == null) {
    return "complete-no-verify";
  }
  return null;
}

/** Convenience boolean wrapper around {@link classifyContradictoryExecState}. */
export function isContradictoryExecState(
  state: ExecStateLike | null | undefined,
  verificationOut?: unknown,
): boolean {
  return classifyContradictoryExecState(state, verificationOut) !== null;
}

/**
 * Compute the safe, resumable checkpoint a contradictory exec state should be
 * reset to so the EXISTING recovery machinery takes over without a human:
 *
 *  - "error-without-fail" → coerce to `failed` (preserving the failedAt/error
 *    breadcrumb) so `retryBuildExecution` retries from the failed step. This is
 *    the least-destructive recovery: it keeps the live container/port pointers
 *    and the diagnosis, and the failed step is re-run idempotently.
 *  - "missing-step" / "complete-no-verify" → return `null`, signalling the
 *    caller to clear the checkpoint and restart the pipeline from a clean
 *    `pending` (the pipeline's own self-heal then re-runs setup idempotently).
 *    These shapes have no trustworthy step to retry from.
 *
 * Idempotent: a state that is already `failed` (or otherwise non-contradictory)
 * returns `{ action: "none" }`, so running this on every boot is safe.
 */
export type ExecRecoveryPlan =
  | { action: "none" }
  | { action: "clear"; reason: ContradictoryExecReason }
  | { action: "to-failed"; reason: ContradictoryExecReason; state: BuildExecutionState };

export function planExecStateRecovery(
  state: ExecStateLike | null | undefined,
  verificationOut?: unknown,
): ExecRecoveryPlan {
  const reason = classifyContradictoryExecState(state, verificationOut);
  if (!reason || !state) return { action: "none" };

  if (reason === "error-without-fail") {
    // Preserve container/port/source pointers + the diagnosis; just coerce the
    // step to `failed` and record where it failed so retry resumes there.
    const failedAt =
      (typeof state.failedAt === "string" && state.failedAt) ||
      (typeof state.step === "string" ? state.step : "pending");
    const recovered = {
      ...(state as Record<string, unknown>),
      step: "failed" as BuildExecStep,
      failedAt,
      error: typeof state.error === "string" ? state.error : "Recovered contradictory checkpoint",
    } as unknown as BuildExecutionState;
    return { action: "to-failed", reason, state: recovered };
  }

  // missing-step / complete-no-verify → clear and restart clean.
  return { action: "clear", reason };
}
