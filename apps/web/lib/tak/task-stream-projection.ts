import type { AgentEvent } from "@/lib/tak/agent-event-bus";
import type { TaskState } from "@/lib/tak/task-states";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isAgentEvent(value: unknown): value is AgentEvent {
  return isRecord(value) && typeof value.type === "string";
}

function makeTaskStatusEvent(input: {
  taskId: string;
  contextId: string | null;
  state: TaskState;
  sourceEvent: AgentEvent["type"];
  message?: string;
  progress?: {
    stage?: string;
    percent?: number;
  };
}): AgentEvent {
  return {
    type: "task:status",
    taskId: input.taskId,
    contextId: input.contextId,
    state: input.state,
    sourceEvent: input.sourceEvent,
    ...(input.message ? { message: input.message } : {}),
    ...(input.progress ? { progress: input.progress } : {}),
  };
}

export function projectAgentEventToTaskEvents(
  event: AgentEvent,
  options?: {
    contextId?: string | null;
  },
): AgentEvent[] {
  if ("taskRunId" in event) {
    if (event.type === "brand:extract.progress") {
      return [makeTaskStatusEvent({
        taskId: event.taskRunId,
        contextId: options?.contextId ?? null,
        state: "working",
        sourceEvent: event.type,
        message: event.message,
        progress: {
          stage: event.stage,
          percent: event.percent,
        },
      })];
    }
    if (event.type === "brand:extract.complete") {
      return [makeTaskStatusEvent({
        taskId: event.taskRunId,
        contextId: options?.contextId ?? null,
        state: "completed",
        sourceEvent: event.type,
        message: event.summary,
      })];
    }
    if (event.type === "brand:extract.failed") {
      return [makeTaskStatusEvent({
        taskId: event.taskRunId,
        contextId: options?.contextId ?? null,
        state: "failed",
        sourceEvent: event.type,
        message: event.error,
      })];
    }
  }

  return [];
}

export function projectTaskStreamEvents(
  event: AgentEvent,
  contextId: string | null,
): AgentEvent[] {
  return [
    event,
    ...projectAgentEventToTaskEvents(event, { contextId }),
  ];
}

export function projectPersistedTaskProgressEvents(
  payload: unknown,
  options?: {
    contextId?: string | null;
  },
): AgentEvent[] {
  if (isAgentEvent(payload)) {
    return projectTaskStreamEvents(payload, options?.contextId ?? null);
  }

  if (isRecord(payload) && Array.isArray(payload.events)) {
    return payload.events.flatMap((event) =>
      isAgentEvent(event)
        ? projectTaskStreamEvents(event, options?.contextId ?? null)
        : [],
    );
  }

  if (Array.isArray(payload)) {
    return payload.flatMap((event) =>
      isAgentEvent(event)
        ? projectTaskStreamEvents(event, options?.contextId ?? null)
        : [],
    );
  }

  return [];
}
