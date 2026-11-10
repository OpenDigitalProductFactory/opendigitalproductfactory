import { auth } from "@/lib/auth";
import { agentEventBus, type AgentEvent } from "@/lib/tak/agent-event-bus";
import {
  projectAgentEventToTaskEvents,
  projectPersistedTaskProgressEvents,
} from "@/lib/tak/task-stream-projection";
import { createSseResponse } from "@/lib/sse/sse-stream";
import { prisma } from "@dpf/db";
import { TASK_STATES, type TaskState } from "@/lib/tak/task-states";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

function toReplayEvents(task: {
  taskRunId: string;
  contextId: string | null;
  status: string;
  progressPayload: unknown;
  artifacts: Array<{
    artifactId: string;
    name: string;
    description: string | null;
    parts: unknown;
  }>;
}): AgentEvent[] {
  const state = TASK_STATES.includes(task.status as TaskState)
    ? task.status as TaskState
    : "working";
  const replayed: AgentEvent[] = [{
    type: "task:status",
    taskId: task.taskRunId,
    contextId: task.contextId,
    state,
    sourceEvent: "task-run.snapshot",
  }];
  replayed.push(
    ...projectPersistedTaskProgressEvents(task.progressPayload, {
      contextId: task.contextId,
    }),
  );

  for (const artifact of task.artifacts) {
    const parts = Array.isArray(artifact.parts)
      ? (artifact.parts as Array<Record<string, unknown>>)
      : [];
    const firstPart = parts[0] ?? {};
    replayed.push({
      type: "task:artifact",
      taskId: task.taskRunId,
      contextId: task.contextId,
      artifactId: artifact.artifactId,
      name: artifact.name,
      artifactType:
        typeof firstPart.type === "string" ? firstPart.type : "artifact",
      message: artifact.description ?? undefined,
    });
  }

  return replayed;
}

function matchesTaskEvent(event: AgentEvent, taskId: string): AgentEvent[] {
  if (event.type === "task:status" || event.type === "task:artifact") {
    return event.taskId === taskId ? [event] : [];
  }

  if ("taskRunId" in event && event.taskRunId === taskId) {
    return projectAgentEventToTaskEvents(event);
  }

  return [];
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { taskId } = await context.params;
  const task = await prisma.taskRun.findFirst({
    where: {
      taskRunId: taskId,
      ...(session.user.isSuperuser ? {} : { userId: session.user.id }),
    },
    select: {
      taskRunId: true,
      threadId: true,
      contextId: true,
      status: true,
      progressPayload: true,
      artifacts: {
        select: {
          artifactId: true,
          name: true,
          description: true,
          parts: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!task) {
    return new Response("Not Found", { status: 404 });
  }

  const threadId = task.threadId;

  return createSseResponse({
    signal: request.signal,
    start: (sse) => {
      for (const event of toReplayEvents(task)) {
        if (!sse.send(event)) return; // client disconnected mid-replay
      }

      if (!threadId) {
        // No live thread to follow — replay only, then close.
        sse.close();
        return;
      }

      const unsub = agentEventBus.subscribe(threadId, (event) => {
        for (const taskEvent of matchesTaskEvent(event, task.taskRunId)) {
          sse.send(taskEvent);
        }
      });
      return unsub;
    },
  });
}
