import { cache } from "react";
import { prisma } from "@dpf/db";
import type { AuditClass } from "@/lib/audit-classes";

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
  // Phase 3
  auditClass: AuditClass | null;
  capabilityId: string | null;
  summary: string | null;
};

export type ToolExecutionStats = {
  total: number;
  successful: number;
  failed: number;
  uniqueAgents: number;
  uniqueTools: number;
};

// ─── Shared select / map ────────────────────────────────────────────────────

const TOOL_EXECUTION_SELECT = {
  id: true,
  threadId: true,
  agentId: true,
  userId: true,
  toolName: true,
  parameters: true,
  result: true,
  success: true,
  executionMode: true,
  routeContext: true,
  durationMs: true,
  createdAt: true,
  auditClass: true,
  capabilityId: true,
  summary: true,
} as const;

function mapRow(r: {
  id: string;
  threadId: string;
  agentId: string;
  userId: string;
  toolName: string;
  parameters: unknown;
  result: unknown;
  success: boolean;
  executionMode: string;
  routeContext: string | null;
  durationMs: number | null;
  createdAt: Date;
  auditClass: string | null;
  capabilityId: string | null;
  summary: string | null;
}): ToolExecutionRow {
  return {
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
    auditClass: (r.auditClass as AuditClass | null) ?? null,
    capabilityId: r.capabilityId,
    summary: r.summary,
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

/** All executions — full history including probe reads. */
export const getToolExecutions = cache(async (limit = 200): Promise<ToolExecutionRow[]> => {
  const rows = await prisma.toolExecution.findMany({
    select: TOOL_EXECUTION_SELECT,
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(mapRow);
});

/** Journal + ledger executions only — excludes metrics_only probe rows.
 *  Use for the Capability Journal tab. */
export const getJournalToolExecutions = cache(async (limit = 500): Promise<ToolExecutionRow[]> => {
  const rows = await prisma.toolExecution.findMany({
    select: TOOL_EXECUTION_SELECT,
    where: {
      OR: [
        { auditClass: "ledger" },
        { auditClass: "journal" },
        { auditClass: null }, // pre-Phase-3 rows have no class; treat as journal
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(mapRow);
});

/** Ledger-only executions — side-effecting writes. */
export const getLedgerToolExecutions = cache(async (limit = 200): Promise<ToolExecutionRow[]> => {
  const rows = await prisma.toolExecution.findMany({
    select: TOOL_EXECUTION_SELECT,
    where: { auditClass: "ledger" },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(mapRow);
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

// ─── Operational Metrics ────────────────────────────────────────────────────

export type ToolExecutionMetrics = {
  totalExecutions: number;
  byAuditClass: { ledger: number; journal: number; metrics_only: number; unknown: number };
  successRate: number; // 0..1
  avgDurationMs: number | null;
  topTools: Array<{ toolName: string; count: number; successRate: number }>;
  recentErrorRate: number; // errors in last 24h / total in last 24h
};

export const getToolExecutionMetrics = cache(async (): Promise<ToolExecutionMetrics> => {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [total, byClass, aggregate, topToolsRaw, recentTotal, recentFailed, capWarning] = await Promise.all([
    prisma.toolExecution.count(),
    prisma.toolExecution.groupBy({
      by: ["auditClass"],
      _count: { auditClass: true },
    }),
    prisma.toolExecution.aggregate({
      _avg: { durationMs: true },
      where: { durationMs: { not: null } },
    }),
    prisma.toolExecution.groupBy({
      by: ["toolName", "success"],
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 50,
    }),
    prisma.toolExecution.count({ where: { createdAt: { gte: oneDayAgo } } }),
    prisma.toolExecution.count({ where: { success: false, createdAt: { gte: oneDayAgo } } }),
    prisma.platformCapability.count(),
  ]);

  // Aggregate byAuditClass counts
  const classMap: Record<string, number> = {};
  for (const row of byClass) {
    classMap[row.auditClass ?? "unknown"] = (classMap[row.auditClass ?? "unknown"] ?? 0) + (row._count.auditClass ?? 0);
  }

  // Build topTools: merge success/failure rows per toolName
  const toolMap = new Map<string, { total: number; success: number }>();
  for (const row of topToolsRaw) {
    const existing = toolMap.get(row.toolName) ?? { total: 0, success: 0 };
    existing.total += row._count.id;
    if (row.success) existing.success += row._count.id;
    toolMap.set(row.toolName, existing);
  }
  const topTools = Array.from(toolMap.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 20)
    .map(([toolName, { total, success }]) => ({
      toolName,
      count: total,
      successRate: total > 0 ? success / total : 0,
    }));

  const successfulTotal = (classMap["ledger"] ?? 0) + (classMap["journal"] ?? 0) + (classMap["metrics_only"] ?? 0);
  void successfulTotal; // not used directly — successRate computed from aggregate

  return {
    totalExecutions: total,
    byAuditClass: {
      ledger: classMap["ledger"] ?? 0,
      journal: classMap["journal"] ?? 0,
      metrics_only: classMap["metrics_only"] ?? 0,
      unknown: classMap["unknown"] ?? 0,
    },
    successRate: total > 0
      ? await prisma.toolExecution.count({ where: { success: true } }).then((n) => n / total)
      : 0,
    avgDurationMs: aggregate._avg?.durationMs ?? null,
    topTools,
    recentErrorRate: recentTotal > 0 ? recentFailed / recentTotal : 0,
  };
});
