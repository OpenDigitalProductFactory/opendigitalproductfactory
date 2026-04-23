import { BUILD_STUDIO_CONFIG_ROUTE_COPY } from "./build-studio-route-copy";

export type PlatformFamilyKey =
  | "overview"
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
    key: "ai",
    label: "AI Operations",
    href: "/platform/ai",
    description: "Manage workforce, assignments, routing, skills, and AI operating health.",
    matchPrefixes: ["/platform/ai"],
    subItems: [
      { label: "Overview", href: "/platform/ai" },
      { label: "Assignments", href: "/platform/ai/assignments" },
      { label: "Routing & Calibration", href: "/platform/ai/providers" },
      { label: BUILD_STUDIO_CONFIG_ROUTE_COPY.navLabel, href: "/platform/ai/build-studio" },
      { label: "Operations", href: "/platform/ai/operations" },
      { label: "Authority", href: "/platform/ai/authority" },
      { label: "Skills", href: "/platform/ai/skills" },
    ],
  },
  {
    key: "tools",
    label: "Tools & Services",
    href: "/platform/tools",
    description: "Keep integrations, discovery operations, MCP services, and tool inventory healthy.",
    matchPrefixes: [
      "/platform/tools",
      "/platform/integrations",
      "/platform/services",
    ],
    subItems: [
      { label: "Hub", href: "/platform/tools" },
      { label: "Catalog", href: "/platform/tools/catalog" },
      { label: "Discovery Operations", href: "/platform/tools/discovery" },
      { label: "Services", href: "/platform/tools/services" },
      { label: "Enterprise Integrations", href: "/platform/tools/integrations/adp" },
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
