import { describe, expect, it, vi } from "vitest";

import { seedCompositionArtifacts } from "./seed-composition-artifacts";

describe("seedCompositionArtifacts", () => {
  it("uses one provenance-preserving path for primary and secondary templates", async () => {
    const itemCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const sectionCreateMany = vi.fn().mockResolvedValue({ count: 2 });
    const db = {
      storefrontItem: { createMany: itemCreateMany },
      storefrontSection: { createMany: sectionCreateMany },
    };

    const result = await seedCompositionArtifacts({
      db: db as never,
      storefrontId: "sf-1",
      compositionId: "comp-2",
      compositionSortOrder: 2,
      seedCurrency: "USD",
      revealContentSections: false,
      archetype: {
        ctaType: "purchase",
        itemTemplates: [
          {
            name: "Retail product",
            description: "A product",
            priceType: "fixed",
            priceAmount: 10,
          },
        ],
        sectionTemplates: [
          { type: "hero", title: "Hero", sortOrder: 0 },
          { type: "items", title: "Products", sortOrder: 1 },
        ],
      },
    });

    expect(result).toEqual({ items: 1, sections: 2 });
    expect(itemCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          storefrontId: "sf-1",
          sourceCompositionId: "comp-2",
          sortOrder: 2000,
          priceCurrency: "USD",
        }),
      ],
    });
    expect(sectionCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sourceCompositionId: "comp-2",
          sortOrder: 2000,
          isVisible: false,
        }),
        expect.objectContaining({
          sourceCompositionId: "comp-2",
          sortOrder: 2001,
          isVisible: false,
        }),
      ],
    });
  });
});
