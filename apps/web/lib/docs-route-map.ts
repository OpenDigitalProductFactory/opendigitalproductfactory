export type DocsExposurePolicy = "visible" | "hidden";

type DocsRouteEntry = {
  routePrefix: string;
  docsPath: string;
};

const DOCS_ROUTE_MAP: DocsRouteEntry[] = [
  { routePrefix: "/platform/ai/build-studio", docsPath: "/docs/build-studio/index" },
  { routePrefix: "/platform/ai/providers", docsPath: "/docs/ai-workforce/connecting-providers" },
  { routePrefix: "/platform/ai/routing", docsPath: "/docs/ai-workforce/model-routing-lifecycle" },
  { routePrefix: "/platform/ai/model-assignment", docsPath: "/docs/ai-workforce/model-routing-lifecycle" },
  { routePrefix: "/platform/ai/authority", docsPath: "/docs/platform/authority-and-audit" },
  { routePrefix: "/platform/ai/operations-map", docsPath: "/docs/platform/ai-operations" },
  { routePrefix: "/platform/ai/capacity-continuity", docsPath: "/docs/platform/ai-operations" },
  { routePrefix: "/platform/ai/capability-needs", docsPath: "/docs/platform/ai-operations" },
  { routePrefix: "/platform/ai/history", docsPath: "/docs/platform/ai-operations" },
  { routePrefix: "/platform/ai/operations", docsPath: "/docs/platform/ai-operations" },
  { routePrefix: "/platform/ai/assignments", docsPath: "/docs/platform/ai-operations" },
  { routePrefix: "/platform/ai", docsPath: "/docs/ai-workforce/index" },
  { routePrefix: "/platform/identity", docsPath: "/docs/platform/identity-and-access" },
  { routePrefix: "/platform/audit", docsPath: "/docs/platform/authority-and-audit" },
  { routePrefix: "/platform/tools/discovery", docsPath: "/docs/platform/discovery-operations" },
  { routePrefix: "/platform/tools/integrations/google-business-profile", docsPath: "/docs/platform/tools-and-integrations" },
  { routePrefix: "/platform/tools/integrations/google-marketing-intelligence", docsPath: "/docs/platform/tools-and-integrations" },
  { routePrefix: "/platform/tools", docsPath: "/docs/platform/tools-and-integrations" },
  { routePrefix: "/platform/services", docsPath: "/docs/platform/tools-and-integrations" },
  { routePrefix: "/platform/integrations", docsPath: "/docs/platform/tools-and-integrations" },
  { routePrefix: "/platform/edge-nodes", docsPath: "/docs/platform/edge-nodes" },
  { routePrefix: "/platform", docsPath: "/docs/platform/index" },

  { routePrefix: "/finance/banking", docsPath: "/docs/finance/banking-and-reconciliation" },
  { routePrefix: "/finance/invoices", docsPath: "/docs/finance/accounts-receivable" },
  { routePrefix: "/finance/payments", docsPath: "/docs/finance/accounts-receivable" },
  { routePrefix: "/finance/revenue", docsPath: "/docs/finance/accounts-receivable" },
  { routePrefix: "/finance/bills", docsPath: "/docs/finance/accounts-payable" },
  { routePrefix: "/finance/purchase-orders", docsPath: "/docs/finance/accounts-payable" },
  { routePrefix: "/finance/suppliers", docsPath: "/docs/finance/accounts-payable" },
  { routePrefix: "/finance/spend", docsPath: "/docs/finance/accounts-payable" },
  { routePrefix: "/finance/reports", docsPath: "/docs/finance/reporting-and-close" },
  { routePrefix: "/finance/close", docsPath: "/docs/finance/reporting-and-close" },
  { routePrefix: "/finance/expense-claims", docsPath: "/docs/finance/expense-workflows" },
  { routePrefix: "/finance/my-expenses", docsPath: "/docs/finance/expense-workflows" },
  { routePrefix: "/finance/settings", docsPath: "/docs/finance/controls-and-automation" },
  { routePrefix: "/finance/configuration", docsPath: "/docs/finance/controls-and-automation" },
  { routePrefix: "/finance/recurring", docsPath: "/docs/finance/controls-and-automation" },
  { routePrefix: "/finance/payment-runs", docsPath: "/docs/finance/controls-and-automation" },
  { routePrefix: "/finance", docsPath: "/docs/finance/index" },

  { routePrefix: "/compliance/onboard", docsPath: "/docs/compliance/regulations-and-obligations" },
  { routePrefix: "/compliance/regulations", docsPath: "/docs/compliance/regulations-and-obligations" },
  { routePrefix: "/compliance/obligations", docsPath: "/docs/compliance/regulations-and-obligations" },
  { routePrefix: "/compliance/controls", docsPath: "/docs/compliance/controls-and-evidence" },
  { routePrefix: "/compliance/evidence", docsPath: "/docs/compliance/controls-and-evidence" },
  { routePrefix: "/compliance/posture", docsPath: "/docs/compliance/posture-and-gaps" },
  { routePrefix: "/compliance/gaps", docsPath: "/docs/compliance/posture-and-gaps" },
  { routePrefix: "/compliance/incidents", docsPath: "/docs/compliance/incidents-risks-and-response" },
  { routePrefix: "/compliance/risks", docsPath: "/docs/compliance/incidents-risks-and-response" },
  { routePrefix: "/compliance/audits", docsPath: "/docs/compliance/audits-and-corrective-actions" },
  { routePrefix: "/compliance/actions", docsPath: "/docs/compliance/audits-and-corrective-actions" },
  { routePrefix: "/compliance/policies", docsPath: "/docs/compliance/policies-and-acknowledgements" },
  { routePrefix: "/compliance/submissions", docsPath: "/docs/compliance/regulatory-submissions" },
  { routePrefix: "/compliance/licensing", docsPath: "/docs/compliance/licensing-readiness" },
  { routePrefix: "/compliance", docsPath: "/docs/compliance/index" },

  { routePrefix: "/admin/storefront/inbox", docsPath: "/docs/storefront/inbox-and-enquiries" },
  { routePrefix: "/admin/storefront/items", docsPath: "/docs/storefront/catalog-and-page-content" },
  { routePrefix: "/admin/storefront/sections", docsPath: "/docs/storefront/catalog-and-page-content" },
  { routePrefix: "/admin/storefront/settings", docsPath: "/docs/storefront/settings-business-and-operations" },
  { routePrefix: "/admin/storefront/setup", docsPath: "/docs/storefront/setup-and-launch" },
  { routePrefix: "/admin/storefront/team", docsPath: "/docs/storefront/team-and-fulfilment" },
  { routePrefix: "/admin/storefront", docsPath: "/docs/storefront/index" },
  { routePrefix: "/storefront/inbox", docsPath: "/docs/storefront/inbox-and-enquiries" },
  { routePrefix: "/storefront/items", docsPath: "/docs/storefront/catalog-and-page-content" },
  { routePrefix: "/storefront/sections", docsPath: "/docs/storefront/catalog-and-page-content" },
  { routePrefix: "/storefront/settings/business", docsPath: "/docs/storefront/settings-business-and-operations" },
  { routePrefix: "/storefront/settings/operations", docsPath: "/docs/storefront/settings-business-and-operations" },
  { routePrefix: "/storefront/settings", docsPath: "/docs/storefront/settings-business-and-operations" },
  { routePrefix: "/storefront/setup", docsPath: "/docs/storefront/setup-and-launch" },
  { routePrefix: "/storefront/team", docsPath: "/docs/storefront/team-and-fulfilment" },
  { routePrefix: "/storefront/tables", docsPath: "/docs/storefront/team-and-fulfilment" },
  { routePrefix: "/storefront", docsPath: "/docs/storefront/index" },

  { routePrefix: "/customer/marketing", docsPath: "/docs/customers/marketing" },
  { routePrefix: "/customer", docsPath: "/docs/customers/index" },
  { routePrefix: "/coworker-decisions", docsPath: "/docs/wiki/index" },
  { routePrefix: "/build", docsPath: "/docs/build-studio/index" },
  // Self-upgrade is high-consequence — give it a dedicated doc rather than
  // letting it fall through to the generic operations backlog page.
  { routePrefix: "/ops/self-upgrade", docsPath: "/docs/operations/self-upgrade" },
  { routePrefix: "/ops", docsPath: "/docs/operations/index" },
  { routePrefix: "/portfolio/product", docsPath: "/docs/products/index" },
  { routePrefix: "/portfolio", docsPath: "/docs/portfolios/index" },
  { routePrefix: "/inventory", docsPath: "/docs/products/index" },
  { routePrefix: "/ea", docsPath: "/docs/architecture/index" },
  { routePrefix: "/employee", docsPath: "/docs/hr/index" },
  { routePrefix: "/admin", docsPath: "/docs/admin/index" },
  { routePrefix: "/workspace/documents", docsPath: "/docs/workspace/documents" },
  { routePrefix: "/workspace", docsPath: "/docs/workspace/index" },
  { routePrefix: "/setup", docsPath: "/docs/getting-started/setup-and-first-login" },
  { routePrefix: "/docs", docsPath: "/docs" },
];

const VISIBLE_DOCS_PREFIXES = [
  "/setup",
  "/workspace",
  "/build",
  "/finance",
  "/platform",
  "/compliance",
  "/storefront",
  "/admin/storefront",
  "/customer",
  "/coworker-decisions",
  "/portfolio",
  "/inventory",
  "/ea",
  "/employee",
  "/ops",
  "/admin",
  "/docs",
];

const HIDDEN_DOCS_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/welcome",
  "/sandbox-restricted",
  "/portal",
  "/customer-login",
  "/customer-signup",
  "/customer-complete-profile",
  "/customer-link-account",
  "/s/approve",
  "/s/expense-approve",
  "/s/pay",
  "/s",
];

function routeMatches(pathname: string, routePrefix: string) {
  return pathname === routePrefix || pathname.startsWith(`${routePrefix}/`);
}

function resolveByLongestPrefix<T extends { routePrefix: string }>(pathname: string, entries: T[]): T | null {
  let best: T | null = null;

  for (const entry of entries) {
    if (routeMatches(pathname, entry.routePrefix)) {
      if (!best || entry.routePrefix.length > best.routePrefix.length) {
        best = entry;
      }
    }
  }

  return best;
}

export function resolveDocsPath(pathname: string): string | null {
  return resolveByLongestPrefix(pathname, DOCS_ROUTE_MAP)?.docsPath ?? null;
}

export function resolveDocsExposurePolicy(pathname: string): DocsExposurePolicy {
  if (resolveByLongestPrefix(pathname, HIDDEN_DOCS_PREFIXES.map((routePrefix) => ({ routePrefix })))) {
    return "hidden";
  }

  if (resolveByLongestPrefix(pathname, VISIBLE_DOCS_PREFIXES.map((routePrefix) => ({ routePrefix })))) {
    return "visible";
  }

  return "hidden";
}

export function shouldShowDocsLink(pathname: string): boolean {
  return resolveDocsExposurePolicy(pathname) === "visible" && resolveDocsPath(pathname) !== null;
}

export function buildContextualDocsHref(pathname: string): string | null {
  const docsPath = resolveDocsPath(pathname);
  if (!docsPath || resolveDocsExposurePolicy(pathname) !== "visible") {
    return null;
  }

  return docsPath === "/docs"
    ? `/docs?sourceRoute=${encodeURIComponent(pathname)}`
    : `${docsPath}?sourceRoute=${encodeURIComponent(pathname)}`;
}

export function getMappedDocsRoutes(): DocsRouteEntry[] {
  return [...DOCS_ROUTE_MAP];
}
