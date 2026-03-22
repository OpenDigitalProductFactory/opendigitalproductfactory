// apps/web/lib/route-context.ts
// Injects page-specific data context into agent system prompts.
// Each route can have a context provider that summarizes what the user sees.

import { prisma } from "@dpf/db";

type RouteContextResult = string | null;

const ROUTE_CONTEXT_PROVIDERS: Record<string, (userId: string, routeContext: string) => Promise<RouteContextResult>> = {
  "/platform/ai": getAiWorkforceContext,
  "/platform/ai/providers": getProvidersContext,
  "/ops": getOpsContext,
  "/compliance": getComplianceContext,
  "/workspace": getWorkspaceContext,
  "/portfolio": getPortfolioContext,
  "/inventory": getInventoryContext,
  "/employee": getEmployeeContext,
  "/build": getBuildContext,
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
    return await provider(userId, routeContext);
  } catch {
    return null;
  }
}

// ─── Route Context Providers ────────────────────────────────────────────────

async function getComplianceContext(_userId: string, routeContext: string): Promise<string> {
  const sections: string[] = ["\nPAGE DATA — Compliance:"];

  // Extract entity ID from route like /compliance/regulations/cmmwfe... or /compliance/obligations/xxx
  const parts = routeContext.replace(/^\/compliance\/?/, "").split("/");
  const subPage = parts[0] ?? "";
  const entityId = parts[1];

  if (subPage === "regulations" && entityId) {
    // Regulation detail page — load the full regulation with obligations
    const regulation = await prisma.regulation.findUnique({
      where: { id: entityId },
      include: {
        obligations: {
          where: { status: "active" },
          orderBy: { reference: "asc" },
          include: {
            controls: {
              include: {
                control: { select: { title: true, implementationStatus: true, controlType: true } },
              },
            },
          },
        },
      },
    });

    if (regulation) {
      sections.push(
        `You are viewing: ${regulation.name} (${regulation.shortName})`,
        `Regulation ID: ${regulation.regulationId}`,
        `Jurisdiction: ${regulation.jurisdiction}, Industry: ${regulation.industry ?? "cross-industry"}`,
        `Status: ${regulation.status}, Effective: ${regulation.effectiveDate?.toISOString().split("T")[0] ?? "N/A"}`,
        regulation.sourceUrl ? `Source: ${regulation.sourceUrl}` : "",
        regulation.notes ? `Notes: ${regulation.notes}` : "",
        "",
        `Obligations (${regulation.obligations.length}):`,
      );

      for (const obl of regulation.obligations) {
        const controlCount = obl.controls.length;
        const implCount = obl.controls.filter(
          (l) => l.control.implementationStatus === "implemented",
        ).length;
        const coverage = controlCount === 0 ? "NO CONTROLS" : implCount > 0 ? "COVERED" : "PARTIAL (planned)";
        sections.push(
          `- ${obl.reference ?? obl.obligationId}: ${obl.title} [${coverage}, ${controlCount} controls]`,
        );
      }
    }
  } else if (subPage === "obligations" && entityId) {
    const obligation = await prisma.obligation.findUnique({
      where: { id: entityId },
      include: {
        regulation: { select: { shortName: true, regulationId: true } },
        controls: {
          include: { control: { select: { title: true, controlType: true, implementationStatus: true } } },
        },
      },
    });
    if (obligation) {
      sections.push(
        `You are viewing obligation: ${obligation.title}`,
        `Reference: ${obligation.reference}, Regulation: ${obligation.regulation.shortName}`,
        `Category: ${obligation.category}, Frequency: ${obligation.frequency}`,
        `Controls (${obligation.controls.length}):`,
        ...obligation.controls.map((l) => `- ${l.control.title} [${l.control.controlType}, ${l.control.implementationStatus}]`),
      );
    }
  } else if (subPage === "controls" && entityId) {
    const control = await prisma.control.findUnique({
      where: { id: entityId },
      include: {
        obligations: {
          include: { obligation: { select: { title: true, reference: true, obligationId: true } } },
        },
      },
    });
    if (control) {
      sections.push(
        `You are viewing control: ${control.title}`,
        `Type: ${control.controlType}, Status: ${control.implementationStatus}, Effectiveness: ${control.effectiveness ?? "not assessed"}`,
        `Linked obligations (${control.obligations.length}):`,
        ...control.obligations.map((l) => `- ${l.obligation.reference ?? l.obligation.obligationId}: ${l.obligation.title}`),
      );
    }
  } else {
    // Dashboard or list pages — provide summary
    const [regCount, oblCount, controlCount, implCount, openIncidents, pendingAlerts] = await Promise.all([
      prisma.regulation.count({ where: { status: "active" } }),
      prisma.obligation.count({ where: { status: "active" } }),
      prisma.control.count({ where: { status: "active" } }),
      prisma.control.count({ where: { status: "active", implementationStatus: "implemented" } }),
      prisma.complianceIncident.count({ where: { status: { in: ["open", "investigating"] } } }),
      prisma.regulatoryAlert.count({ where: { status: "pending" } }),
    ]);

    const regulations = await prisma.regulation.findMany({
      where: { status: "active" },
      select: { shortName: true, jurisdiction: true, _count: { select: { obligations: true } } },
      orderBy: { shortName: "asc" },
    });

    sections.push(
      `Summary: ${regCount} regulations, ${oblCount} obligations, ${controlCount} controls (${implCount} implemented), ${openIncidents} open incidents, ${pendingAlerts} pending alerts`,
      "",
      "Registered regulations:",
      ...regulations.map((r) => `- ${r.shortName} (${r.jurisdiction}) — ${r._count.obligations} obligations`),
    );
  }

  return sections.filter(Boolean).join("\n");
}

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

// ─── Cross-Cutting Workspace Context ──────────────────────────────────────

async function getWorkspaceContext(): Promise<string> {
  const [itemCount, openItems, epicCount, buildCount, productCount, providerCount] = await Promise.all([
    prisma.backlogItem.count(),
    prisma.backlogItem.count({ where: { status: { in: ["open", "in-progress"] } } }),
    prisma.epic.count(),
    prisma.featureBuild.count({ where: { phase: { notIn: ["complete", "failed"] } } }),
    prisma.digitalProduct.count(),
    prisma.modelProvider.count({ where: { status: "active" } }),
  ]);

  return [
    "\nPAGE DATA — Workspace Overview:",
    `Backlog: ${itemCount} items total, ${openItems} open/in-progress across ${epicCount} epics`,
    `Products: ${productCount} digital products registered`,
    `Builds: ${buildCount} active feature builds`,
    `AI: ${providerCount} active providers`,
  ].join("\n");
}

// ─── Portfolio Context ───────────────────────────────────────────────────

async function getPortfolioContext(): Promise<string> {
  const [portfolioCount, productCount, nodeCount] = await Promise.all([
    prisma.portfolio.count(),
    prisma.digitalProduct.count(),
    prisma.taxonomyNode.count(),
  ]);

  const portfolios = await prisma.portfolio.findMany({
    orderBy: { name: "asc" },
    select: { name: true, _count: { select: { products: true } } },
  });

  return [
    "\nPAGE DATA — Portfolio:",
    `${portfolioCount} portfolios, ${productCount} products, ${nodeCount} taxonomy nodes`,
    "",
    ...portfolios.map((p) => `- ${p.name}: ${p._count.products} products`),
  ].join("\n");
}

// ─── Inventory Context ──────────────────────────────────────────────────

async function getInventoryContext(): Promise<string> {
  const products = await prisma.digitalProduct.findMany({
    orderBy: { name: "asc" },
    select: { productId: true, name: true, lifecycleStage: true, lifecycleStatus: true, version: true },
    take: 30,
  });

  const byStage = new Map<string, number>();
  for (const p of products) {
    byStage.set(p.lifecycleStage, (byStage.get(p.lifecycleStage) ?? 0) + 1);
  }

  return [
    "\nPAGE DATA — Inventory:",
    `${products.length} products`,
    `By stage: ${[...byStage.entries()].map(([s, c]) => `${s}=${c}`).join(", ")}`,
    "",
    ...products.map((p) => `- ${p.productId}: ${p.name} [${p.lifecycleStage}/${p.lifecycleStatus}] v${p.version}`),
  ].join("\n");
}

// ─── Employee Context ───────────────────────────────────────────────────

async function getEmployeeContext(): Promise<string> {
  const employees = await prisma.employeeProfile.findMany({
    orderBy: { displayName: "asc" },
    select: { displayName: true, position: { select: { title: true } }, department: { select: { name: true } } },
    take: 30,
  });

  return [
    "\nPAGE DATA — Employees:",
    `${employees.length} employee profiles`,
    "",
    ...employees.map((e) => `- ${e.displayName}: ${e.position?.title ?? "no title"}, ${e.department?.name ?? "no dept"}`),
  ].join("\n");
}

// ─── Build Studio Context ───────────────────────────────────────────────

async function getBuildContext(userId: string): Promise<string> {
  const builds = await prisma.featureBuild.findMany({
    where: { createdById: userId },
    orderBy: { updatedAt: "desc" },
    select: { buildId: true, title: true, phase: true, sandboxPort: true },
    take: 10,
  });

  if (builds.length === 0) return "\nPAGE DATA — Build Studio:\nNo builds yet. Create one to get started.";

  return [
    "\nPAGE DATA — Build Studio:",
    `${builds.length} builds:`,
    ...builds.map((b) => `- ${b.buildId}: ${b.title} [${b.phase}]${b.sandboxPort ? ` (sandbox: port ${b.sandboxPort})` : ""}`),
  ].join("\n");
}
