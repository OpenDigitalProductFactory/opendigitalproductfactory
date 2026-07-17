import { describe, expect, it } from "vitest";
import {
  defaultCatalogPath,
  deriveCatalogIdentity,
  loadFingerprintCatalogIntoDb,
  type FingerprintCatalogLoaderClient,
} from "./discovery-fingerprint-catalog-loader";

describe("deriveCatalogIdentity", () => {
  it("maps a software resolvedIdentity to an application (part 'a') identity with a slugged key", () => {
    expect(
      deriveCatalogIdentity({ kind: "software", name: "Prometheus Node Exporter", vendor: "Prometheus" }),
    ).toEqual({
      identityKey: "a:prometheus:prometheus-node-exporter",
      part: "a",
      manufacturer: "Prometheus",
      product: "Prometheus Node Exporter",
    });
  });

  it("maps hardware → part 'h' and os → part 'o'", () => {
    expect(deriveCatalogIdentity({ kind: "hardware", name: "PowerEdge R750", vendor: "Dell" })?.part).toBe("h");
    expect(deriveCatalogIdentity({ kind: "os", name: "Ubuntu", vendor: "Canonical" })?.part).toBe("o");
  });

  it("returns null unless both product and manufacturer are present", () => {
    expect(deriveCatalogIdentity({ kind: "software", name: "OnlyName" })).toBeNull();
    expect(deriveCatalogIdentity({ vendor: "OnlyVendor" })).toBeNull();
    expect(deriveCatalogIdentity(null)).toBeNull();
    expect(deriveCatalogIdentity("not-an-object")).toBeNull();
  });
});

describe("loadFingerprintCatalogIntoDb — CatalogIdentity bridge (BI-0528AD01)", () => {
  it("upserts a canonical CatalogIdentity per resolvable rule and links catalogIdentityId", async () => {
    const identityUpserts: Array<{ where: { identityKey: string }; create: { source: string } }> = [];
    const ruleUpserts: Array<{ create: { catalogIdentityId: string | null } }> = [];
    let seq = 0;

    const db: FingerprintCatalogLoaderClient = {
      taxonomyNode: { findMany: async () => [] },
      discoveryFingerprintCatalogVersion: { upsert: async () => ({ id: "catalog-version-1" }) },
      discoveryFingerprintRule: {
        upsert: async (args: unknown) => {
          ruleUpserts.push(args as { create: { catalogIdentityId: string | null } });
          return {};
        },
      },
      catalogIdentity: {
        upsert: async (args: unknown) => {
          identityUpserts.push(args as { where: { identityKey: string }; create: { source: string } });
          return { id: `catalog-identity-${(seq += 1)}` };
        },
      },
    };

    const result = await loadFingerprintCatalogIntoDb(db, defaultCatalogPath(__dirname));

    expect(result.loaded).toBeGreaterThan(0);
    expect(result.catalogIdentitiesLinked).toBeGreaterThan(0);

    // Every identity upsert is keyed on the CPE-part-prefixed identityKey and seeded.
    for (const upsert of identityUpserts) {
      expect(upsert.where.identityKey).toMatch(/^[aoh]:/);
      expect(upsert.create.source).toBe("seeded");
    }

    // Exactly the rules that resolved to an identity carry a non-null catalogIdentityId.
    const linkedRules = ruleUpserts.filter((r) => r.create.catalogIdentityId != null);
    expect(linkedRules.length).toBe(result.catalogIdentitiesLinked);
  });
});
