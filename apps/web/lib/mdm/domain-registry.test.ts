import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MASTER_DATA_DOMAINS,
  MASTER_DATA_DOMAIN_KEYS,
  getMasterDataDomain,
  isIdentityBearingDomain,
  masterDataSourceRefDomains,
} from "@/lib/mdm/domain-registry";
import { readCanonicalPrismaSchema } from "@dpf/db/schema-source";

const KEBAB_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Resolve real Prisma model names from the schema (hermetic — no DB, no client
// runtime). The prisma/schema folder is the canonical source the EA extractor also reads.
const PRISMA_MODEL_NAMES = new Set<string>(
  Array.from(
    readCanonicalPrismaSchema().matchAll(/^model\s+(\w+)\s*\{/gm),
    (m) => m[1],
  ),
);

describe("master-data domain registry", () => {
  it("every domain's canonicalModel resolves to a real Prisma model", () => {
    for (const key of MASTER_DATA_DOMAIN_KEYS) {
      const config = MASTER_DATA_DOMAINS[key];
      expect(
        PRISMA_MODEL_NAMES.has(config.canonicalModel),
        `domain "${key}" canonicalModel "${config.canonicalModel}" is not a Prisma model`,
      ).toBe(true);
    }
  });

  it("identityBearing is consistent with the crosswalk mechanism", () => {
    for (const key of MASTER_DATA_DOMAIN_KEYS) {
      const config = MASTER_DATA_DOMAINS[key];
      if (config.identityBearing) {
        expect(config.crosswalkVia, key).toBe("principal-alias");
      } else {
        expect(config.crosswalkVia, key).toBe("master-data-source-ref");
      }
    }
  });

  it("identity-bearing domains are excluded from the MasterDataSourceRef crosswalk", () => {
    const refDomains = masterDataSourceRefDomains();
    // Per spec §6.2 / AGENTS.md §11, organization and customer-contact resolve
    // identity via PrincipalAlias and must NOT appear in the crosswalk set.
    expect(refDomains).not.toContain("organization");
    expect(refDomains).not.toContain("customer-contact");
    expect(isIdentityBearingDomain("organization")).toBe(true);
    expect(isIdentityBearingDomain("customer-contact")).toBe(true);
    expect(isIdentityBearingDomain("customer-account")).toBe(false);
    for (const domain of refDomains) {
      expect(isIdentityBearingDomain(domain)).toBe(false);
    }
  });

  it("the crosswalk set matches the non-identity domains named in spec §6.2", () => {
    expect(new Set(masterDataSourceRefDomains())).toEqual(
      new Set([
        "customer-account",
        "customer-site",
        "digital-product",
        "supplier",
        "inventory-entity",
        "taxonomy-node",
        "reference-data",
      ]),
    );
  });

  it("every domain is fully specified with a well-formed steward capability", () => {
    for (const key of MASTER_DATA_DOMAIN_KEYS) {
      const config = MASTER_DATA_DOMAINS[key];
      expect(config.domain, key).toBe(key);
      expect(config.canonicalIdField.length, key).toBeGreaterThan(0);
      expect(config.identityAttributes.length, key).toBeGreaterThan(0);
      expect(config.qualityDimensions.length, key).toBeGreaterThan(0);
      expect(config.publishingReadModel.length, key).toBeGreaterThan(0);
      expect(KEBAB_SLUG.test(config.stewardCapabilityId), key).toBe(true);
    }
  });

  it("merge policy is tombstone for every domain (resolved §6.6 decision: no hard-delete)", () => {
    for (const key of MASTER_DATA_DOMAIN_KEYS) {
      expect(MASTER_DATA_DOMAINS[key].mergePolicy, key).toBe("tombstone");
    }
  });

  it("getMasterDataDomain resolves known keys and rejects unknown ones", () => {
    expect(getMasterDataDomain("supplier")?.canonicalModel).toBe("Supplier");
    expect(getMasterDataDomain("not-a-domain")).toBeUndefined();
  });
});
