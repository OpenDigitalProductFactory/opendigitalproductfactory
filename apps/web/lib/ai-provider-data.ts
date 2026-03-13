// apps/web/lib/ai-provider-data.ts
// Server-only: uses React cache() to deduplicate Prisma calls within one request.
import { cache } from "react";
import { prisma } from "@dpf/db";
import type {
  ProviderWithCredential,
  ProviderRow,
  SpendByProvider,
  SpendByAgent,
  ScheduledJobRow,
} from "./ai-provider-types";

export const getProviders = cache(async (): Promise<ProviderWithCredential[]> => {
  const providers = await prisma.modelProvider.findMany({ orderBy: { name: "asc" } });
  const credentials = await prisma.credentialEntry.findMany({
    where: { providerId: { in: providers.map((p) => p.providerId) } },
  });
  const credMap = new Map(credentials.map((c) => [c.providerId, c]));
  return providers.map((p) => ({
    provider: {
      ...p,
      families:             p.families as string[],
      enabledFamilies:      p.enabledFamilies as string[],
      supportedAuthMethods: p.supportedAuthMethods as string[],
    } satisfies ProviderRow,
    credential: credMap.get(p.providerId) ?? null,
  }));
});

export const getProviderById = cache(async (providerId: string): Promise<ProviderWithCredential | null> => {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return null;
  const credential = await prisma.credentialEntry.findUnique({ where: { providerId } });
  return {
    provider: {
      ...provider,
      families:             provider.families as string[],
      enabledFamilies:      provider.enabledFamilies as string[],
      supportedAuthMethods: provider.supportedAuthMethods as string[],
    } satisfies ProviderRow,
    credential: credential ?? null,
  };
});

function monthRange(month: { year: number; month: number }): { gte: Date; lt: Date } {
  const gte = new Date(Date.UTC(month.year, month.month - 1, 1));
  const lt  = new Date(Date.UTC(month.year, month.month, 1));
  return { gte, lt };
}

export const getTokenSpendByProvider = cache(
  async (month: { year: number; month: number }): Promise<SpendByProvider[]> => {
    const range = monthRange(month);
    const rows = await prisma.tokenUsage.groupBy({
      by: ["providerId"],
      where: { createdAt: range },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
    });
    return rows.map((r) => ({
      providerId:        r.providerId,
      totalInputTokens:  r._sum.inputTokens  ?? 0,
      totalOutputTokens: r._sum.outputTokens ?? 0,
      totalCostUsd:      r._sum.costUsd      ?? 0,
    }));
  }
);

export const getTokenSpendByAgent = cache(
  async (month: { year: number; month: number }): Promise<SpendByAgent[]> => {
    const range = monthRange(month);
    const rows = await prisma.tokenUsage.groupBy({
      by: ["agentId"],
      where: { createdAt: range },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      orderBy: { _sum: { costUsd: "desc" } },
    });
    const agentIds = rows.map((r) => r.agentId);
    const agents = await prisma.agent.findMany({ where: { agentId: { in: agentIds } } });
    const agentMap = new Map(agents.map((a) => [a.agentId, a.name]));
    return rows.map((r) => ({
      agentId:           r.agentId,
      agentName:         agentMap.get(r.agentId) ?? r.agentId,
      totalInputTokens:  r._sum.inputTokens  ?? 0,
      totalOutputTokens: r._sum.outputTokens ?? 0,
      totalCostUsd:      r._sum.costUsd      ?? 0,
    }));
  }
);

export const getScheduledJobs = cache(async (): Promise<ScheduledJobRow[]> => {
  return prisma.scheduledJob.findMany({ orderBy: { jobId: "asc" } });
});
