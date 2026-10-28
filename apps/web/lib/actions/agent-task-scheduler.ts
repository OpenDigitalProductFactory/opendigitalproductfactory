"use server";

import { coworkerBriefSpans } from "@/lib/tak/coworker-prompt-provenance";
import { auth } from "@/lib/auth";
import { prisma, DATA_MODEL_MIRROR_TASK_ID, SYSML_PROJECTION_TASK_ID, SELF_OPTIMIZATION_SWEEP_TASK_ID } from "@dpf/db";
import {
  scheduleAgentTaskFor,
  getScheduledAgentTasksFor,
  cancelAgentTaskFor,
  setAgentTaskActiveFor,
  rerunAgentTaskFor,
  type ScheduleAgentTaskInput,
  type ScheduleAgentTaskResult,
  type ScheduledAgentTaskView,
} from "@/lib/operate/scheduled-jobs/agent-task-core";
import { runDataModelMirror } from "@/lib/ea/run-data-model-mirror";
import { runArchitectureParitySteward } from "@/lib/ea/architecture-parity-steward";
import { runConsolidationParitySteward } from "@/lib/ea/consolidation-parity-steward";
import { computeNextCronRun, isOneShotCron } from "@/lib/operate/cron-next-run";
import { extractScheduledTaskSummary } from "./agent-task-scheduler-summary";
import { readWorkroomStageTaskConfig } from "@/lib/scheduling/workroom-stage-task-config";
import { formatScheduledTurnPrompt } from "./scheduled-turn-prompt";
import {
  classifyScheduledRequiredTools, scheduledToolsNeedingPin, scheduledRunLastStatus,
  createTaskRunForScheduledTask,
  detectScheduledRunFailure, withPersistedExecutions, scheduledMandatoryToolGap, scheduledRequiredToolCorrection,
  type ScheduledTaskRunRef,
} from "@/lib/tak/scheduled-task-runs";
import { createTaskMessage } from "@/lib/tak/task-records";
import {
  executeAutonomousAgenticLoop,
  executeAutonomousWorkTool,
  resolveAutonomousWorkAgent,
  resolveAutonomousWorkTools,
} from "@/lib/tak/autonomous-work-run";
import { assertScheduledResearchCapability, resolveScheduledTurnExternalAccess } from "@/lib/tak/scheduled-external-access";
import { resolveUserAwareProactivityPlan } from "@/lib/proactivity/proactivity-resolver.server";
import { resolveDelegatedPosture } from "@/lib/proactivity/delegated-posture";
import { resolveScheduledTickPlan } from "@/lib/scheduling/scheduled-work-posture.server";
import { applyProviderRouteModelPreference } from "@/lib/ai-provider-route-context";
import {
  isCoworkerSelfTaskId,
  coworkerSelfTaskRequiredTool,
} from "@/lib/operate/scheduled-jobs/coworker-self-tasks";
import {
  PRODUCT_INTELLIGENCE_WATCH_TASK_KIND,
} from "@/lib/product-management/product-intelligence-watch-contract";
import { proposeProductIntelligenceWatch } from "@/lib/product-management/product-intelligence-watch";
import {
  PRODUCT_MANAGEMENT_PLAYBOOK_TASK_KIND,
} from "@/lib/product-management/product-management-playbook";
import { ACCEPTANCE_SWEEP_TASK_KIND, BUSINESS_ANALYSIS_WATCH_TASK_KIND } from "@/lib/operate/scheduled-jobs/agent-task-kind";
import { executeBusinessAnalysisWatchRun } from "@/lib/performance/business-analysis-watch-run";
import { runDeterministicScheduledTaskKind } from "./agent-task-scheduler-deterministic";
import { claimScheduledTaskCadence } from "./agent-task-claim";
import { holdWorkroomQueueAfterFailure } from "@/lib/work-capsules/workroom-queue-hold";
import {
  completeProductManagementPlaybookRun,
  prepareProductManagementPlaybookRun,
} from "@/lib/product-management/product-management-playbook-run";

// ─── Cron helpers ───────────────────────────────────────────────────────────

// computeNextCronRun + isOneShotCron now live in @/lib/operate/cron-next-run
// (BI-D72CC945): the previous inline parser dropped the day-of-month and month
// fields, so the Calendar "Monthly"/"Once" presets fired daily. The extracted
// module honors all five cron fields and is unit-tested outside this
// "use server" file.

type RequiredProceduralTool = {
  name: string;
  args: Record<string, unknown>;
  /**
   * Optional recency guard for artifact tools with no write-time dedup. When it
   * resolves true, the forced fallback is skipped so a placeholder is not
   * duplicated on every tick. See CoworkerSelfTaskProceduralTool.
   */
  hasRecentArtifact?: () => Promise<boolean>;
};

function getRequiredProceduralToolForScheduledTask(
  taskId: string,
  agentId: string,
): RequiredProceduralTool | null {
  if (taskId === "discovery-taxonomy-gap-triage-daily") {
    return {
      name: "run_discovery_triage",
      args: { trigger: "cadence" },
    };
  }

  // Coworker self-tasks (Proactivity → autonomous, BI-3F09BDD4) get their own
  // required-tool guarantee, keyed by the coworker's agentId. Unlike the
  // deterministic discovery-triage tool, the marketing artifact tool has no
  // dedup, so the returned descriptor carries a recency guard the caller honors.
  if (isCoworkerSelfTaskId(taskId)) {
    return coworkerSelfTaskRequiredTool(agentId);
  }

  return null;
}

// ─── Public actions ─────────────────────────────────────────────────────────

// ScheduleAgentTaskInput + result/view types live in agent-task-core.ts
// (BI-1C44A93A) so the MCP tools share the same logic without the "use server"
// boundary. These thin wrappers resolve identity from auth() and delegate.

export async function scheduleAgentTask(input: ScheduleAgentTaskInput): Promise<ScheduleAgentTaskResult> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };
  return scheduleAgentTaskFor(session.user.id, input);
}

export async function cancelAgentTask(taskId: string): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };
  return cancelAgentTaskFor(session.user.id, taskId);
}

export async function setAgentTaskActive(
  taskId: string,
  isActive: boolean,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };
  return setAgentTaskActiveFor(session.user.id, taskId, isActive);
}

export async function rerunAgentTask(
  taskId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: "Unauthorized" };
  return rerunAgentTaskFor(session.user.id, taskId);
}

export async function getScheduledAgentTasks(): Promise<ScheduledAgentTaskView[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  return getScheduledAgentTasksFor(session.user.id);
}

// ─── Execution (called by Inngest dispatcher) ───────────────────────────────

/** A run with nothing left to do: healthy, no error, the retry cycle closed. */
async function recordUnchangedScheduledRun(task: { taskId: string; schedule: string }, now: Date): Promise<void> {
  const oneShot = isOneShotCron(task.schedule);
  const nextRunAt = oneShot ? null : computeNextCronRun(task.schedule, now);
  await prisma.scheduledAgentTask.update({
    where: { taskId: task.taskId },
    data: { lastRunAt: now, lastStatus: "unchanged", lastError: null, nextRunAt, attempts: 0, ...(oneShot ? { isActive: false } : {}) },
  });
  await prisma.scheduledJob
    .update({
      where: { jobId: task.taskId },
      data: { lastRunAt: now, lastStatus: "unchanged", lastError: null, nextRunAt, ...(oneShot ? { schedule: "disabled" } : {}) },
    })
    .catch(() => {});
}

export async function executeScheduledAgentTask(taskId: string): Promise<void> {
  const task = await prisma.scheduledAgentTask.findUnique({
    where: { taskId },
  });
  if (!task || !task.isActive) return;

  // Acceptance owns a task-row lease and preserves upgrade wakeups while it
  // runs. The generic cadence claim below must not consume its due time first.
  if (task.taskKind === ACCEPTANCE_SWEEP_TASK_KIND) {
    await runDeterministicScheduledTaskKind(task);
    return;
  }

  if (!await claimScheduledTaskCadence(prisma, task)) return;

  // Phase 7 product-intelligence watches are deterministic proposal producers.
  // A cadence tick creates (or deduplicates to) a PENDING ResearchProposal and
  // stops. Web search, inference, and publication remain behind the proposal
  // approval + draft-review gates; prompt text is never parsed as scope/config.
  if (task.taskKind === PRODUCT_INTELLIGENCE_WATCH_TASK_KIND) {
    const startedAt = new Date();
    const oneShot = isOneShotCron(task.schedule);
    const nextRunAt = oneShot ? null : computeNextCronRun(task.schedule, startedAt);
    try {
      await proposeProductIntelligenceWatch(task);
      await prisma.scheduledAgentTask.update({
        where: { taskId },
        data: {
          lastRunAt: startedAt,
          lastStatus: "ok",
          lastError: null,
          nextRunAt,
          ...(oneShot ? { isActive: false } : {}),
        },
      });
      await prisma.scheduledJob
        .update({
          where: { jobId: taskId },
          data: {
            lastRunAt: startedAt,
            lastStatus: "ok",
            lastError: null,
            nextRunAt,
            ...(oneShot ? { schedule: "disabled" } : {}),
          },
        })
        .catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      await prisma.scheduledAgentTask.update({
        where: { taskId },
        data: {
          lastRunAt: startedAt,
          lastStatus: "error",
          lastError: message,
          nextRunAt,
          ...(oneShot ? { isActive: false } : {}),
        },
      });
      await prisma.scheduledJob
        .update({
          where: { jobId: taskId },
          data: {
            lastRunAt: startedAt,
            lastStatus: "error",
            lastError: message,
            nextRunAt,
            ...(oneShot ? { schedule: "disabled" } : {}),
          },
        })
        .catch(() => {});
    }
    return;
  }

  if (task.taskKind === BUSINESS_ANALYSIS_WATCH_TASK_KIND) {
    await executeBusinessAnalysisWatchRun(task);
    return;
  }

  // Deterministic kinds (books cadence, decision review, acceptance sweep) run off the LLM path.
  if (await runDeterministicScheduledTaskKind(task)) return;

  // EP-DATA-ARCH Phase 6: the data-model mirror is deterministic — run it
  // directly instead of through the LLM agentic loop.
  if (task.taskId === DATA_MODEL_MIRROR_TASK_ID) {
    const startedAt = new Date();
    try {
      const result = await runDataModelMirror();
      console.info(
        "[agent-task-scheduler] data-model mirror %s (created=%d, steward=%d)",
        JSON.stringify(result.mirror.status),
        result.mirror.summary.created,
        result.steward.created,
      );
      const nextRunAt = computeNextCronRun(task.schedule, startedAt);
      await prisma.scheduledAgentTask.update({
        where: { taskId },
        data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, nextRunAt },
      });
      await prisma.scheduledJob
        .update({ where: { jobId: taskId }, data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, nextRunAt } })
        .catch(() => {});
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "unknown error";
      const nextRunAt = computeNextCronRun(task.schedule, startedAt);
      await prisma.scheduledAgentTask.update({
        where: { taskId },
        data: { lastRunAt: startedAt, lastStatus: "error", lastError: errMsg, nextRunAt },
      });
      await prisma.scheduledJob
        .update({ where: { jobId: taskId }, data: { lastRunAt: startedAt, lastStatus: "error", lastError: errMsg, nextRunAt } })
        .catch(() => {});
    }
    return;
  }

  // Parity Engine: the SysML projection reconcile is deterministic — run it
  // directly (re-derives the MCP-authority + coworker-workforce SysML projections
  // from their source registries), then let the steward surface skipped domains as
  // conformance issues. No LLM loop; mirrors the data-model mirror branch.
  if (task.taskId === SYSML_PROJECTION_TASK_ID) {
    const startedAt = new Date();
    try {
      const result = await runArchitectureParitySteward();
      console.info(
        "[agent-task-scheduler] sysml projections mcp=%s coworker=%s (tools=%d, coworkers=%d, steward=%d)",
        result.projections.mcpAuthority.status,
        result.projections.coworkerAuthority.status,
        result.projections.mcpAuthority.toolCount,
        result.projections.coworkerAuthority.created + result.projections.coworkerAuthority.updated,
        result.steward.created + result.steward.updated + result.steward.resolved,
      );
      // BET-0b: the same parity sweep reconciles the consolidation-bet
      // conformance issues, so duplication drift-reduces on the same cadence
      // projection health does.
      const consolidation = await runConsolidationParitySteward();
      console.info(
        "[agent-task-scheduler] consolidation parity outstanding=%d completed=%d (created=%d updated=%d resolved=%d)",
        consolidation.outstandingBets.length,
        consolidation.completedBets.length,
        consolidation.created,
        consolidation.updated,
        consolidation.resolved,
      );
      const nextRunAt = computeNextCronRun(task.schedule, startedAt);
      await prisma.scheduledAgentTask.update({
        where: { taskId },
        data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, nextRunAt },
      });
      await prisma.scheduledJob
        .update({ where: { jobId: taskId }, data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, nextRunAt } })
        .catch(() => {});
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "unknown error";
      const nextRunAt = computeNextCronRun(task.schedule, startedAt);
      await prisma.scheduledAgentTask.update({
        where: { taskId },
        data: { lastRunAt: startedAt, lastStatus: "error", lastError: errMsg, nextRunAt },
      });
      await prisma.scheduledJob
        .update({ where: { jobId: taskId }, data: { lastRunAt: startedAt, lastStatus: "error", lastError: errMsg, nextRunAt } })
        .catch(() => {});
    }
    return;
  }

  // Self-optimization sweep (BET-0e): deterministic — reconcile consolidation
  // parity, re-measure bet blast radius, derive stalled bets, persist the
  // summary. No LLM loop; mirrors the SysML projection branch above.
  if (task.taskId === SELF_OPTIMIZATION_SWEEP_TASK_ID) {
    const startedAt = new Date();
    try {
      const { runSelfOptimizationSweep } = await import("@/lib/optimization/self-optimization-sweep");
      const summary = await runSelfOptimizationSweep();
      console.info(
        "[agent-task-scheduler] self-optimization sweep outstanding=%d stalled=%d graph=%s",
        summary.outstandingBets.length,
        summary.stalledBets.length,
        summary.graphAvailable,
      );
      const nextRunAt = computeNextCronRun(task.schedule, startedAt);
      await prisma.scheduledAgentTask.update({
        where: { taskId },
        data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, nextRunAt },
      });
      await prisma.scheduledJob
        .update({ where: { jobId: taskId }, data: { lastRunAt: startedAt, lastStatus: "ok", lastError: null, nextRunAt } })
        .catch(() => {});
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "unknown error";
      const nextRunAt = computeNextCronRun(task.schedule, startedAt);
      await prisma.scheduledAgentTask.update({
        where: { taskId },
        data: { lastRunAt: startedAt, lastStatus: "error", lastError: errMsg, nextRunAt },
      });
      await prisma.scheduledJob
        .update({ where: { jobId: taskId }, data: { lastRunAt: startedAt, lastStatus: "error", lastError: errMsg, nextRunAt } })
        .catch(() => {});
    }
    return;
  }

  const now = new Date();
  let taskRunRef: ScheduledTaskRunRef | null = null;
  let preparedPlaybook: Awaited<
    ReturnType<typeof prepareProductManagementPlaybookRun>
  > | null = null;
  // BI-754C9E82: the resolved plan is needed in the catch block (retry policy);
  // null when failure precedes resolution (fall back to plain cron re-arm).
  let resolvedPlan: Awaited<ReturnType<typeof resolveUserAwareProactivityPlan>> | null = null;

  try {
    if (task.taskKind === PRODUCT_MANAGEMENT_PLAYBOOK_TASK_KIND) {
      preparedPlaybook = await prepareProductManagementPlaybookRun(task);
      if (preparedPlaybook.unchanged) return await recordUnchangedScheduledRun(task, now);
    }
    // BI-CAP-B5F50D1F: the stage task shares the drive's tick, so it can start
    // before the drive reads the evidence that already answered this dispatch.
    if (task.taskId.startsWith("workroom-")) {
      const { loadStageDispatchAnswered } = await import("@/lib/work-management/stage-dispatch-answered");
      const answer = await loadStageDispatchAnswered(task);
      if (answer.answered) {
        // Same form as the failure line below (CodeQL #39): JSON.stringify escapes CR/LF.
        console.info("[agent-task-scheduler] %s: stage %s already has completing evidence for this dispatch (%s); not running it again.", JSON.stringify(taskId), JSON.stringify(answer.stageKey), answer.evidenceRecordedAt.toISOString());
        return await recordUnchangedScheduledRun(task, now);
      }
    }
    const executionPrompt = preparedPlaybook?.prompt ?? task.prompt;

    // Get or create a dedicated thread for this scheduled task
    const contextKey = `scheduled:${taskId}`;
    const thread = await prisma.agentThread.upsert({
      where: { userId_contextKey: { userId: task.ownerUserId, contextKey } },
      update: {},
      create: { userId: task.ownerUserId, contextKey },
    });
    const scheduledPrompt = formatScheduledTurnPrompt(task.title, executionPrompt);
    // Persist the user prompt as a message
    await prisma.agentMessage.create({
      data: {
        threadId: thread.id,
        role: "user",
        content: scheduledPrompt,
        agentId: task.agentId,
        routeContext: task.routeContext,
      },
    });

    // BI-27C8484F: the identity ladder, then MOVED by the room's ladder when this
    // job serves a Workroom — its declaration, the work's shape, and the
    // obligation this tick races. A job serving no room resolves exactly as before.
    const { plan: proactivity } = await resolveScheduledTickPlan({
      userId: task.ownerUserId,
      taskConfig: task.taskConfig,
      agentId: task.agentId,
      routeContext: task.routeContext,
      now: new Date(),
    });
    resolvedPlan = proactivity;

    // BI-754C9E82: record the resolved delegated posture on the run — the
    // scheduler is the "caller" delegating scheduled work to the coworker, so
    // the run carries an auditable effective level + action boundary instead of
    // the posture resolver staying dead code.
    const delegatedPosture = resolveDelegatedPosture({
      caller: { agentId: "agent-task-scheduler" },
      receiver: { agentId: task.agentId, localProactivityPlan: proactivity },
    });

    taskRunRef = await createTaskRunForScheduledTask({
      taskId: task.taskId,
      ownerUserId: task.ownerUserId,
      agentId: task.agentId,
      threadId: thread.id,
      routeContext: task.routeContext,
      title: task.title,
      prompt: executionPrompt,
      taskConfig: task.taskConfig,
      proactivity,
      delegatedPosture,
    });
    await prisma.scheduledAgentTask.update({ where: { taskId }, data: { taskRunId: taskRunRef.taskRunId } });

    await createTaskMessage({
      taskRunId: taskRunRef.taskRunId,
      taskRunRecordId: taskRunRef.id,
      contextId: taskRunRef.contextId,
      role: "user",
      content: scheduledPrompt,
      metadata: {
        source: "scheduled",
        taskId: task.taskId,
        routeContext: task.routeContext,
      },
    });

    // Look up owner's role for permission context
    const owner = await prisma.user.findUnique({
      where: { id: task.ownerUserId },
      select: { id: true, isSuperuser: true },
    });
    const userContext = {
      userId: task.ownerUserId,
      platformRole: null as string | null,
      isSuperuser: owner?.isSuperuser ?? false,
    };

    const agentInfo = await resolveAutonomousWorkAgent({
      agentId: task.agentId,
      routeContext: task.routeContext,
      userContext,
    });

    const chatHistory = [
      {
        role: "user" as const,
        content: scheduledPrompt,
      },
    ];

    // Advise strips writes; propose diverts unmandated writes through the monitor.
    const boundary = proactivity.actionBoundary;
    // BI-0A59F936: unattended turns resolve external access from standing grants.
    const externalAccess = await resolveScheduledTurnExternalAccess(task.agentId);
    const roomStage = task.taskId.startsWith("workroom-")
      ? await (await import("@/lib/work-management/room-stage-mandate")).loadScheduledRoomAuthorityLive({ taskRunId: taskRunRef.taskRunId, agentId: task.agentId }) : null;
    const roomTurn = roomStage?.roomTurn;
    // BI-CAP-F2D39F8F budgets attachment to the serving model. A prompt that NAMES
    // a governed writer declares a dependency on it, so it is pinned inside the
    // budget rather than left to runtime discovery (BI-4A394B21).
    const toolArgs = {
      userContext,
      mode: (boundary === "advise" || roomTurn?.actionBoundary === "advise" ? "advise" : "act") as "advise" | "act",
      agentId: task.agentId,
      externalAccessEnabled: externalAccess.enabled && (roomTurn?.externalAccess.enabled ?? true),
      ...(roomTurn ? { roomAuthorizedGrants: roomTurn.authorizedGrants } : {}),
      routeContext: task.routeContext,
      intentQuery: task.prompt,
    };
    let { tools, toolsForProvider, deferredTools } = await resolveAutonomousWorkTools(toolArgs);
    const pinned = scheduledToolsNeedingPin({
      prompt: task.prompt, attached: tools, deferred: deferredTools, taskConfig: task.taskConfig,
    });
    if (pinned.length > 0) {
      ({ tools, toolsForProvider, deferredTools } = await resolveAutonomousWorkTools({
        ...toolArgs, requiredToolNames: pinned,
      }));
    }
    // A research task that cannot research fails loudly BEFORE the model runs.
    assertScheduledResearchCapability({
      taskKind: task.taskKind, prompt: task.prompt, agentId: task.agentId,
      tools: [...tools, ...deferredTools], externalAccess,
    });
    // BI-62DB6C03: a Workroom stage is never dispatched without its evidence writer.
    const writerGap = scheduledMandatoryToolGap({ prompt: task.prompt, taskConfig: task.taskConfig, mode: toolArgs.mode, attached: tools, deferred: deferredTools });
    if (writerGap) throw new Error(`Scheduled run not dispatched (${writerGap}).`);

    // Mirror the interactive coworker path (agent-coworker.sendMessage): carry the
    // coworker's configured model requirements into the scheduled run. Without
    // this, executeAutonomousAgenticLoop routes at the default tier — for the
    // Marketing Strategist that drops its route's frontier floor
    // (defaultMinimumTier: "frontier", set precisely because weaker models were
    // observed refusing to call tools) and the loop fabricates "Done" with zero
    // tool calls (BI-3F09BDD4). The Golden Triangle posture is still applied
    // independently at prepareRoute via agentId; this restores the per-coworker
    // floor the interactive path sends, and benefits every autonomous coworker
    // whose route declares modelRequirements.
    const rawModelRequirements =
      agentInfo.modelRequirements && typeof agentInfo.modelRequirements === "object"
        ? (agentInfo.modelRequirements as Record<string, unknown>)
        : {};
    const modelRequirements = applyProviderRouteModelPreference(
      { ...rawModelRequirements },
      task.routeContext,
    );

    const loopInput = {
      systemPrompt: agentInfo.systemPrompt,
      systemPromptInstructionSpans: coworkerBriefSpans(agentInfo.systemPrompt),
      chatHistory,
      sensitivity: agentInfo.sensitivity ?? "internal",
      tools,
      toolsForProvider,
      deferredTools,
      userId: task.ownerUserId,
      routeContext: task.routeContext,
      agentId: task.agentId,
      threadId: thread.id,
      taskRunId: taskRunRef.taskRunId,
      proposeSideEffects: boundary === "propose" || Boolean(roomTurn) || Boolean(roomStage?.withheldBecause),
      ...(roomTurn ? { roomTurn } : {}),
      ...(Object.keys(modelRequirements).length > 0 ? { modelRequirements } : {}),
    };
    let result = await executeAutonomousAgenticLoop(loopInput);
    // BI-62DB6C03: one correction turn when the writer was handed over and not called.
    const attachedToolNames = tools.map((tool) => tool.name);
    const correction = scheduledRequiredToolCorrection({ prompt: task.prompt, authorizedTools: [...tools, ...deferredTools], attachedToolNames, executedTools: result.executedTools ?? [] });
    if (correction && !(await prisma.toolExecution.findFirst({ where: { taskRunId: taskRunRef.taskRunId, toolName: correction.toolName, success: true }, select: { id: true } }))) {
      const retry = await executeAutonomousAgenticLoop({ ...loopInput, chatHistory: [...chatHistory, { role: "assistant" as const, content: result.content ?? "" }, { role: "user" as const, content: correction.message }] });
      result = { ...retry, executedTools: [...(result.executedTools ?? []), ...(retry.executedTools ?? [])] };
    }
    const executedTools = [...(result.executedTools ?? [])];

    const requiredTool = getRequiredProceduralToolForScheduledTask(task.taskId, task.agentId);
    if (requiredTool) {
      const hasPersistedRequiredTool = await prisma.toolExecution.findFirst({
        where: {
          taskRunId: taskRunRef.taskRunId,
          toolName: requiredTool.name,
          success: true,
        },
        select: { id: true },
      });

      // Recency guard: for artifact tools with no write-time dedup (the marketing
      // brief tool is a plain .create), skip the forced fallback when a fresh
      // artifact already exists — the coworker just produced one this run, or a
      // recent run did. Without this, the daily self-task would duplicate a
      // placeholder brief every tick (BI-3F09BDD4).
      const artifactAlreadyFresh = requiredTool.hasRecentArtifact
        ? await requiredTool.hasRecentArtifact().catch(() => false)
        : false;

      if (!hasPersistedRequiredTool && !artifactAlreadyFresh) {
        const alreadyCountedRequiredTool = executedTools.some(
          (tool) => tool.name === requiredTool.name,
        );
        const toolResult = await executeAutonomousWorkTool({
          toolName: requiredTool.name,
          args: requiredTool.args,
          userId: task.ownerUserId,
          userContext,
          routeContext: task.routeContext,
          agentId: task.agentId,
          threadId: thread.id,
          taskRunId: taskRunRef.taskRunId,
          externalAccessEnabled: externalAccess.enabled,
        });
        if (!alreadyCountedRequiredTool) {
          executedTools.push({
            name: requiredTool.name,
            args: requiredTool.args,
            result: toolResult,
          });
        }
      }
    }

    // BI-E0F27E0E: every endpoint failing leaves the loop returning ONLY a
    // friendly provider-failure apology with zero executed tools (live repro:
    // TR-SCHED-B7151A4C). That run did no work — throw so the catch below
    // records status=failed and the BI-754C9E82 retry cadence takes over,
    // instead of completing quietly with a healthy lastStatus. BI-D48B3B0F: judge what the run PERSISTED too.
    const verdictTools = withPersistedExecutions(executedTools, await prisma.toolExecution.findMany({ where: { taskRunId: taskRunRef.taskRunId, success: true }, select: { toolName: true, result: true } }));
    const requiredTools = classifyScheduledRequiredTools({ prompt: task.prompt, authorizedTools: [...tools, ...deferredTools], executedTools: verdictTools, preservePendingApprovals: Boolean(readWorkroomStageTaskConfig(task.taskConfig)) });
    const runFailure = detectScheduledRunFailure({ prompt: task.prompt, authorizedTools: [...tools, ...deferredTools], executedTools: verdictTools, content: result.content, attachedToolNames });
    if (runFailure && requiredTools.kind !== "proposed") throw new Error(`Scheduled run produced no governed work (${runFailure}). ${result.content ?? ""}`.trim());

    const scheduledSummary = extractScheduledTaskSummary(executedTools);
    const taskMessageContent = scheduledSummary?.compactStatus ?? result.content ?? "(No response)";
    const playbookRunStatus =
      preparedPlaybook &&
      executedTools.some((tool) => {
        const value = tool.result;
        return (
          value != null &&
          typeof value === "object" &&
          "success" in value &&
          (value as { success?: unknown }).success === false
        );
      })
        ? "partial"
        : "completed";

    // Persist agent response
    await prisma.agentMessage.create({
      data: {
        threadId: thread.id,
        role: "assistant",
        content: result.content ?? "(No response)",
        agentId: task.agentId,
        routeContext: task.routeContext,
      },
    });

    await createTaskMessage({
      taskRunId: taskRunRef.taskRunId,
      taskRunRecordId: taskRunRef.id,
      contextId: taskRunRef.contextId,
      role: "agent",
      content: taskMessageContent,
      metadata: {
        source: "scheduled",
        taskId: task.taskId,
        agentId: task.agentId,
      },
    });

    if (scheduledSummary) {
      await prisma.agentMessage.create({
        data: {
          threadId: thread.id,
          role: "assistant",
          content: scheduledSummary.threadMessage,
          agentId: task.agentId,
          routeContext: task.routeContext,
          taskType: "scheduled-task-summary",
        },
      });
    }

    const oneShot = isOneShotCron(task.schedule);
    const nextRunAt = oneShot || requiredTools.kind === "proposed" && readWorkroomStageTaskConfig(task.taskConfig) ? null : computeNextCronRun(task.schedule, now);
    await prisma.scheduledAgentTask.update({
      where: { taskId },
      data: {
        lastRunAt: now,
        lastStatus: scheduledRunLastStatus(requiredTools, preparedPlaybook, playbookRunStatus),
        lastError: null,
        lastThreadId: thread.id,
        taskRunId: taskRunRef.taskRunId,
        nextRunAt,
        // BI-754C9E82: success closes the retry cycle.
        attempts: 0,
        ...(preparedPlaybook
          ? {
              taskConfig: completeProductManagementPlaybookRun(
                task.taskConfig,
                {
                  fingerprint: preparedPlaybook.fingerprint,
                  completedAt: now,
                  status: playbookRunStatus,
                },
              ),
            }
          : {}),
        ...(oneShot ? { isActive: false } : {}),
      },
    });

    await prisma.taskRun.update({
      where: { id: taskRunRef.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        progressPayload: {
          scheduledSummary: scheduledSummary?.compactStatus ?? null,
          scheduledSummaryPayload: scheduledSummary?.payload ?? null,
          executedToolCount: executedTools.length,
          ...(preparedPlaybook
            ? {
                productManagementPlaybook: {
                  recipeId: preparedPlaybook.config.recipeId,
                  inputFingerprint: preparedPlaybook.fingerprint,
                  sourceIds: preparedPlaybook.sources.map(
                    (source) => `${source.sourceKind}:${source.sourceId}`,
                  ),
                  outcome: playbookRunStatus,
                },
              }
            : {}),
        },
      },
    });

    await prisma.scheduledJob.update({
      where: { jobId: taskId },
      data: {
        lastRunAt: now,
        lastStatus: scheduledRunLastStatus(requiredTools, preparedPlaybook, playbookRunStatus),
        lastError: null,
        nextRunAt,
      },
    }).catch(() => {});

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "unknown error";
    // CodeQL #39 (js/tainted-format-string): taskId via format-arg.
    console.error("[agent-task-scheduler] Task %s failed: %s",
      JSON.stringify(taskId),
      JSON.stringify(errMsg));

    const ref = taskRunRef;
    if (ref) {
      await prisma.taskRun.update({
        where: { id: ref.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          progressPayload: {
            error: errMsg,
          },
        },
      }).catch((updateErr) => {
        console.error(
          `[agent-task-scheduler] Failed to mark TaskRun ${ref.taskRunId} failed:`,
          updateErr,
        );
      });
    }

    // BI-754C9E82: the plan's followUpCadenceMinutes/maxAttempts are ENFORCED
    // as the retry policy. Attempt N failing schedules a short-cadence retry at
    // cadence[N-1] minutes while attempts < maxAttempts and a cadence step
    // exists; exhausting the budget re-arms the normal cron and resets the
    // budget so the next cycle starts fresh. resolvedPlan is null when the
    // failure happened before plan resolution — fall back to plain cron re-arm.
    const failedAttempts = (task.attempts ?? 0) + 1;
    const cadence = resolvedPlan?.followUpCadenceMinutes ?? [];
    const maxAttempts = resolvedPlan?.maxAttempts ?? 0;
    const retryDelayMinutes =
      failedAttempts < maxAttempts ? cadence[failedAttempts - 1] : undefined;
    const willRetry = typeof retryDelayMinutes === "number" && retryDelayMinutes > 0;
    const nextRunAt = willRetry
      ? new Date(now.getTime() + retryDelayMinutes * 60_000)
      : computeNextCronRun(task.schedule, now);
    if (willRetry) {
      console.info(
        "[agent-task-scheduler] Task %s failed attempt %d/%d — retrying in %d min per proactivity plan",
        JSON.stringify(taskId),
        failedAttempts,
        maxAttempts,
        retryDelayMinutes,
      );
    }
    await prisma.scheduledAgentTask.update({
      where: { taskId },
      data: {
        lastRunAt: now,
        lastStatus: "error",
        lastError: errMsg,
        taskRunId: taskRunRef?.taskRunId ?? null,
        nextRunAt,
        attempts: willRetry ? failedAttempts : 0,
      },
    });

    await prisma.scheduledJob.update({
      where: { jobId: taskId },
      data: { lastRunAt: now, lastStatus: "error", lastError: errMsg, nextRunAt },
    }).catch(() => {});
    // BI-2B6A8A74: a room's stage that no provider could answer holds the room's queue.
    await holdWorkroomQueueAfterFailure({ taskId, ownerUserId: task.ownerUserId, taskConfig: task.taskConfig, error: errMsg, now }).catch(() => null);
  }
}
