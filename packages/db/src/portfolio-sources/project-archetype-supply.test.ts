import { describe, it, expect } from "vitest";

import { ARCHETYPE_SUPPLY_MANIFEST } from "./archetype-supply-manifest";
import {
  projectArchetypeSupply,
  type ProjectArchetypeSupplyClient,
} from "./project-archetype-supply";
import { PORTFOLIO_PROJECTION_KEYS, PROJECTED_BY } from "./types";

type ProductRow = {
  id: string;
  productId: string;
  name: string;
  description: string | null;
  portfolioId: string | null;
  taxonomyNodeId: string | null;
  lifecycleStage: string;
  lifecycleStatus: string;
  observationConfig: unknown;
};

const ALL_PORTFOLIOS = [
  "foundational",
  "manufacturing_and_delivery",
  "for_employees",
  "products_and_services_sold",
];

function makeFakeDb(opts: {
  archetypeId: string | null;
  portfolios?: string[];
}): ProjectArchetypeSupplyClient & { products: Map<string, ProductRow> } {
  const portfolios = new Map(
    (opts.portfolios ?? ALL_PORTFOLIOS).map((slug) => [slug, { id: `pf-${slug}` }]),
  );
  const products = new Map<string, ProductRow>();
  let seq = 0;

  return {
    products,
    storefrontConfig: {
      findFirst: async () => ({ archetypeId: opts.archetypeId }),
    },
    portfolio: {
      findUnique: async (args: unknown) => {
        const slug = (args as { where: { slug: string } }).where.slug;
        return portfolios.get(slug) ?? null;
      },
    },
    taxonomyNode: {
      findUnique: async () => null,
    },
    digitalProduct: {
      findUnique: async (args: unknown) => {
        const productId = (args as { where: { productId: string } }).where.productId;
        const row = products.get(productId);
        return row ? { id: row.id, observationConfig: row.observationConfig } : null;
      },
      create: async (args: unknown) => {
        const data = (args as { data: Record<string, unknown> }).data;
        const row: ProductRow = {
          id: `dp-${seq++}`,
          productId: data.productId as string,
          name: (data.name as string) ?? "",
          description: (data.description as string | null) ?? null,
          portfolioId: (data.portfolioId as string | null) ?? null,
          taxonomyNodeId: (data.taxonomyNodeId as string | null) ?? null,
          lifecycleStage: (data.lifecycleStage as string) ?? "plan",
          lifecycleStatus: (data.lifecycleStatus as string) ?? "draft",
          observationConfig: data.observationConfig ?? null,
        };
        products.set(row.productId, row);
        return row;
      },
      update: async (args: unknown) => {
        const a = args as { where: { productId: string }; data: Record<string, unknown> };
        const row = products.get(a.where.productId);
        if (!row) throw new Error(`update: not found ${a.where.productId}`);
        Object.assign(row, a.data);
        return row;
      },
    },
  };
}

describe("ARCHETYPE_SUPPLY_MANIFEST", () => {
  it("covers the plumber's trades-maintenance category with suppliers + goods", () => {
    const trades = ARCHETYPE_SUPPLY_MANIFEST["trades-maintenance"];
    expect(trades).toBeTruthy();
    expect(trades!.suppliers.length).toBeGreaterThan(0);
    expect(trades!.suppliers.some((s) => /merchant|wholesal/i.test(s.name))).toBe(true);
    expect(trades!.goods.length).toBeGreaterThan(0);
  });

  it("every starter item has a non-empty name", () => {
    for (const starter of Object.values(ARCHETYPE_SUPPLY_MANIFEST)) {
      for (const item of [...starter!.suppliers, ...starter!.goods]) {
        expect(item.name.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("projectArchetypeSupply", () => {
  it("projects plumber suppliers → Manufacturing & Delivery and goods → Products & Services Sold", async () => {
    const db = makeFakeDb({ archetypeId: "plumber" });
    const res = await projectArchetypeSupply({ organizationId: "org-1", db });

    expect(res.archetypeId).toBe("plumber");
    expect(res.created).toBeGreaterThan(0);

    const suppliers = [...db.products.values()].filter((p) => p.productId.startsWith("sup-org-1-"));
    expect(suppliers.length).toBeGreaterThan(0);
    expect(suppliers.every((r) => r.portfolioId === "pf-manufacturing_and_delivery")).toBe(true);
    const supCfg = suppliers[0].observationConfig as Record<string, string>;
    expect(supCfg[PORTFOLIO_PROJECTION_KEYS.sourceKind]).toBe("archetype");
    expect(supCfg[PORTFOLIO_PROJECTION_KEYS.coverageStatus]).toBe("used");
    expect(supCfg[PORTFOLIO_PROJECTION_KEYS.projectedBy]).toBe(PROJECTED_BY);

    const goods = [...db.products.values()].filter((p) => p.productId.startsWith("good-org-1-"));
    expect(goods.length).toBeGreaterThan(0);
    expect(goods.every((r) => r.portfolioId === "pf-products_and_services_sold")).toBe(true);
    expect((goods[0].observationConfig as Record<string, string>)[PORTFOLIO_PROJECTION_KEYS.coverageStatus]).toBe("sold");
  });

  it("no-ops when the org has no archetype", async () => {
    const db = makeFakeDb({ archetypeId: null });
    const res = await projectArchetypeSupply({ organizationId: "org-1", db });
    expect(res.archetypeId).toBeNull();
    expect(res.created).toBe(0);
    expect(db.products.size).toBe(0);
  });

  it("no-ops for an archetype with no starter manifest", async () => {
    const db = makeFakeDb({ archetypeId: "does-not-exist-xyz" });
    const res = await projectArchetypeSupply({ organizationId: "org-1", db });
    expect(res.archetypeId).toBe("does-not-exist-xyz");
    expect(res.created).toBe(0);
    expect(db.products.size).toBe(0);
  });

  it("is idempotent — re-projection updates owned rows and creates no duplicates", async () => {
    const db = makeFakeDb({ archetypeId: "plumber" });
    await projectArchetypeSupply({ organizationId: "org-1", db });
    const sizeAfterFirst = db.products.size;

    const second = await projectArchetypeSupply({ organizationId: "org-1", db });
    expect(second.created).toBe(0);
    expect(second.updated).toBeGreaterThan(0);
    expect(db.products.size).toBe(sizeAfterFirst);
  });
});
