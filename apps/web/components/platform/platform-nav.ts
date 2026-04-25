import { BUILD_STUDIO_CONFIG_ROUTE_COPY } from "./build-studio-route-copy";

export type PlatformFamilyKey =
  | "overview"
  | "identity"
  | "ai"
  | "tools"
  | "audit"
  | "admin";

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
    subItems: [{ label: "Platform Hub", href: "/platform" }],
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
      { label: "Agents", href: "/platform/identity/agents" },
    ],
  },
  {
    key: "ai",
    label: "AI Operations",
    href: "/platform/ai",
    description: "Manage coworkers, assignments, skills, providers, routing, and build runtime from one AI operations surface.",
    matchPrefixes: ["/platform/ai"],
    subItems: [
      { label: "Overview", href: "/platform/ai" },
      { label: "Assignments", href: "/platform/ai/assignments" },
      { label: "Prompts", href: "/platform/ai/prompts" },
      { label: "Skills", href: "/platform/ai/skills" },
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
  {
    key: "admin",
    label: "Core Admin",
    href: "/admin",
    description: "Reach controlled configuration work without turning Admin into a launchpad.",
    matchPrefixes: ["/admin"],
    subItems: [{ label: "Admin Home", href: "/admin" }],
  },
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
