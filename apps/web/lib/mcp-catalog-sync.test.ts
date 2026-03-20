import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    mcpIntegration: {
      upsert: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    mcpCatalogSync: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { emit: vi.fn() },
}));

import { prisma } from "@dpf/db";
import { runMcpCatalogSync } from "./mcp-catalog-sync";

const mockRegistryPage1 = {
  servers: [
    { id: "stripe-mcp", name: "Stripe", description: "Payments", tags: ["payments"], category: "finance", isVerified: true },
    { id: "wp-mcp", name: "WordPress", description: "CMS", tags: ["cms", "wordpress"], category: "cms", isVerified: false },
  ],
  nextCursor: null,
};

// Use the ACTUAL GlamaServerEntry shape (nested stats/pricing)
const mockGlamaStripe = {
  id: "stripe-mcp",
  logoUrl: "https://example.com/stripe.png",
  stats: { rating: 4.8, ratingCount: 120, installCount: 5000 },
  pricing: { model: "paid" },
};
const mockGlamaWp = {
  id: "wp-mcp",
  logoUrl: "https://example.com/wp.png",
  stats: { rating: 4.2, ratingCount: 80, installCount: 3000 },
  pricing: { model: "free" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.mcpIntegration.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.mcpIntegration.updateMany).mockResolvedValue({ count: 0 } as never);
  vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([]);
  vi.mocked(prisma.mcpCatalogSync.update).mockResolvedValue({} as never);

  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    if (url.includes("registry.modelcontextprotocol.io")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockRegistryPage1) });
    }
    if (url.includes("glama.ai") && url.includes("stripe-mcp")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockGlamaStripe) });
    }
    if (url.includes("glama.ai") && url.includes("wp-mcp")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockGlamaWp) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  }));
});

describe("runMcpCatalogSync", () => {
  it("fetches from registry and upserts entries", async () => {
    await runMcpCatalogSync("sync-1");
    expect(prisma.mcpIntegration.upsert).toHaveBeenCalledTimes(2);
  });

  it("upserts Stripe with enriched Glama data", async () => {
    await runMcpCatalogSync("sync-1");
    const stripeCall = vi.mocked(prisma.mcpIntegration.upsert).mock.calls.find(
      (c) => c[0].where.registryId === "stripe-mcp"
    );
    expect(stripeCall).toBeDefined();
    expect(stripeCall![0].create.logoUrl).toBe("https://example.com/stripe.png");
    expect(Number(stripeCall![0].create.rating)).toBe(4.8);
    expect(stripeCall![0].create.pricingModel).toBe("paid");
  });

  it("derives archetypeIds from tags", async () => {
    await runMcpCatalogSync("sync-1");
    const stripeCall = vi.mocked(prisma.mcpIntegration.upsert).mock.calls.find(
      (c) => c[0].where.registryId === "stripe-mcp"
    );
    expect(stripeCall![0].create.archetypeIds).toContain("retail-goods");
  });

  it("marks entries absent from sync as deprecated", async () => {
    vi.mocked(prisma.mcpIntegration.findMany).mockResolvedValue([
      { registryId: "old-mcp" } as never,
    ]);
    await runMcpCatalogSync("sync-1");
    expect(prisma.mcpIntegration.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "active" }),
        data: { status: "deprecated" },
      })
    );
  });

  it("updates sync record to success on completion", async () => {
    await runMcpCatalogSync("sync-1");
    expect(prisma.mcpCatalogSync.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sync-1" },
        data: expect.objectContaining({ status: "success" }),
      })
    );
  });

  it("updates sync record to failed on fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    await runMcpCatalogSync("sync-1");
    expect(prisma.mcpCatalogSync.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed", error: "Network error" }),
      })
    );
  });
});
