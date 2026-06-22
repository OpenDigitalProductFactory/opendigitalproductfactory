import { describe, it, expect } from "vitest";

import {
  projectAiProviders,
  projectIntegrations,
  type ProjectAiProvidersClient,
  type ProjectIntegrationsClient,
} from "./project-external-supply";
import { SUPPORTED_INTEGRATIONS } from "./supported-integrations-manifest";
import { PORTFOLIO_PROJECTION_KEYS, isPortfolioSlug } from "./types";

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

function makeBaseDb() {
  const portfolios = new Map(ALL_PORTFOLIOS.map((slug) => [slug, { id: `pf-${slug}` }]));
  const products = new Map<string, ProductRow>();
  let seq = 0;
  const writer = {
    products,
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
  return writer;
}

describe("projectAiProviders", () => {
  it("projects providers into Foundational with used/potential by configuration", async () => {
    const base = makeBaseDb();
    const db: ProjectAiProvidersClient & { products: typeof base.products } = {
      ...base,
      modelProvider: {
        findMany: async () => [
          { providerId: "docker-model-runner-local", name: "Docker Model Runner", status: "unconfigured", category: "local", costBand: "free", catalogVisibility: "visible" },
          { providerId: "anthropic", name: "Anthropic", status: "active", category: "direct", costBand: "paid", catalogVisibility: "visible" },
          { providerId: "secret", name: "Hidden", status: "active", category: "direct", costBand: "free", catalogVisibility: "hidden" },
        ],
      },
    };

    const res = await projectAiProviders({ db });
    expect(res.created).toBe(2); // hidden one skipped

    const docker = db.products.get("prov-docker-model-runner-local")!;
    expect(docker.portfolioId).toBe("pf-foundational");
    expect((docker.observationConfig as Record<string, string>)[PORTFOLIO_PROJECTION_KEYS.coverageStatus]).toBe("potential");
    expect((docker.observationConfig as Record<string, string>)[PORTFOLIO_PROJECTION_KEYS.sourceKind]).toBe("ai_provider");

    const anthropic = db.products.get("prov-anthropic")!;
    expect((anthropic.observationConfig as Record<string, string>)[PORTFOLIO_PROJECTION_KEYS.coverageStatus]).toBe("used");

    expect(db.products.get("prov-secret")).toBeUndefined();
  });
});

describe("SUPPORTED_INTEGRATIONS", () => {
  it("has unique slugs and valid portfolio routing", () => {
    const slugs = SUPPORTED_INTEGRATIONS.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const i of SUPPORTED_INTEGRATIONS) {
      expect(isPortfolioSlug(i.portfolioSlug)).toBe(true);
      expect(i.credentialProvider.length).toBeGreaterThan(0);
    }
  });
});

describe("projectIntegrations", () => {
  it("projects all integrations as potential when no credentials exist", async () => {
    const base = makeBaseDb();
    const db: ProjectIntegrationsClient & { products: typeof base.products } = {
      ...base,
      integrationCredential: { findMany: async () => [] },
    };

    const res = await projectIntegrations({ db });
    expect(res.created).toBe(SUPPORTED_INTEGRATIONS.length);

    const qb = db.products.get("int-quickbooks")!;
    expect(qb.portfolioId).toBe("pf-for_employees");
    expect((qb.observationConfig as Record<string, string>)[PORTFOLIO_PROJECTION_KEYS.coverageStatus]).toBe("potential");
    expect((qb.observationConfig as Record<string, string>)[PORTFOLIO_PROJECTION_KEYS.sourceKind]).toBe("integration_registry");

    // routing spot-checks
    expect(db.products.get("int-microsoft-365")!.portfolioId).toBe("pf-foundational");
    expect(db.products.get("int-ninjaone")!.portfolioId).toBe("pf-manufacturing_and_delivery");
  });

  it("reflects connection state: connected → used, other status → available", async () => {
    const base = makeBaseDb();
    const db: ProjectIntegrationsClient & { products: typeof base.products } = {
      ...base,
      integrationCredential: {
        findMany: async () => [
          { provider: "quickbooks", status: "connected" },
          { provider: "stripe", status: "error" },
        ],
      },
    };

    await projectIntegrations({ db });
    expect((db.products.get("int-quickbooks")!.observationConfig as Record<string, string>)[PORTFOLIO_PROJECTION_KEYS.coverageStatus]).toBe("used");
    expect((db.products.get("int-stripe")!.observationConfig as Record<string, string>)[PORTFOLIO_PROJECTION_KEYS.coverageStatus]).toBe("available");
    expect((db.products.get("int-xero")!.observationConfig as Record<string, string>)[PORTFOLIO_PROJECTION_KEYS.coverageStatus]).toBe("potential");
  });

  it("is idempotent — re-projection creates no duplicates", async () => {
    const base = makeBaseDb();
    const db: ProjectIntegrationsClient & { products: typeof base.products } = {
      ...base,
      integrationCredential: { findMany: async () => [] },
    };
    await projectIntegrations({ db });
    const size1 = db.products.size;
    const second = await projectIntegrations({ db });
    expect(second.created).toBe(0);
    expect(second.updated).toBe(SUPPORTED_INTEGRATIONS.length);
    expect(db.products.size).toBe(size1);
  });
});
