import { beforeEach, describe, expect, it, vi } from "vitest";

const { storefrontFindMany, seedMarketOffer } = vi.hoisted(() => ({
  storefrontFindMany: vi.fn(),
  seedMarketOffer: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: { findMany: storefrontFindMany },
  },
}));

vi.mock("./seed-market-offer", () => ({
  seedMarketOffer,
}));

import { backfillCommercialCatalogOnBoot } from "./backfill-commercial-catalog-on-boot";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("commercial catalog boot reconciliation", () => {
  it("is cheap for converged storefronts and reconciles only active unlinked projections", async () => {
    storefrontFindMany.mockResolvedValue([
      {
        id: "storefront-ready",
        organizationId: "org-ready",
        _count: { items: 0 },
      },
      {
        id: "storefront-needs-link",
        organizationId: "org-needs-link",
        _count: { items: 2 },
      },
    ]);
    seedMarketOffer.mockResolvedValue({
      seeded: false,
      alreadyPresent: true,
      productId: null,
      offeringCount: 2,
      linkedCatalogItemCount: 2,
      unresolvedCatalogItemCount: 0,
    });
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    await expect(backfillCommercialCatalogOnBoot(logger)).resolves.toEqual({
      storefrontsPresent: 1,
      storefrontsReconciled: 1,
      linked: 2,
      unresolved: 0,
      failed: 0,
    });

    expect(seedMarketOffer).toHaveBeenCalledTimes(1);
    expect(seedMarketOffer).toHaveBeenCalledWith({
      organizationId: "org-needs-link",
    });
    expect(storefrontFindMany).toHaveBeenCalledWith({
      select: {
        id: true,
        organizationId: true,
        _count: {
          select: {
            items: {
              where: {
                isActive: true,
                catalogItemId: null,
              },
            },
          },
        },
      },
    });
  });

  it("reports unresolved evidence without inventing catalog relationships", async () => {
    storefrontFindMany.mockResolvedValue([
      {
        id: "storefront-legacy",
        organizationId: "org-legacy",
        _count: { items: 1 },
      },
    ]);
    seedMarketOffer.mockResolvedValue({
      seeded: false,
      alreadyPresent: true,
      productId: null,
      offeringCount: 0,
      linkedCatalogItemCount: 0,
      unresolvedCatalogItemCount: 1,
    });
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const result = await backfillCommercialCatalogOnBoot(logger);

    expect(result).toMatchObject({ linked: 0, unresolved: 1, failed: 0 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("1 unresolved"),
    );
  });
});
