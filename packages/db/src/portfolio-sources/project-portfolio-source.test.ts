import { describe, it, expect } from "vitest";

import {
  projectPlatformCapabilities,
  type ProjectPortfolioClient,
} from "./project-portfolio-source.js";
import { PORTFOLIO_PROJECTION_KEYS, PROJECTED_BY } from "./types.js";

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
  portfolios: string[];
  nodes?: string[];
  products?: ProductRow[];
}): ProjectPortfolioClient & { products: Map<string, ProductRow> } {
  const portfolios = new Map(
    opts.portfolios.map((slug) => [slug, { id: `pf-${slug}` }]),
  );
  const nodes = new Map((opts.nodes ?? []).map((nodeId, i) => [nodeId, { id: `tn-${i}` }]));
  const products = new Map<string, ProductRow>(
    (opts.products ?? []).map((p) => [p.productId, p]),
  );
  let seq = 0;

  return {
    products,
    portfolio: {
      findUnique: async (args: unknown) => {
        const slug = (args as { where: { slug: string } }).where.slug;
        return portfolios.get(slug) ?? null;
      },
    },
    taxonomyNode: {
      findUnique: async (args: unknown) => {
        const nodeId = (args as { where: { nodeId: string } }).where.nodeId;
        return nodes.get(nodeId) ?? null;
      },
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

describe("projectPlatformCapabilities", () => {
  it("creates DigitalProduct rows with coverage + source markers and portfolio placement", async () => {
    const db = makeFakeDb({
      portfolios: ALL_PORTFOLIOS,
      nodes: ["foundational/platform_services"],
    });
    const res = await projectPlatformCapabilities({ db });

    expect(res.created).toBe(res.total);
    expect(res.skipped).toBe(0);

    const buildStudio = db.products.get("cap-build-studio");
    expect(buildStudio).toBeTruthy();
    expect(buildStudio!.portfolioId).toBe("pf-manufacturing_and_delivery");
    expect(buildStudio!.lifecycleStage).toBe("production");
    expect(buildStudio!.lifecycleStatus).toBe("active");

    const cfg = buildStudio!.observationConfig as Record<string, string>;
    expect(cfg[PORTFOLIO_PROJECTION_KEYS.coverageStatus]).toBe("used");
    expect(cfg[PORTFOLIO_PROJECTION_KEYS.sourceKind]).toBe("platform_capability");
    expect(cfg[PORTFOLIO_PROJECTION_KEYS.projectedBy]).toBe(PROJECTED_BY);

    // foundational subsystem resolves the existing taxonomy node
    const inference = db.products.get("cap-local-ai-inference");
    expect(inference!.portfolioId).toBe("pf-foundational");
    expect(inference!.taxonomyNodeId).toBe("tn-0");
  });

  it("is idempotent — re-projection updates owned rows and creates none", async () => {
    const db = makeFakeDb({
      portfolios: ALL_PORTFOLIOS,
      nodes: ["foundational/platform_services"],
    });
    await projectPlatformCapabilities({ db });
    const countAfterFirst = db.products.size;

    const second = await projectPlatformCapabilities({ db });
    expect(second.created).toBe(0);
    expect(second.updated).toBe(second.total);
    expect(second.skipped).toBe(0);
    expect(db.products.size).toBe(countAfterFirst); // no duplicates
  });

  it("is non-destructive — never overwrites a row it does not own", async () => {
    const db = makeFakeDb({
      portfolios: ALL_PORTFOLIOS,
      products: [
        {
          id: "dp-existing",
          productId: "cap-build-studio",
          name: "Operator Custom Name",
          description: "hand-authored",
          portfolioId: "pf-other",
          taxonomyNodeId: null,
          lifecycleStage: "production",
          lifecycleStatus: "active",
          observationConfig: { note: "operator owns this" },
        },
      ],
    });
    const res = await projectPlatformCapabilities({ db });

    const buildStudio = db.products.get("cap-build-studio")!;
    expect(buildStudio.name).toBe("Operator Custom Name"); // untouched
    expect(buildStudio.portfolioId).toBe("pf-other");
    expect(res.skipped).toBeGreaterThanOrEqual(1);
  });

  it("skips entries whose portfolio root is not seeded", async () => {
    // Only foundational exists — Manufacturing & Delivery entries must skip.
    const db = makeFakeDb({
      portfolios: ["foundational"],
      nodes: ["foundational/platform_services"],
    });
    const res = await projectPlatformCapabilities({ db });

    expect(res.skipped).toBeGreaterThan(0);
    expect(res.created).toBeGreaterThan(0);
    expect(db.products.get("cap-build-studio")).toBeUndefined();
    expect(db.products.get("cap-local-ai-inference")).toBeTruthy();
  });
});
