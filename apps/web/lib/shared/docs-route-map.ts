export type DocsRouteMatch = {
  route: string;
  slug: string;
  label: string;
};

export type DocsTarget = {
  href: string;
  slug: string | null;
  label: string;
  sourcePath: string | null;
  matched: boolean;
};

export const DOC_ROUTE_MATCHERS: DocsRouteMatch[] = [
  { route: "/platform/ai", slug: "ai-workforce/index", label: "AI Workforce" },
  { route: "/platform/tools", slug: "platform/index", label: "Platform Tools" },
  { route: "/platform/identity", slug: "platform/index", label: "Platform Identity" },
  { route: "/platform/audit", slug: "platform/index", label: "Platform Audit" },
  { route: "/platform", slug: "platform/index", label: "Platform" },
  { route: "/storefront", slug: "storefront/index", label: "Storefront" },
  { route: "/admin/storefront", slug: "storefront/index", label: "Storefront" },
  { route: "/admin", slug: "admin/index", label: "Admin" },
  { route: "/build", slug: "build-studio/index", label: "Build Studio" },
  { route: "/complaints", slug: "complaints/index", label: "Complaints" },
  { route: "/compliance", slug: "compliance/index", label: "Compliance" },
  { route: "/customer", slug: "customers/index", label: "Customers" },
  { route: "/ea", slug: "architecture/index", label: "Enterprise Architecture" },
  { route: "/employee", slug: "hr/index", label: "HR & Workforce" },
  { route: "/finance/spend/ai", slug: "finance/ai-spend", label: "AI Spend" },
  { route: "/finance", slug: "finance/index", label: "Finance" },
  { route: "/inventory", slug: "inventory/index", label: "Inventory" },
  { route: "/knowledge", slug: "knowledge/index", label: "Knowledge" },
  { route: "/ops", slug: "operations/index", label: "Operations" },
  { route: "/portfolio/product", slug: "products/index", label: "Products" },
  { route: "/portfolio", slug: "portfolios/index", label: "Portfolios" },
  { route: "/workspace", slug: "workspace/index", label: "Workspace" },
];

function normalizePath(pathname: string): string {
  const [pathOnly = ""] = pathname.split(/[?#]/);
  const withSlash = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

function routeMatches(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function resolveDocsTarget(pathname: string | null | undefined): DocsTarget {
  const sourcePath = normalizePath(pathname ?? "/");
  if (sourcePath === "/docs" || sourcePath.startsWith("/docs/")) {
    return {
      href: "/docs",
      slug: null,
      label: "Documentation",
      sourcePath: null,
      matched: false,
    };
  }

  const match = DOC_ROUTE_MATCHERS.find((candidate) => routeMatches(sourcePath, candidate.route));
  if (!match) {
    return {
      href: `/docs?from=${encodeURIComponent(sourcePath)}`,
      slug: null,
      label: "Documentation",
      sourcePath,
      matched: false,
    };
  }

  return {
    href: `/docs/${match.slug}?from=${encodeURIComponent(sourcePath)}`,
    slug: match.slug,
    label: match.label,
    sourcePath,
    matched: true,
  };
}

export function getMappedDocSlugs(): string[] {
  return [...new Set(DOC_ROUTE_MATCHERS.map((matcher) => matcher.slug))].sort();
}
