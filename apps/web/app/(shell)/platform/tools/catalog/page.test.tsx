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

vi.mock("@/lib/actions/tool-marketplace-readiness", () => ({
  getToolMarketplaceReadiness: vi.fn().mockResolvedValue({
    summary: {
      total: 4,
      ready: 1,
      available: 1,
      needsSetup: 1,
      needsGrant: 1,
      blocked: 0,
    },
    entries: [
      {
        id: "adp",
        kind: "native",
        name: "ADP Workforce Now",
        description: "Payroll anchor",
        category: "hr",
        readiness: "needs_grant",
        readinessLabel: "Needs grant",
        guidance: "ADP is configured, but this coworker still needs the required grant before using it.",
        href: "/platform/tools/integrations/adp",
        enables: ["Payroll guidance"],
        missingSetup: [],
        missingGrants: ["consumer_read"],
        relevantAgentIds: ["finance-controller", "coo"],
      },
      {
        id: "build-studio-frontier-tool-model",
        kind: "model_requirement",
        name: "Build Studio Frontier Tool Model",
        description: "Build Studio model requirement",
        category: "model-routing",
        readiness: "needs_setup",
        readinessLabel: "Needs setup",
        guidance: "Build Studio implementation needs an active frontier, tool-capable model.",
        href: "/platform/ai/providers",
        enables: ["Build Studio implementation"],
        missingSetup: ["Activate a frontier, tool-capable model provider"],
        missingGrants: [],
        relevantAgentIds: ["build-specialist", "coo"],
      },
    ],
  }),
}));

vi.mock("@/components/platform/IntegrationCatalogFilters", () => ({
  IntegrationCatalogFilters: () => <div>Search tools, integrations, or tasks Any readiness Build Studio</div>,
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

    expect(html).toContain("Agent Tool Marketplace");
    expect(html).toContain("Search tools, integrations, or tasks");
    expect(html).toContain("Any readiness");
    expect(html).toContain("Build Studio");
    expect(html).toContain("MCP Catalog");
    expect(html).toContain("Native Integrations");
    expect(html).toContain("Built-in Tools");
    expect(html).toContain("Coworker Readiness");
    expect(html).toContain("ADP Workforce Now");
    expect(html).toContain("consumer_read");
    expect(html).toContain("Build Studio Frontier Tool Model");
    expect(html).toContain("QuickBooks Online");
    expect(html).toContain("Brave Search");
    expect(html).toContain("Stripe MCP");
  });
});
