import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/mcp-catalog", () => ({
  runMcpCatalogSyncIfDue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/actions/connection-catalog", () => ({
  getConnectionCatalog: vi.fn().mockResolvedValue({
    totalCount: 3,
    counts: {
      mcp: 1,
      native: 1,
      builtIn: 1,
    },
    sections: [
      {
        kind: "mcp",
        title: "MCP Catalog",
        description: "Registry-backed MCP integrations",
        entries: [
          {
            kind: "mcp",
            id: "mcp-1",
            name: "Stripe MCP",
            description: "Payments connector",
            category: "finance",
            pricingModel: "free",
            vendor: "Stripe",
            documentationUrl: "https://example.com/docs",
            logoUrl: null,
            rating: 4.8,
            ratingCount: 120,
            isVerified: true,
            activeServerId: null,
          },
        ],
      },
      {
        kind: "native",
        title: "Native Integrations",
        description: "Native enterprise anchors",
        entries: [
          {
            kind: "native",
            id: "quickbooks",
            name: "QuickBooks Online",
            description: "Finance anchor",
            category: "finance",
            pricingModel: "paid",
            href: "/platform/tools/integrations/quickbooks",
            configured: true,
            statusLabel: "Configured",
            provider: "quickbooks",
            model: "native",
          },
        ],
      },
      {
        kind: "built_in",
        title: "Built-in Tools",
        description: "Platform-native tools",
        entries: [
          {
            kind: "built_in",
            id: "brave-search",
            name: "Brave Search",
            description: "Public web search",
            category: "built-in",
            pricingModel: "free",
            href: "/platform/tools/built-ins",
            configured: false,
            statusLabel: "Needs setup",
            configKey: "brave_search_api_key",
            capability: "search_public_web",
            model: "built-in",
          },
        ],
      },
    ],
  }),
}));

vi.mock("@/components/platform/IntegrationCatalogFilters", () => ({
  IntegrationCatalogFilters: () => <div>integration-catalog-filters</div>,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe("ToolsCatalogPage", () => {
  it("renders the cross-source connection catalog sections", async () => {
    const { default: ToolsCatalogPage } = await import("./page");
    const html = renderToStaticMarkup(
      await ToolsCatalogPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("Connection Catalog");
    expect(html).toContain("integration-catalog-filters");
    expect(html).toContain("MCP Catalog");
    expect(html).toContain("Native Integrations");
    expect(html).toContain("Built-in Tools");
    expect(html).toContain("QuickBooks Online");
    expect(html).toContain("Brave Search");
    expect(html).toContain("Stripe MCP");
  });
});
