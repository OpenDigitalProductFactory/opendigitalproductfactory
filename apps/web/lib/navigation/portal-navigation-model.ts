import type { CapabilityKey } from "@/lib/govern/permissions";

export type PortalAudienceMode = "worker" | "operator" | "customer" | "diagnostic";

export type PortalDestinationKind =
  | "domain-home"
  | "section-page"
  | "detail"
  | "workflow-step"
  | "settings"
  | "contextual-action"
  | "legacy-redirect";

export type PortalDomain =
  | "workspace"
  | "business"
  | "delivery"
  | "platform"
  | "admin"
  | "knowledge"
  | "customer";

export type PortalShellSectionKey =
  | "workspace"
  | "business"
  | "products"
  | "platform"
  | "knowledge";

export type PortalNavRecord = {
  key: string;
  label: string;
  path: string;
  parentPath: string;
  domain: PortalDomain;
  audienceModes: readonly PortalAudienceMode[];
  destinationKind: PortalDestinationKind;
  capabilityKey?: CapabilityKey | null;
  primaryOrder?: number;
  sectionNavLabel?: string;
  shellNav?: {
    sectionKey: PortalShellSectionKey;
    label?: string;
    description: string;
  };
  sectionSiblings?: readonly string[];
};

export type PortalNavEntry = Pick<
  PortalNavRecord,
  "key" | "label" | "path" | "parentPath" | "domain" | "destinationKind"
> & {
  capabilityKey: CapabilityKey | null;
  audienceModes: readonly PortalAudienceMode[];
};

export type PortalShellNavEntry = PortalNavEntry & {
  label: string;
  description: string;
  sectionKey: PortalShellSectionKey;
};

const platformSectionSiblings = [
  "/platform",
  "/platform/identity",
  "/platform/ai",
  "/platform/tools",
  "/platform/audit",
] as const;

export const PORTAL_NAV_ROUTES: readonly PortalNavRecord[] = [
  {
    key: "workspace",
    label: "Workspace",
    path: "/workspace",
    parentPath: "/workspace",
    domain: "workspace",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: null,
    primaryOrder: 10,
    shellNav: {
      sectionKey: "workspace",
      description: "See what needs attention next.",
    },
    sectionSiblings: ["/workspace", "/workspace/documents"],
  },
  {
    key: "documents",
    label: "Documents",
    path: "/workspace/documents",
    parentPath: "/workspace",
    domain: "workspace",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
    shellNav: {
      sectionKey: "workspace",
      description: "Search, open, publish, and trace managed documents.",
    },
  },
  {
    key: "customer",
    label: "Customer",
    sectionNavLabel: "Accounts",
    path: "/customer",
    parentPath: "/customer",
    domain: "business",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_customer",
    primaryOrder: 20,
    shellNav: {
      sectionKey: "business",
      description: "Accounts, pipeline, quotes, and orders.",
    },
    sectionSiblings: [
      "/customer",
      "/customer/engagements",
      "/customer/opportunities",
      "/customer/quotes",
      "/customer/sales-orders",
      "/customer/funnel",
      "/customer/marketing",
    ],
  },
  {
    key: "customer-engagements",
    label: "Engagements",
    path: "/customer/engagements",
    parentPath: "/customer",
    domain: "customer",
    audienceModes: ["worker", "operator"],
    destinationKind: "section-page",
    capabilityKey: "view_customer",
  },
  {
    key: "customer-opportunities",
    label: "Opportunities",
    sectionNavLabel: "Pipeline",
    path: "/customer/opportunities",
    parentPath: "/customer",
    domain: "customer",
    audienceModes: ["worker", "operator"],
    destinationKind: "section-page",
    capabilityKey: "view_customer",
  },
  {
    key: "customer-quotes",
    label: "Quotes",
    path: "/customer/quotes",
    parentPath: "/customer",
    domain: "customer",
    audienceModes: ["worker", "operator"],
    destinationKind: "section-page",
    capabilityKey: "view_customer",
  },
  {
    key: "customer-sales-orders",
    label: "Sales Orders",
    sectionNavLabel: "Orders",
    path: "/customer/sales-orders",
    parentPath: "/customer",
    domain: "customer",
    audienceModes: ["worker", "operator"],
    destinationKind: "section-page",
    capabilityKey: "view_customer",
  },
  {
    key: "customer-funnel",
    label: "Funnel",
    path: "/customer/funnel",
    parentPath: "/customer",
    domain: "customer",
    audienceModes: ["worker", "operator"],
    destinationKind: "section-page",
    capabilityKey: "view_customer",
  },
  {
    key: "customer-marketing",
    label: "Marketing",
    path: "/customer/marketing",
    parentPath: "/customer",
    domain: "customer",
    audienceModes: ["worker", "operator"],
    destinationKind: "section-page",
    capabilityKey: "view_marketing",
  },
  {
    key: "employee",
    label: "People",
    path: "/employee",
    parentPath: "/employee",
    domain: "business",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_employee",
    shellNav: {
      sectionKey: "business",
      description: "Human users, contractors, and workforce records.",
    },
  },
  {
    key: "finance",
    label: "Finance",
    path: "/finance",
    parentPath: "/finance",
    domain: "business",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_finance",
    primaryOrder: 30,
    shellNav: {
      sectionKey: "business",
      description: "Cashflow, receivables, payables, and close.",
    },
  },
  {
    key: "compliance",
    label: "Compliance",
    path: "/compliance",
    parentPath: "/compliance",
    domain: "business",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_compliance",
    primaryOrder: 40,
    shellNav: {
      sectionKey: "business",
      description: "Controls, risk, obligations, and posture.",
    },
  },
  {
    key: "storefront",
    label: "Portal",
    path: "/storefront",
    parentPath: "/storefront",
    domain: "business",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_storefront",
    primaryOrder: 50,
    shellNav: {
      sectionKey: "business",
      description: "Customer-facing portal experience and setup.",
    },
  },
  {
    key: "portfolio",
    label: "Portfolio",
    path: "/portfolio",
    parentPath: "/portfolio",
    domain: "delivery",
    audienceModes: ["operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_portfolio",
    shellNav: {
      sectionKey: "products",
      description: "Digital products and their lifecycle homes.",
    },
  },
  {
    key: "backlog",
    label: "Backlog",
    path: "/ops",
    parentPath: "/ops",
    domain: "delivery",
    audienceModes: ["operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_operations",
    primaryOrder: 60,
    shellNav: {
      sectionKey: "products",
      description: "Cross-cutting work queues and improvements.",
    },
  },
  {
    key: "ea_modeler",
    label: "Architecture",
    path: "/portfolio/architecture",
    parentPath: "/portfolio",
    domain: "delivery",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_ea_modeler",
    shellNav: {
      sectionKey: "products",
      description: "Reference models, capabilities, and structure.",
    },
  },
  {
    key: "ai_workforce",
    label: "AI Workforce",
    path: "/platform/ai",
    parentPath: "/platform",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
    shellNav: {
      sectionKey: "platform",
      description: "Oversee AI specialists and their authority.",
    },
  },
  {
    key: "build",
    label: "Build Studio",
    path: "/build",
    parentPath: "/build",
    domain: "delivery",
    audienceModes: ["operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_platform",
    primaryOrder: 70,
    shellNav: {
      sectionKey: "platform",
      description: "Create and ship new capability with AI help.",
    },
  },
  {
    key: "platform",
    label: "Platform Hub",
    path: "/platform",
    parentPath: "/platform",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_platform",
    primaryOrder: 80,
    shellNav: {
      sectionKey: "platform",
      description: "Providers, integrations, services, and governance.",
    },
    sectionSiblings: platformSectionSiblings,
  },
  {
    key: "platform-identity",
    label: "Identity & Access",
    path: "/platform/identity",
    parentPath: "/platform",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
    sectionSiblings: [
      "/platform/identity",
      "/platform/identity/principals",
      "/platform/identity/groups",
      "/platform/identity/directory",
      "/platform/identity/federation",
      "/platform/identity/applications",
      "/platform/identity/authorization",
      "/platform/identity/agents",
    ],
  },
  {
    key: "platform-identity-principals",
    label: "Principals",
    path: "/platform/identity/principals",
    parentPath: "/platform/identity",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-identity-groups",
    label: "Groups",
    path: "/platform/identity/groups",
    parentPath: "/platform/identity",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-identity-directory",
    label: "Directory",
    path: "/platform/identity/directory",
    parentPath: "/platform/identity",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-identity-federation",
    label: "Federation",
    path: "/platform/identity/federation",
    parentPath: "/platform/identity",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-identity-applications",
    label: "Applications",
    path: "/platform/identity/applications",
    parentPath: "/platform/identity",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-identity-authorization",
    label: "Authorization",
    path: "/platform/identity/authorization",
    parentPath: "/platform/identity",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-identity-agents",
    label: "Agents",
    path: "/platform/identity/agents",
    parentPath: "/platform/identity",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-ai-operations-map",
    label: "Operations Map",
    path: "/platform/ai/operations-map",
    parentPath: "/platform/ai",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-ai-capacity-continuity",
    label: "Capacity Continuity",
    path: "/platform/ai/capacity-continuity",
    parentPath: "/platform/ai",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-ai-assignments",
    label: "Assignments",
    path: "/platform/ai/assignments",
    parentPath: "/platform/ai",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-ai-prompts",
    label: "Prompts",
    path: "/platform/ai/prompts",
    parentPath: "/platform/ai",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-ai-skills",
    label: "Skills",
    path: "/platform/ai/skills",
    parentPath: "/platform/ai",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-ai-capability-needs",
    label: "Capability Needs",
    path: "/platform/ai/capability-needs",
    parentPath: "/platform/ai",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-ai-providers",
    label: "Providers & Routing",
    path: "/platform/ai/providers",
    parentPath: "/platform/ai",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-ai-build-studio",
    label: "Build Runtime",
    path: "/platform/ai/build-studio",
    parentPath: "/platform/ai",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "settings",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-tools",
    label: "Tools & Services",
    path: "/platform/tools",
    parentPath: "/platform",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
    sectionSiblings: [
      "/platform/tools",
      "/platform/tools/catalog",
      "/platform/tools/services",
      "/platform/tools/integrations",
      "/platform/tools/built-ins",
      "/platform/tools/discovery",
      "/platform/tools/inventory",
    ],
  },
  {
    key: "platform-tools-catalog",
    label: "MCP Catalog",
    path: "/platform/tools/catalog",
    parentPath: "/platform/tools",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-tools-services",
    label: "MCP Services",
    path: "/platform/tools/services",
    parentPath: "/platform/tools",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-tools-integrations",
    label: "Native Integrations",
    path: "/platform/tools/integrations",
    parentPath: "/platform/tools",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-tools-built-ins",
    label: "Built-in Tools",
    path: "/platform/tools/built-ins",
    parentPath: "/platform/tools",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-tools-discovery",
    label: "Estate Discovery",
    path: "/platform/tools/discovery",
    parentPath: "/platform/tools",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-tools-inventory",
    label: "Capability Inventory",
    path: "/platform/tools/inventory",
    parentPath: "/platform/tools",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-audit",
    label: "Governance & Audit",
    path: "/platform/audit",
    parentPath: "/platform",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
    sectionSiblings: [
      "/platform/audit",
      "/platform/audit/ledger",
      "/platform/audit/journal",
      "/platform/audit/routes",
      "/platform/audit/operations",
      "/platform/audit/authority",
      "/platform/audit/metrics",
    ],
  },
  {
    key: "platform-audit-ledger",
    label: "Ledger",
    path: "/platform/audit/ledger",
    parentPath: "/platform/audit",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-audit-journal",
    label: "Journal",
    path: "/platform/audit/journal",
    parentPath: "/platform/audit",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-audit-routes",
    label: "Routes",
    path: "/platform/audit/routes",
    parentPath: "/platform/audit",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-audit-operations",
    label: "Operations",
    path: "/platform/audit/operations",
    parentPath: "/platform/audit",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-audit-authority",
    label: "Authority",
    path: "/platform/audit/authority",
    parentPath: "/platform/audit",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "platform-audit-metrics",
    label: "Metrics",
    path: "/platform/audit/metrics",
    parentPath: "/platform/audit",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    key: "admin",
    label: "Admin",
    path: "/admin",
    parentPath: "/admin",
    domain: "admin",
    audienceModes: ["operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_admin",
    primaryOrder: 90,
    shellNav: {
      sectionKey: "platform",
      description: "Core platform configuration and access.",
    },
  },
  {
    key: "admin-storefront-redirect",
    label: "Storefront Admin Redirect",
    path: "/admin/storefront",
    parentPath: "/admin",
    domain: "admin",
    audienceModes: ["operator"],
    destinationKind: "legacy-redirect",
    capabilityKey: "view_admin",
  },
  {
    key: "admin-business-context-redirect",
    label: "Business Context Redirect",
    path: "/admin/business-context",
    parentPath: "/admin",
    domain: "admin",
    audienceModes: ["operator"],
    destinationKind: "legacy-redirect",
    capabilityKey: "view_admin",
  },
  {
    key: "admin-operating-hours-redirect",
    label: "Operating Hours Redirect",
    path: "/admin/operating-hours",
    parentPath: "/admin",
    domain: "admin",
    audienceModes: ["operator"],
    destinationKind: "legacy-redirect",
    capabilityKey: "view_admin",
  },
  {
    key: "knowledge",
    label: "Knowledge",
    path: "/knowledge",
    parentPath: "/knowledge",
    domain: "knowledge",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: null,
    primaryOrder: 100,
    shellNav: {
      sectionKey: "knowledge",
      description: "Shared operational and product knowledge.",
    },
  },
  {
    key: "wiki",
    label: "Wiki",
    path: "/wiki",
    parentPath: "/wiki",
    domain: "knowledge",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: null,
    shellNav: {
      sectionKey: "knowledge",
      description: "Founder kernel and per-org overlay - stances, heuristics, decisions.",
    },
  },
  {
    key: "docs",
    label: "Docs",
    path: "/docs",
    parentPath: "/docs",
    domain: "knowledge",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: null,
    shellNav: {
      sectionKey: "knowledge",
      description: "Reference documentation and specs.",
    },
  },
] as const;

const ROUTES_BY_PATH = new Map(
  PORTAL_NAV_ROUTES.map((route) => [normalizePath(route.path), route] as const),
);

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

function toEntry(route: PortalNavRecord): PortalNavEntry {
  return {
    key: route.key,
    label: route.label,
    path: route.path,
    parentPath: route.parentPath,
    domain: route.domain,
    audienceModes: route.audienceModes,
    destinationKind: route.destinationKind,
    capabilityKey: route.capabilityKey ?? null,
  };
}

function toSectionEntry(route: PortalNavRecord): PortalNavEntry {
  return {
    ...toEntry(route),
    label: route.sectionNavLabel ?? route.label,
  };
}

export function getRouteNavRecord(path: string): PortalNavRecord | undefined {
  return ROUTES_BY_PATH.get(normalizePath(path));
}

export function getPrimaryNavEntries(audienceMode: PortalAudienceMode): PortalNavEntry[] {
  return PORTAL_NAV_ROUTES
    .filter((route) =>
      route.primaryOrder !== undefined &&
      route.destinationKind !== "legacy-redirect" &&
      route.audienceModes.includes(audienceMode)
    )
    .sort((left, right) => (left.primaryOrder ?? 0) - (right.primaryOrder ?? 0))
    .map(toEntry);
}

export function getSectionNavEntries(path: string): PortalNavEntry[] {
  const route = getRouteNavRecord(path);
  const owner = route?.sectionSiblings
    ? route
    : route?.parentPath
      ? getRouteNavRecord(route.parentPath)
      : undefined;

  return (owner?.sectionSiblings ?? [])
    .map((siblingPath) => getRouteNavRecord(siblingPath))
    .filter((entry): entry is PortalNavRecord => entry !== undefined)
    .filter((entry) => entry.destinationKind !== "legacy-redirect")
    .map(toSectionEntry);
}

export function getShellNavEntries(): PortalShellNavEntry[] {
  return PORTAL_NAV_ROUTES
    .filter((route) => route.shellNav !== undefined)
    .map((route) => ({
      ...toEntry(route),
      label: route.shellNav?.label ?? route.label,
      description: route.shellNav?.description ?? "",
      sectionKey: route.shellNav?.sectionKey ?? "knowledge",
    }));
}
