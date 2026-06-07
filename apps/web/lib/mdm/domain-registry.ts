/**
 * Master Data Management — domain registry (MDM spec §6.1).
 *
 * A code-level registry of the business entities DPF governs as master data.
 * This is NOT a new table: the canonical record for each domain stays in its
 * existing Prisma model (spec §5.1). The registry declares HOW each domain is
 * mastered so crosswalk, match/dedupe, survivorship, stewardship, and
 * publishing all read one source of truth.
 *
 * Two crosswalk mechanisms, never duplicated (spec §6.2):
 *  - identity-bearing domains resolve cross-source identity through
 *    `PrincipalAlias` (AGENTS.md §11) and are OUT of scope for
 *    `MasterDataSourceRef`;
 *  - non-identity domains use the `MasterDataSourceRef` crosswalk.
 *
 * Domain "reference-data" is a domain-family (Country/Region/City). `Region`
 * is its representative canonical model for the merge surface (MDM-5).
 *
 * Relationship to EP-DATA-ARCH: the data-architecture steward derives a domain
 * map from the schema; this registry is the governed overlay declaring which
 * of those domains are managed master data — it is not an independent taxonomy.
 */
import type { TrustDimensionKey } from "@/lib/trust-vector";

export type MasterDataDomain =
  | "organization"
  | "customer-account"
  | "customer-contact"
  | "customer-site"
  | "digital-product"
  | "supplier"
  | "inventory-entity"
  | "taxonomy-node"
  | "reference-data";

/** How a domain resolves the same real-world entity across source systems. */
export type CrosswalkMechanism = "principal-alias" | "master-data-source-ref";

/**
 * Merge policy. Only "tombstone" exists: the merge-severity decision (spec §6.6,
 * kernel 2026-06-06) resolved that a merge never hard-deletes — the losing
 * canonical row is superseded and retained with a pre-merge snapshot.
 */
export type MergePolicy = "tombstone";

export type MasterDataDomainConfig = {
  readonly domain: MasterDataDomain;
  /** Prisma model name that owns the canonical record. Validated at test time. */
  readonly canonicalModel: string;
  /** Canonical primary-key field on that model. */
  readonly canonicalIdField: string;
  /** Attributes used to identify/match records within the domain. */
  readonly identityAttributes: readonly string[];
  /**
   * Quality dimensions this domain must score. Typed against the single trust
   * registry (MDM-0) — tsc rejects any non-registry key here.
   */
  readonly qualityDimensions: readonly TrustDimensionKey[];
  /** Source systems whose records may map onto this domain. */
  readonly allowedSourceSystems: readonly string[];
  /** Identity crosswalk mechanism. principal-alias ⇔ identityBearing. */
  readonly crosswalkVia: CrosswalkMechanism;
  /** True iff this is an identity-bearing entity (PrincipalAlias territory). */
  readonly identityBearing: boolean;
  readonly mergePolicy: MergePolicy;
  /**
   * PlatformCapability id checked at the steward action boundary (spec §6.1).
   * Kebab-case slug; the capability is seeded + bound in MDM-3 (steward queue).
   */
  readonly stewardCapabilityId: string;
  /** Stable read-model name downstream surfaces consume (spec §7 step 7). */
  readonly publishingReadModel: string;
};

const STEWARD_CAPABILITY = "mdm-steward" as const;

const SHARED_QUALITY_DIMENSIONS: readonly TrustDimensionKey[] = [
  "coverageCompleteness",
  "freshness",
  "sourceAuthority",
  "dataLineage",
  "humanValidation",
  "conflictContradiction",
  "validityConformity",
  "uniqueness",
  "relationshipIntegrity",
];

export const MASTER_DATA_DOMAINS: Readonly<
  Record<MasterDataDomain, MasterDataDomainConfig>
> = {
  organization: {
    domain: "organization",
    canonicalModel: "Organization",
    canonicalIdField: "id",
    identityAttributes: ["name", "legalName", "domain"],
    qualityDimensions: SHARED_QUALITY_DIMENSIONS,
    allowedSourceSystems: [],
    crosswalkVia: "principal-alias",
    identityBearing: true,
    mergePolicy: "tombstone",
    stewardCapabilityId: STEWARD_CAPABILITY,
    publishingReadModel: "mdm.organization",
  },
  "customer-account": {
    domain: "customer-account",
    canonicalModel: "CustomerAccount",
    canonicalIdField: "id",
    identityAttributes: ["name", "website", "domain"],
    qualityDimensions: SHARED_QUALITY_DIMENSIONS,
    allowedSourceSystems: ["pipedrive", "quickbooks", "csv-import", "manual"],
    crosswalkVia: "master-data-source-ref",
    identityBearing: false,
    mergePolicy: "tombstone",
    stewardCapabilityId: STEWARD_CAPABILITY,
    publishingReadModel: "mdm.customer-account",
  },
  "customer-contact": {
    domain: "customer-contact",
    canonicalModel: "CustomerContact",
    canonicalIdField: "id",
    identityAttributes: ["email", "fullName", "phone"],
    qualityDimensions: SHARED_QUALITY_DIMENSIONS,
    allowedSourceSystems: [],
    crosswalkVia: "principal-alias",
    identityBearing: true,
    mergePolicy: "tombstone",
    stewardCapabilityId: STEWARD_CAPABILITY,
    publishingReadModel: "mdm.customer-contact",
  },
  "customer-site": {
    domain: "customer-site",
    canonicalModel: "CustomerSite",
    canonicalIdField: "id",
    identityAttributes: ["name", "addressId"],
    qualityDimensions: SHARED_QUALITY_DIMENSIONS,
    allowedSourceSystems: ["csv-import", "manual"],
    crosswalkVia: "master-data-source-ref",
    identityBearing: false,
    mergePolicy: "tombstone",
    stewardCapabilityId: STEWARD_CAPABILITY,
    publishingReadModel: "mdm.customer-site",
  },
  "digital-product": {
    domain: "digital-product",
    canonicalModel: "DigitalProduct",
    canonicalIdField: "id",
    identityAttributes: ["name", "slug"],
    qualityDimensions: SHARED_QUALITY_DIMENSIONS,
    allowedSourceSystems: ["build-studio", "manual"],
    crosswalkVia: "master-data-source-ref",
    identityBearing: false,
    mergePolicy: "tombstone",
    stewardCapabilityId: STEWARD_CAPABILITY,
    publishingReadModel: "mdm.digital-product",
  },
  supplier: {
    domain: "supplier",
    canonicalModel: "Supplier",
    canonicalIdField: "id",
    identityAttributes: ["name", "website", "taxId"],
    qualityDimensions: SHARED_QUALITY_DIMENSIONS,
    allowedSourceSystems: ["quickbooks", "csv-import", "manual"],
    crosswalkVia: "master-data-source-ref",
    identityBearing: false,
    mergePolicy: "tombstone",
    stewardCapabilityId: STEWARD_CAPABILITY,
    publishingReadModel: "mdm.supplier",
  },
  "inventory-entity": {
    domain: "inventory-entity",
    canonicalModel: "InventoryEntity",
    canonicalIdField: "id",
    identityAttributes: ["name", "externalRef"],
    qualityDimensions: SHARED_QUALITY_DIMENSIONS,
    allowedSourceSystems: ["discovery", "manual"],
    crosswalkVia: "master-data-source-ref",
    identityBearing: false,
    mergePolicy: "tombstone",
    stewardCapabilityId: STEWARD_CAPABILITY,
    publishingReadModel: "mdm.inventory-entity",
  },
  "taxonomy-node": {
    domain: "taxonomy-node",
    canonicalModel: "TaxonomyNode",
    canonicalIdField: "id",
    identityAttributes: ["slug", "label"],
    qualityDimensions: SHARED_QUALITY_DIMENSIONS,
    allowedSourceSystems: ["manual"],
    crosswalkVia: "master-data-source-ref",
    identityBearing: false,
    mergePolicy: "tombstone",
    stewardCapabilityId: STEWARD_CAPABILITY,
    publishingReadModel: "mdm.taxonomy-node",
  },
  "reference-data": {
    // Domain-family (Country/Region/City). Region is the representative
    // canonical model for the merge surface (MDM-5).
    domain: "reference-data",
    canonicalModel: "Region",
    canonicalIdField: "id",
    identityAttributes: ["name", "code", "countryId"],
    qualityDimensions: SHARED_QUALITY_DIMENSIONS,
    allowedSourceSystems: ["iso-3166", "manual"],
    crosswalkVia: "master-data-source-ref",
    identityBearing: false,
    mergePolicy: "tombstone",
    stewardCapabilityId: STEWARD_CAPABILITY,
    publishingReadModel: "mdm.reference-data",
  },
};

/** All registered master-data domains. */
export const MASTER_DATA_DOMAIN_KEYS = Object.keys(
  MASTER_DATA_DOMAINS,
) as MasterDataDomain[];

/** Look up a domain config, or undefined if the key is not a master-data domain. */
export function getMasterDataDomain(
  domain: string,
): MasterDataDomainConfig | undefined {
  return (MASTER_DATA_DOMAINS as Record<string, MasterDataDomainConfig>)[domain];
}

/** True iff the domain resolves identity via PrincipalAlias (not MasterDataSourceRef). */
export function isIdentityBearingDomain(domain: MasterDataDomain): boolean {
  return MASTER_DATA_DOMAINS[domain].identityBearing;
}

/**
 * Domains eligible for the `MasterDataSourceRef` crosswalk (spec §6.2): every
 * non-identity domain. Identity-bearing domains are excluded — a second identity
 * crosswalk would violate single-source-of-truth.
 */
export function masterDataSourceRefDomains(): MasterDataDomain[] {
  return MASTER_DATA_DOMAIN_KEYS.filter(
    (domain) => MASTER_DATA_DOMAINS[domain].crosswalkVia === "master-data-source-ref",
  );
}
