// BI-89030C9B Phase 1 — helpers for the durable build-execution Inngest function.
//
// The durable path (apps/web/lib/queue/functions/build-execute.ts) runs each
// existing pipeline step as its own journaled `step.run`. These helpers hold
// everything the function body delegates to, split so the decision logic is
// pure and unit-testable while the side effects stay in lazily-imported
// functions (keeping prisma out of the Inngest function's module graph at
// definition time, matching the established queue-function idiom).
//
// Plan: docs/superpowers/plans/2026-06-09-build-studio-durable-execution-migration.md
// Spec: docs/architecture/2026-06-09-long-running-agentic-process-architecture.md §7.1

import type { BuildExecStep, BuildExecutionState } from "@/lib/build-exec-types";
import { STEP_ORDER, MAX_RETRIES, RETRY_DELAYS_MS } from "@/lib/build-exec-types";
import { buildFailedState } from "@/lib/build/build-pipeline";
import { envFlagEnabled } from "@/lib/runtime/env-flags";
import { getErrorMessage } from "@/lib/shared/get-error-message";

// ─── Pure decision logic (unit-tested) ───────────────────────────────────────

export const BUILD_DURABLE_EXECUTION_FLAG = "DPF_BUILD_DURABLE_EXECUTION_ENABLED";

export function isBuildDurableExecutionEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return envFlagEnabled(env, BUILD_DURABLE_EXECUTION_FLAG);
}

/**
 * Deterministic idempotency id for the `build/execute.run` send.
 *
 * autoExecuteBuild has four call sites and is itself retry-prone; without
 * dedup, two sends would queue two durable runs of the same build. The id is
 * keyed on the build's current checkpoint so duplicate sends from the same
 * logical attempt collapse, while a later legitimate re-dispatch (after the
 * checkpoint moved or was reset) gets a fresh id. The per-build concurrency
 * key on the function is the belt to this braces.
 */
export function buildExecuteSendId(
  buildId: string,
  state: BuildExecutionState | null | undefined,
): string {
  const checkpoint = state?.step ?? "fresh";
  const retry = state?.retryCount ?? 0;
  return `build-execute:${buildId}:${checkpoint}:r${retry}`;
}

export type PipelineStepDecision = "run" | "skip-completed" | "halt-failed";

/**
 * Whether the durable loop should execute, skip, or halt at `step` given the
 * persisted checkpoint. Mirrors getResumeStep()/STEP_ORDER semantics from the
 * legacy runBuildPipeline: `state.step` names the last reached milestone, and
 * executeStep(X) runs when the pipeline is AT milestone X.
 */
export function shouldRunPipelineStep(
  state: BuildExecutionState | null | undefined,
  step: BuildExecStep,
): PipelineStepDecision {
  if (!state) return "run"; // fresh run executes sequentially from pending
  if (state.step === "failed") return "halt-failed";
  const stateIdx = STEP_ORDER.indexOf(state.step);
  const stepIdx = STEP_ORDER.indexOf(step);
  if (stateIdx === -1 || stepIdx === -1) return "run";
  return stateIdx > stepIdx ? "skip-completed" : "run";
}

// ─── Side-effect helpers (called inside step.run bodies) ─────────────────────

/**
 * Stand up (or find) the per-build TaskRun — the durable identity the spec
 * §7.4 caveat says builds lack today. Idempotent: a re-invoked step returns
 * the existing row. Heartbeats flow via withHeartbeatTicker during steps so
 * the taskrun-watchdog covers durable builds.
 */
export async function ensureBuildTaskRun(buildId: string): Promise<string> {
  const { prisma } = await import("@dpf/db");
  const { admitRuntimeGuardedWork } = await import("@/lib/platform-runtime/work-admission");

  const existing = await prisma.taskRun.findFirst({
    where: { buildId, source: "build", status: { notIn: ["archived", "canceled"] } },
    select: { taskRunId: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing.taskRunId;

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { title: true, createdById: true, threadId: true },
  });
  if (!build) throw new Error(`ensureBuildTaskRun: unknown build ${JSON.stringify(buildId)}`);

  const taskRunId = `build-${buildId}-${Date.now().toString(36)}`;
  // Created in the schema-default "submitted" state, then transitioned via
  // the canonical markTaskRunWorking helper so status + lastHeartbeatAt move
  // atomically (BI-4ab6be39 stall-detection write guard).
  await prisma.$transaction(async (tx) => {
    await admitRuntimeGuardedWork(tx as never, "task-run:build");
    await tx.taskRun.create({ data: {
      taskRunId,
      userId: build.createdById,
      threadId: build.threadId ?? null,
      buildId,
      routeContext: "build-pipeline",
      title: `Build: ${build.title}`,
      objective: `Durable build execution for ${buildId} (BI-89030C9B Phase 1)`,
      source: "build",
    } });
  }, { isolationLevel: "Serializable" });
  const { markTaskRunWorking } = await import("@/lib/observability/heartbeat");
  await markTaskRunWorking(taskRunId);
  return taskRunId;
}

export async function loadBuildExecState(
  buildId: string,
): Promise<BuildExecutionState | null> {
  const { prisma } = await import("@dpf/db");
  const row = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { buildExecState: true },
  });
  return (row?.buildExecState as BuildExecutionState | null) ?? null;
}

export async function recheckAutonomousBuildExecution(input: {
  buildId: string;
  taskRunId: string;
}): Promise<{ mayContinue: boolean; reason: string | null }> {
  const { getAutonomousPlaybookMode } = await import(
    "@/lib/build/build-studio-config"
  );
  const mode = getAutonomousPlaybookMode();
  if (mode === "off") return { mayContinue: true, reason: null };

  try {
    const { resolveAutonomousBuildPhaseEligibility } = await import(
      "@/lib/build/autonomous-build-phase-runtime"
    );
    const autonomy = await resolveAutonomousBuildPhaseEligibility({
      buildId: input.buildId,
      checkpoint: "build",
      gateOutcome: "recommend",
    });
    if (mode === "enforce" && !autonomy.mayAct) {
      const reason =
        autonomy.eligibility.blockers.join(", ")
        || "autonomous build dispatch is not evidence-cleared";
      const { prisma } = await import("@dpf/db");
      await prisma.taskRun.updateMany({
        where: {
          taskRunId: input.taskRunId,
          status: { in: ["submitted", "working"] },
        },
        data: { status: "input-required" },
      });
      await prisma.buildActivity.create({
        data: {
          buildId: input.buildId,
          tool: "autonomous:needs-decision",
          summary: `Build dispatch parked: ${reason}.`,
        },
      });
      return { mayContinue: false, reason };
    }
    const { startBuildPhaseRun } = await import("./build-phase-run");
    await startBuildPhaseRun(input.buildId, "build", {
      ...(autonomy.executionProfileRef
        ? { executionProfileRef: autonomy.executionProfileRef }
        : {}),
    });
    return { mayContinue: true, reason: null };
  } catch (error) {
    if (mode !== "enforce") return { mayContinue: true, reason: null };
    return {
      mayContinue: false,
      reason: `autonomous build eligibility unavailable: ${String(
        error instanceof Error ? error.message : error,
      ).slice(0, 180)}`,
    };
  }
}

/**
 * Dual-write of buildExecState — a faithful port of autoExecuteBuild's
 * updateState closure (sourceCurrency preservation + sandbox pointer
 * mirroring). Duplicated rather than imported from the server-action module;
 * Phase 3 consolidates when the legacy path is deleted.
 */
export async function persistBuildExecState(
  buildId: string,
  state: BuildExecutionState,
): Promise<void> {
  const { prisma } = await import("@dpf/db");
  const persisted = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { buildExecState: true },
  });
  const persistedState = persisted?.buildExecState as
    | { sourceCurrency?: unknown }
    | null;
  const persistedSourceCurrency =
    persistedState && typeof persistedState === "object" && !Array.isArray(persistedState)
      ? persistedState.sourceCurrency ?? null
      : null;
  const nextState =
    state.sourceCurrency || !persistedSourceCurrency
      ? state
      : { ...state, sourceCurrency: persistedSourceCurrency as BuildExecutionState["sourceCurrency"] };

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      buildExecState: nextState as unknown as import("@dpf/db").Prisma.InputJsonValue,
      ...(nextState.containerId ? { sandboxId: nextState.containerId } : {}),
      ...(nextState.hostPort ? { sandboxPort: nextState.hostPort } : {}),
    },
  });
}

async function emitForBuild(
  buildId: string,
  event: import("@/lib/agent-event-bus").AgentEvent,
): Promise<void> {
  const { prisma } = await import("@dpf/db");
  const { agentEventBus } = await import("@/lib/agent-event-bus");
  const row = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { threadId: true },
  });
  if (row?.threadId) agentEventBus.emit(row.threadId, event);
}

/**
 * Execute one pipeline step with the legacy in-step retry budget.
 *
 * Layering (deliberate — see plan Phase 1): app-level transient retries
 * (MAX_RETRIES + RETRY_DELAYS_MS backoff) stay INSIDE the step body so they
 * are fast and don't burn engine retries; the engine's function-level retries
 * are reserved for process death (the F2 recovery path). A step that
 * exhausts its app-level budget returns a `failed` state rather than
 * throwing, so a genuine build failure is a journaled outcome, not an engine
 * retry storm.
 *
 * Returns small checkpoint state only (artifacts stay in their existing DB
 * homes — the by-reference rule that keeps run-state under the 32MB cap).
 */
export async function runPipelineStepDurable(params: {
  buildId: string;
  taskRunId: string;
  step: BuildExecStep;
  state: BuildExecutionState | null;
}): Promise<BuildExecutionState> {
  const { buildId, taskRunId, step } = params;
  let state: BuildExecutionState =
    params.state ?? { step: "pending", retryCount: 0, startedAt: new Date().toISOString() };

  const decision = shouldRunPipelineStep(state, step);
  if (decision !== "run") return state;

  const { executeStep, nextStep } = await import("@/lib/build/build-pipeline");
  const { withHeartbeatTicker, heartbeat, markTaskRunWorking } = await import("@/lib/observability/heartbeat");

  // Refresh the stall heartbeat at the START of each step so the watchdog's
  // timeout window is measured per-step, not from taskrun creation. The in-step
  // heartbeat ticker (withHeartbeatTicker's setInterval) does NOT fire inside
  // the Inngest step.run execution context, so without this a long step (local
  // codegen ~100s+) accumulates the ENTIRE build phase's elapsed time against a
  // single heartbeat window and is falsely reaped as a `heartbeat_timeout`
  // stall — observed live reaping every durable codegen (FB-6E8F4BA4,
  // FB-8E5BD3A8 each failed at code_generated with the taskrun heartbeat never
  // advancing past creation). markTaskRunWorking also re-asserts
  // status="working" so heartbeat() writes land even when ensureBuildTaskRun
  // reused a row that was not in the working state.
  await markTaskRunWorking(taskRunId).catch(() => {});

  await emitForBuild(buildId, { type: "phase:change", buildId, phase: step });

  let attempt = 0;
  const maxAttempts = (MAX_RETRIES[step] ?? 0) + 1;
  const emit = (event: import("@/lib/agent-event-bus").AgentEvent) => {
    void emitForBuild(buildId, event);
  };

  while (attempt < maxAttempts) {
    try {
      state = await withHeartbeatTicker(taskRunId, () =>
        executeStep(step, buildId, state, emit),
      );
      const advanced = nextStep(step);
      state = { ...state, step: advanced ?? step, retryCount: 0 };
      await persistBuildExecState(buildId, state);
      await heartbeat(taskRunId);
      return state;
    } catch (err) {
      attempt++;
      let errorMsg = getErrorMessage(err);
      const { getAutonomousPlaybookMode } = await import("./build-studio-config");
      if (getAutonomousPlaybookMode() !== "off") {
        const {
          classifyAutonomousBuildFailure,
          decideAutonomousRecovery,
          initialAutonomousRecoveryState,
        } = await import("@/lib/build/autonomous-recovery-policy");
        const failureClass = classifyAutonomousBuildFailure({
          message: errorMsg,
          step,
        });
        const recovery = decideAutonomousRecovery({
          failureClass,
          state: state.autonomousRecovery
            ?? initialAutonomousRecoveryState(),
        });
        state = {
          ...state,
          autonomousRecovery: recovery.state,
          retryCount: attempt,
        };
        await persistBuildExecState(buildId, state);
        if (failureClass === "sandbox-drift") {
          errorMsg = `blocked_sandbox_drift: ${errorMsg}`;
        }
        if (recovery.terminal) {
          const failed = buildFailedState(state, step, errorMsg);
          await persistBuildExecState(buildId, failed);
          return failed;
        }
      }
      if (attempt < maxAttempts) {
        const delay =
          RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      } else {
        const failed = buildFailedState(state, step, errorMsg);
        await persistBuildExecState(buildId, failed);
        return failed;
      }
    }
  }
  return state;
}

/**
 * Terminal bookkeeping: completion checkpoint (stripping stale failure
 * breadcrumbs, mirroring the legacy pipeline), sandbox slot release (the
 * legacy `finally`), TaskRun terminal status, and the buildActivity audit
 * line. Also emits the A4 guardrail audit signal so an engine-resumed build
 * is automatic but never silent.
 */
export async function finalizeDurableBuild(params: {
  buildId: string;
  taskRunId: string;
  state: BuildExecutionState | null;
}): Promise<{ terminal: BuildExecStep }> {
  const { buildId, taskRunId } = params;
  const { prisma } = await import("@dpf/db");
  let state = params.state;

  if (state && state.step !== "failed") {
    const { error: _e, failedAt: _f, ...rest } = state;
    void _e;
    void _f;
    state = {
      ...rest,
      step: "complete",
      completedAt: state.completedAt ?? new Date().toISOString(),
    };
    await persistBuildExecState(buildId, state);
    await emitForBuild(buildId, { type: "phase:change", buildId, phase: "complete" });
  }

  const { releaseSandbox } = await import("@/lib/build/sandbox/sandbox-pool");
  await releaseSandbox(buildId).catch((err) =>
    console.error("[build-execute] failed to release sandbox slot:", { buildId }, err),
  );

  const terminal: BuildExecStep = state?.step === "failed" ? "failed" : "complete";
  await prisma.taskRun
    .update({
      where: { taskRunId },
      data: {
        status: terminal === "complete" ? "completed" : "failed",
        completedAt: new Date(),
      },
    })
    .catch(() => {});

  await prisma.buildActivity
    .create({
      data: {
        buildId,
        tool: "build/execute (durable)",
        summary:
          terminal === "complete"
            ? "Durable build pipeline completed successfully"
            : `Durable build pipeline failed at step: ${state?.failedAt ?? state?.step ?? "unknown"}`,
      },
    })
    .catch(() => {});

  return { terminal };
}
