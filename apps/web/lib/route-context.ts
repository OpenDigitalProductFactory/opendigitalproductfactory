// apps/web/lib/route-context.ts
// Injects page-specific data context into agent system prompts.
// Each route can have a context provider that summarizes what the user sees.

import { prisma } from "@dpf/db";

type RouteContextResult = string | null;

const ROUTE_CONTEXT_PROVIDERS: Record<string, (userId: string) => Promise<RouteContextResult>> = {
  "/platform/ai": getAiWorkforceContext,
  "/platform/ai/providers": getProvidersContext,
  "/ops": getOpsContext,
};

export async function getRouteDataContext(routeContext: string, userId: string): Promise<RouteContextResult> {
  // Find the most specific matching route
  let bestMatch: string | null = null;
  let bestLen = 0;
  for (const prefix of Object.keys(ROUTE_CONTEXT_PROVIDERS)) {
    if ((routeContext === prefix || routeContext.startsWith(prefix + "/")) && prefix.length > bestLen) {
      bestLen = prefix.length;
      bestMatch = prefix;
    }
  }

  if (!bestMatch) return null;
  const provider = ROUTE_CONTEXT_PROVIDERS[bestMatch];
  if (!provider) return null;

  try {
    return await provider(userId);
  } catch {
    return null;
  }
}

// ─── Route Context Providers ────────────────────────────────────────────────

async function getAiWorkforceContext(): Promise<string> {
  const agents = await prisma.agent.findMany({
    where: { type: "coworker" },
    orderBy: { name: "asc" },
    select: { agentId: true, name: true, preferredProviderId: true },
  });

  const lines = agents.map((a) =>
    `- ${a.name} (${a.agentId}): provider=${a.preferredProviderId ?? "auto"}`
  );

  return [
    "\nPAGE DATA — AI Workforce:",
    `${agents.length} co-worker agents registered:`,
    ...lines,
  ].join("\n");
}

async function getProvidersContext(): Promise<string> {
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

async function getOpsContext(): Promise<string> {
  const [epics, items] = await Promise.all([
    prisma.epic.findMany({
      where: { status: "open" },
      select: { epicId: true, title: true, id: true },
    }),
    prisma.backlogItem.findMany({
      orderBy: [{ priority: "asc" }, { status: "asc" }],
      select: { itemId: true, title: true, status: true, type: true, priority: true, epicId: true },
      take: 60,
    }),
  ]);

  const epicMap = new Map(epics.map((e) => [e.id, e]));
  const assigned = items.filter((i) => i.epicId);
  const unassigned = items.filter((i) => !i.epicId);

  const epicLines = epics.map((e) => {
    const epicItems = items.filter((i) => i.epicId === e.id);
    return `- ${e.epicId}: ${e.title} (${epicItems.length} items)`;
  });

  const itemLines = items.map((i) => {
    const epic = i.epicId ? epicMap.get(i.epicId) : null;
    return `- ${i.itemId} [${i.status}] ${i.title}${epic ? ` (epic: ${epic.epicId})` : " (NO EPIC)"}`;
  });

  return [
    "\nPAGE DATA — Operations Backlog:",
    `${items.length} backlog items (${assigned.length} assigned to epics, ${unassigned.length} unassigned):`,
    "",
    "EPICS:",
    ...epicLines,
    "",
    "ALL BACKLOG ITEMS:",
    ...itemLines,
  ].join("\n");
}
