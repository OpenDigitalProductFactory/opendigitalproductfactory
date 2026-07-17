import { describe, expect, it } from "vitest";

import {
  deriveEolSlug,
  enrichCatalogIdentity,
  enrichDigitalProduct,
  requestReEnrichment,
  type EnrichDigitalProductClient,
  type EnrichIdentityRow,
  type ReEnrichmentClient,
} from "./enrich-digital-product";

const PG: EnrichIdentityRow = {
  id: "ci-pg",
  part: "a",
  manufacturer: "PostgreSQL",
  product: "PostgreSQL",
  productVersion: "16",
  edition: null,
};

function eolFetchStub(): typeof fetch {
  return (async (url: string) => {
    if (typeof url === "string" && url.includes("/products/postgresql/")) {
      return {
        ok: true,
        json: async () => ({
          result: { name: "postgresql", releases: [{ name: "16", isEol: false, eolFrom: "2028-11-09" }] },
        }),
      } as unknown as Response;
    }
    return { ok: false, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("deriveEolSlug", () => {
  it("matches the sweep derivation (lowercase-hyphenated)", () => {
    expect(deriveEolSlug({ product: "PostgreSQL" })).toBe("postgresql");
    expect(deriveEolSlug({ product: "SQL Server" })).toBe("sql-server");
  });
});

describe("enrichCatalogIdentity", () => {
  it("resolves CPE and writes lifecycle for a known product", async () => {
    const cpeUpdates: string[] = [];
    const milestones: string[] = [];
    const db = {
      catalogIdentity: { update: async ({ where }: { where: { id: string } }) => { cpeUpdates.push(where.id); return {}; } },
      catalogLifecycleMilestone: {
        upsert: async ({ create }: { create: { milestone: string } }) => { milestones.push(create.milestone); return {}; },
      },
    };

    const r = await enrichCatalogIdentity(db, PG, { eolFetch: eolFetchStub() });

    expect(cpeUpdates).toEqual(["ci-pg"]);
    expect(r.cpe).toContain("cpe:2.3:a:postgresql:postgresql");
    expect(r.lifecycleMatched).toBe(true);
    expect(r.lifecycleMilestonesWritten).toBeGreaterThan(0);
    expect(milestones.length).toBeGreaterThan(0);
  });

  it("resolves CPE but writes no lifecycle for an unknown endoflife product", async () => {
    const db = {
      catalogIdentity: { update: async () => ({}) },
      catalogLifecycleMilestone: { upsert: async () => ({}) },
    };
    const r = await enrichCatalogIdentity(
      db,
      { ...PG, id: "ci-x", product: "MysteryApp" },
      { eolFetch: eolFetchStub() },
    );
    expect(r.lifecycleMatched).toBe(false);
    expect(r.lifecycleMilestonesWritten).toBe(0);
  });
});

function buildProductClient(
  identities: Array<EnrichIdentityRow | null>,
  productUpdates: Array<{ enrichmentStatus: string }>,
): EnrichDigitalProductClient {
  return {
    catalogIdentity: { update: async () => ({}) },
    catalogLifecycleMilestone: { upsert: async () => ({}) },
    digitalProduct: {
      findUnique: async () => ({
        id: "dp-1",
        inventoryEntities: identities.map((catalogIdentity) => ({ catalogIdentity })),
      }),
      update: async ({ data }: { data: { enrichmentStatus: string; lastEnrichedAt: Date } }) => {
        productUpdates.push({ enrichmentStatus: data.enrichmentStatus });
        return {};
      },
    },
  } as unknown as EnrichDigitalProductClient;
}

describe("enrichDigitalProduct", () => {
  it("enriches distinct resolved identities and marks the product enriched", async () => {
    const productUpdates: Array<{ enrichmentStatus: string }> = [];
    // Two entities share ci-pg; dedup means one enrichment.
    const db = buildProductClient([PG, PG, { ...PG, id: "ci-nginx", product: "nginx" }], productUpdates);

    const r = await enrichDigitalProduct(db, "dp-1", { eolFetch: eolFetchStub() });

    expect(r.identitiesEnriched).toBe(2); // ci-pg + ci-nginx (deduped)
    expect(r.identitiesFailed).toBe(0);
    expect(r.enrichmentStatus).toBe("enriched");
    expect(productUpdates.at(-1)?.enrichmentStatus).toBe("enriched");
  });

  it("marks a product with no resolved identities as partial (awaiting a rule match)", async () => {
    const productUpdates: Array<{ enrichmentStatus: string }> = [];
    const db = buildProductClient([null], productUpdates);

    const r = await enrichDigitalProduct(db, "dp-1", { eolFetch: eolFetchStub() });

    expect(r.identitiesEnriched).toBe(0);
    expect(r.enrichmentStatus).toBe("partial");
  });

  it("marks a missing product as failed and does not update", async () => {
    const productUpdates: Array<{ enrichmentStatus: string }> = [];
    const db = {
      catalogIdentity: { update: async () => ({}) },
      catalogLifecycleMilestone: { upsert: async () => ({}) },
      digitalProduct: {
        findUnique: async () => null,
        update: async () => { productUpdates.push({ enrichmentStatus: "x" }); return {}; },
      },
    } as unknown as EnrichDigitalProductClient;

    const r = await enrichDigitalProduct(db, "missing", {});

    expect(r.enrichmentStatus).toBe("failed");
    expect(productUpdates).toHaveLength(0);
  });

  it("marks failed when every identity throws", async () => {
    const productUpdates: Array<{ enrichmentStatus: string }> = [];
    const db = buildProductClient([PG], productUpdates);
    db.catalogIdentity.update = (async () => { throw new Error("db down"); }) as EnrichDigitalProductClient["catalogIdentity"]["update"];

    const r = await enrichDigitalProduct(db, "dp-1", { eolFetch: eolFetchStub() });

    expect(r.identitiesFailed).toBe(1);
    expect(r.enrichmentStatus).toBe("failed");
    expect(productUpdates.at(-1)?.enrichmentStatus).toBe("failed");
  });
});

describe("requestReEnrichment", () => {
  it("flags a product back to pending", async () => {
    const updates: Array<{ enrichmentStatus: string }> = [];
    const db: ReEnrichmentClient = {
      digitalProduct: {
        update: async ({ data }: { data: { enrichmentStatus: string } }) => { updates.push(data); return {}; },
      },
      inventoryEntity: { updateMany: async () => ({ count: 0 }) },
    };

    const r = await requestReEnrichment(db, { digitalProductId: "dp-1" });

    expect(r.flaggedProduct).toBe(true);
    expect(r.flaggedEntity).toBe(false);
    expect(updates).toEqual([{ enrichmentStatus: "pending" }]);
  });

  it("flags an entity for re-resolution when it exists", async () => {
    const db: ReEnrichmentClient = {
      digitalProduct: { update: async () => ({}) },
      inventoryEntity: { updateMany: async () => ({ count: 1 }) },
    };

    const r = await requestReEnrichment(db, { inventoryEntityId: "e-1" });

    expect(r.flaggedEntity).toBe(true);
    expect(r.flaggedProduct).toBe(false);
  });
});
