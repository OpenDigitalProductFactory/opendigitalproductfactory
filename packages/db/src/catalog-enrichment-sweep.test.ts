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
  bomLinks: Array<{ id: string; catalogIdentityId: string }>;
  postureUpdates: Array<{ catalogIdentityId: string; supportStatus: string; supportLifecycleSource: string }>;
  firmwareUpdates: Array<{ catalogIdentityId: string; latestKnownVersion: string }>;
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
      update: async ({ where, data }: { where: { id: string }; data: { catalogIdentityId: string } }) => {
        recorded.bomLinks.push({ id: where.id, catalogIdentityId: data.catalogIdentityId });
        return {};
      },
    },
    inventoryEntity: {
      updateMany: async ({ where, data }: {
        where: { catalogIdentityId: string };
        data: { supportStatus?: string; supportLifecycleSource?: string; latestKnownVersion?: string };
      }) => {
        if (data.latestKnownVersion !== undefined) {
          recorded.firmwareUpdates.push({
            catalogIdentityId: where.catalogIdentityId,
            latestKnownVersion: data.latestKnownVersion,
          });
        } else {
          recorded.postureUpdates.push({
            catalogIdentityId: where.catalogIdentityId,
            supportStatus: data.supportStatus!,
            supportLifecycleSource: data.supportLifecycleSource!,
          });
        }
        return { count: 2 };
      },
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
      { id: "bc-leftpad", name: "left-pad", version: "1.3.0", packageUrl: "pkg:npm/left-pad@1.3.0", supplierName: null, ecosystem: "npm" },
    ];
    const recorded: Recorded = { cpeUpdates: [], lifecycleUpserts: [], sbomUpserts: [], bomLinks: [], postureUpdates: [], firmwareUpdates: [] };
    const db = buildDb(identities, bomComponents, recorded);

    const result = await runCatalogEnrichmentSweep(db, {
      fetchers: { eolFetch: eolFetchStub() },
    });

    // SBOM stage bridged the one component and linked it back to its identity.
    expect(result.sbomComponentsIngested).toBe(1);
    expect(recorded.sbomUpserts).toHaveLength(1);
    expect(recorded.bomLinks).toEqual([
      { id: "bc-leftpad", catalogIdentityId: "ci:a:npm:left-pad:1-3-0" },
    ]);
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
    const recorded: Recorded = { cpeUpdates: [], lifecycleUpserts: [], sbomUpserts: [], bomLinks: [], postureUpdates: [], firmwareUpdates: [] };
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
    const recorded: Recorded = { cpeUpdates: [], lifecycleUpserts: [], sbomUpserts: [], bomLinks: [], postureUpdates: [], firmwareUpdates: [] };
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

  it("routes part='h' identities to the hardware feed stage, not the software mapping (BI-84710E60)", async () => {
    const identities: SweepIdentityRow[] = [
      { id: "ci-r750", part: "h", manufacturer: "Dell", product: "PowerEdge R750", productVersion: null, edition: null },
    ];
    const recorded: Recorded = { cpeUpdates: [], lifecycleUpserts: [], sbomUpserts: [], bomLinks: [], postureUpdates: [], firmwareUpdates: [] };
    const db = buildDb(identities, [], recorded);

    // endoflife hardware page (discontinued + eol) for the R750 slug.
    const hwEolFetch = (async (url: string) =>
      typeof url === "string" && url.includes("/products/poweredge-r750/")
        ? ({ ok: true, json: async () => ({ result: { name: "poweredge-r750", releases: [{ name: "R750", discontinuedFrom: "2026-01-01", eolFrom: "2029-03-01" }] } }) } as unknown as Response)
        : ({ ok: false, json: async () => ({}) } as unknown as Response)) as unknown as typeof fetch;
    const wikidataFetch = (async (url: string) =>
      url.includes("wbsearchentities")
        ? ({ ok: true, json: async () => ({ search: [{ id: "Q1" }] }) } as unknown as Response)
        : ({ ok: true, json: async () => ({ claims: { P2669: [{ mainsnak: { datavalue: { value: { time: "+2026-01-01T00:00:00Z" } } } }] } }) } as unknown as Response)) as unknown as typeof fetch;

    const result = await runCatalogEnrichmentSweep(db, {
      fetchers: { eolFetch: hwEolFetch, wikidataFetch },
      now: new Date("2026-07-17T00:00:00Z"),
    });

    expect(result.hardwareIdentitiesEnriched).toBe(1);
    expect(result.hardwareMilestonesWritten).toBeGreaterThan(0);
    // The software endoflife path was NOT used for the hardware identity.
    expect(result.lifecycleProductsMatched).toBe(0);
    // CPE still resolved for hardware (part='h' CPEs are valid).
    expect(result.cpeResolved).toBe(1);
    // Milestones landed (end_of_sale from both sources + eol).
    expect(recorded.lifecycleUpserts.map((m) => m.milestone)).toEqual(
      expect.arrayContaining(["end_of_sale", "eol"]),
    );
    // Support posture projected onto the model's discovered instances (BI-4731303B):
    // eol 2029-03-01 is >180d out from the fixed clock → supported, from endoflife.date.
    expect(recorded.postureUpdates).toEqual([
      { catalogIdentityId: "ci-r750", supportStatus: "supported", supportLifecycleSource: "endoflife.date" },
    ]);
    expect(result.entitiesPostureProjected).toBe(2);
  });

  it("skips posture projection for a hardware model with no eol milestone", async () => {
    const identities: SweepIdentityRow[] = [
      { id: "ci-sensor", part: "h", manufacturer: "Acme", product: "Sensor", productVersion: null, edition: null },
    ];
    const recorded: Recorded = { cpeUpdates: [], lifecycleUpserts: [], sbomUpserts: [], bomLinks: [], postureUpdates: [], firmwareUpdates: [] };
    const db = buildDb(identities, [], recorded);
    // endoflife page has only a release date (no eol) → posture cannot be derived.
    const hwEolFetch = (async (url: string) =>
      typeof url === "string" && url.includes("/products/sensor/")
        ? ({ ok: true, json: async () => ({ result: { name: "sensor", releases: [{ name: "v1", releaseDate: "2020-01-01" }] } }) } as unknown as Response)
        : ({ ok: false, json: async () => ({}) } as unknown as Response)) as unknown as typeof fetch;

    const result = await runCatalogEnrichmentSweep(db, {
      fetchers: { eolFetch: hwEolFetch },
      now: new Date("2026-07-17T00:00:00Z"),
    });

    expect(result.hardwareMilestonesWritten).toBeGreaterThan(0); // release milestone written
    expect(recorded.postureUpdates).toEqual([]); // but no posture projected
    expect(result.entitiesPostureProjected).toBe(0);
  });

  it("resolves LVFS firmware once and projects latestKnownVersion onto hardware instances (BI-84710E60)", async () => {
    const identities: SweepIdentityRow[] = [
      { id: "ci-r750", part: "h", manufacturer: "Dell", product: "PowerEdge R750", productVersion: null, edition: null },
    ];
    const recorded: Recorded = { cpeUpdates: [], lifecycleUpserts: [], sbomUpserts: [], bomLinks: [], postureUpdates: [], firmwareUpdates: [] };
    const db = buildDb(identities, [], recorded);

    const lvfsXml = `<components><component type="firmware"><name>Dell PowerEdge R750 BIOS</name><developer_name>Dell Inc.</developer_name><releases><release version="2.1.0" date="2026-05-14"/></releases></component></components>`;
    let lvfsCalls = 0;
    const lvfsFetch = async () => { lvfsCalls += 1; return lvfsXml; };

    const result = await runCatalogEnrichmentSweep(db, {
      fetchers: { lvfsFetch },
      now: new Date("2026-07-17T00:00:00Z"),
    });

    // Catalog fetched exactly once for the batch.
    expect(lvfsCalls).toBe(1);
    expect(result.firmwareVersionsResolved).toBe(1);
    expect(recorded.firmwareUpdates).toEqual([
      { catalogIdentityId: "ci-r750", latestKnownVersion: "2.1.0" },
    ]);
  });

  it("does not fetch the LVFS catalog when the batch has no hardware identity", async () => {
    const identities: SweepIdentityRow[] = [
      { id: "ci-pg", part: "a", manufacturer: "PostgreSQL", product: "PostgreSQL", productVersion: "16", edition: null },
    ];
    const recorded: Recorded = { cpeUpdates: [], lifecycleUpserts: [], sbomUpserts: [], bomLinks: [], postureUpdates: [], firmwareUpdates: [] };
    const db = buildDb(identities, [], recorded);
    let lvfsCalls = 0;
    const lvfsFetch = async () => { lvfsCalls += 1; return "<components/>"; };

    await runCatalogEnrichmentSweep(db, { fetchers: { eolFetch: eolFetchStub(), lvfsFetch } });

    expect(lvfsCalls).toBe(0); // software-only batch never downloads the catalog
    expect(recorded.firmwareUpdates).toEqual([]);
  });
});
