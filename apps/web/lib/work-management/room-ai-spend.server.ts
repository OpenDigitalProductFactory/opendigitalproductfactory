/**
 * Load AI spend per Workroom over a window (BI-1737A427, F6). Server only.
 * See room-ai-spend.ts for the attribution rule.
 */
import { prisma } from "@dpf/db";

import { sumSpendByRoom } from "./room-ai-spend";

export async function loadRoomAiSpend(window: { since: Date; until?: Date }): Promise<Map<string, number>> {
  const threads = await prisma.agentThread.findMany({
    where: {
      OR: [
        { contextKey: { startsWith: "scheduled:workroom-WC-" } },
        { contextKey: { startsWith: "coworker:/workspace/cases/work-capsule" } },
      ],
    },
    select: { id: true, contextKey: true },
  });
  if (threads.length === 0) return new Map();
  const spendByThread = new Map<string, number>();
  for (let i = 0; i < threads.length; i += 1000) {
    const grouped = await prisma.adapterRunTelemetry.groupBy({
      by: ["threadId"],
      where: {
        threadId: { in: threads.slice(i, i + 1000).map((t) => t.id) },
        startedAt: { gte: window.since, ...(window.until ? { lt: window.until } : {}) },
      },
      _sum: { estimatedCostUsd: true },
    });
    for (const row of grouped) {
      if (row.threadId && row._sum.estimatedCostUsd != null) spendByThread.set(row.threadId, Number(row._sum.estimatedCostUsd));
    }
  }
  return sumSpendByRoom(threads, spendByThread);
}
