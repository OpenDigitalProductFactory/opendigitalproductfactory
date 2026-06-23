import { describe, it, expect } from "vitest";

import {
  attributeBacklogPortfolio,
  backfillBacklogPortfolios,
  getBacklogByPortfolio,
  resolveBacklogPortfolio,
  type BacklogPortfolioClient,
} from "./backlog-portfolio";

type Item = {
  id: string;
  portfolioId: string | null;
  status?: string;
  effortSize?: string | null;
  digitalProduct?: { portfolioId: string | null } | null;
  taxonomyNode?: { portfolioId: string | null } | null;
  epic?: { portfolios?: Array<{ portfolioId: string }> } | null;
};

function makeFakeDb(items: Item[]): BacklogPortfolioClient & { items: Item[] } {
  return {
    items,
    backlogItem: {
      findUnique: async (args: unknown) => {
        const id = (args as { where: { id: string } }).where.id;
        return items.find((i) => i.id === id) ?? null;
      },
      findMany: async (args: unknown) => {
        const where = (args as { where?: { status?: { in: string[] } } }).where;
        if (where?.status?.in) {
          const set = new Set(where.status.in);
          return items.filter((i) => i.status !== undefined && set.has(i.status));
        }
        return items;
      },
      update: async (args: unknown) => {
        const a = args as { where: { id: string }; data: { portfolioId: string | null } };
        const it = items.find((i) => i.id === a.where.id);
        if (it) it.portfolioId = a.data.portfolioId;
        return it;
      },
    },
  };
}

describe("resolveBacklogPortfolio", () => {
  it("prefers product, then taxonomy node, then epic, else null", () => {
    expect(
      resolveBacklogPortfolio({
        digitalProduct: { portfolioId: "p-prod" },
        taxonomyNode: { portfolioId: "p-tax" },
        epic: { portfolios: [{ portfolioId: "p-epic" }] },
      }),
    ).toBe("p-prod");
    expect(
      resolveBacklogPortfolio({ digitalProduct: { portfolioId: null }, taxonomyNode: { portfolioId: "p-tax" } }),
    ).toBe("p-tax");
    expect(resolveBacklogPortfolio({ epic: { portfolios: [{ portfolioId: "p-epic" }] } })).toBe("p-epic");
    expect(resolveBacklogPortfolio({})).toBeNull();
  });
});

describe("attributeBacklogPortfolio", () => {
  it("sets portfolioId from links and is a no-op when unchanged", async () => {
    const db = makeFakeDb([{ id: "i1", portfolioId: null, digitalProduct: { portfolioId: "p-prod" } }]);
    expect(await attributeBacklogPortfolio("i1", { db })).toBe("p-prod");
    expect(db.items[0].portfolioId).toBe("p-prod");
    expect(await attributeBacklogPortfolio("i1", { db })).toBe("p-prod");
  });

  it("returns null for a missing item", async () => {
    const db = makeFakeDb([]);
    expect(await attributeBacklogPortfolio("nope", { db })).toBeNull();
  });
});

describe("backfillBacklogPortfolios", () => {
  it("attributes resolvable items, skipping already-correct and unresolvable", async () => {
    const db = makeFakeDb([
      { id: "a", portfolioId: null, taxonomyNode: { portfolioId: "p-tax" } },
      { id: "b", portfolioId: "p-prod", digitalProduct: { portfolioId: "p-prod" } },
      { id: "c", portfolioId: null },
    ]);
    const res = await backfillBacklogPortfolios({ db });
    expect(res.scanned).toBe(3);
    expect(res.updated).toBe(1);
    expect(db.items.find((i) => i.id === "a")!.portfolioId).toBe("p-tax");
    expect(db.items.find((i) => i.id === "c")!.portfolioId).toBeNull();
  });
});

describe("getBacklogByPortfolio", () => {
  it("groups by portfolio with counts + effort breakdown, honoring a status filter", async () => {
    const db = makeFakeDb([
      { id: "1", portfolioId: "pf-a", status: "open", effortSize: "small" },
      { id: "2", portfolioId: "pf-a", status: "open", effortSize: "large" },
      { id: "3", portfolioId: "pf-b", status: "done", effortSize: "small" },
      { id: "4", portfolioId: null, status: "open", effortSize: null },
    ]);

    const all = await getBacklogByPortfolio({ db });
    const a = all.find((g) => g.portfolioId === "pf-a")!;
    expect(a.count).toBe(2);
    expect(a.effortBreakdown).toEqual({ small: 1, large: 1 });
    expect(all.find((g) => g.portfolioId === null)!.count).toBe(1);

    const open = await getBacklogByPortfolio({ db, statuses: ["open"] });
    expect(open.find((g) => g.portfolioId === "pf-b")).toBeUndefined();
  });
});
