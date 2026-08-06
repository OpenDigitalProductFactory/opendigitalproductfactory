// apps/web/lib/tak/route-context/providers/platform.ts
// AI-platform (workforce & providers) page-context providers.
// Extracted verbatim from route-context.ts (page-owned context contract,
// design spec 2026-08-05 Phase 2 PR 2). Behavior unchanged.

import { prisma } from "@dpf/db";

export async function getAiWorkforceContext(): Promise<string> {
  const agents = await prisma.agent.findMany({
    where: { type: "coworker" },
    orderBy: { name: "asc" },
    select: { agentId: true, slugId: true, name: true },
  });

  // EP-AI-WORKFORCE-001: Read pinned provider from AgentModelConfig
  const modelConfigs = await prisma.agentModelConfig.findMany({
    select: { agentId: true, pinnedProviderId: true },
  });
  const configBySlug = new Map(modelConfigs.map((c) => [c.agentId, c.pinnedProviderId]));

  const lines = agents.map((a) => {
    const pinnedProvider = configBySlug.get(a.slugId ?? a.agentId) ?? null;
    return `- ${a.name} (${a.agentId}): provider=${pinnedProvider ?? "auto"}`;
  });

  return [
    "\nPAGE DATA — AI Workforce:",
    `${agents.length} co-worker agents registered:`,
    ...lines,
  ].join("\n");
}
export async function getProvidersContext(): Promise<string> {
  const providers = await prisma.modelProvider.findMany({
    orderBy: { name: "asc" },
    select: {
      providerId: true,
      name: true,
      status: true,
      category: true,
      costModel: true,
      inputPricePerMToken: true,
      outputPricePerMToken: true,
    },
  });

  const models = await prisma.discoveredModel.groupBy({
    by: ["providerId"],
    _count: true,
  });
  const modelCounts = new Map(models.map((m) => [m.providerId, m._count]));

  const profiles = await prisma.modelProfile.groupBy({
    by: ["providerId"],
    _count: true,
  });
  const profileCounts = new Map(profiles.map((p) => [p.providerId, p._count]));

  const lines = providers.map((p) => {
    const mc = modelCounts.get(p.providerId) ?? 0;
    const pc = profileCounts.get(p.providerId) ?? 0;
    const pricing = p.costModel === "token"
      ? `$${p.inputPricePerMToken ?? "?"}/$${p.outputPricePerMToken ?? "?"} per M tokens`
      : p.costModel === "compute" ? "compute-based (local)" : "unknown pricing";
    return `- ${p.name} (${p.providerId}): status=${p.status}, category=${p.category}, ${mc} models, ${pc} profiled, ${pricing}`;
  });

  const active = providers.filter((p) => p.status === "active").length;
  const inactive = providers.filter((p) => p.status === "inactive").length;

  return [
    "\nPAGE DATA — AI Providers:",
    `${providers.length} total (${active} active, ${inactive} inactive, ${providers.length - active - inactive} unconfigured):`,
    ...lines,
  ].join("\n");
}
