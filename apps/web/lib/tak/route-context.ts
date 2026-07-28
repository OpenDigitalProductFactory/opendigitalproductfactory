// apps/web/lib/route-context.ts
// Injects page-specific data context into agent system prompts.
// Each route can have a context provider that summarizes what the user sees.

import { INVENTORY_ENTITY_CANONICAL_WHERE, prisma } from "@dpf/db";
import { createEstateItem } from "@/lib/estate/estate-item";
import { getPlaybook } from "@/lib/tak/marketing-playbooks";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import {
  isManagedServiceProviderProfile,
  readActivationProfile,
} from "@/lib/storefront/archetype-activation";
import { getWikiGovernanceContext } from "@/lib/tak/decision-governance-route-context";

type RouteContextResult = string | null;

const ROUTE_CONTEXT_PROVIDERS: Record<string, (userId: string, routeContext: string) => Promise<RouteContextResult>> = {
  "/platform/ai": getAiWorkforceContext,
  "/platform/ai/providers": getProvidersContext,
  "/platform/tools/discovery": getDiscoveryOperationsContext,
  // /ops/dev-loop renders the runtime coordination map (targets + leases), NOT
  // the backlog. Without its own provider it fell back to /ops → getOpsContext
  // and the coworker only saw backlog items + epics (BI-FD7E4D72). More-specific
  // prefix wins via longest-match below, so this must precede "/ops".
  "/ops/dev-loop": getDevLoopContext,
  "/ops": getOpsContext,
  "/compliance/licensing": getLicensingReadinessContext,
  "/compliance": getComplianceContext,
  "/workspace": getWorkspaceContext,
  "/finance": getFinanceContext,
  "/portfolio/product": getProductEstateContext,
  "/portfolio": getPortfolioContext,
  "/inventory": getDiscoveryOperationsContext,
  "/employee": getEmployeeContext,
  "/build/work": getCapsuleBuildContext,
  "/build": getBuildContext,
  "/storefront": getStorefrontMarketingContext,
  "/customer/funnel": getCustomerFunnelContext,
  // /coworker-decisions is the Decision Governance hub (WWMD/WWWD/WSID).
  // Without its own provider the coworker fell outside this allow-list and saw
  // only the generic business blurb — so asked "what should we do about these
  // open reviews?" it had no idea the page even showed reviews and told the user
  // to paste the screen (BI-C888E1B6 / EP-0AF96937).
  "/coworker-decisions": getWikiGovernanceContext,
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

  // Default provider: any route with no bespoke provider (the vast majority —
  // only ~18 of ~286 shell routes are enrolled above) would otherwise leave the
  // coworker with just the generic business blurb, so it could not even name the
  // page the user is on. This guarantees perception by construction: the coworker
  // always knows which page the user is viewing and is steered to read via tools
  // rather than ask the user to paste the screen. BI-F2AFD796 / EP-8C706944.
  if (!routeSpecific && routeContext) {
    routeSpecific = buildDefaultRouteContext(routeContext);
  }

  if (!businessContextBlock && !routeSpecific) return null;
  return [businessContextBlock, routeSpecific].filter(Boolean).join("\n");
}

// ─── Default Route Context (fallback for unenrolled routes) ──────────────────

/** Turn a route like "/compliance/risks/[id]" into "Compliance › Risks › Detail". */
function humanizeRoute(routeContext: string): string {
  const segments = routeContext.split("/").filter(Boolean);
  if (segments.length === 0) return "Home";
  return segments
    .map((seg) => {
      // Dynamic segment (e.g. [id], [capsuleId]) → "Detail".
      if (/^\[.*\]$/.test(seg)) return "Detail";
      return seg
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    })
    .join(" › ");
}

/**
 * Minimal page-identity context for a route with no bespoke provider. It does not
 * fabricate page data — it names the page and steers the coworker to its read
 * tools. The explicit "do not tell the user you cannot see the page" line is the
 * behavioral fix for the reported failure: a coworker on an unenrolled route used
 * to ask the user to paste the screen instead of acting.
 */
function buildDefaultRouteContext(routeContext: string): string {
  const label = humanizeRoute(routeContext);
  return [
    `\nPAGE DATA — ${label}:`,
    `The user is viewing the "${label}" page (route ${routeContext}).`,
    "No bespoke data summary is wired for this route yet, but you DO know which page the user is on. To answer questions about what is on it, use your available read tools (e.g. query_backlog, list_open_decision_reviews, wiki_query, get_runtime_coordination_map, and any domain read tools you hold) rather than asking the user to paste or screenshot the screen. Only ask the user to describe the page as a last resort, after your tools cannot supply the answer.",
  ].join("\n");
}

// ─── Route Context Providers ────────────────────────────────────────────────

async function getLicensingReadinessContext(): Promise<string> {
  const profile = await prisma.organizationLicenseProfile.findFirst({
    orderBy: { createdAt: "asc" },
    select: {
      setupStatus: true,
      investigationMode: true,
      homeCountryCode: true,
      primaryRegionCode: true,
      operatingFootprintSummary: true,
      legalActivityConfidence: true,
      researchCoverageStatus: true,
      notes: true,
    },
  });

  const requirementWhere = profile?.homeCountryCode
    ? {
        OR: [
          { countryCode: profile.homeCountryCode },
          ...(profile.primaryRegionCode ? [{ stateProvinceCode: profile.primaryRegionCode }] : []),
        ],
      }
    : undefined;

  const [storefrontConfig, organizationLicenseCount, personLicenseCount, openIssueCount, requirementHints] =
    await Promise.all([
      prisma.storefrontConfig.findFirst({
        include: {
          archetype: {
            select: {
              name: true,
              category: true,
              ctaType: true,
            },
          },
        },
      }),
      prisma.organizationLicenseRecord.count(),
      prisma.personLicenseRecord.count(),
      prisma.licenseReadinessIssue.count({ where: { status: "open" } }),
      prisma.licenseRequirementReference.findMany({
        where: requirementWhere,
        select: {
          authorityName: true,
          jurisdictionLabel: true,
          requirementType: true,
          scopeLevel: true,
        },
        orderBy: [{ countryCode: "asc" }, { stateProvinceCode: "asc" }, { authorityName: "asc" }],
        take: 6,
      }),
    ]);

  const sections: string[] = ["\nPAGE DATA — Licensing Readiness:"];

  if (storefrontConfig?.archetype) {
    sections.push(
      `Business archetype: ${storefrontConfig.archetype.name}`,
      `Archetype category: ${storefrontConfig.archetype.category}`,
      `Primary public CTA: ${storefrontConfig.archetype.ctaType}`,
    );
  }

  if (!profile) {
    sections.push(
      "No licensing profile exists yet.",
      `Organization-held license records: ${organizationLicenseCount}`,
      `Person-held credential records: ${personLicenseCount}`,
      `Open licensing issues: ${openIssueCount}`,
    );
  } else {
    sections.push(
      `Setup status: ${profile.setupStatus}`,
      `Investigation mode: ${profile.investigationMode}`,
      `Home jurisdiction: ${profile.homeCountryCode ?? "unassigned"}${profile.primaryRegionCode ? ` / ${profile.primaryRegionCode}` : ""}`,
      `Legal activity confidence: ${profile.legalActivityConfidence}`,
      `Research coverage: ${profile.researchCoverageStatus}`,
      `Organization-held license records: ${organizationLicenseCount}`,
      `Person-held credential records: ${personLicenseCount}`,
      `Open licensing issues: ${openIssueCount}`,
    );

    if (profile.operatingFootprintSummary) {
      sections.push(`Operating footprint summary: ${profile.operatingFootprintSummary}`);
    }
    if (profile.notes) {
      sections.push(`Current notes: ${profile.notes}`);
    }
  }

  if (requirementHints.length > 0) {
    sections.push(
      "",
      "Requirement reference hints:",
      ...requirementHints.map(
        (item) =>
          `- ${item.authorityName} (${item.jurisdictionLabel}) — ${item.requirementType}, scope=${item.scopeLevel}`,
      ),
    );
  }

  return sections.join("\n");
}

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

// /ops/dev-loop — the runtime coordination map. Mirrors the data the page
// renders (apps/web/app/(shell)/ops/dev-loop/page.tsx getData): RuntimeTargets
// grouped by lifecycle + active NonProductionEnvironmentLeases, plus the janitor
// rules so the coworker can reason about staleness (e.g. why several targets
// show "running" on the same port — stale ones await the 2h-no-heartbeat sweep).
// BI-FD7E4D72 / BI-AD949172.
async function getDevLoopContext(): Promise<string> {
  const [targets, leases] = await Promise.all([
    prisma.runtimeTarget.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        targetId: true,
        kind: true,
        status: true,
        hostUrl: true,
        lastHeartbeatAt: true,
        expiresAt: true,
        updatedAt: true,
        workCapsule: { select: { headBranch: true } },
        featureBuild: { select: { buildId: true } },
      },
    }),
    prisma.nonProductionEnvironmentLease.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        leaseId: true,
        environmentKey: true,
        status: true,
        ownerProvider: true,
        purpose: true,
        branchName: true,
        worktreePath: true,
        expiresAt: true,
        releasedAt: true,
      },
    }),
  ]);

  const now = Date.now();
  const ageHours = (d: Date | null): string =>
    d ? `${Math.round(((now - d.getTime()) / 3_600_000) * 10) / 10}h ago` : "never";

  const ACTIVE = ["running", "starting", "verifying", "assigned"];
  const STALE = ["expired", "failed"];
  const INACTIVE = ["planned", "verified", "released"];

  const fmtTarget = (t: (typeof targets)[number]): string => {
    const branch = t.workCapsule?.headBranch ? ` branch=${t.workCapsule.headBranch}` : "";
    const build = t.featureBuild?.buildId ? ` build=${t.featureBuild.buildId}` : "";
    const url = t.hostUrl ? ` url=${t.hostUrl}` : "";
    return `- ${t.targetId} [${t.kind}/${t.status}]${url} lastHeartbeat=${ageHours(t.lastHeartbeatAt)}${branch}${build}`;
  };

  const active = targets.filter((t) => ACTIVE.includes(t.status));
  const stale = targets.filter((t) => STALE.includes(t.status));
  const inactive = targets.filter((t) => INACTIVE.includes(t.status));
  const activeLeases = leases.filter((l) => l.status === "active" && !l.releasedAt);

  const leaseLines = activeLeases.map(
    (l) =>
      `- ${l.environmentKey} (${l.leaseId}) provider=${l.ownerProvider}` +
      `${l.branchName ? ` branch=${l.branchName}` : ""} purpose="${l.purpose}" expires=${ageHours(l.expiresAt).replace(" ago", " from update")}`,
  );

  return [
    "\nPAGE DATA — Dev Loop (runtime coordination map):",
    "This page shows governed RuntimeTargets and non-prod environment leases, not the backlog.",
    "",
    `ACTIVE RUNTIME TARGETS (${active.length}) — status in running/starting/verifying/assigned:`,
    ...(active.length ? active.map(fmtTarget) : ["- (none)"]),
    "",
    `STALE / FAILED TARGETS (${stale.length}) — status expired/failed:`,
    ...(stale.length ? stale.map(fmtTarget) : ["- (none)"]),
    "",
    `INACTIVE TARGETS (${inactive.length}) — status planned/verified/released:`,
    ...(inactive.length ? inactive.map(fmtTarget) : ["- (none)"]),
    "",
    `ACTIVE NON-PROD LEASES (${activeLeases.length}):`,
    ...(leaseLines.length ? leaseLines : ["- (none)"]),
    "",
    "JANITOR RULES (runtimeTargetJanitor, BI-AD949172): running/starting + no heartbeat for 2h → expired; planned + no consumer for 7 days → released; lease past expiresAt → expired. So several targets can show the SAME status (e.g. running) and even the same URL/port concurrently — multiple build sandboxes register their own target on the shared sandbox port; a 'running' target whose lastHeartbeat is hours/days old is stale and simply has not been swept to 'expired' yet. Cross-check status against lastHeartbeat before assuming a target is live. Use get_runtime_coordination_map for the full live record (verifications, capsule/build linkage).",
  ].join("\n");
}

// ─── Cross-Cutting Workspace Context ──────────────────────────────────────

async function getWorkspaceContext(): Promise<string> {
  const [itemCount, openItems, epicCount, buildCount, productCount, providerCount] = await Promise.all([
    prisma.backlogItem.count(),
    prisma.backlogItem.count({ where: { status: { in: ["open", "in-progress"] } } }),
    prisma.epic.count(),
    prisma.featureBuild.count({ where: { phase: { notIn: ["complete", "failed", "abandoned"] } } }),
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

function containsAnyToken(value: string | null | undefined, tokens: string[]): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return tokens.some((token) => normalized.includes(token.toLowerCase()));
}

function isTexasFinanceFootprint(input: {
  region?: string | null;
  footprint?: string | null;
  businessGeographicScope?: string | null;
  businessTargetMarket?: string | null;
}): boolean {
  const values = [
    input.region,
    input.footprint,
    input.businessGeographicScope,
    input.businessTargetMarket,
  ];

  return values.some((value) => {
    if (!value) return false;
    return value.trim().toUpperCase() === "TX"
      || containsAnyToken(value, ["Texas", " TX", "TX,", "TX."]);
  });
}

function isSoftwarePlatformBusiness(input: {
  industry?: string | null;
  description?: string | null;
  revenueModel?: string | null;
}): boolean {
  return [
    input.industry,
    input.description,
    input.revenueModel,
  ].some((value) => containsAnyToken(value, ["software", "saas", "platform", "subscription", "digital product"]));
}

async function getFinanceContext(): Promise<string> {
  const sections: string[] = ["\nPAGE DATA — Finance:"];

  const [taxProfile, businessContext, registrationCount, openIssueCount, recurringCount, overdueInvoices, activeCredentialCount, blockedRunCount, readyPeriodCount] = await Promise.all([
    prisma.organizationTaxProfile.findFirst({
      orderBy: { createdAt: "asc" },
      select: {
        setupMode: true,
        setupStatus: true,
        homeCountryCode: true,
        primaryRegionCode: true,
        taxModel: true,
        filingOwner: true,
        handoffMode: true,
        externalSystem: true,
        footprintSummary: true,
      },
    }),
    prisma.businessContext.findFirst({
      select: {
        industry: true,
        description: true,
        targetMarket: true,
        revenueModel: true,
        geographicScope: true,
      },
    }),
    prisma.taxRegistration.count(),
    prisma.taxIssue.count({ where: { status: "open" } }),
    prisma.recurringSchedule.count({ where: { status: "active" } }),
    prisma.invoice.count({ where: { status: { in: ["sent", "overdue"] } } }),
    prisma.taxAuthorityCredential.count({ where: { status: "active" } }),
    prisma.taxRemittanceRun.count({ where: { status: { in: ["blocked", "failed"] } } }),
    prisma.taxObligationPeriod.count({ where: { status: "ready" } }),
  ]);

  if (!taxProfile) {
    sections.push(
      "No organization tax profile has been configured yet.",
      `Recurring schedules: ${recurringCount}`,
      `Outstanding customer invoices: ${overdueInvoices}`,
      `Ready tax periods: ${readyPeriodCount}`,
      "External tax research requirement: External Access is required before recommending registrations, filing schedules, or tax-processing setup from live law.",
      "Research tool instruction: when External Access is enabled, use search_public_web for official tax authority pages and fetch_public_website for the strongest official sources before making a DPF tax processing proposal. If External Access is off, ask the user to enable it and provide the official-source targets to verify.",
      "DPF tax processing proposal required: propose DPF configuration changes for tax capture, registrations, tax codes, liability tracking, obligation periods, remittance schedule, evidence, and accounting handoff. Mark assumptions and human approval boundaries.",
      "Provider/subscription spend instruction: use platform finance records first, then browser-use billing portals for plan, amount, cadence, renewal, invoice, and receipt evidence. Do not submit payments, change plans, or update external account settings. If the portal cannot resolve a required field, queue the human ask with the exact missing fields.",
    );
    return sections.join("\n");
  }

  sections.push(
    `Tax setup mode: ${taxProfile.setupMode}`,
    `Tax setup status: ${taxProfile.setupStatus}`,
    `Home jurisdiction: ${taxProfile.homeCountryCode ?? "unassigned"}${taxProfile.primaryRegionCode ? ` / ${taxProfile.primaryRegionCode}` : ""}`,
    `Tax model: ${taxProfile.taxModel}`,
    `Filing owner: ${taxProfile.filingOwner}`,
    `Handoff mode: ${taxProfile.handoffMode}`,
    `External system: ${taxProfile.externalSystem ?? "none recorded"}`,
    `Registrations recorded: ${registrationCount}`,
    `Open tax setup issues: ${openIssueCount}`,
    `Active authority credentials: ${activeCredentialCount}`,
    `Ready tax periods: ${readyPeriodCount}`,
    `Blocked or failed remittance runs: ${blockedRunCount}`,
    `Recurring schedules: ${recurringCount}`,
    `Outstanding customer invoices: ${overdueInvoices}`,
    "Provider/subscription spend instruction: use platform finance records first, then browser-use billing portals for plan, amount, cadence, renewal, invoice, and receipt evidence. Do not submit payments, change plans, or update external account settings. If the portal cannot resolve a required field, queue the human ask with the exact missing fields.",
  );

  const jurisdictionWhere = taxProfile.homeCountryCode
    ? {
        countryCode: taxProfile.homeCountryCode,
        ...(taxProfile.primaryRegionCode
          ? {
              OR: [
                { stateProvinceCode: taxProfile.primaryRegionCode },
                { stateProvinceCode: null },
              ],
            }
          : {}),
      }
    : undefined;

  const [topOpenIssues, unverifiedRegistrations, jurisdictionHints] = await Promise.all([
    prisma.taxIssue.findMany({
      where: { status: "open" },
      select: {
        title: true,
        severity: true,
        issueType: true,
      },
      orderBy: [{ openedAt: "asc" }],
      take: 3,
    }),
    prisma.taxRegistration.findMany({
      where: { lastVerifiedAt: null },
      select: {
        registrationNumber: true,
        jurisdictionReference: {
          select: {
            authorityName: true,
            jurisdictionRefId: true,
          },
        },
      },
      take: 5,
    }),
    prisma.taxJurisdictionReference.findMany({
      where: jurisdictionWhere,
      select: {
        authorityName: true,
        countryCode: true,
        stateProvinceCode: true,
        authorityType: true,
        taxTypes: true,
        filingUrl: true,
        officialWebsiteUrl: true,
      },
      orderBy: [{ countryCode: "asc" }, { stateProvinceCode: "asc" }, { authorityName: "asc" }],
      take: 6,
    }),
  ]);

  if (taxProfile.setupMode === "new_business") {
    sections.push(
      "Coworker investigation posture: first-time setup",
      "Coworker next question: Where is the business legally registered and where are taxable services delivered?",
      "Recommended next action: Research likely authorities from the seeded jurisdiction registry, then live-verify official sources before scheduling periods.",
    );
  } else if (taxProfile.setupMode === "existing") {
    sections.push(
      "Coworker investigation posture: existing filing normalization",
      "Coworker next question: Which authorities does the business already file with today, and who owns each filing?",
      "Recommended next action: Add or verify each known registration, then reconcile open setup gaps before scheduling remittance runs.",
    );
  } else {
    sections.push(
      "Coworker investigation posture: setup mode unknown",
      "Coworker next question: Is the business already filing sales tax, VAT, or GST anywhere today?",
      "Recommended next action: Classify setup mode, capture home jurisdiction and operating footprint, then add the first known or likely authority registration.",
    );
  }

  const setupNeedsOfficialResearch =
    taxProfile.setupMode !== "existing"
    || taxProfile.setupStatus !== "complete"
    || registrationCount === 0
    || openIssueCount > 0;

  if (setupNeedsOfficialResearch) {
    sections.push(
      "External tax research requirement: External Access is required before recommending registrations, filing schedules, or tax-processing setup from live law.",
      "Research tool instruction: when External Access is enabled, use search_public_web for official tax authority pages and fetch_public_website for the strongest official sources before making a DPF tax processing proposal. If External Access is off, ask the user to enable it and provide the official-source targets to verify.",
      "DPF tax processing proposal required: propose DPF configuration changes for tax capture, registrations, tax codes, liability tracking, obligation periods, remittance schedule, evidence, and accounting handoff. Mark assumptions and human approval boundaries.",
    );
  }

  const likelyTexas = isTexasFinanceFootprint({
    region: taxProfile.primaryRegionCode,
    footprint: taxProfile.footprintSummary,
    businessGeographicScope: businessContext?.geographicScope,
    businessTargetMarket: businessContext?.targetMarket,
  });
  const likelySoftware = isSoftwarePlatformBusiness({
    industry: businessContext?.industry,
    description: businessContext?.description,
    revenueModel: businessContext?.revenueModel,
  });

  if (likelyTexas && likelySoftware) {
    sections.push(
      "Likely DPF/Texas research focus: software-platform or SaaS-style sales into Texas; verify Texas Comptroller guidance before configuring tax capture.",
      "Official-source starting points: Texas Comptroller sales/use tax permit FAQ, Texas taxable services guidance, and Texas franchise tax taxable-entities FAQ.",
    );
  }

  if (taxProfile.footprintSummary) {
    sections.push(`Operating footprint summary: ${taxProfile.footprintSummary}`);
  }

  if (topOpenIssues.length > 0) {
    sections.push(
      "Open tax issues for coworker attention:",
      ...topOpenIssues.map(
        (issue) => `- ${issue.severity} ${issue.issueType} - ${issue.title}`,
      ),
      `Top open tax issue: ${topOpenIssues[0]?.severity} ${topOpenIssues[0]?.issueType} - ${topOpenIssues[0]?.title}`,
    );
  }

  if (unverifiedRegistrations.length > 0) {
    sections.push(
      "Registrations needing live verification:",
      ...unverifiedRegistrations.map(
        (registration) =>
          `- ${registration.jurisdictionReference.authorityName} (${registration.jurisdictionReference.jurisdictionRefId}) registration=${registration.registrationNumber ?? "pending"}`,
      ),
    );
  }

  if (jurisdictionHints.length > 0) {
    sections.push(
      "Jurisdiction seed hints:",
      ...jurisdictionHints.map((hint) => {
        const region = hint.stateProvinceCode ? `/${hint.stateProvinceCode}` : "";
        const source = hint.filingUrl ?? hint.officialWebsiteUrl ?? "source pending";
        return `- ${hint.authorityName} (${hint.countryCode}${region}, ${hint.authorityType}) taxes=${hint.taxTypes.join(", ")} source=${source}`;
      }),
    );
  }

  return sections.join("\n");
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
    prisma.inventoryEntity.count({
      where: {
        ...INVENTORY_ENTITY_CANONICAL_WHERE,
        attributionStatus: "needs_review",
      },
    }),
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
          technicalClass: true,
          iconKey: true,
          manufacturer: true,
          productModel: true,
          normalizedVersion: true,
          observedVersion: true,
          supportStatus: true,
          providerView: true,
          status: true,
          firstSeenAt: true,
          lastSeenAt: true,
          taxonomyNode: { select: { name: true, nodeId: true } },
          softwareEvidence: {
            orderBy: [{ lastSeenAt: "desc" }, { firstSeenAt: "desc" }],
            take: 2,
            select: {
              rawVendor: true,
              rawProductName: true,
              rawPackageName: true,
              rawVersion: true,
              normalizationStatus: true,
              normalizationConfidence: true,
              lastSeenAt: true,
            },
          },
          _count: { select: { fromRelationships: true, toRelationships: true } },
          qualityIssues: {
            where: { status: "open" },
            select: { issueType: true, status: true, severity: true },
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
      const item = createEstateItem({
        id: `${productId}:${entity.name}`,
        entityKey: `${entity.entityType}:${entity.name}`,
        name: entity.name,
        entityType: entity.entityType,
        technicalClass: entity.technicalClass,
        iconKey: entity.iconKey,
        manufacturer: entity.manufacturer,
        productModel: entity.productModel,
        observedVersion: entity.observedVersion,
        normalizedVersion: entity.normalizedVersion,
        supportStatus: entity.supportStatus,
        providerView: entity.providerView,
        status: entity.status,
        firstSeenAt: entity.firstSeenAt,
        lastSeenAt: entity.lastSeenAt,
        taxonomyNode: entity.taxonomyNode,
        softwareEvidence: entity.softwareEvidence,
        _count: entity._count,
        qualityIssues: entity.qualityIssues,
      });
      const issues = entity.qualityIssues.map((issue) => issue.issueType).join(", ") || "none";
      const lastSeen = entity.lastSeenAt?.toISOString().slice(0, 10) ?? "unknown";
      return `- ${item.name} [${item.technicalClassLabel}] identity=${item.identityLabel} (${item.identityConfidenceLabel}), vendor=${item.manufacturerLabel}, version=${item.versionLabel} (${item.versionSourceLabel}), support=${item.supportSummaryLabel}, advisories=${item.advisorySummaryLabel}, last seen=${lastSeen}, upstream=${item.upstreamCount}, downstream=${item.downstreamCount}, issues=${issues}`;
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

// Scoped context for a specific work capsule page (/build/work/<capsuleId>).
// The generic getBuildContext lists all 10 recent builds; on a capsule page
// that leaks every other active build's tasks into the coworker prompt.
async function getCapsuleBuildContext(_userId: string, routeContext: string): Promise<string> {
  const capsuleMatch = routeContext.match(/\/build\/work\/(WC-[A-Z0-9]+)/);
  if (!capsuleMatch) return "\nPAGE DATA — Work Capsule:\nNo capsule identified in route.";

  const capsuleId = capsuleMatch[1];
  const capsule = await prisma.workCapsule.findUnique({
    where: { capsuleId },
    select: { title: true, status: true, featureBuildId: true },
  });

  if (!capsule) return `\nPAGE DATA — Work Capsule:\nCapsule ${capsuleId} not found.`;

  const lines = [
    "\nPAGE DATA — Work Capsule:",
    `Capsule: ${capsuleId} — ${capsule.title} (status: ${capsule.status})`,
  ];

  if (capsule.featureBuildId) {
    const build = await prisma.featureBuild.findUnique({
      where: { id: capsule.featureBuildId },
      select: { buildId: true, title: true, phase: true, sandboxPort: true },
    });
    if (build) {
      lines.push(
        `Linked build: ${build.buildId}: ${build.title} [${build.phase}]${build.sandboxPort ? ` (sandbox: port ${build.sandboxPort})` : ""}`,
      );
    } else {
      lines.push("Linked build record not found.");
    }
  } else {
    lines.push("No build linked to this capsule yet.");
  }

  return lines.join("\n");
}

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
        select: {
          archetypeId: true,
          name: true,
          category: true,
          ctaType: true,
          customVocabulary: true,
          activationProfile: true,
        },
      },
    },
  });

  if (!config) {
    return "\nPAGE DATA — Portal:\nNo portal configured yet. Set up your portal at /storefront/setup to unlock business-model-specific recommendations.";
  }

  const archetype = config.archetype;
  const playbook = getPlaybook(archetype.category, archetype.ctaType);
  const vocabulary = getVocabulary(archetype.category, archetype.customVocabulary as Record<string, string> | null);
  const activationProfile = readActivationProfile(archetype.activationProfile);

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
  const activationLines = isManagedServiceProviderProfile(activationProfile)
    ? [
        "",
        "OPERATING PROFILE:",
        `Archetype activation: ${activationProfile.profileType}`,
        `Operating modules: ${activationProfile.modules.join(", ")}`,
        `Billing mode: ${activationProfile.billingReadinessMode}`,
        `Customer graph: ${activationProfile.customerGraph}`,
        `Estate separation: ${activationProfile.estateSeparation}`,
      ]
    : [];

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
    ...activationLines,
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
