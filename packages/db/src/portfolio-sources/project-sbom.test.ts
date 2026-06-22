import { describe, it, expect } from "vitest";

import { LICENSED_DEPENDENCIES } from "./licensed-dependencies-manifest";
import {
  bomComponentEntries,
  licensedDependencyEntries,
  projectSupplyChain,
  type ProjectSbomClient,
} from "./project-sbom";
import { PORTFOLIO_PROJECTION_KEYS } from "./types";

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

function makeFakeDb(bomRows: unknown[]): ProjectSbomClient & { products: Map<string, ProductRow> } {
  const portfolios = new Map([["foundational", { id: "pf-foundational" }]]);
  const products = new Map<string, ProductRow>();
  let seq = 0;
  return {
    products,
    bomComponent: { findMany: async () => bomRows },
    portfolio: {
      findUnique: async (args: unknown) => {
        const slug = (args as { where: { slug: string } }).where.slug;
        return portfolios.get(slug) ?? null;
      },
    },
    taxonomyNode: { findUnique: async () => null },
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

describe("licensedDependencyEntries", () => {
  it("surfaces the paid platform dependencies (Docker, Neo4j) as Foundational sbom entries", () => {
    const entries = licensedDependencyEntries();
    expect(entries.length).toBe(LICENSED_DEPENDENCIES.length);
    const docker = entries.find((e) => e.productId === "dep-docker-business")!;
    expect(docker.portfolioSlug).toBe("foundational");
    expect(docker.sourceKind).toBe("sbom");
    expect(docker.coverageStatus).toBe("used");
    expect(docker.description.toLowerCase()).toContain("paid");
  });
});

describe("bomComponentEntries", () => {
  it("keeps notable component types and drops the OSS library long-tail", () => {
    const rows = [
      { componentKey: "k1", name: "next", version: "16.2.6", componentType: "framework", supplierName: null, licenseExpression: "MIT", packageUrl: "pkg:npm/next@16.2.6" },
      { componentKey: "k2", name: "lodash", version: "4.0.0", componentType: "library", supplierName: null, licenseExpression: "MIT", packageUrl: "pkg:npm/lodash@4.0.0" },
      { componentKey: "k3", name: "gpt-5.4", version: "1", componentType: "model", supplierName: "openai", licenseExpression: "Commercial", packageUrl: null },
    ];
    const entries = bomComponentEntries(rows);
    const ids = entries.map((e) => e.productId);
    expect(ids).toContain("sbom-k1"); // framework kept
    expect(ids).toContain("sbom-k3"); // model kept
    expect(ids).not.toContain("sbom-k2"); // library dropped
    // commercial license → paid in description
    const model = entries.find((e) => e.productId === "sbom-k3")!;
    expect(model.description.toLowerCase()).toContain("paid");
    const fw = entries.find((e) => e.productId === "sbom-k1")!;
    expect(fw.description.toLowerCase()).toContain("free"); // MIT → free
  });
});

describe("projectSupplyChain", () => {
  it("writes licensed deps always + notable SBOM components when present", async () => {
    const db = makeFakeDb([
      { componentKey: "k1", name: "next", version: "16", componentType: "framework", supplierName: null, licenseExpression: "MIT", packageUrl: "pkg:npm/next@16" },
    ]);
    const res = await projectSupplyChain({ db });
    expect(res.created).toBe(LICENSED_DEPENDENCIES.length + 1);

    const docker = db.products.get("dep-docker-business")!;
    expect(docker.portfolioId).toBe("pf-foundational");
    expect((docker.observationConfig as Record<string, string>)[PORTFOLIO_PROJECTION_KEYS.sourceKind]).toBe("sbom");
    expect(db.products.get("sbom-k1")).toBeTruthy();
  });

  it("projects only the licensed deps when no SBOM exists (dormant long-tail)", async () => {
    const db = makeFakeDb([]);
    const res = await projectSupplyChain({ db });
    expect(res.created).toBe(LICENSED_DEPENDENCIES.length);
  });

  it("is idempotent — re-projection creates no duplicates", async () => {
    const db = makeFakeDb([]);
    await projectSupplyChain({ db });
    const size1 = db.products.size;
    const second = await projectSupplyChain({ db });
    expect(second.created).toBe(0);
    expect(second.updated).toBe(LICENSED_DEPENDENCIES.length);
    expect(db.products.size).toBe(size1);
  });
});
