import type { CapabilityKey } from "@/lib/govern/permissions";

export type PortalAudienceMode = "worker" | "operator" | "customer" | "diagnostic";

import type { PortalShellSectionKey } from "./portal-shell-sections";
import { BUSINESS_VIEW_ROUTES } from "./business-view-routes";

export {
  PORTAL_SHELL_SECTIONS,
  type PortalShellSectionDefinition,
  type PortalShellSectionKey,
} from "./portal-shell-sections";

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
  | "performance"
  | "business"
  | "delivery"
  | "platform"
  | "admin"
  | "knowledge"
  | "customer";

export type PortalNavRecord = {
  key: string;
  label: string;
  path: string;
  parentPath: string;
  domain: PortalDomain;
  audienceModes: readonly PortalAudienceMode[];
  destinationKind: PortalDestinationKind;
  capabilityKey?: CapabilityKey | null;
  /**
   * Archetype-capability gate (capability registry key(s) from
   * @dpf/storefront-templates, e.g. "public-body-governance"). Entries carrying
   * this render only when the org's effective capability activation has AT
   * LEAST ONE of the keys active (any-of) — capability-driven surfaces per the
   * civic archetypes spec §12, on top of (not instead of) the user-permission
   * capabilityKey. An array expresses shared surfaces like /governance, which
   * serves both public-body and member-owned governance.
   */
  orgCapabilityKey?: string | readonly string[] | null;
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
  orgCapabilityKey: string | readonly string[] | null;
  audienceModes: readonly PortalAudienceMode[];
};

export type PortalShellNavEntry = PortalNavEntry & {
  label: string;
  description: string;
  sectionKey: PortalShellSectionKey;
};

const platformSectionSiblings = ["/platform", "/platform/archetype-readiness", "/platform/identity", "/platform/ai", "/platform/tools", "/platform/audit"] as const;

function platformAiRoute(
  key: string,
  label: string,
  path: string,
  destinationKind: PortalDestinationKind = "section-page",
): PortalNavRecord {
  return { key, label, path, parentPath: "/platform/ai", domain: "platform", audienceModes: ["operator"], destinationKind, capabilityKey: "view_platform" };
}

export const PORTAL_NAV_ROUTES: readonly PortalNavRecord[] = [
  ...BUSINESS_VIEW_ROUTES,
  {
    // EP-ATTENTION-SURFACE keystone (BI-D39484E7): the "Needs you" attention inbox.
    // A workspace-section SIBLING, not a new rail destination (kernel-ratified
    // elevate-workspace 0.69 vs new-rail 0.06) — so no cross-rail-section teleport
    // (EP-NAV-COHERENCE hard rule). Audience-aware: operator-primary, worker later.
    key: "workspace-inbox",
    label: "Needs you",
    path: "/workspace/inbox",
    parentPath: "/workspace",
    domain: "workspace",
    audienceModes: ["worker", "operator"],
    destinationKind: "section-page",
    capabilityKey: null,
  },
  { key: "workspace-work-cases", label: "Work Cases", path: "/workspace/my-queue", parentPath: "/workspace", domain: "workspace", audienceModes: ["worker", "operator"], destinationKind: "section-page", capabilityKey: null },
  { key: "workspace-case-detail", label: "Work Case Detail", path: "/workspace/cases/[caseKey]", parentPath: "/workspace", domain: "workspace", audienceModes: ["worker", "operator"], destinationKind: "detail", capabilityKey: null },
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
    key: "workbooks",
    label: "Workbooks",
    path: "/workbooks",
    parentPath: "/workbooks",
    domain: "workspace",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_workbooks",
    // Demoted from the primary Workspace nav (EP-GRID-WORKBOOKS): the platform-data
    // grids now live in-place on their domain surfaces; the user-tables hub is
    // surfaced under Platform Hub (see platform-nav.ts). Record kept so links resolve.
    sectionSiblings: ["/workbooks"],
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
    // Disambiguate from the Marketing subnav's "Marketing Funnel": this is the
    // CRM deal-stage conversion funnel (BI-8AB9C904 duplicate-funnel confusion).
    sectionNavLabel: "Sales Funnel",
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
    // EP-COWORKER-IDENTITY-360 (DI-CB054DD6F79D): AI coworkers as identities,
    // beside People and Customers in the business section — not only inside the
    // platform-admin "AI Workforce" tooling. Lands on the existing directory;
    // each coworker's identity lives at /workforce/[agentId].
    key: "ai_coworkers",
    label: "AI Coworkers",
    path: "/workforce",
    parentPath: "/workforce",
    domain: "business",
    audienceModes: ["operator"],
    // Directory landing, like People (/employee). NB: the shell/page-purpose
    // destinationKind comes from ROUTE_AUDIENCE_OVERRIDES (section-home →
    // cockpit), which is a DIFFERENT enum from PortalDestinationKind here.
    destinationKind: "domain-home",
    capabilityKey: "view_platform",
    shellNav: {
      sectionKey: "business",
      description: "Your AI coworkers as identities — what they do, cost, engagements, and skills.",
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
    // Civic archetypes (BI-8D477188 Phase 3): public-body governance workflow.
    // Renders only when the org's archetype derives public-body-governance
    // active (towns, utilities, law enforcement — and member-owned boards
    // reuse the same surface via member-governance in a later slice).
    key: "governance",
    label: "Governance",
    path: "/governance",
    parentPath: "/governance",
    domain: "business",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_compliance",
    // Any-of: the surface serves council/open-meetings governance (public
    // bodies) AND board/annual-meeting governance (member-owned orgs,
    // BI-AFC178F3); the page adapts via the same capability activations.
    orgCapabilityKey: ["public-body-governance", "member-governance"],
    shellNav: {
      sectionKey: "business",
      description: "Meetings, agendas, minutes — council or board.",
    },
    sectionSiblings: ["/governance", "/governance/records-requests"],
  },
  {
    // Member equity & patronage ledger (BI-AFC178F3) — co-ops and, later,
    // member-owned utilities (capital credits).
    key: "member-equity",
    label: "Member Equity",
    path: "/member-equity",
    parentPath: "/member-equity",
    domain: "business",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_finance",
    orgCapabilityKey: "member-equity",
    shellNav: {
      sectionKey: "business",
      description: "Per-member equity, patronage allocations, and retirements.",
    },
  },
  {
    key: "governance-records-requests",
    label: "Records Requests",
    path: "/governance/records-requests",
    parentPath: "/governance",
    domain: "business",
    audienceModes: ["worker", "operator"],
    destinationKind: "section-page",
    capabilityKey: "view_compliance",
    orgCapabilityKey: "records-request",
  },
  {
    key: "service-requests",
    label: "Service Requests",
    path: "/service-requests",
    parentPath: "/service-requests",
    domain: "business",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_storefront",
    orgCapabilityKey: "service-request-311",
    shellNav: {
      sectionKey: "business",
      description: "Resident service requests routed to departments.",
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
    // Rental / shared-asset value stream (BI-EEA24A34 Phase 4): the operator
    // daily board for the reserve → checkout → return & inspect → re-pool
    // lifecycle. Renders only for rental archetypes (equipment rental,
    // self-storage, agricultural shared-machinery co-op) whose archetype
    // derives the rental capabilities — any-of fleet/agreements.
    key: "rental",
    label: "Rental Desk",
    path: "/rental",
    parentPath: "/rental",
    domain: "business",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_storefront",
    orgCapabilityKey: ["rental-fleet", "rental-agreements"],
    shellNav: {
      sectionKey: "business",
      description: "Reservations, checkouts, and returns for your asset pool.",
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
    path: "/ea",
    parentPath: "/ea",
    domain: "delivery",
    audienceModes: ["operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_ea_modeler",
    shellNav: {
      sectionKey: "products",
      description: "Capability map, value streams, EA views, and data architecture.",
    },
    sectionSiblings: [
      "/ea",
      "/ea/capabilities",
      "/ea/value-streams",
      "/ea/views",
      "/ea/models",
    ],
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
  platformAiRoute("platform-ai-readiness", "Readiness", "/platform/ai/readiness"),
  platformAiRoute("platform-ai-overview", "AI Workforce Directory", "/platform/ai/overview"),
  platformAiRoute("platform-ai-catalog", "Catalog", "/platform/ai/catalog"),
  {
    // BI-ARCH-DELIVERY-IA: one operator home for delivery work. A hub that
    // launches the delivery surfaces (Build Studio, work capsules, change lanes,
    // promotions, dev loop, self-upgrade status) — it does not own a second
    // tracking model; it links to the existing surfaces. Build Studio *config*
    // stays under Platform (/platform/ai/build-studio); the operator path for
    // *doing* delivery work is here (spec §6.3).
    key: "delivery",
    label: "Delivery",
    path: "/delivery",
    parentPath: "/delivery",
    domain: "delivery",
    audienceModes: ["operator"],
    destinationKind: "domain-home",
    capabilityKey: "view_platform",
    primaryOrder: 65,
    shellNav: {
      sectionKey: "delivery",
      description: "Build, ship, and track delivery work from one operator home.",
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
      // BI-ARCH-DELIVERY-IA: the Build Studio *work* surface belongs to the
      // Delivery rail section (it is already domain:"delivery"); model/provider
      // configuration stays under Platform at /platform/ai/build-studio.
      sectionKey: "delivery",
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
  { key: "platform-archetype-readiness", label: "Archetype Readiness", path: "/platform/archetype-readiness", parentPath: "/platform", domain: "platform", audienceModes: ["operator"], destinationKind: "section-page", capabilityKey: "view_platform" },
  {
    key: "platform-schedule",
    label: "Schedule",
    path: "/platform/schedule",
    parentPath: "/platform",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
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
    label: "AI Coworkers",
    path: "/platform/identity/agents",
    parentPath: "/platform/identity",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  platformAiRoute("platform-ai-operations-map", "Operations Map", "/platform/ai/operations-map"),
  // BI-1A68257F: the live workforce activity view (what coworkers are doing + did
  // today), a sibling altitude to the Operations Map.
  platformAiRoute("platform-ai-right-now", "Right Now", "/platform/ai/right-now"),
  // EP-GOLDEN-TRIANGLE surface consolidation: no "platform-ai-priority" record —
  // /platform/ai/priority is now a redirect-only shim into the unified
  // "Priority & Models" surface (mirrors /platform/ai/model-assignment, which
  // likewise has no nav record). Redirect-only routes carry neither a nav subItem
  // nor a record.
  platformAiRoute("platform-ai-capacity-continuity", "Capacity Continuity", "/platform/ai/capacity-continuity"),
  platformAiRoute("platform-ai-assignments", "Priority & Models", "/platform/ai/assignments"),
  platformAiRoute("platform-ai-prompts", "Prompts", "/platform/ai/prompts"),
  platformAiRoute("platform-ai-skills", "Skills", "/platform/ai/skills"),
  platformAiRoute("platform-ai-memory", "Coworker Memory", "/platform/ai/memory"),
  // Capability needs converged into the Backlog (EP-INTAKE-UNIFY); this route stays
  // known as a redirect shim without rendering an AI Operations tab.
  platformAiRoute("platform-ai-capability-needs", "Capability Needs", "/platform/ai/capability-needs", "legacy-redirect"),
  platformAiRoute("platform-ai-providers", "Providers & Routing", "/platform/ai/providers"),
  platformAiRoute("platform-ai-build-studio", "Build Runtime", "/platform/ai/build-studio", "settings"),
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
      "/platform/federation-links",
      "/platform/edge-nodes",
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
    // Peer-deployment federation ("Connections" page). Distinct from Identity
    // Federation (SSO) under /platform/identity/federation.
    key: "platform-federation-links",
    label: "Connections",
    path: "/platform/federation-links",
    parentPath: "/platform/tools",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "section-page",
    capabilityKey: "view_platform",
  },
  {
    // BI-2EC8906A: the route and six operator docs existed; the documented
    // path "Platform > Edge Nodes" did not. Matters most where node count > 1
    // (MSP: one per customer per site; retail: one per location).
    key: "platform-edge-nodes",
    label: "Edge Nodes",
    path: "/platform/edge-nodes",
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
    label: "Coworker Decision Engine",
    path: "/coworker-decisions",
    parentPath: "/coworker-decisions",
    domain: "knowledge",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    capabilityKey: null,
    shellNav: {
      sectionKey: "knowledge",
      description: "How your AI decides on your behalf - WWMD, WWWD, WSID - and where you shape it.",
    },
  },
  {
    key: "docs",
    label: "All docs",
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
    orgCapabilityKey: route.orgCapabilityKey ?? null,
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
