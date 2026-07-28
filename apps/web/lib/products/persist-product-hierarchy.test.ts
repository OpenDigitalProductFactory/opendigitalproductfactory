import { describe, expect, it, vi } from "vitest";

import { persistProductHierarchy } from "./persist-product-hierarchy";

function makeDb() {
  const lineUpsert = vi
    .fn()
    .mockImplementation(({ create }) =>
      Promise.resolve({ id: `db-${create.lineId}`, lineId: create.lineId }),
    );
  const productUpsert = vi.fn().mockResolvedValue({ id: "product-db-id" });
  const updateMany = vi.fn().mockResolvedValue({ count: 0 });
  const compositionUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  return {
    db: {
      productLine: { upsert: lineUpsert, updateMany },
      product: { upsert: productUpsert, updateMany },
      storefrontArchetypeComposition: { updateMany: compositionUpdateMany },
    },
    lineUpsert,
    productUpsert,
    updateMany,
    compositionUpdateMany,
  };
}

describe("persistProductHierarchy", () => {
  it("upserts stable lines/products and binds matching compositions", async () => {
    const { db, lineUpsert, productUpsert, compositionUpdateMany } = makeDb();

    const result = await persistProductHierarchy({
      organizationId: "org-1",
      storefrontId: "sf-1",
      db: db as never,
      lines: [
        {
          key: "dining",
          label: "Dining",
          archetypeId: "restaurant",
          products: [{ key: "table-dining", label: "Table dining" }],
        },
      ],
    });

    expect(result).toEqual({ lineCount: 1, productCount: 1 });
    expect(lineUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lineId: "PL-org-1-dining" },
        update: expect.objectContaining({ name: "Dining", effectiveTo: null }),
        create: expect.objectContaining({
          organizationId: "org-1",
          lineId: "PL-org-1-dining",
          sourceKind: "storefront-setup",
        }),
      }),
    );
    expect(productUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { productId: "PR-org-1-dining-table-dining" },
      }),
    );
    expect(compositionUpdateMany).toHaveBeenCalledWith({
      where: {
        storefrontId: "sf-1",
        archetype: { archetypeId: "restaurant" },
        removedAt: null,
      },
      data: { productLineId: "db-PL-org-1-dining" },
    });
  });

  it("is replay-safe and retires only setup-owned rows no longer confirmed", async () => {
    const { db, updateMany } = makeDb();

    await persistProductHierarchy({
      organizationId: "org-1",
      storefrontId: "sf-1",
      db: db as never,
      lines: [{ key: "services", label: "Services", products: [] }],
    });
    await persistProductHierarchy({
      organizationId: "org-1",
      storefrontId: "sf-1",
      db: db as never,
      lines: [{ key: "services", label: "Services", products: [] }],
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          sourceKind: "storefront-setup",
          key: { notIn: ["services"] },
          effectiveTo: null,
        }),
      }),
    );
  });
});
