import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/mcp-catalog", () => ({
  queryMcpIntegrations: vi.fn(),
}));

vi.mock("@/lib/actions/built-in-tools", () => ({
  getBuiltInToolsOverview: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    mcpServer: {
      findMany: vi.fn(),
    },
    integrationCredential: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { queryMcpIntegrations } from "@/lib/actions/mcp-catalog";
import { getBuiltInToolsOverview } from "@/lib/actions/built-in-tools";
import { getConnectionCatalog } from "./connection-catalog";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queryMcpIntegrations).mockResolvedValue([
    {
      id: "mcp-1",
      name: "Stripe MCP",
      vendor: "Stripe",
      shortDescription: "Payments MCP integration",
      category: "finance",
      pricingModel: "free",
      rating: 4.8,
      ratingCount: 120,
      isVerified: true,
      documentationUrl: "https://example.com/docs",
      logoUrl: null,
      archetypeIds: [],
    },
  ] as never);
  vi.mocked(prisma.mcpServer.findMany).mockResolvedValue([
    { integrationId: "mcp-1", id: "server-1" },
  ] as never);
  vi.mocked(getBuiltInToolsOverview).mockResolvedValue({
    tools: [
      {
        id: "brave-search",
        name: "Brave Search",
        description: "Public web search",
        model: "built-in",
        configKey: "brave_search_api_key",
        configured: false,
        capability: "search_public_web",
      },
    ],
    keyData: {
      brave_search_api_key: {
        configured: false,
        currentValue: null,
      },
    },
    addressValidation: {
      commercialProviderDetected: false,
      siteLookupReady: false,
      headline: "No address validation provider is configured.",
      nextStep: "Choose Smarty or Mapbox.",
      primaryCountry: null,
    },
  });
  vi.mocked(prisma.integrationCredential.findMany).mockResolvedValue([
    { integrationId: "quickbooks-online-accounting", status: "connected" },
    { integrationId: "adp-workforce-now", status: "error" },
  ] as never);
});

describe("getConnectionCatalog", () => {
  it("aggregates MCP, native, and built-in entries into separate sections", async () => {
    const result = await getConnectionCatalog({ query: "" });

    expect(result.totalCount).toBe(18);
    expect(result.counts).toEqual({ mcp: 1, native: 16, builtIn: 1 });
    expect(result.sections.map((section) => section.title)).toEqual([
      "MCP Catalog",
      "Native Integrations",
      "Built-in Tools",
    ]);
    expect(result.sections[0].entries[0]).toMatchObject({
      kind: "mcp",
      name: "Stripe MCP",
      activeServerId: "server-1",
    });
    expect(result.sections[1].entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "native", id: "adp", statusLabel: "Needs attention" }),
        expect.objectContaining({ kind: "native", id: "quickbooks", statusLabel: "Configured" }),
        expect.objectContaining({ kind: "native", id: "facebook-pages", name: "Facebook Pages" }),
        expect.objectContaining({ kind: "native", id: "google-business-profile", name: "Google Business Profile" }),
        expect.objectContaining({ kind: "native", id: "whatsapp-business", name: "WhatsApp Business" }),
        expect.objectContaining({ kind: "native", id: "instagram-business", name: "Instagram Business" }),
      ]),
    );
    expect(result.sections[2].entries[0]).toMatchObject({
      kind: "built_in",
      name: "Brave Search",
      statusLabel: "Needs setup",
    });
  });

  it("applies search filtering to native and built-in entries while delegating MCP filtering", async () => {
    const result = await getConnectionCatalog({ query: "brave" });

    expect(result.counts).toEqual({ mcp: 1, native: 0, builtIn: 1 });
    expect(result.sections[1].entries).toHaveLength(0);
    expect(result.sections[2].entries[0]).toMatchObject({ id: "brave-search" });
    expect(queryMcpIntegrations).toHaveBeenCalledWith(
      expect.objectContaining({ query: "brave" }),
    );
  });
});
