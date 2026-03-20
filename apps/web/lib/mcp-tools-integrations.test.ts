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
    } as never,
  ]);
});

describe("executeTool — search_integrations", () => {
  it("queries mcpIntegration and returns results", async () => {
    const result = await executeTool("search_integrations", { query: "payments" }, "user-1");
    expect(result.success).toBe(true);
    expect(result.data?.results).toHaveLength(1);
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
    expect(result.success).toBe(true);
    expect(result.data?.results).toHaveLength(0);
  });
});
