"use server";

import { auth } from "@/lib/auth";
import { prisma, DATA_MODEL_MIRROR_TASK_ID, SYSML_PROJECTION_TASK_ID } from "@dpf/db";
import {
  scheduleAgentTaskFor,
  getScheduledAgentTasksFor,
  cancelAgentTaskFor,
  type ScheduleAgentTaskInput,
  type ScheduleAgentTaskResult,
  type ScheduledAgentTaskView,
} from "@/lib/operate/scheduled-jobs/agent-task-core";
import { runDataModelMirror } from "@/lib/ea/run-data-model-mirror";
import { runArchitectureParitySteward } from "@/lib/ea/architecture-parity-steward";
import { runConsolidationParitySteward } from "@/lib/ea/consolidation-parity-steward";
import { computeNextCronRun, isOneShotCron } from "@/lib/operate/cron-next-run";
import { extractScheduledTaskSummary } from "./agent-task-scheduler-summary";
import {
  createTaskRunForScheduledTask,
  type ScheduledTaskRunRef,
} from "@/lib/tak/scheduled-task-runs";
import { createTaskMessage } from "@/lib/tak/task-records";
import {
  executeAutonomousAgenticLoop,
  executeAutonomousWorkTool,
  resolveAutonomousWorkAgent,
  resolveAutonomousWorkTools,
} from "@/lib/tak/autonomous-work-run";
import { resolveUserAwareProactivityPlan } from "@/lib/proactivity/proactivity-resolver.server";
import { applyProviderRouteModelPreference } from "@/lib/ai-provider-route-context";
import {
  isCoworkerSelfTaskId,
  coworkerSelfTaskRequiredTool,
} from "@/lib/operate/scheduled-jobs/coworker-self-tasks";

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

export async function getScheduledAgentTasks(): Promise<ScheduledAgentTaskView[]> {
  const session = await auth();
  if (!session?.user?.id) return [];
  return getScheduledAgentTasksFor(session.user.id);
}

// ─── Execution (called by Inngest dispatcher) ───────────────────────────────

export async function executeScheduledAgentTask(taskId: string): Promise<void> {
  const task = await prisma.scheduledAgentTask.findUnique({
    where: { taskId },
  });
  if (!task || !task.isActive) return;

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

  const now = new Date();
  let taskRunRef: ScheduledTaskRunRef | null = null;

  try {
    // Get or create a dedicated thread for this scheduled task
    const contextKey = `scheduled:${taskId}`;
    const thread = await prisma.agentThread.upsert({
      where: { userId_contextKey: { userId: task.ownerUserId, contextKey } },
      update: {},
      create: { userId: task.ownerUserId, contextKey },
    });

    // Persist the user prompt as a message
    await prisma.agentMessage.create({
      data: {
        threadId: thread.id,
        role: "user",
        content: `[Scheduled task: ${task.title}]\n\n${task.prompt}`,
        agentId: task.agentId,
        routeContext: task.routeContext,
      },
    });

    const proactivity = await resolveUserAwareProactivityPlan({
      userId: task.ownerUserId,
      input: {
        activityFamily: "scheduled-task",
        agentId: task.agentId,
        routeContext: task.routeContext,
      },
    });

    taskRunRef = await createTaskRunForScheduledTask({
      taskId: task.taskId,
      ownerUserId: task.ownerUserId,
      agentId: task.agentId,
      threadId: thread.id,
      routeContext: task.routeContext,
      title: task.title,
      prompt: task.prompt,
      proactivity,
    });

    await createTaskMessage({
      taskRunId: taskRunRef.taskRunId,
      taskRunRecordId: taskRunRef.id,
      contextId: taskRunRef.contextId,
      role: "user",
      content: `[Scheduled task: ${task.title}]\n\n${task.prompt}`,
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

    const scheduledPrompt = `[Scheduled task: ${task.title}]\n\n${task.prompt}`;
    const chatHistory = [
      {
        role: "user" as const,
        content: scheduledPrompt,
      },
    ];

    const { tools, toolsForProvider } = await resolveAutonomousWorkTools({
      userContext,
      mode: "act",
      agentId: task.agentId,
    });

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

    const result = await executeAutonomousAgenticLoop({
      systemPrompt: agentInfo.systemPrompt,
      chatHistory,
      sensitivity: agentInfo.sensitivity ?? "internal",
      tools,
      toolsForProvider,
      userId: task.ownerUserId,
      routeContext: task.routeContext,
      agentId: task.agentId,
      threadId: thread.id,
      taskRunId: taskRunRef.taskRunId,
      ...(Object.keys(modelRequirements).length > 0 ? { modelRequirements } : {}),
    });
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

    const scheduledSummary = extractScheduledTaskSummary(executedTools);
    const taskMessageContent = scheduledSummary?.compactStatus ?? result.content ?? "(No response)";

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

    // Update task status and schedule next run. A one-shot ("Once") task
    // deactivates after firing instead of re-arming a year later (BI-D72CC945).
    const oneShot = isOneShotCron(task.schedule);
    const nextRunAt = oneShot ? null : computeNextCronRun(task.schedule, now);
    await prisma.scheduledAgentTask.update({
      where: { taskId },
      data: {
        lastRunAt: now,
        lastStatus: "ok",
        lastError: null,
        lastThreadId: thread.id,
        taskRunId: taskRunRef.taskRunId,
        nextRunAt,
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
        },
      },
    });

    await prisma.scheduledJob.update({
      where: { jobId: taskId },
      data: {
        lastRunAt: now,
        lastStatus: "ok",
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

    const nextRunAt = computeNextCronRun(task.schedule, now);
    await prisma.scheduledAgentTask.update({
      where: { taskId },
      data: {
        lastRunAt: now,
        lastStatus: "error",
        lastError: errMsg,
        taskRunId: taskRunRef?.taskRunId ?? null,
        nextRunAt,
      },
    });

    await prisma.scheduledJob.update({
      where: { jobId: taskId },
      data: { lastRunAt: now, lastStatus: "error", lastError: errMsg, nextRunAt },
    }).catch(() => {});
  }
}
