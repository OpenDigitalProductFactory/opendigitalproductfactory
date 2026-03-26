import { cache } from "react";
import { prisma } from "@dpf/db";

export type ToolExecutionRow = {
  id: string;
  threadId: string;
  agentId: string;
  userId: string;
  toolName: string;
  parameters: Record<string, unknown>;
  result: Record<string, unknown>;
  success: boolean;
  executionMode: string;
  routeContext: string | null;
  durationMs: number | null;
  createdAt: string;
};

export type ToolExecutionStats = {
  total: number;
  successful: number;
  failed: number;
  uniqueAgents: number;
  uniqueTools: number;
};

export const getToolExecutions = cache(async (limit = 200): Promise<ToolExecutionRow[]> => {
  const rows = await prisma.toolExecution.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    threadId: r.threadId,
    agentId: r.agentId,
    userId: r.userId,
    toolName: r.toolName,
    parameters: r.parameters as Record<string, unknown>,
    result: r.result as Record<string, unknown>,
    success: r.success,
    executionMode: r.executionMode,
    routeContext: r.routeContext,
    durationMs: r.durationMs,
    createdAt: r.createdAt.toISOString(),
  }));
});

export const getToolExecutionStats = cache(async (): Promise<ToolExecutionStats> => {
  const [total, successful, failed] = await Promise.all([
    prisma.toolExecution.count(),
    prisma.toolExecution.count({ where: { success: true } }),
    prisma.toolExecution.count({ where: { success: false } }),
  ]);
  const agents = await prisma.toolExecution.findMany({ distinct: ["agentId"], select: { agentId: true } });
  const tools = await prisma.toolExecution.findMany({ distinct: ["toolName"], select: { toolName: true } });
  return {
    total,
    successful,
    failed,
    uniqueAgents: agents.length,
    uniqueTools: tools.length,
  };
});
