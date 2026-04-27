import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    mcpIntegration: { findMany: vi.fn() },
    backlogItem: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn(), requireCap: vi.fn() }));
vi.mock("@/lib/semantic-memory", () => ({ storePlatformKnowledge: vi.fn() }));

import { prisma } from "@dpf/db";
import { executeTool } from "./mcp-tools";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([
    {
      id: "1", name: "Stripe", vendor: "Stripe Inc", slug: "stripe",
      shortDescription: "Payments API", category: "finance", pricingModel: "paid",
      rating: 4.8, ratingCount: 100, isVerified: true,
      documentationUrl: "https://stripe.com/docs", logoUrl: null, archetypeIds: ["retail-goods"],
      tags: ["payments"], rawMetadata: {},
    } as never,
  ]);
});

describe("executeTool — search_integrations", () => {
  it("queries mcpIntegration and returns results", async () => {
    const result = await executeTool("search_integrations", { query: "payments" }, "user-1");
    const data = result.data as
      | {
          results: Array<{
            benchmark: { recommendedTreatment: string };
            connectorProfile: { authModes: string[]; capabilities: string[] };
            nativeIntegration?: { route: string } | null;
          }>;
        }
      | undefined;
    expect(result.success).toBe(true);
    expect(data?.results).toHaveLength(1);
    expect(data?.results[0].benchmark.recommendedTreatment).toBe("native_first_class");
    expect(data?.results[0].connectorProfile.authModes).toContain("api_key_header");
    expect(data?.results[0].connectorProfile.capabilities).toContain("universal_api_call");
    expect(data?.results[0].nativeIntegration ?? null).toBeNull();
  });

  it("passes category filter to prisma query", async () => {
    await executeTool("search_integrations", { query: "pay", category: "finance" }, "user-1");
    expect(prisma.mcpIntegration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: "finance" }) })
    );
  });

  it("returns empty results gracefully when nothing found", async () => {
    vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([]);
    const result = await executeTool("search_integrations", { query: "nonexistent" }, "user-1");
    const data = result.data as { results: unknown[] } | undefined;
    expect(result.success).toBe(true);
    expect(data?.results).toHaveLength(0);
  });

  it("supports benchmark-aware filters for MSP results", async () => {
    vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([
      {
        id: "1", name: "NinjaOne", vendor: "NinjaOne", slug: "ninjaone",
        shortDescription: "RMM", category: "cloud", pricingModel: "paid",
        rating: 4.4, ratingCount: 20, isVerified: true,
        documentationUrl: "https://example.com", logoUrl: null, archetypeIds: ["professional-services"],
        tags: ["rmm", "endpoint"], rawMetadata: {},
      } as never,
      {
        id: "2", name: "HubSpot CRM", vendor: "HubSpot", slug: "hubspot-crm",
        shortDescription: "CRM", category: "crm", pricingModel: "paid",
        rating: 4.7, ratingCount: 40, isVerified: true,
        documentationUrl: "https://example.com", logoUrl: null, archetypeIds: ["professional-services"],
        tags: ["crm", "sales"], rawMetadata: {},
      } as never,
    ]);

    const result = await executeTool(
      "search_integrations",
      { query: "", businessProfile: "msp" },
      "user-1"
    );
    const data = result.data as
      | {
          results: Array<{
            name: string;
          }>;
        }
      | undefined;

    expect(result.success).toBe(true);
    expect(data?.results).toHaveLength(1);
    expect(data?.results[0].name).toBe("NinjaOne");
  });

  it("returns native integration routing for ADP search results", async () => {
    vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([
      {
        id: "1",
        name: "ADP Workforce Now",
        vendor: "ADP",
        slug: "adp-workforce-now",
        shortDescription: "Payroll and workers",
        category: "hr",
        pricingModel: "paid",
        rating: 4.1,
        ratingCount: 12,
        isVerified: true,
        documentationUrl: "https://example.com",
        logoUrl: null,
        archetypeIds: ["professional-services"],
        tags: ["adp", "payroll"],
        rawMetadata: {},
      } as never,
    ]);

    const result = await executeTool("search_integrations", { query: "adp" }, "user-1");
    const data = result.data as
      | {
          results: Array<{
            nativeIntegration?: { route: string } | null;
          }>;
        }
      | undefined;

    expect(result.success).toBe(true);
    expect(data?.results[0].nativeIntegration?.route).toBe("/platform/tools/integrations/adp");
  });
});
