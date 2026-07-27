import { describe, expect, it, vi } from "vitest";

import { ALL_ARCHETYPES } from "@dpf/storefront-templates";
import { seedMarketOffer } from "./seed-market-offer";

const ORG = "org-test-1";

// A real archetype carrying a market offer, so the derive step exercises the
// actual itemTemplates → ServiceOffering mapping.
const archetype = ALL_ARCHETYPES.find((a) => a.itemTemplates.length > 0)!;
const ARCHETYPE_ID = archetype.archetypeId;
const ITEM_COUNT = archetype.itemTemplates.length;

function makeDb(opts: {
  archetypeId?: string | null;
  portfolio?: { id: string } | null;
  existingProduct?: { id: string } | null;
}) {
  const create = vi.fn().mockResolvedValue({ id: "dp-cuid" });
  const upsert = vi.fn().mockResolvedValue({});
  const db = {
    storefrontConfig: {
      findFirst: vi.fn().mockResolvedValue(
        opts.archetypeId === undefined ? { archetypeId: ARCHETYPE_ID } : { archetypeId: opts.archetypeId },
      ),
    },
    portfolio: {
      findUnique: vi
        .fn()
        .mockResolvedValue(opts.portfolio === undefined ? { id: "port-cuid" } : opts.portfolio),
    },
    digitalProduct: {
      findUnique: vi.fn().mockResolvedValue(opts.existingProduct ?? null),
      create,
    },
    serviceOffering: { upsert },
  };
  return { db, create, upsert };
}

describe("seedMarketOffer (BI-4503E6B9)", () => {
  it("seeds an offer product + one ServiceOffering per archetype item", async () => {
    const { db, create, upsert } = makeDb({});

    const result = await seedMarketOffer({ organizationId: ORG, db: db as never });

    expect(result.seeded).toBe(true);
    expect(result.alreadyPresent).toBe(false);
    expect(result.productId).toBe(`DP-MARKET-OFFER-${ORG}`);
    expect(result.offeringCount).toBe(ITEM_COUNT);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: `DP-MARKET-OFFER-${ORG}`,
          name: archetype.name,
          portfolioId: "port-cuid",
          lifecycleStage: "production",
          lifecycleStatus: "active",
        }),
      }),
    );
    expect(upsert).toHaveBeenCalledTimes(ITEM_COUNT);
    // offerings reference the created product and carry external consumers
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          digitalProductId: "dp-cuid",
          consumers: ["external"],
          status: "active",
        }),
      }),
    );
  });

  it("is non-destructive when the offer product already exists", async () => {
    const { db, create, upsert } = makeDb({ existingProduct: { id: "dp-existing" } });

    const result = await seedMarketOffer({ organizationId: ORG, db: db as never });

    expect(result).toEqual({
      seeded: false,
      alreadyPresent: true,
      productId: `DP-MARKET-OFFER-${ORG}`,
      offeringCount: 0,
    });
    expect(create).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("no-ops when the install has no archetype", async () => {
    const { db, create } = makeDb({ archetypeId: null });

    const result = await seedMarketOffer({ organizationId: ORG, db: db as never });

    expect(result.seeded).toBe(false);
    expect(result.productId).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it("no-ops for an unknown archetype id", async () => {
    const { db, create } = makeDb({ archetypeId: "no-such-archetype" });

    const result = await seedMarketOffer({ organizationId: ORG, db: db as never });

    expect(result.seeded).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("no-ops when the Goods and Services for Sale portfolio is missing", async () => {
    const { db, create } = makeDb({ portfolio: null });

    const result = await seedMarketOffer({ organizationId: ORG, db: db as never });

    expect(result.seeded).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
