import { describe, expect, it, vi } from "vitest";

import { upsertWikiPage } from "./wiki-store";

describe("wiki stance projection persistence", () => {
  it("persists dimensions without acquiring principle authority", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: "wp_stance" });
    const db = {
      wikiPage: {
        findFirst, create, update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(),
      },
    };
    await upsertWikiPage(db, {
      slug: "stances/market-boundary",
      title: "Market boundary",
      body: "We serve MSP partners, not consumer retail markets.",
      pageKind: "stance",
      isKernel: false,
      principleDimensionVector: { market_fit: 0.4, product_fit: 0.4 },
      principleDimensions: ["market_fit", "product_fit"],
    });
    const data = create.mock.calls[0][0].data;
    expect(data).toEqual(expect.objectContaining({
      pageKind: "stance",
      principleDimensionVector: { market_fit: 0.4, product_fit: 0.4 },
      principleDimensions: ["market_fit", "product_fit"],
    }));
    expect(data).not.toHaveProperty("principleTier");
    expect(data).not.toHaveProperty("principleAppliesTo");
  });
});
