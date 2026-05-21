// apps/web/lib/inference/budget-events-data.ts
//
// EP-COST-001 Phase 2: data helpers for surfacing AgentBudgetEvent rows
// in the Admin > AI Providers UI.
//
// Fetches the most recent budget pressure events (warning_95 + rejected)
// for display so operators can see which agents are near or over their
// daily token budgets without needing to query the DB directly.

import { prisma } from "@dpf/db";

export type BudgetEventRow = {
  id: string;
  agentId: string;
  eventKind: string;
  tokensTotal: number | null;
  amountUsd: string; // Decimal serialized as string
  modelId: string | null;
  providerId: string | null;
  buildRunId: string | null;
  createdAt: Date;
};

/**
 * Fetch the most recent budget pressure events (warning_95 + rejected).
 * Excludes routine "inference" events — only returns threshold crossings.
 * Defaults to events from the past 7 days, capped at 50 rows.
 */
export async function getRecentBudgetEvents(opts?: {
  sinceHours?: number;
  limit?: number;
}): Promise<BudgetEventRow[]> {
  const sinceHours = opts?.sinceHours ?? 168; // 7 days
  const limit = opts?.limit ?? 50;
  const since = new Date(Date.now() - sinceHours * 3_600_000);

  try {
    const rows = await prisma.agentBudgetEvent.findMany({
      where: {
        eventKind: { in: ["warning_95", "rejected"] },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        agentId: true,
        eventKind: true,
        tokensTotal: true,
        amountUsd: true,
        modelId: true,
        providerId: true,
        buildRunId: true,
        createdAt: true,
      },
    });

    return rows.map((r) => ({
      ...r,
      amountUsd: r.amountUsd.toString(),
    }));
  } catch (err) {
    console.warn("[budget-events-data] Failed to fetch budget events:", err);
    return [];
  }
}

/**
 * Count active rejections (events in the last 24 hours where kind=rejected).
 * Used to decide whether to show the warning banner prominently.
 */
export async function countRecentRejections(): Promise<number> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  try {
    return await prisma.agentBudgetEvent.count({
      where: { eventKind: "rejected", createdAt: { gte: since } },
    });
  } catch {
    return 0;
  }
}
