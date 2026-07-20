import "server-only";

import { prisma } from "@dpf/db";
import type { ChatMessage } from "@/lib/inference/ai-inference";
import { agentEventBus } from "@/lib/agent-event-bus";
import { readCollaborationProvenance } from "@/lib/tak/conversation-participants-core";
import {
  executeAutonomousAgenticLoop,
  resolveAutonomousWorkAgent,
  resolveAutonomousWorkTools,
  type AutonomousWorkUserContext,
} from "@/lib/tak/autonomous-work-run";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import {
  formatProviderComplianceAdvisoryForOwner,
  parseProviderComplianceAdvisory,
  PROVIDER_COMPLIANCE_COLLABORATION_SUMMARY,
} from "@/lib/routing/provider-suitability/provider-compliance-advisory";

/**
 * EP-A2A: when a collaboration child thread reaches a terminal state, emit
 * collaboration:return on the PARENT thread so the coworker panel can render
 * the "returned" card and refresh the done indicator without polling. Best-
 * effort: a missing parent or provenance simply means no return card.
 */
async function emitCollaborationReturn(
  childThreadId: string,
  taskRunId: string,
  outcome: "completed" | "failed" | "canceled",
  options?: { specialistReply?: string; routeContext?: string },
): Promise<void> {
  try {
    const child = await prisma.agentThread.findUnique({
      where: { id: childThreadId },
      select: { parentThreadId: true },
    });
    if (!child?.parentThreadId) return;
    const tr = await prisma.taskRun.findUnique({
      where: { taskRunId },
      select: { a2aMetadata: true },
    });
    const prov = readCollaborationProvenance(tr?.a2aMetadata);
    if (!prov) return; // only emit returns for governed collaboration spawns
    let ownerMessage: string | undefined;
    if (prov.summary === PROVIDER_COMPLIANCE_COLLABORATION_SUMMARY) {
      const advisory = outcome === "completed" && options?.specialistReply
        ? parseProviderComplianceAdvisory(options.specialistReply)
        : null;
      ownerMessage = advisory?.success
        ? formatProviderComplianceAdvisoryForOwner(advisory.value)
        : "I could not substantiate a provider recommendation from the specialist's returned evidence. This is no provider approval, and DPF has not changed provider activation or routing eligibility. The safest next step is to retry the review or obtain qualified compliance advice.";
      await prisma.agentMessage.create({
        data: {
          threadId: child.parentThreadId,
          role: "assistant",
          content: ownerMessage,
          agentId: prov.fromAgentId,
          routeContext: options?.routeContext ?? DEFAULT_ROUTE_CONTEXT,
        },
      });
    }
    agentEventBus.emit(child.parentThreadId, {
      type: "collaboration:return",
      parentThreadId: child.parentThreadId,
      childThreadId,
      fromAgentId: prov.toAgentId,
      toAgentId: prov.fromAgentId ?? "",
      taskRunId,
      outcome,
      ...(ownerMessage ? { ownerMessage } : {}),
    });
  } catch {
    // non-fatal — the panel's in-flight poll still flips the done indicator.
  }
}

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

    // Grant preflight: if this agent holds no grant for a single tool it was
    // handed, every tool call in the loop would be rejected with
    // forbidden_grant. Fail fast with an actionable message instead of
    // dispatching a loop that can only spin (the runAgenticLoop circuit breaker
    // is the backstop; this avoids paying for the wasted inference calls). Only
    // short-circuits total grant-starvation — an agent that can call even one
    // tool proceeds normally.
    const { agentHasAnyGrant } = await import("@/lib/mcp-governed-execute");
    if (!(await agentHasAnyGrant(resolvedAgentId, tools.map((t) => t.name)))) {
      const blockedMessage =
        `Blocked — this agent's profile (${resolvedAgentId}) lacks a grant for any of the tools it needs, ` +
        `so it cannot act on this work. A platform operator must grant it the required tools ` +
        `(or route the work to a peer that already holds them).`;
      console.warn(
        `[agent-thread-dispatcher] grant-preflight blocked agent=${JSON.stringify(resolvedAgentId)} ` +
        `thread=${JSON.stringify(context.threadId)} toolCount=${tools.length}`,
      );
      await prisma.agentMessage.create({
        data: {
          threadId: context.threadId,
          taskRunId: context.taskRunId,
          role: "assistant",
          content: blockedMessage,
          agentId: resolvedAgentId,
          routeContext: context.routeContext,
        },
      });
      await markChildThreadFailed(context, blockedMessage);
      return;
    }

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
    await emitCollaborationReturn(context.threadId, context.taskRunId, "completed", {
      specialistReply: replyText,
      routeContext: context.routeContext,
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
        error: getErrorMessage(err),
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
        error: getErrorMessage(err),
      });
    });

  await emitCollaborationReturn(context.threadId, context.taskRunId, "failed");
}
