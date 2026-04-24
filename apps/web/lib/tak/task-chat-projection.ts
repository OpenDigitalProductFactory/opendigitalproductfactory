import { randomUUID } from "crypto";
import { prisma } from "@dpf/db";
import { createTaskMessage } from "@/lib/tak/task-records";

export type CoworkerTaskRef = {
  id: string;
  taskRunId: string;
  contextId: string | null;
};

export async function ensureTaskForCoworkerTurn(input: {
  userId: string;
  threadId: string;
  routeContext: string;
  content: string;
  agentId?: string | null;
}): Promise<CoworkerTaskRef> {
  const existing = await prisma.taskRun.findFirst({
    where: {
      userId: input.userId,
      threadId: input.threadId,
      archivedAt: null,
    },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, taskRunId: true, contextId: true, currentAgentId: true },
  });

  if (existing) {
    if (input.agentId && existing.currentAgentId !== input.agentId) {
      await prisma.taskRun.update({
        where: { id: existing.id },
        data: { currentAgentId: input.agentId },
      });
    }

    return {
      id: existing.id,
      taskRunId: existing.taskRunId,
      contextId: existing.contextId,
    };
  }

  const normalizedContent = input.content.trim().replace(/\s+/g, " ");
  const titlePreview = normalizedContent.slice(0, 80) || input.routeContext;

  return prisma.taskRun.create({
    data: {
      taskRunId: `TR-CHAT-${randomUUID().slice(0, 8).toUpperCase()}`,
      userId: input.userId,
      threadId: input.threadId,
      contextId: input.threadId,
      currentAgentId: input.agentId ?? null,
      routeContext: input.routeContext,
      title: `Coworker: ${titlePreview}`,
      objective: normalizedContent || `Coworker conversation on ${input.routeContext}`,
      source: "coworker",
      status: "submitted",
      authorityScope: [],
    },
    select: { id: true, taskRunId: true, contextId: true },
  });
}

function toTaskRole(role: string): string {
  if (role === "assistant") return "agent";
  return role;
}

export async function projectThreadMessageToTask(input: {
  task: CoworkerTaskRef;
  role: string;
  content: string;
  routeContext?: string | null;
  agentId?: string | null;
  providerId?: string | null;
  taskType?: string | null;
  routedEndpointId?: string | null;
  messageType?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await createTaskMessage({
    taskRunId: input.task.taskRunId,
    taskRunRecordId: input.task.id,
    contextId: input.task.contextId,
    role: toTaskRole(input.role),
    messageType: input.messageType ?? "message",
    content: input.content,
    metadata: {
      routeContext: input.routeContext ?? null,
      agentId: input.agentId ?? null,
      providerId: input.providerId ?? null,
      taskType: input.taskType ?? null,
      routedEndpointId: input.routedEndpointId ?? null,
      ...(input.metadata ?? {}),
    },
  });
}
