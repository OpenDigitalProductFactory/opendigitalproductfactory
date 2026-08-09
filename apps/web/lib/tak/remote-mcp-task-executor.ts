import { prisma } from "@dpf/db";
import { markTaskRunWorking } from "@/lib/observability/heartbeat";
import { isRecord } from "@/lib/shared/coerce";
import {
  executeAutonomousAgenticLoop,
  resolveAutonomousWorkAgent,
  resolveAutonomousWorkTools,
} from "@/lib/tak/autonomous-work-run";
import { createTaskMessage } from "@/lib/tak/task-records";

const TERMINAL = ["completed", "failed", "canceled", "rejected", "archived"];

function messageText(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (isRecord(part) && typeof part["text"] === "string" && part["text"].trim()) {
      return part["text"].trim();
    }
  }
  return null;
}

async function markTerminalFailure(taskRunId: string, message: string): Promise<void> {
  await prisma.taskRun.updateMany({
    where: {
      taskRunId,
      status: { notIn: TERMINAL },
      cancellationRequestedAt: null,
    },
    data: {
      status: "failed",
      completedAt: new Date(),
      progressPayload: { summary: message.slice(0, 4_000) },
    },
  });
}

/** Restart-safe worker core. It reconstructs the execution context from the
 * TaskRun + initial TaskMessage and revalidates the durable PAT before any
 * agent/model allocation. No bearer secret, connection, request, or model
 * context crosses the queue boundary. */
export async function executeRemoteTask(taskRunId: string): Promise<void> {
  const run = await prisma.taskRun.findUnique({
    where: { taskRunId },
    select: {
      id: true,
      taskRunId: true,
      userId: true,
      contextId: true,
      threadId: true,
      currentAgentId: true,
      routeContext: true,
      status: true,
      cancellationRequestedAt: true,
      a2aMetadata: true,
      messages: {
        where: { role: "user" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { parts: true },
      },
    },
  });
  if (!run || TERMINAL.includes(run.status)) return;
  if (run.cancellationRequestedAt) {
    await prisma.taskRun.update({
      where: { taskRunId },
      data: { status: "canceled", completedAt: new Date() },
    });
    return;
  }

  const metadata = isRecord(run.a2aMetadata) ? run.a2aMetadata : {};
  const sourceRef = isRecord(metadata["sourceRef"]) ? metadata["sourceRef"] : {};
  const tokenId = typeof sourceRef["id"] === "string"
    ? sourceRef["id"]
    : typeof metadata["apiTokenId"] === "string"
      ? metadata["apiTokenId"]
      : null;
  if (sourceRef["kind"] !== "mcp-token" || !tokenId) {
    await markTerminalFailure(taskRunId, "Remote task cannot resume without a durable MCP token reference.");
    return;
  }

  const token = await prisma.mcpApiToken.findUnique({
    where: { id: tokenId },
    select: {
      id: true,
      userId: true,
      agentId: true,
      scopes: true,
      scope: true,
      capability: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  if (
    !token ||
    token.userId !== run.userId ||
    token.revokedAt ||
    (token.expiresAt && token.expiresAt.getTime() <= Date.now())
  ) {
    await markTerminalFailure(taskRunId, "MCP authorization was revoked, expired, or no longer owns this task.");
    return;
  }

  const agentId = run.currentAgentId ?? token.agentId;
  const routeContext = run.routeContext;
  const prompt = messageText(run.messages[0]?.parts);
  const threadId = run.threadId ?? run.contextId;
  if (!agentId || !routeContext || !prompt || !threadId) {
    await markTerminalFailure(taskRunId, "Remote task is missing its durable agent, route, or prompt reference.");
    return;
  }
  if (token.agentId && token.agentId !== agentId) {
    await markTerminalFailure(taskRunId, "The MCP token is not bound to the task's acting agent.");
    return;
  }

  const owner = await prisma.user.findUnique({
    where: { id: run.userId },
    select: {
      isSuperuser: true,
      groups: { include: { platformRole: true }, take: 1 },
    },
  });
  if (!owner) {
    await markTerminalFailure(taskRunId, "The task owner no longer exists.");
    return;
  }
  const userContext = {
    userId: run.userId,
    platformRole: owner.groups[0]?.platformRole.roleId ?? null,
    isSuperuser: owner.isSuperuser,
  };

  await markTaskRunWorking(taskRunId);
  const riskClass = metadata["riskClass"];
  const mode = riskClass === "read" ? "advise" : "act";

  try {
    const agent = await resolveAutonomousWorkAgent({ agentId, routeContext, userContext });
    const resolvedAgentId = agent.agentId ?? agentId;
    const tools = await resolveAutonomousWorkTools({
      userContext,
      agentId: resolvedAgentId,
      mode,
      externalAccessEnabled: true,
      authorityGrants: token.scopes,
      routeContext,
      intentQuery: prompt,
    });
    const result = await executeAutonomousAgenticLoop({
      systemPrompt: agent.systemPrompt,
      chatHistory: [{ role: "user", content: prompt }],
      sensitivity: agent.sensitivity ?? "internal",
      tools: tools.tools,
      toolsForProvider: tools.toolsForProvider,
      deferredTools: tools.deferredTools,
      userId: run.userId,
      routeContext,
      agentId: resolvedAgentId,
      threadId,
      taskRunId,
      apiTokenId: tokenId,
      taskType: "external-mcp",
      agentDisplayName: typeof agent.displayName === "string" ? agent.displayName : resolvedAgentId,
    });

    await createTaskMessage({
      taskRunId,
      taskRunRecordId: run.id,
      contextId: run.contextId,
      role: "assistant",
      content: result.content,
      metadata: {
        source: "mcp.task-worker",
        executedToolCount: result.executedTools?.length ?? 0,
      },
    });

    const completed = await prisma.taskRun.updateMany({
      where: {
        taskRunId,
        status: { notIn: TERMINAL },
        cancellationRequestedAt: null,
      },
      data: {
        status: "completed",
        completedAt: new Date(),
        progressPayload: {
          summary: result.content,
          riskClass,
          executedToolCount: result.executedTools?.length ?? 0,
        },
      },
    });
    if (completed.count === 0) {
      await prisma.taskRun.updateMany({
        where: { taskRunId, status: { notIn: TERMINAL }, cancellationRequestedAt: { not: null } },
        data: { status: "canceled", completedAt: new Date() },
      });
    }
  } catch (error) {
    await markTerminalFailure(
      taskRunId,
      error instanceof Error ? error.message : "Unknown remote coworker execution error",
    );
  }
}
