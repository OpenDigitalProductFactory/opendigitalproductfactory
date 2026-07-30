import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveAuthority: vi.fn(),
  findDigital: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@dpf/db", () => ({
  INVENTORY_ENTITY_CANONICAL_WHERE: { supersededById: null },
  prisma: {
    digitalProduct: {
      findUnique: mocks.findDigital,
    },
  },
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: mocks.redirect,
}));

vi.mock(
  "@/lib/product-management/current-product-operating-context.server",
  () => ({
    resolveCurrentProductRouteAuthority: mocks.resolveAuthority,
  }),
);

vi.mock("@/components/ui/LocalTime", () => ({
  LocalTime: ({ value }: { value: Date }) => (
    <time>{value.toISOString()}</time>
  ),
}));

import ProductOverviewPage from "./page";

beforeEach(() => {
  mocks.resolveAuthority.mockReset();
  mocks.findDigital.mockReset();
  mocks.redirect.mockClear();
});

describe("product overview compatibility route", () => {
  it("redirects a business Product to Direction without querying DigitalProduct detail", async () => {
    mocks.resolveAuthority.mockResolvedValue({
      kind: "business-product",
      product: { id: "business-1" },
    });

    await expect(
      ProductOverviewPage({
        params: Promise.resolve({ id: "business-1" }),
      }),
    ).rejects.toThrow(
      "REDIRECT:/portfolio/product/business-1/direction",
    );
    expect(mocks.findDigital).not.toHaveBeenCalled();
  });

  it("preserves the existing DigitalProduct overview", async () => {
    const now = new Date("2026-07-28T20:00:00.000Z");
    mocks.resolveAuthority.mockResolvedValue({
      kind: "digital-product",
      product: { id: "digital-1" },
    });
    mocks.findDigital.mockResolvedValue({
      id: "digital-1",
      productId: "DP-1",
      name: "Booking portal",
      createdAt: now,
      updatedAt: now,
      lifecycleStage: "operate",
      lifecycleStatus: "active",
      version: "1.0.0",
      portfolio: { name: "Foundational" },
      taxonomyNode: { name: "Booking" },
      _count: {
        backlogItems: 1,
        inventoryEntities: 2,
        eaElements: 3,
        versions: 4,
        serviceOfferings: 5,
        featureBuilds: 6,
        businessModels: 7,
        knowledgeArticles: 8,
      },
    });

    const html = renderToStaticMarkup(
      await ProductOverviewPage({
        params: Promise.resolve({ id: "digital-1" }),
      }),
    );

    expect(html).toContain("Product Details");
    expect(html).toContain("Backlog Items");
    expect(mocks.findDigital).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "digital-1" } }),
    );
  });
});
