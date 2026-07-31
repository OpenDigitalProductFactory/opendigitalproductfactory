import { BUILD_STUDIO_CONFIG_ROUTE_COPY } from "./build-studio-route-copy";

export type PlatformFamilyKey =
  | "overview"
  | "identity"
  | "ai"
  | "tools"
  | "audit";

export type PlatformFamily = {
  key: PlatformFamilyKey;
  label: string;
  href: string;
  description: string;
  matchPrefixes: string[];
  subItems: Array<{ label: string; href: string }>;
};

export const PLATFORM_FAMILIES: PlatformFamily[] = [
  {
    key: "overview",
    label: "Overview",
    href: "/platform",
    description: "Supervise platform operations from a small number of workflow hubs.",
    matchPrefixes: ["/platform"],
    subItems: [
      { label: "Platform Hub", href: "/platform" },
      { label: "Archetype Readiness", href: "/platform/archetype-readiness" },
      { label: "Schedule", href: "/platform/schedule" },
      { label: "Workbooks", href: "/workbooks" },
    ],
  },
  {
    key: "identity",
    label: "Identity & Access",
    href: "/platform/identity",
    description: "Manage principals, memberships, directory authorities, federation, and route-aware access from one control plane.",
    matchPrefixes: ["/platform/identity"],
    subItems: [
      { label: "Overview", href: "/platform/identity" },
      { label: "Principals", href: "/platform/identity/principals" },
      { label: "Groups", href: "/platform/identity/groups" },
      { label: "Directory", href: "/platform/identity/directory" },
      { label: "Federation", href: "/platform/identity/federation" },
      { label: "Applications", href: "/platform/identity/applications" },
      { label: "Authorization", href: "/platform/identity/authorization" },
      { label: "AI Coworkers", href: "/platform/identity/agents" },
    ],
  },
  {
    key: "ai",
    label: "AI Operations",
    href: "/platform/ai",
    description: "Manage coworkers, assignments, skills, providers, routing, and build runtime from one AI operations surface.",
    matchPrefixes: ["/platform/ai"],
    subItems: [
      // EP-26E528F5 (coworker UX carry-through): the workforce directory is the
      // family's front door — the AppRail "AI Workforce" entry lands on the
      // actual workforce (roster → per-coworker record), with the health
      // altitudes (Readiness, Operations Map) one tab away. /platform/ai
      // redirects here for the same reason.
      { label: "Workforce", href: "/platform/ai/overview" },
      { label: "Readiness", href: "/platform/ai/readiness" },
      { label: "Operations Map", href: "/platform/ai/operations-map" },
      { label: "Capacity Continuity", href: "/platform/ai/capacity-continuity" },
      // EP-GOLDEN-TRIANGLE surface consolidation: the everyday Cost/Quality/Time
      // priority and the advanced per-coworker model guardrails were two competing
      // tabs ("Priority" + "Assignments"). They merged into ONE surface — everyday
      // priority on top, advanced guardrails below — so there's one place to tune
      // how coworkers work. /platform/ai/priority now redirects here.
      { label: "Priority & Models", href: "/platform/ai/assignments" },
      { label: "Prompts", href: "/platform/ai/prompts" },
      { label: "Skills", href: "/platform/ai/skills" },
      { label: "Coworker Memory", href: "/platform/ai/memory" },
      // No "Capability Needs" tab: coworker capability needs converged into the Backlog
      // (EP-INTAKE-UNIFY) and /platform/ai/capability-needs now redirects to
      // /ops?origin=capability-need. A secondary-nav tab that redirects to /ops is a
      // cross-section jump (AI Operations → Backlog) — exactly the teleport founder
      // feedback (2026-06-22) flagged. Capability needs are seen + worked in /ops.
      { label: "Providers & Routing", href: "/platform/ai/providers" },
      { label: BUILD_STUDIO_CONFIG_ROUTE_COPY.navLabel, href: "/platform/ai/build-studio" },
    ],
  },
  {
    key: "tools",
    label: "Tools & Services",
    href: "/platform/tools",
    description: "Manage the connection lifecycle across catalog research, MCP services, native integrations, estate discovery, and runtime inventory.",
    matchPrefixes: [
      "/platform/tools",
      "/platform/integrations",
      "/platform/services",
    ],
    subItems: [
      { label: "Hub", href: "/platform/tools" },
      { label: "MCP Catalog", href: "/platform/tools/catalog" },
      { label: "MCP Services", href: "/platform/tools/services" },
      { label: "Native Integrations", href: "/platform/tools/integrations" },
      { label: "Built-in Tools", href: "/platform/tools/built-ins" },
      { label: "Estate Discovery", href: "/platform/tools/discovery" },
      { label: "Capability Inventory", href: "/platform/tools/inventory" },
    ],
  },
  {
    key: "audit",
    label: "Governance & Audit",
    href: "/platform/audit",
    description: "Trace approvals, actions, routes, and operational evidence.",
    matchPrefixes: ["/platform/audit"],
    subItems: [
      { label: "Hub", href: "/platform/audit" },
      { label: "Ledger", href: "/platform/audit/ledger" },
      { label: "Journal", href: "/platform/audit/journal" },
      { label: "Routes", href: "/platform/audit/routes" },
      { label: "Operations", href: "/platform/audit/operations" },
      { label: "Authority", href: "/platform/audit/authority" },
      { label: "Metrics", href: "/platform/audit/metrics" },
    ],
  },
  // NOTE: "Core Admin" was removed here (EP-NAV-COHERENCE keystone, BI-8866F144).
  // A secondary-nav tab pointing at /admin was a cross-domain teleport — clicking
  // it swapped the whole tab row to Admin's families with no way back, the exact
  // "you took them out of context with no path back" defect. Admin is reachable
  // from the persistent AppRail; P1 (BI-CB07C8BA) unifies Platform + Admin into
  // one operator console so the boundary stops being a context swap entirely.
];

export function getPlatformFamily(pathname: string): PlatformFamily {
  if (pathname === "/platform") {
    return PLATFORM_FAMILIES[0];
  }

  return (
    PLATFORM_FAMILIES.slice(1).find((family) =>
      family.matchPrefixes.some((prefix) => pathname.startsWith(prefix))
    ) ?? PLATFORM_FAMILIES[0]
  );
}
