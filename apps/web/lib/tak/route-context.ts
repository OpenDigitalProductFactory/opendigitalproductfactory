// apps/web/lib/route-context.ts
// Injects page-specific data context into agent system prompts.
// Each route can have a context provider that summarizes what the user sees.

import { prisma } from "@dpf/db";
import { getPlaybook } from "@/lib/tak/marketing-playbooks";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";

type RouteContextResult = string | null;

const ROUTE_CONTEXT_PROVIDERS: Record<string, (userId: string, routeContext: string) => Promise<RouteContextResult>> = {
  "/platform/ai": getAiWorkforceContext,
  "/platform/ai/providers": getProvidersContext,
  "/platform/tools/discovery": getDiscoveryOperationsContext,
  "/ops": getOpsContext,
  "/compliance": getComplianceContext,
  "/workspace": getWorkspaceContext,
  "/portfolio/product": getProductEstateContext,
  "/portfolio": getPortfolioContext,
  "/inventory": getDiscoveryOperationsContext,
  "/employee": getEmployeeContext,
  "/build": getBuildContext,
  "/storefront": getStorefrontMarketingContext,
  "/customer/funnel": getCustomerFunnelContext,
};

export async function getRouteDataContext(routeContext: string, userId: string): Promise<RouteContextResult> {
  // Universal business context — injected on every route so the coworker
  // always knows what the business does, who it serves, and how it operates.
  let businessContextBlock: string | null = null;
  try {
    businessContextBlock = await getBusinessContextBlock();
  } catch {
    // Non-fatal — proceed without business context
  }

  // Find the most specific matching route
  let bestMatch: string | null = null;
  let bestLen = 0;
  for (const prefix of Object.keys(ROUTE_CONTEXT_PROVIDERS)) {
    if ((routeContext === prefix || routeContext.startsWith(prefix + "/")) && prefix.length > bestLen) {
      bestLen = prefix.length;
      bestMatch = prefix;
    }
  }

  let routeSpecific: string | null = null;
  if (bestMatch) {
    const provider = ROUTE_CONTEXT_PROVIDERS[bestMatch];
    if (provider) {
      try {
        routeSpecific = await provider(userId, routeContext);
      } catch {
        // Non-fatal
      }
    }
  }

  if (!businessContextBlock && !routeSpecific) return null;
  return [businessContextBlock, routeSpecific].filter(Boolean).join("\n");
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

async function getDiscoveryOperationsContext(): Promise<string> {
  const [latestRun, connectionCount, needsReviewCount, openIssues] = await Promise.all([
    prisma.discoveryRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        runKey: true,
        status: true,
        startedAt: true,
        completedAt: true,
        itemCount: true,
        relationshipCount: true,
      },
    }),
    prisma.discoveryConnection.count(),
    prisma.inventoryEntity.count({ where: { attributionStatus: "needs_review" } }),
    prisma.portfolioQualityIssue.groupBy({
      by: ["issueType"],
      where: { status: "open" },
      _count: true,
      orderBy: { _count: { issueType: "desc" } },
      take: 8,
    }),
  ]);

  const latestRunSummary = latestRun
    ? `${latestRun.runKey} [${latestRun.status}] items=${latestRun.itemCount}, relationships=${latestRun.relationshipCount}`
    : "No discovery run recorded";

  return [
    "\nPAGE DATA — Discovery Operations:",
    `Connections: ${connectionCount}`,
    `Needs review: ${needsReviewCount}`,
    `Latest run: ${latestRunSummary}`,
    "",
    "Open discovery issues:",
    ...(openIssues.length > 0
      ? openIssues.map((issue) => `- ${issue.issueType}: ${issue._count}`)
      : ["- none"]),
  ].join("\n");
}

async function getProductEstateContext(_userId: string, routeContext: string): Promise<string> {
  const parts = routeContext.split("/").filter(Boolean);
  const productId = parts[2] ?? null;
  if (!productId) {
    return "\nPAGE DATA — Product Estate:\nNo product is selected.";
  }

  const product = await prisma.digitalProduct.findUnique({
    where: { id: productId },
    select: {
      productId: true,
      name: true,
      portfolio: { select: { name: true } },
      taxonomyNode: { select: { nodeId: true } },
      inventoryEntities: {
        orderBy: [{ lastSeenAt: "desc" }, { name: "asc" }],
        take: 10,
        select: {
          name: true,
          entityType: true,
          manufacturer: true,
          normalizedVersion: true,
          observedVersion: true,
          supportStatus: true,
          lastSeenAt: true,
          _count: { select: { fromRelationships: true, toRelationships: true } },
          qualityIssues: {
            where: { status: "open" },
            select: { issueType: true },
            take: 4,
          },
        },
      },
    },
  });

  if (!product) {
    return "\nPAGE DATA — Product Estate:\nThe selected product could not be loaded.";
  }

  const taxonomyPath = product.taxonomyNode?.nodeId ?? "unmapped";
  const attentionCount = product.inventoryEntities.filter((entity) => entity.qualityIssues.length > 0).length;

  return [
    "\nPAGE DATA — Product Estate:",
    `Product: ${product.name} (${product.productId})`,
    `Portfolio: ${product.portfolio?.name ?? "unassigned"}`,
    `Taxonomy: ${taxonomyPath}`,
    `Estate items: ${product.inventoryEntities.length}, items with open issues: ${attentionCount}`,
    "",
    "Visible estate items:",
    ...product.inventoryEntities.map((entity) => {
      const version = entity.normalizedVersion ?? entity.observedVersion ?? "unknown version";
      const issues = entity.qualityIssues.map((issue) => issue.issueType).join(", ") || "none";
      const lastSeen = entity.lastSeenAt?.toISOString().slice(0, 10) ?? "unknown";
      return `- ${entity.name} [${entity.entityType}] ${entity.manufacturer ?? "unknown vendor"} v${version}, support=${entity.supportStatus ?? "unknown"}, last seen=${lastSeen}, upstream=${entity._count.fromRelationships}, downstream=${entity._count.toRelationships}, issues=${issues}`;
    }),
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

// ─── Storefront Marketing Context ──────────────────────────────────────

async function getStorefrontMarketingContext(): Promise<string> {
  const config = await prisma.storefrontConfig.findFirst({
    include: {
      archetype: {
        select: { archetypeId: true, name: true, category: true, ctaType: true, customVocabulary: true },
      },
    },
  });

  if (!config) {
    return "\nPAGE DATA — Portal:\nNo portal configured yet. Set up your portal at /storefront/setup to unlock business-model-specific recommendations.";
  }

  const archetype = config.archetype;
  const playbook = getPlaybook(archetype.category, archetype.ctaType);
  const vocabulary = getVocabulary(archetype.category, archetype.customVocabulary as Record<string, string> | null);

  // Inbox metrics — last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [bookingCount, inquiryCount, orderCount, donationCount] = await Promise.all([
    prisma.storefrontBooking.count({
      where: { storefrontId: config.id, createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.storefrontInquiry.count({
      where: { storefrontId: config.id, createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.storefrontOrder.count({
      where: { storefrontId: config.id, createdAt: { gte: thirtyDaysAgo } },
    }),
    prisma.storefrontDonation.count({
      where: { storefrontId: config.id, createdAt: { gte: thirtyDaysAgo } },
    }),
  ]);

  // CRM pipeline summary
  const [engagementsByStatus, opportunitiesByStage] = await Promise.all([
    prisma.engagement.groupBy({ by: ["status"], _count: true }),
    prisma.opportunity.groupBy({ by: ["stage"], _count: true }),
  ]);

  const engagementSummary = engagementsByStatus
    .map((e) => `${e.status}: ${e._count}`)
    .join(", ");
  const opportunitySummary = opportunitiesByStage
    .map((o) => `${o.stage}: ${o._count}`)
    .join(", ");

  const totalInbox = bookingCount + inquiryCount + orderCount + donationCount;

  return [
    `\nPAGE DATA — ${vocabulary.portalLabel}:`,
    `Business type: ${archetype.name} (${archetype.category})`,
    `Portal label: ${vocabulary.portalLabel}`,
    `Stakeholders: ${vocabulary.stakeholderLabel}`,
    `Agent role: ${vocabulary.agentName}`,
    `CTA type: ${archetype.ctaType}`,
    "",
    "MARKETING PLAYBOOK (adapted to this business model):",
    `Primary goal: ${playbook.primaryGoal}`,
    `Key stakeholders: ${playbook.stakeholders}`,
    `Recommended campaign types: ${playbook.campaignTypes.join("; ")}`,
    `Content tone: ${playbook.contentTone}`,
    `Key metrics to track: ${playbook.keyMetrics.join("; ")}`,
    `CTA language: ${playbook.ctaLanguage.join(", ")}`,
    `Agent skills for this model: ${playbook.agentSkills.join(", ")}`,
    "",
    `INBOX (last 30 days): ${totalInbox} total — Bookings: ${bookingCount}, Inquiries: ${inquiryCount}, Orders: ${orderCount}, Donations: ${donationCount}`,
    "",
    `CRM PIPELINE:`,
    `Engagements: ${engagementSummary || "none"}`,
    `Opportunities: ${opportunitySummary || "none"}`,
  ].join("\n");
}

// ─── Universal Business Context ───────────────────────────────────────────

async function getBusinessContextBlock(): Promise<string | null> {
  const bc = await prisma.businessContext.findFirst({
    select: {
      description: true,
      targetMarket: true,
      industry: true,
      companySize: true,
      geographicScope: true,
      revenueModel: true,
      ctaType: true,
    },
  });

  if (!bc) return null;

  const lines: string[] = ["\nBUSINESS CONTEXT:"];
  if (bc.industry) lines.push(`Industry: ${bc.industry.replace(/-/g, " ")}`);
  if (bc.description) lines.push(`What they do: ${bc.description}`);
  if (bc.targetMarket) lines.push(`Who they serve: ${bc.targetMarket}`);
  if (bc.revenueModel) lines.push(`Revenue model: ${bc.revenueModel}`);
  if (bc.ctaType) lines.push(`Primary CTA: ${bc.ctaType}`);
  if (bc.companySize) lines.push(`Company size: ${bc.companySize}`);
  if (bc.geographicScope) lines.push(`Geographic scope: ${bc.geographicScope}`);

  return lines.length > 1 ? lines.join("\n") : null;
}

// ─── Customer Funnel Context ───────────────────────────────────────────

async function getCustomerFunnelContext(): Promise<string> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Load archetype for CTA-aware funnel labelling
  const config = await prisma.storefrontConfig.findFirst({
    include: {
      archetype: { select: { name: true, ctaType: true } },
    },
  });

  // Storefront interaction counts (top of funnel)
  const [bookings, inquiries, orders, donations] = await Promise.all([
    prisma.storefrontBooking.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.storefrontInquiry.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.storefrontOrder.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.storefrontDonation.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
  ]);

  // CRM pipeline stages
  const [engagements, opportunities] = await Promise.all([
    prisma.engagement.groupBy({ by: ["status"], _count: true }),
    prisma.opportunity.groupBy({ by: ["stage"], _count: true }),
  ]);

  const totalInteractions = bookings + inquiries + orders + donations;
  const totalEngagements = engagements.reduce((sum, e) => sum + e._count, 0);
  const totalOpportunities = opportunities.reduce((sum, o) => sum + o._count, 0);
  const closedWon = opportunities.find((o) => o.stage === "closed_won")?._count ?? 0;
  const closedLost = opportunities.find((o) => o.stage === "closed_lost")?._count ?? 0;

  const convEngagement = totalInteractions > 0
    ? ((totalEngagements / totalInteractions) * 100).toFixed(0)
    : "N/A";
  const convOpportunity = totalEngagements > 0
    ? ((totalOpportunities / totalEngagements) * 100).toFixed(0)
    : "N/A";
  const convWon = totalOpportunities > 0
    ? ((closedWon / totalOpportunities) * 100).toFixed(0)
    : "N/A";

  const ctaType = config?.archetype?.ctaType ?? "inquiry";
  const businessLabel = config?.archetype?.name ?? "Unknown business type";

  return [
    "\nPAGE DATA — Conversion Funnel (last 30 days):",
    `Business type: ${businessLabel} (CTA: ${ctaType})`,
    "",
    "FUNNEL STAGES:",
    `1. Storefront interactions: ${totalInteractions} (Bookings: ${bookings}, Inquiries: ${inquiries}, Orders: ${orders}, Donations: ${donations})`,
    `2. Engagements: ${totalEngagements} (conversion: ${convEngagement}%)`,
    `   ${engagements.map((e) => `${e.status}: ${e._count}`).join(", ") || "none"}`,
    `3. Opportunities: ${totalOpportunities} (conversion: ${convOpportunity}%)`,
    `   ${opportunities.map((o) => `${o.stage}: ${o._count}`).join(", ") || "none"}`,
    `4. Closed won: ${closedWon} (win rate: ${convWon}%), Closed lost: ${closedLost}`,
  ].join("\n");
}
