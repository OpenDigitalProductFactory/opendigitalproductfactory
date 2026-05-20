import "server-only";

import { prisma } from "@dpf/db";
import type { ChatMessage } from "@/lib/inference/ai-inference";
import {
  executeAutonomousAgenticLoop,
  resolveAutonomousWorkAgent,
  resolveAutonomousWorkTools,
  type AutonomousWorkUserContext,
} from "@/lib/tak/autonomous-work-run";

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "canceled",
  "cancelled",
  "rejected",
  "archived",
]);

const CHAT_HISTORY_LIMIT = 50;
const SUMMARY_LIMIT = 1000;
const DEFAULT_ROUTE_CONTEXT = "/coworker";

export type ChildRuntimeContext = {
  threadId: string;
  taskRunId: string;
  userId: string;
  agentId: string;
  routeContext: string;
};

export async function prepareChildExecution(
  childThreadId: string,
  userId: string,
): Promise<ChildRuntimeContext> {
  const thread = await prisma.agentThread.findUnique({
    where: { id: childThreadId },
    select: {
      id: true,
      userId: true,
      cancelledAt: true,
    },
  });
  if (!thread) throw new Error(`Child thread ${childThreadId} not found`);
  if (thread.userId !== userId) {
    throw new Error("Child thread is owned by another user");
  }
  if (thread.cancelledAt) {
    throw new Error("Child thread is cancelled");
  }

  const taskRun = await prisma.taskRun.findFirst({
    where: { threadId: childThreadId, archivedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      taskRunId: true,
      userId: true,
      status: true,
      currentAgentId: true,
      initiatingAgentId: true,
      routeContext: true,
    },
  });
  if (!taskRun) {
    throw new Error(`Child thread ${childThreadId} has no task run to dispatch`);
  }
  if (taskRun.userId !== userId) {
    throw new Error("Child task run is owned by another user");
  }
  if (TERMINAL_STATUSES.has(taskRun.status)) {
    throw new Error(
      `Child task run ${taskRun.taskRunId} is already in terminal status ${taskRun.status}`,
    );
  }

  const agentId =
    taskRun.currentAgentId ?? taskRun.initiatingAgentId ?? "platform-coworker";
  const routeContext = taskRun.routeContext ?? DEFAULT_ROUTE_CONTEXT;

  await prisma.taskRun.update({
    where: { taskRunId: taskRun.taskRunId },
    data: {
      status: "working",
      startedAt: new Date(),
      lastHeartbeatAt: new Date(),
      currentAgentId: agentId,
    },
  });

  return {
    threadId: childThreadId,
    taskRunId: taskRun.taskRunId,
    userId,
    agentId,
    routeContext,
  };
}

export async function runChildThreadExecution(context: ChildRuntimeContext): Promise<void> {
  try {
    const chatHistory = await loadChatHistory(context.threadId);
    if (chatHistory.length === 0) {
      throw new Error("Child thread has no messages to execute");
    }

    const userContext = await loadUserContext(context.userId);

    const agentInfo = await resolveAutonomousWorkAgent({
      agentId: context.agentId,
      routeContext: context.routeContext,
      userContext,
    });

    const resolvedAgentId =
      typeof agentInfo.agentId === "string" && agentInfo.agentId.length > 0
        ? agentInfo.agentId
        : context.agentId;

    const { tools, toolsForProvider } = await resolveAutonomousWorkTools({
      userContext,
      agentId: resolvedAgentId,
      mode: "act",
    });

    const result = await executeAutonomousAgenticLoop({
      systemPrompt: agentInfo.systemPrompt,
      chatHistory,
      sensitivity: agentInfo.sensitivity ?? "internal",
      tools,
      toolsForProvider,
      userId: context.userId,
      routeContext: context.routeContext,
      agentId: resolvedAgentId,
      threadId: context.threadId,
      taskRunId: context.taskRunId,
    });

    const replyText = typeof result.content === "string" && result.content.trim().length > 0
      ? result.content
      : "(no response)";

    await prisma.agentMessage.create({
      data: {
        threadId: context.threadId,
        taskRunId: context.taskRunId,
        role: "assistant",
        content: replyText,
        agentId: resolvedAgentId,
        routeContext: context.routeContext,
      },
    });

    await prisma.taskRun.update({
      where: { taskRunId: context.taskRunId },
      data: {
        status: "completed",
        completedAt: new Date(),
        currentAgentId: resolvedAgentId,
        progressPayload: {
          summary: replyText.slice(0, SUMMARY_LIMIT),
          executedToolCount: result.executedTools?.length ?? 0,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Child thread execution failed";
    await markChildThreadFailed(context, message);
  }
}

async function loadChatHistory(threadId: string): Promise<ChatMessage[]> {
  const messages = await prisma.agentMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
    take: CHAT_HISTORY_LIMIT,
    select: { role: true, content: true },
  });
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
    .map((m) => ({
      role: m.role as ChatMessage["role"],
      content: m.content,
    }));
}

async function loadUserContext(userId: string): Promise<AutonomousWorkUserContext> {
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperuser: true },
  });
  return {
    userId,
    platformRole: null,
    isSuperuser: owner?.isSuperuser ?? false,
  };
}

async function markChildThreadFailed(
  context: ChildRuntimeContext,
  message: string,
): Promise<void> {
  await prisma.taskRun
    .update({
      where: { taskRunId: context.taskRunId },
      data: {
        status: "failed",
        completedAt: new Date(),
        progressPayload: { error: message.slice(0, SUMMARY_LIMIT) },
      },
    })
    .catch((err) => {
      console.error("[agent-thread-dispatcher] failed to mark TaskRun failed", {
        taskRunId: context.taskRunId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  await prisma.agentThread
    .update({
      where: { id: context.threadId },
      data: {
        terminalError: {
          message: message.slice(0, SUMMARY_LIMIT),
          at: new Date().toISOString(),
        },
      },
    })
    .catch((err) => {
      console.error("[agent-thread-dispatcher] failed to record terminalError", {
        threadId: context.threadId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}
