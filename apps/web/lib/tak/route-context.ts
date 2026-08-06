// apps/web/lib/route-context.ts
// Injects page-specific data context into agent system prompts.
// Each route can have a context provider that summarizes what the user sees.
import { prisma } from "@dpf/db";
import { getDiscoveryOperationsContext } from "@/lib/tak/discovery-operations-route-context";
import { getProductEstateContext } from "@/lib/tak/product-estate-route-context";
import { getWikiGovernanceContext } from "@/lib/tak/decision-governance-route-context";
import { getSelfUpgradeContext } from "@/lib/tak/self-upgrade-route-context";
import type { PageContextProvider } from "@/lib/tak/route-context/types";
import { getLicensingReadinessContext, getComplianceContext } from "@/lib/tak/route-context/providers/compliance";
import { getAiWorkforceContext, getProvidersContext } from "@/lib/tak/route-context/providers/platform";
import { getOpsContext, getDevLoopContext } from "@/lib/tak/route-context/providers/ops";
import { getWorkspaceContext, getEmployeeContext } from "@/lib/tak/route-context/providers/workspace";
import { getCapsuleBuildContext, getBuildContext } from "@/lib/tak/route-context/providers/build";
import { getFinanceContext } from "@/lib/tak/route-context/providers/finance";
import { getPortfolioContext, getStorefrontMarketingContext, getCustomerFunnelContext } from "@/lib/tak/route-context/providers/commerce";

type RouteContextResult = string | null;

// The page-owned context registry (design spec 2026-08-05, Phase 2). Each entry
// declares the route it owns and its `match` mode; a page "self-registers" by
// adding an entry here. Order is irrelevant — resolution is exact-first, then
// longest matching prefix (see resolveProvider). `exact` routes never leak their
// data to a descendant, which is the generalized fix for the /ops/self-upgrade →
// /ops backlog mislabel (PR #4048): every /ops/* sibling now falls to the
// page-identity label instead of inheriting the backlog.
const PAGE_CONTEXT_PROVIDERS: PageContextProvider[] = [
  { route: "/platform/ai/providers", match: "prefix", build: () => getProvidersContext() },
  { route: "/platform/ai", match: "prefix", build: () => getAiWorkforceContext() },
  { route: "/platform/tools/discovery", match: "prefix", build: () => getDiscoveryOperationsContext()},
  // /ops is the Operations Backlog — `exact` so its backlog+epics data can never
  // leak to a sibling ops page. This is the generalized /ops/self-upgrade fix
  // (BI-FD7E4D72 / PR #4048): /ops/patches, /ops/journeys, /ops/changes,
  // /ops/promotions, /ops/security get the page-identity label, not the backlog.
  { route: "/ops", match: "exact", build: () => getOpsContext() },
  { route: "/ops/dev-loop", match: "exact", build: () => getDevLoopContext() },
  { route: "/ops/self-upgrade", match: "exact", build: () => getSelfUpgradeContext() },
  { route: "/compliance/licensing", match: "prefix", build: () => getLicensingReadinessContext() },
  // /compliance parses a regulation/obligation/control id out of the route, so it
  // genuinely serves its subtree → `prefix`.
  { route: "/compliance", match: "prefix", build: (i) => getComplianceContext(i.userId, i.route) },
  // /workspace is the top-level overview — `exact` so a child page never claims
  // to be the workspace overview.
  { route: "/workspace", match: "exact", build: () => getWorkspaceContext() },
  { route: "/finance", match: "prefix", build: () => getFinanceContext() },
  { route: "/portfolio/product", match: "prefix", build: (i) => getProductEstateContext(i.userId, i.route) },
  { route: "/portfolio", match: "prefix", build: () => getPortfolioContext() },
  { route: "/inventory", match: "prefix", build: () => getDiscoveryOperationsContext()},
  { route: "/employee", match: "prefix", build: () => getEmployeeContext() },
  // /build/work parses the capsule id from the route → `prefix`.
  { route: "/build/work", match: "prefix", build: (i) => getCapsuleBuildContext(i.userId, i.route) },
  { route: "/build", match: "prefix", build: (i) => getBuildContext(i.userId) },
  { route: "/storefront", match: "prefix", build: () => getStorefrontMarketingContext() },
  // /customer/funnel is a 30-day funnel dashboard — `exact`; a child does not
  // share that aggregate.
  { route: "/customer/funnel", match: "exact", build: () => getCustomerFunnelContext() },
  // /coworker-decisions is the Decision Governance hub (WWMD/WWWD/WSID).
  { route: "/coworker-decisions", match: "prefix", build: () => getWikiGovernanceContext()},
];

/**
 * Resolve the owning provider for a route: an `exact` provider whose route
 * equals the pathname wins outright; otherwise the longest `prefix` provider
 * that is a path-prefix of the route. An `exact` provider is NEVER returned for
 * a descendant route, so a page can never be mislabeled with a sibling's PAGE
 * DATA (design spec 2026-08-05, Phase 2 — no data inheritance).
 */
function resolveProvider(routeContext: string): PageContextProvider | null {
  const exact = PAGE_CONTEXT_PROVIDERS.find(
    (p) => p.match === "exact" && p.route === routeContext,
  );
  if (exact) return exact;
  let best: PageContextProvider | null = null;
  for (const p of PAGE_CONTEXT_PROVIDERS) {
    if (p.match !== "prefix") continue;
    if (routeContext === p.route || routeContext.startsWith(p.route + "/")) {
      if (!best || p.route.length > best.route.length) best = p;
    }
  }
  return best;
}

export async function getRouteDataContext(routeContext: string, userId: string): Promise<RouteContextResult> {
  // Universal business context — injected on every route so the coworker
  // always knows what the business does, who it serves, and how it operates.
  let businessContextBlock: string | null = null;
  try {
    businessContextBlock = await getBusinessContextBlock();
  } catch {
    // Non-fatal — proceed without business context
  }

  let routeSpecific: string | null = null;
  const provider = resolveProvider(routeContext);
  if (provider) {
    try {
      routeSpecific = await provider.build({ userId, route: routeContext });
    } catch {
      // Non-fatal
    }
  }

  // Perception by construction: a route with no owning provider still names the
  // page and steers the coworker to its read tools rather than asking the user to
  // paste the screen (BI-F2AFD796 / EP-8C706944). An `exact` provider never leaks
  // here — an unowned descendant gets this label, not a sibling's data.
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
