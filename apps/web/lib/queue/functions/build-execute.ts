/**
 * BI-89030C9B Phase 1 — durable build execution.
 *
 * Runs the existing checkpoint pipeline (lib/integrate/build-pipeline.ts) as
 * an Inngest function with one journaled `step.run` per STEP_ORDER entry, so
 * a portal recycle mid-build resumes from the engine's journal instead of
 * relying on boot-time reconciliation hooks. Flag-gated by
 * DPF_BUILD_DURABLE_EXECUTION_ENABLED — when off, autoExecuteBuild runs the
 * legacy in-process path byte-for-byte unchanged.
 *
 * Design notes (deviations from the plan doc, deliberate):
 *  - Function-level `retries: 3`, not 0: engine retries ARE the
 *    crash-recovery mechanism (Phase-0 finding F2 — ~37s kill→re-invocation).
 *    App-level transient retries (MAX_RETRIES per step) run inside each step
 *    body; a step that exhausts them returns a journaled `failed` state
 *    rather than throwing, so build failures never burn engine retries.
 *  - Quiescence uses gateBetweenSteps (defer-not-skip): a build paused by an
 *    upgrade drain suspends on platform.quiescence-cleared rather than being
 *    silently dropped (plan Phase-1; guardrail A3).
 *  - Concurrency: one run per build via the event-keyed concurrency below.
 *    The global admission cap stays with assertWipCapacity() at the
 *    promote/advance call sites — one source of truth, per the plan's
 *    correction (a flat limit here would have serialized builds).
 *
 * Step outputs are small checkpoint states only; artifacts live in their
 * existing DB homes (by-reference rule, 32MB run-state cap).
 *
 * Plan: docs/superpowers/plans/2026-06-09-build-studio-durable-execution-migration.md
 */

import { inngest } from "../inngest-client";
import { gateBetweenSteps, type GateBetweenStepsRunner } from "../quiescence-gates";
import { STEP_ORDER } from "@/lib/build-exec-types";
import type { BuildExecutionState } from "@/lib/build-exec-types";

export const buildExecute = inngest.createFunction(
  {
    id: "build/execute",
    retries: 3,
    concurrency: [{ key: "event.data.buildId", limit: 1 }],
    triggers: [{ event: "build/execute.run" }],
    // Terminal engine failure (all retries exhausted — e.g. the portal stayed
    // down past the retry window): release the sandbox slot and fail the
    // TaskRun so nothing leaks and the watchdog/UI see a terminal state, not
    // a silent hang. The happy and build-failed paths release via the
    // finalize step instead (releaseSandbox is idempotent/no-op when the
    // slot is already released).
    onFailure: async ({ event, error }) => {
      const original = (event.data as { event?: { data?: { buildId?: string } } }).event;
      const buildId = original?.data?.buildId;
      if (!buildId) return;
      console.error(
        `[build-execute] terminal engine failure for build ${JSON.stringify(buildId)}: ${error instanceof Error ? JSON.stringify(error.message) : "unknown"}`,
      );
      const { releaseSandbox } = await import("@/lib/integrate/sandbox/sandbox-pool");
      await releaseSandbox(buildId).catch(() => {});
      const { prisma } = await import("@dpf/db");
      await prisma.taskRun
        .updateMany({
          // Any non-terminal run for this build fails — covers both the
          // working state and a run that died before its first transition.
          where: {
            buildId,
            source: "build",
            status: { notIn: ["completed", "failed", "canceled", "rejected", "archived"] },
          },
          data: { status: "failed", completedAt: new Date() },
        })
        .catch(() => {});
    },
  },
  async ({ event, step }) => {
    const buildId = event.data.buildId as string;

    // Defer-not-skip: if an upgrade drain is in progress, suspend until
    // platform.quiescence-cleared instead of dropping the build.
    await gateBetweenSteps(step as unknown as GateBetweenStepsRunner, "build-execute-entry");

    const taskRunId = (await step.run("ensure-task-run", async () => {
      const { ensureBuildTaskRun } = await import("@/lib/integrate/build-execute-helpers");
      return ensureBuildTaskRun(buildId);
    })) as string;

    const autonomy = (await step.run("autonomous-eligibility", async () => {
      const { recheckAutonomousBuildExecution } = await import(
        "@/lib/integrate/build-execute-helpers"
      );
      return recheckAutonomousBuildExecution({ buildId, taskRunId });
    })) as { mayContinue: boolean; reason: string | null };
    if (!autonomy.mayContinue) {
      return {
        buildId,
        taskRunId,
        terminal: "input-required",
        reason: autonomy.reason,
      };
    }

    let state = (await step.run("load-exec-state", async () => {
      const { loadBuildExecState } = await import("@/lib/integrate/build-execute-helpers");
      return loadBuildExecState(buildId);
    })) as BuildExecutionState | null;

    for (const pipelineStep of STEP_ORDER) {
      if (pipelineStep === "complete" || pipelineStep === "failed") break;
      state = (await step.run(`pipeline:${pipelineStep}`, async () => {
        const { runPipelineStepDurable } = await import("@/lib/integrate/build-execute-helpers");
        return runPipelineStepDurable({ buildId, taskRunId, step: pipelineStep, state });
      })) as BuildExecutionState;
      if (state.step === "failed") break;
    }

    const summary = (await step.run("finalize", async () => {
      const { finalizeDurableBuild } = await import("@/lib/integrate/build-execute-helpers");
      return finalizeDurableBuild({ buildId, taskRunId, state });
    })) as { terminal: string };

    return { buildId, taskRunId, terminal: summary.terminal };
  },
);
