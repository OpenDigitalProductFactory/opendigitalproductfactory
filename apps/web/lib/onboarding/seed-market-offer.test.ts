import { describe, expect, it, vi } from "vitest";

import { ALL_ARCHETYPES } from "@dpf/storefront-templates";
import { seedMarketOffer } from "./seed-market-offer";

const ORG = "org-test-1";
const archetype = ALL_ARCHETYPES.find((item) => item.archetypeId === "restaurant")!;

function makeDb(options: {
  existingLine?: { id: string } | null;
  storefront?: unknown;
} = {}) {
  const lineUpsert = vi
    .fn()
    .mockImplementation(({ create }) =>
      Promise.resolve({ id: `db-${create.lineId}`, lineId: create.lineId }),
    );
  const productUpsert = vi.fn().mockResolvedValue({});
  const db = {
    storefrontConfig: {
      findFirst: vi.fn().mockResolvedValue(
        options.storefront === undefined
          ? {
              id: "sf-1",
              archetype: {
                archetypeId: archetype.archetypeId,
                name: archetype.name,
                itemTemplates: archetype.itemTemplates,
                productMix: archetype.productMix,
              },
              archetypeCompositions: [
                {
                  role: "primary",
                  archetype: {
                    archetypeId: archetype.archetypeId,
                    name: archetype.name,
                    itemTemplates: archetype.itemTemplates,
                    productMix: archetype.productMix,
                  },
                },
              ],
            }
          : options.storefront,
      ),
    },
    productLine: {
      findFirst: vi.fn().mockResolvedValue(options.existingLine ?? null),
      upsert: lineUpsert,
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    product: {
      upsert: productUpsert,
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    storefrontArchetypeComposition: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { db, lineUpsert, productUpsert };
}

describe("seedMarketOffer", () => {
  it("reconciles confirmed composition evidence into business products", async () => {
    const { db, lineUpsert, productUpsert } = makeDb();

    const result = await seedMarketOffer({
      organizationId: ORG,
      db: db as never,
    });

    expect(result.seeded).toBe(true);
    expect(result.productId).toBeNull();
    expect(result.offeringCount).toBe(archetype.productMix!.primary.products.length);
    expect(lineUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          organizationId: ORG,
          key: "dining",
        }),
      }),
    );
    expect(productUpsert).toHaveBeenCalled();
    expect(JSON.stringify(productUpsert.mock.calls)).not.toMatch(
      /consumer|subscriber|entitlement/i,
    );
  });

  it("is a true no-op when the setup-owned hierarchy already exists", async () => {
    const { db, lineUpsert } = makeDb({ existingLine: { id: "line-1" } });

    expect(
      await seedMarketOffer({ organizationId: ORG, db: db as never }),
    ).toEqual({
      seeded: false,
      alreadyPresent: true,
      productId: null,
      offeringCount: 0,
    });
    expect(lineUpsert).not.toHaveBeenCalled();
  });

  it("does not fabricate an offer when storefront evidence is absent", async () => {
    const { db, lineUpsert } = makeDb({ storefront: null });

    expect(
      await seedMarketOffer({ organizationId: ORG, db: db as never }),
    ).toEqual({
      seeded: false,
      alreadyPresent: false,
      productId: null,
      offeringCount: 0,
    });
    expect(lineUpsert).not.toHaveBeenCalled();
  });
});
