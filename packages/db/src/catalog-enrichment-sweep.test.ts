import { describe, expect, it } from "vitest";

import {
  runCatalogEnrichmentSweep,
  type CatalogSweepClient,
  type SweepBomRow,
  type SweepIdentityRow,
} from "./catalog-enrichment-sweep";

// deriveEolSlug is defined + unit-tested in ./enrich-digital-product (the sweep reuses
// it as the single source of truth); the cases live in enrich-digital-product.test.ts.

type Recorded = {
  cpeUpdates: Array<{ id: string; cpe: string }>;
  lifecycleUpserts: Array<{ catalogIdentityId: string; milestone: string }>;
  sbomUpserts: string[];
};

function buildDb(
  identities: SweepIdentityRow[],
  bomComponents: SweepBomRow[],
  recorded: Recorded,
): CatalogSweepClient {
  return {
    catalogIdentity: {
      count: async () => identities.length,
      findMany: async () => identities,
      update: async ({ where, data }: { where: { id: string }; data: { cpe: string } }) => {
        recorded.cpeUpdates.push({ id: where.id, cpe: data.cpe });
        return {};
      },
      upsert: async ({ where }: { where: { identityKey: string } }) => {
        recorded.sbomUpserts.push(where.identityKey);
        return { id: `ci:${where.identityKey}` };
      },
    },
    catalogLifecycleMilestone: {
      upsert: async ({ create }: { create: { catalogIdentityId: string; milestone: string } }) => {
        recorded.lifecycleUpserts.push({
          catalogIdentityId: create.catalogIdentityId,
          milestone: create.milestone,
        });
        return {};
      },
    },
    bomComponent: {
      count: async () => bomComponents.length,
      findMany: async () => bomComponents,
    },
  } as unknown as CatalogSweepClient;
}

function eolFetchStub(): typeof fetch {
  // Only "postgresql" is known; everything else 404s (null path in fetchEolProduct).
  return (async (url: string) => {
    if (typeof url === "string" && url.includes("/products/postgresql/")) {
      return {
        ok: true,
        json: async () => ({
          result: {
            name: "postgresql",
            releases: [
              { name: "16", isEol: false, eolFrom: "2028-11-09", releaseDate: "2023-09-14" },
            ],
          },
        }),
      } as unknown as Response;
    }
    return { ok: false, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("runCatalogEnrichmentSweep", () => {
  it("ingests SBOM, resolves CPE for every identity, and writes lifecycle for matches", async () => {
    const identities: SweepIdentityRow[] = [
      { id: "ci-pg", part: "a", manufacturer: "PostgreSQL", product: "PostgreSQL", productVersion: "16", edition: null },
      { id: "ci-mystery", part: "a", manufacturer: "Acme", product: "MysteryApp", productVersion: null, edition: null },
    ];
    const bomComponents: SweepBomRow[] = [
      { name: "left-pad", version: "1.3.0", packageUrl: "pkg:npm/left-pad@1.3.0", supplierName: null, ecosystem: "npm" },
    ];
    const recorded: Recorded = { cpeUpdates: [], lifecycleUpserts: [], sbomUpserts: [] };
    const db = buildDb(identities, bomComponents, recorded);

    const result = await runCatalogEnrichmentSweep(db, {
      fetchers: { eolFetch: eolFetchStub() },
    });

    // SBOM stage bridged the one component.
    expect(result.sbomComponentsIngested).toBe(1);
    expect(recorded.sbomUpserts).toHaveLength(1);
    // CPE resolved for both identities.
    expect(result.cpeResolved).toBe(2);
    expect(recorded.cpeUpdates.map((u) => u.id).sort()).toEqual(["ci-mystery", "ci-pg"]);
    // Only the known endoflife product (postgresql) produced milestones.
    expect(result.lifecycleProductsMatched).toBe(1);
    expect(result.lifecycleMilestonesWritten).toBeGreaterThan(0);
    expect(recorded.lifecycleUpserts.every((m) => m.catalogIdentityId === "ci-pg")).toBe(true);
    expect(result.identitiesScanned).toBe(2);
    expect(result.identitiesTotal).toBe(2);
    expect(result.failures).toBe(0);
  });

  it("counts a per-identity failure without aborting the sweep", async () => {
    const identities: SweepIdentityRow[] = [
      { id: "ci-a", part: "a", manufacturer: "A", product: "A", productVersion: null, edition: null },
      { id: "ci-b", part: "a", manufacturer: "B", product: "B", productVersion: null, edition: null },
    ];
    const recorded: Recorded = { cpeUpdates: [], lifecycleUpserts: [], sbomUpserts: [] };
    const db = buildDb(identities, [], recorded);
    // First CPE update throws; the sweep must count it and continue to ci-b.
    let calls = 0;
    db.catalogIdentity.update = (async () => {
      calls += 1;
      if (calls === 1) throw new Error("db down");
      recorded.cpeUpdates.push({ id: "ci-b", cpe: "x" });
      return {};
    }) as CatalogSweepClient["catalogIdentity"]["update"];

    const result = await runCatalogEnrichmentSweep(db, { fetchers: { eolFetch: eolFetchStub() } });

    expect(result.failures).toBe(1);
    expect(result.identitiesScanned).toBe(2);
    expect(result.cpeResolved).toBe(1);
  });

  it("respects the batch limit", async () => {
    const identities: SweepIdentityRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `ci-${i}`, part: "a", manufacturer: "M", product: "P", productVersion: null, edition: null,
    }));
    const recorded: Recorded = { cpeUpdates: [], lifecycleUpserts: [], sbomUpserts: [] };
    // findMany honors take in the real client; here we assert the option is passed through
    // by returning only the first `take` rows.
    const takeAware: CatalogSweepClient = {
      ...buildDb(identities, [], recorded),
      catalogIdentity: {
        count: async () => identities.length,
        findMany: async ({ take }: { take: number }) => identities.slice(0, take),
        update: async ({ where, data }: { where: { id: string }; data: { cpe: string } }) => {
          recorded.cpeUpdates.push({ id: where.id, cpe: data.cpe });
          return {};
        },
        upsert: async () => ({ id: "x" }),
      },
    } as unknown as CatalogSweepClient;

    const result = await runCatalogEnrichmentSweep(takeAware, {
      limit: 2,
      fetchers: { eolFetch: eolFetchStub() },
    });

    expect(result.identitiesScanned).toBe(2);
    expect(result.identitiesTotal).toBe(5);
  });
});
