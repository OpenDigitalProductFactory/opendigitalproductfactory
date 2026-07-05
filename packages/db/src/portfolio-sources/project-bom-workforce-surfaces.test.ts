import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  BOM_WORKFORCE_DOMAIN_PREFIX,
  BOM_WORKFORCE_SURFACE_MANIFEST,
} from "./bom-workforce-surface-manifest";
import { projectBomWorkforceSurfaces } from "./project-bom-workforce-surfaces";
import { PORTFOLIO_PROJECTION_KEYS, PROJECTED_BY } from "./types";

type ProductRow = { id: string; productId: string; observationConfig: Record<string, unknown> };
type TaxonomyRow = {
  portfolio_id: string;
  level_1: string;
  level_2: string;
  level_3: string;
};

const taxonomyPath = join(__dirname, "..", "..", "data", "taxonomy_v3.json");
const taxonomyRows = JSON.parse(readFileSync(taxonomyPath, "utf8")) as TaxonomyRow[];

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function forEmployeesTaxonomyNodeIds(): Set<string> {
  const ids = new Set<string>();
  ids.add("for_employees");
  for (const row of taxonomyRows.filter((r) => r.portfolio_id === "for_employees")) {
    if (!row.level_1) continue;
    const l1 = `for_employees/${slugify(row.level_1)}`;
    ids.add(l1);
    if (!row.level_2) continue;
    const l2 = `${l1}/${slugify(row.level_2)}`;
    ids.add(l2);
    if (!row.level_3) continue;
    ids.add(`${l2}/${slugify(row.level_3)}`);
  }
  return ids;
}

function forEmployeesTopLevelNodeIds(): Set<string> {
  return new Set(
    taxonomyRows
      .filter((r) => r.portfolio_id === "for_employees")
      .map((r) => r.level_1)
      .filter((level1): level1 is string => level1.length > 0)
      .map((level1) => `for_employees/${slugify(level1)}`),
  );
}

function makeDb() {
  const products = new Map<string, ProductRow & Record<string, unknown>>();
  const taxonomyNodeIds = forEmployeesTaxonomyNodeIds();
  return {
    _products: products,
    portfolio: { findUnique: vi.fn(async () => ({ id: "port-fe" })) },
    taxonomyNode: {
      findUnique: vi.fn(async (args: { where: { nodeId: string } }) =>
        taxonomyNodeIds.has(args.where.nodeId) ? { id: `node:${args.where.nodeId}` } : null,
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
  it("covers every top-level For Employees functional domain beyond finance", () => {
    const expectedDomains = forEmployeesTopLevelNodeIds();
    const projectedDomains = new Set(
      BOM_WORKFORCE_SURFACE_MANIFEST
        .filter((surface) => surface.productId.startsWith(BOM_WORKFORCE_DOMAIN_PREFIX))
        .map((surface) => surface.taxonomyNodeId),
    );

    expect(projectedDomains).toEqual(expectedDomains);
    expect(projectedDomains.size).toBeGreaterThan(10);
    expect(projectedDomains).toContain("for_employees/financial_management");
    expect(projectedDomains).toContain("for_employees/productivity_services");
    expect(projectedDomains).toContain("for_employees/sales_and_marketing");
    expect(projectedDomains).toContain("for_employees/security_and_compliance");
    expect(projectedDomains).toContain("for_employees/workforce_services");
  });

  it("declares only taxonomy nodes that resolve from taxonomy_v3", () => {
    const taxonomyNodeIds = forEmployeesTaxonomyNodeIds();
    const unresolved = BOM_WORKFORCE_SURFACE_MANIFEST
      .map((surface) => surface.taxonomyNodeId)
      .filter((nodeId): nodeId is string => nodeId !== null)
      .filter((nodeId) => !taxonomyNodeIds.has(nodeId));

    expect(unresolved).toEqual([]);
  });

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
      if (s.taxonomyNodeId) {
        expect(row.taxonomyNodeId).toBe(`node:${s.taxonomyNodeId}`);
      }
    }
  });

  it("places the tax-remittance exemplar under the manage_taxes taxonomy node", async () => {
    const db = makeDb();
    await projectBomWorkforceSurfaces({ db: db as never });

    const tax = db._products.get("bom-surface-tax-remittance")!;
    expect(tax.taxonomyNodeId).toBe("node:for_employees/financial_management/manage_taxes");
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
