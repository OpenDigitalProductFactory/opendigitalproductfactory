import { describe, expect, it, vi } from "vitest";

import { BOM_WORKFORCE_SURFACE_MANIFEST } from "./bom-workforce-surface-manifest";
import { projectBomWorkforceSurfaces } from "./project-bom-workforce-surfaces";
import { PORTFOLIO_PROJECTION_KEYS, PROJECTED_BY } from "./types";

type ProductRow = { id: string; productId: string; observationConfig: Record<string, unknown> };

function makeDb() {
  const products = new Map<string, ProductRow & Record<string, unknown>>();
  return {
    _products: products,
    portfolio: { findUnique: vi.fn(async () => ({ id: "port-fe" })) },
    taxonomyNode: {
      // Resolve the financial_management node; everything else sits at root.
      findUnique: vi.fn(async (args: { where: { nodeId: string } }) =>
        args.where.nodeId === "for_employees/financial_management" ? { id: "tax-node" } : null,
      ),
    },
    digitalProduct: {
      findUnique: vi.fn(async (args: { where: { productId: string } }) => {
        const r = products.get(args.where.productId);
        return r ? { id: r.id, observationConfig: r.observationConfig } : null;
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const d = args.data;
        products.set(d.productId as string, {
          id: `dp-${d.productId as string}`,
          productId: d.productId as string,
          observationConfig: (d.observationConfig as Record<string, unknown>) ?? {},
          ...d,
        });
        return {};
      }),
      update: vi.fn(async () => ({})),
    },
  };
}

describe("projectBomWorkforceSurfaces (BI-D5C9C3F7)", () => {
  it("projects every manifest surface as a for_employees DigitalProduct", async () => {
    const db = makeDb();
    const result = await projectBomWorkforceSurfaces({ db: db as never });

    expect(result.total).toBe(BOM_WORKFORCE_SURFACE_MANIFEST.length);
    expect(result.created).toBe(BOM_WORKFORCE_SURFACE_MANIFEST.length);
    for (const s of BOM_WORKFORCE_SURFACE_MANIFEST) {
      const row = db._products.get(s.productId)!;
      expect(row).toBeDefined();
      expect(row.portfolioId).toBe("port-fe");
      expect(row.sourceKind).toBe("bom_surface");
      expect(row.coverageStatus).toBe("used");
      expect(row.observationConfig[PORTFOLIO_PROJECTION_KEYS.projectedBy]).toBe(PROJECTED_BY);
    }
  });

  it("places the tax-remittance exemplar under the financial_management taxonomy node", async () => {
    const db = makeDb();
    await projectBomWorkforceSurfaces({ db: db as never });

    const tax = db._products.get("bom-surface-tax-remittance")!;
    expect(tax.taxonomyNodeId).toBe("tax-node");
  });

  it("is idempotent — a re-run updates projector-owned rows, no duplicates", async () => {
    const db = makeDb();
    await projectBomWorkforceSurfaces({ db: db as never });
    const sizeAfterFirst = db._products.size;

    const result2 = await projectBomWorkforceSurfaces({ db: db as never });
    expect(db._products.size).toBe(sizeAfterFirst);
    expect(result2.created).toBe(0);
    expect(result2.updated).toBe(BOM_WORKFORCE_SURFACE_MANIFEST.length);
  });
});
