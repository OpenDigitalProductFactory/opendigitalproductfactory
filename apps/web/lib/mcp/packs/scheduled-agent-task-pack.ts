// Scheduled-agent-task tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the recurring-agent-task management domain out of the mcp-tools.ts
// executeTool switch: creating a recurring agent task on a UTC cron, listing the
// tasks owned by the calling user, and cancelling one by id. Each handler
// lazy-imports the single backing service (the userId-parameterized scheduling
// core) and reproduces the former switch case verbatim, so behaviour is
// identical when the tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import { SCHEDULED_AGENT_TASK_KINDS } from "@/lib/operate/scheduled-jobs/agent-task-kind";
import {
  isScheduledWorkTriggerKind,
  SCHEDULED_WORK_TRIGGER_KINDS,
  withScheduledWorkTrigger,
  type ScheduledWorkTriggerKind,
} from "@/lib/scheduling/scheduled-work-trigger";

const definitions: ToolDefinition[] = [
  {
    name: "create_scheduled_agent_task",
    // changes identity or authority → consult-gated (TAK §8.4.1). Kept terse:
    // the coverage measure only sees a 3000-char window from `name:` (BI-99F4B22C).
    sideEffect: true,
    consequence: "authority",
    description: "Create a recurring agent task that runs in the coordination plane (TaskRun/thread/tools/evidence) on a 5-field UTC cron. Owned by the calling user; the supported way for an agent to schedule recurring work instead of a client-local cron.",
    inputSchema: {
      type: "object",
      properties: {
        agentId: { type: "string", description: "Coworker agent id that runs the task (e.g. AGT-... or a role id like platform-engineer)." },
        title: { type: "string", description: "Short human title for the task." },
        prompt: { type: "string", description: "The instruction the agent runs each tick." },
        schedule: { type: "string", description: "5-field cron expression in UTC, e.g. '0 9 1 * *' = 1st of each month at 09:00 UTC." },
        routeContext: { type: "string", description: "Route context the task runs under (optional, default /platform)." },
        organizationId: { type: "string", description: "Optional organization scope. Required for typed product-management tasks." },
        productLineId: { type: "string", description: "Optional ProductLine scope; mutually exclusive with businessProductId." },
        businessProductId: { type: "string", description: "Optional business Product scope; mutually exclusive with productLineId." },
        taskKind: {
          type: "string",
          enum: [...SCHEDULED_AGENT_TASK_KINDS],
          description: "Optional typed execution contract.",
        },
        taskConfig: {
          type: "object",
          description: "Versioned typed configuration for taskKind. Product-management playbooks require a previewed permissions digest.",
        },
        trigger: {
          type: "object",
          description: "WHY this job exists, so immediacy is judgeable at fire time (BI-5087F34F). Recorded either way — omit it and the job records kind 'time'. Supply workroomId to have the room's posture govern this job's pace at fire time.",
          properties: {
            kind: { type: "string", enum: [...SCHEDULED_WORK_TRIGGER_KINDS], description: "Trigger source." },
            workroomId: { type: "string", description: "Room this job serves, if any." },
            obligation: {
              type: "object",
              description: "Obligation discharged, if any.",
              properties: {
                dueAt: { type: "string", description: "ISO-8601 due instant." },
                label: { type: "string", description: "Optional label." },
              },
              required: ["dueAt"],
            },
          },
          required: ["kind"],
        },
      },
      required: ["agentId", "title", "prompt", "schedule"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
  },
  {
    name: "list_scheduled_agent_tasks",
    description: "List the recurring agent tasks owned by the calling user (id, title, explicit product scope, typed kind, schedule, active state, next/last run, last status). Optional product scope returns only that exact operating boundary.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string" },
        productLineId: { type: "string" },
        businessProductId: { type: "string" },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "cancel_scheduled_agent_task",
    description: "Deactivate a recurring agent task by id. Only the owning user may cancel it.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The scheduled agent task id (agent-task-xxxxxxxx)." },
      },
      required: ["taskId"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: true,
    // destroys state → consult-gated (TAK §8.4.1).
    consequence: "irreversible",
  },
  {
    name: "pause_scheduled_agent_task",
    description: "Pause a recurring agent task owned by the calling user while preserving its run history and typed configuration.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The scheduled agent task id." },
      },
      required: ["taskId"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "resume_scheduled_agent_task",
    description: "Resume a paused recurring agent task owned by the calling user and compute its next canonical cron run.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The scheduled agent task id." },
      },
      required: ["taskId"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "rerun_scheduled_agent_task",
    description: "Queue an immediate rerun of a scheduled agent task owned by the calling user.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "The scheduled agent task id." },
      },
      required: ["taskId"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: true,
  },
];

async function createScheduledAgentTaskHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const { scheduleAgentTaskFor } = await import("@/lib/operate/scheduled-jobs/agent-task-core");

  // BI-5087F34F — merge the trigger record into taskConfig, preserving any
  // typed kind config already supplied.
  const baseTaskConfig =
    params.taskConfig && typeof params.taskConfig === "object" && !Array.isArray(params.taskConfig)
      ? (params.taskConfig as Record<string, unknown>)
      : null;
  const triggerParam =
    params.trigger && typeof params.trigger === "object" && !Array.isArray(params.trigger)
      ? (params.trigger as Record<string, unknown>)
      : null;
  if (triggerParam && !isScheduledWorkTriggerKind(triggerParam.kind)) {
    return {
      success: false,
      error: "invalid_trigger_kind",
      message: `trigger.kind must be one of: ${SCHEDULED_WORK_TRIGGER_KINDS.join(", ")}.`,
    };
  }
  const obligationParam =
    triggerParam?.obligation
    && typeof triggerParam.obligation === "object"
    && !Array.isArray(triggerParam.obligation)
      ? (triggerParam.obligation as Record<string, unknown>)
      : null;
  // BI-5087F34F set out to record WHY a job exists, not just when. Recording it
  // only when a caller opted in left most tasks with no answer: of 53 live tasks
  // 13 carried a trigger, and none of the 12 ACTIVE ones did. An optional
  // provenance record is one most callers never supply.
  //
  // So the record is now unconditional. "time" is the honest default for a job
  // created on a cron with no stated cause — it is what a scheduled job IS, not
  // a guess about intent. A caller that knows better still supplies its own kind,
  // the room it serves, and the obligation it races; nothing about that path
  // changes. What changes is that "why does this job exist" now always has an
  // answer, which is what the posture ladder reads at fire time.
  const taskConfig = withScheduledWorkTrigger(baseTaskConfig, {
    kind: (triggerParam?.kind as ScheduledWorkTriggerKind | undefined) ?? "time",
    workroomId: typeof triggerParam?.workroomId === "string" ? triggerParam.workroomId : null,
    obligation:
      typeof obligationParam?.dueAt === "string"
        ? {
            dueAt: obligationParam.dueAt,
            label: typeof obligationParam.label === "string" ? obligationParam.label : null,
          }
        : null,
  });
  const result = await scheduleAgentTaskFor(userId, {
    agentId: String(params.agentId ?? ""),
    title: String(params.title ?? ""),
    prompt: String(params.prompt ?? ""),
    routeContext: typeof params.routeContext === "string" ? params.routeContext : "/platform",
    schedule: String(params.schedule ?? ""),
    timezone: typeof params.timezone === "string" ? params.timezone : undefined,
    ...(typeof params.organizationId === "string"
      ? { organizationId: params.organizationId }
      : {}),
    ...(typeof params.productLineId === "string"
      ? { productLineId: params.productLineId }
      : {}),
    ...(typeof params.businessProductId === "string"
      ? { businessProductId: params.businessProductId }
      : {}),
    ...(typeof params.taskKind === "string"
      ? { taskKind: params.taskKind as (typeof SCHEDULED_AGENT_TASK_KINDS)[number] }
      : {}),
    // BI-5087F34F: taskConfig now carries the trigger record as well as the
    // typed kind config. It was previously written ONLY when taskKind was set,
    // which would have made the trigger unrecordable for exactly the ordinary
    // jobs that most need to say why they exist.
    ...(taskConfig !== null ? { taskConfig } : {}),
  });
  return result.success
    ? { success: true, entityId: result.taskId, message: `Scheduled agent task ${result.taskId} created${result.note ? ` (${result.note})` : ""}.` }
    : { success: false, error: result.error, message: result.error };
}

async function listScheduledAgentTasksHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const { getScheduledAgentTasksFor } = await import("@/lib/operate/scheduled-jobs/agent-task-core");
  const scope =
    typeof params.organizationId === "string"
      ? {
          organizationId: params.organizationId,
          productLineId:
            typeof params.productLineId === "string"
              ? params.productLineId
              : null,
          businessProductId:
            typeof params.businessProductId === "string"
              ? params.businessProductId
              : null,
        }
      : undefined;
  const tasks = scope
    ? await getScheduledAgentTasksFor(userId, scope)
    : await getScheduledAgentTasksFor(userId);
  // Bound each prompt so a few long tasks can't blow the local context window
  // (the MCP-route result cap is the backstop).
  const compact = tasks.map((t) => ({ ...t, prompt: t.prompt.length > 200 ? `${t.prompt.slice(0, 200)}…` : t.prompt }));
  return { success: true, message: `${tasks.length} scheduled agent task(s).`, data: { tasks: compact } };
}

async function changeScheduledAgentTaskHandler(
  params: Record<string, unknown>,
  userId: string,
  action: "pause" | "resume" | "rerun",
): Promise<ToolResult> {
  const taskId = String(params.taskId ?? "");
  if (!taskId) {
    return {
      success: false,
      error: "taskId is required.",
      message: "Provide a scheduled agent task id.",
    };
  }
  const core = await import("@/lib/operate/scheduled-jobs/agent-task-core");
  const result =
    action === "rerun"
      ? await core.rerunAgentTaskFor(userId, taskId)
      : await core.setAgentTaskActiveFor(userId, taskId, action === "resume");
  return result.success
    ? {
        success: true,
        entityId: taskId,
        message: `Scheduled agent task ${taskId} ${action === "pause" ? "paused" : action === "resume" ? "resumed" : "queued for rerun"}.`,
      }
    : {
        success: false,
        error: result.error,
        message: result.error ?? `${action} failed.`,
      };
}

async function cancelScheduledAgentTaskHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const { cancelAgentTaskFor } = await import("@/lib/operate/scheduled-jobs/agent-task-core");
  const taskId = String(params.taskId ?? "");
  if (!taskId) return { success: false, error: "taskId is required.", message: "Provide a scheduled agent task id." };
  const result = await cancelAgentTaskFor(userId, taskId);
  return result.success
    ? { success: true, entityId: taskId, message: `Scheduled agent task ${taskId} cancelled.` }
    : { success: false, error: result.error, message: result.error ?? "Cancel failed." };
}

const handlers: Record<string, ToolPackHandler> = {
  create_scheduled_agent_task: (params, userId) => createScheduledAgentTaskHandler(params, userId),
  list_scheduled_agent_tasks: (params, userId) => listScheduledAgentTasksHandler(params, userId),
  cancel_scheduled_agent_task: (params, userId) => cancelScheduledAgentTaskHandler(params, userId),
  pause_scheduled_agent_task: (params, userId) =>
    changeScheduledAgentTaskHandler(params, userId, "pause"),
  resume_scheduled_agent_task: (params, userId) =>
    changeScheduledAgentTaskHandler(params, userId, "resume"),
  rerun_scheduled_agent_task: (params, userId) =>
    changeScheduledAgentTaskHandler(params, userId, "rerun"),
};

export const scheduledAgentTaskPack: ToolPack = {
  packId: "scheduled-agent-task",
  definitions,
  handlers,
  grants: {
    create_scheduled_agent_task: ["work_capsule_write"],
    cancel_scheduled_agent_task: ["work_capsule_write"],
    pause_scheduled_agent_task: ["work_capsule_write"],
    resume_scheduled_agent_task: ["work_capsule_write"],
    rerun_scheduled_agent_task: ["work_capsule_write"],
    list_scheduled_agent_tasks: ["work_capsule_read"],
  },
};
