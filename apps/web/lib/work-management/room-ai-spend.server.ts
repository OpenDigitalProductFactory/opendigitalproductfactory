/**
 * Load AI use per Workroom over a window (BI-1737A427, F6). Server only.
 * See room-ai-spend.ts for the attribution rule.
 */
import { Prisma, prisma } from "@dpf/db";

import type { AiUse } from "@/lib/portfolio/ai-resource";

import { sumAiUseByRoom } from "./room-ai-spend";

export async function loadRoomAiUse(window: { since: Date; until: Date }): Promise<Map<string, AiUse>> {
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
  const useByThread = new Map<string, AiUse>();
  for (let i = 0; i < threads.length; i += 1000) {
    const ids = threads.slice(i, i + 1000).map((t) => t.id);
    // Same valuation rule as the portfolio AI read (ai-resource.ts): a
    // commitment_first provider is a subscription, so its tokens are named as such.
    const rows = await prisma.$queryRaw<Array<{ threadId: string; runs: bigint | number; tokens: bigint | number | null; usd: unknown; subTokens: bigint | number | null; ms: bigint | number | null }>>`
      SELECT r."threadId" AS "threadId",
             COUNT(*) AS "runs",
             SUM(COALESCE(r."inputTokens", 0) + COALESCE(r."outputTokens", 0)) AS "tokens",
             SUM(r."estimatedCostUsd") AS "usd",
             SUM(CASE WHEN f."valuationMethod" = 'commitment_first' THEN COALESCE(r."inputTokens", 0) + COALESCE(r."outputTokens", 0) ELSE 0 END) AS "subTokens",
             SUM(COALESCE(r."durationMs", 0)) AS "ms"
        FROM "AdapterRunTelemetry" r
        LEFT JOIN "AiProviderFinanceProfile" f ON f."providerId" = r."providerId"
       WHERE r."threadId" IN (${Prisma.join(ids)})
         AND r."startedAt" >= ${window.since} AND r."startedAt" < ${window.until}
       GROUP BY r."threadId"`;
    for (const row of rows) {
      useByThread.set(row.threadId, {
        runs: Number(row.runs),
        tokens: Number(row.tokens ?? 0),
        recordedUsd: row.usd == null ? null : Number(row.usd),
        subscriptionTokens: Number(row.subTokens ?? 0),
        durationMs: Number(row.ms ?? 0),
      });
    }
  }
  return sumAiUseByRoom(threads, useByThread);
}
