import {
  attributeInventoryEntity,
  type RankedTaxonomyCandidate,
  type TaxonomyNodeCandidate,
} from "./discovery-attribution";
import { matchInventoryEntity, type AdapterRule } from "./discovery-fingerprint-adapter";
import { buildDeviceFingerprintObservation } from "./discovery-fingerprint-observation";
import {
  buildDiscoveredKey,
  buildInventoryEntityKey,
} from "./discovery-identity";
import {
  normalizeSoftwareEvidence,
  type SoftwareIdentityCandidate,
  type SoftwareNormalizationRuleInput,
} from "./software-normalization";
import type {
  CollectorOutput,
  DiscoveredItemInput,
  DiscoveredRelationshipInput,
  DiscoveredSoftwareInput,
} from "./discovery-types";

export type NormalizedDiscoveredItem = {
  discoveredKey: string;
  sourceKind: string;
  itemType: string;
  name: string;
  externalRef: string;
  sourcePath?: string;
  confidence?: number;
  attributes: Record<string, unknown>;
};

export type NormalizedInventoryEntity = {
  entityKey: string;
  entityType: string;
  name: string;
  discoveredKey: string;
  portfolioSlug?: string | null;
  taxonomyNodeId?: string | null;
  attributionStatus: "attributed" | "needs_review" | "unmapped" | "stale" | "dismissed";
  attributionMethod?: "rule" | "heuristic";
  attributionConfidence?: number;
  attributionEvidence?: Record<string, unknown>;
  candidateTaxonomy?: RankedTaxonomyCandidate[];
  providerView: string;
  confidence?: number;
  // Enrichment linkage (BI-27EE2AF7) — the canonical identity a rule resolved to.
  catalogIdentityId?: string | null;
  identityStatus?: string | null;
  identityConfidence?: number | null;
  properties: Record<string, unknown>;
};

export type NormalizedInventoryRelationship = {
  relationshipKey: string;
  relationshipType: string;
  fromDiscoveredKey?: string;
  toDiscoveredKey?: string;
  confidence?: number;
  properties: Record<string, unknown>;
};

export type NormalizedSoftwareEvidence = {
  evidenceKey: string;
  inventoryEntityKey: string;
  evidenceSource: string;
  packageManager?: string;
  rawVendor?: string | null;
  rawProductName?: string | null;
  rawPackageName?: string | null;
  rawVersion?: string | null;
  installLocation?: string;
  rawMetadata?: Record<string, unknown>;
  normalizationStatus: "normalized" | "needs_review";
  normalizationMethod: "rule" | "heuristic";
  normalizationConfidence: number;
  softwareIdentityId?: string | null;
  normalizedVendor?: string | null;
  normalizedProductName?: string | null;
  normalizedEdition?: string | null;
  canonicalVersion?: string | null;
  candidateIdentities: Array<{ id: string; score: number; normalizedProductName: string }>;
};

export type NormalizedDiscoveryOutput = {
  discoveredItems: NormalizedDiscoveredItem[];
  inventoryEntities: NormalizedInventoryEntity[];
  inventoryRelationships: NormalizedInventoryRelationship[];
  softwareEvidence: NormalizedSoftwareEvidence[];
};

import {
  scopeFieldsFromContext,
  type DiscoveryScopeContext,
} from "./discovery-scope";

export type NormalizeDiscoveryOptions = {
  taxonomyNodes?: TaxonomyNodeCandidate[];
  softwareIdentities?: SoftwareIdentityCandidate[];
  softwareRules?: SoftwareNormalizationRuleInput[];
  discoveryScope?: DiscoveryScopeContext;
  /**
   * Active discovery-fingerprint rules (spec §4 layer 0). When present, an
   * entity whose day-one signals (OUI vendor / MAC / hostname) confidently
   * match a rule is identified + placed deterministically — overriding the
   * heuristic taxonomy attribution. Each rule's `taxonomyNodeId` must be the
   * semantic nodeId STRING (loaded joined to TaxonomyNode.nodeId), since the
   * normalizer attaches taxonomy via `connect: { nodeId }`.
   */
  fingerprintRules?: AdapterRule[];
  /**
   * Both confidences must clear this for a fingerprint match to auto-attribute
   * (reuses AUTO_PROMOTE_THRESHOLD = 0.9 by default; spec §5).
   */
  fingerprintAutoApplyThreshold?: number;
};

const DEFAULT_FINGERPRINT_AUTO_APPLY = 0.9;

/**
 * Layer-0 fingerprint attribution: if the item's day-one signals confidently
 * match an active rule, return a deterministic attribution that takes
 * precedence over the heuristic. Returns null when no rule matches or the
 * match is below threshold (the caller then falls back to the heuristic).
 */
function fingerprintAttribution(
  item: DiscoveredItemInput,
  options: NormalizeDiscoveryOptions,
): DerivedAttribution | null {
  const rules = options.fingerprintRules;
  if (!rules || rules.length === 0) {
    return null;
  }
  const observation = buildDeviceFingerprintObservation({
    name: item.name,
    attributes: item.attributes ?? {},
  });
  if (observation === null) {
    return null;
  }
  const match = matchInventoryEntity(observation, { rules });
  if (match === null || match.taxonomyNodeId === null) {
    return null;
  }
  const threshold = options.fingerprintAutoApplyThreshold ?? DEFAULT_FINGERPRINT_AUTO_APPLY;
  // Both the identity and the placement must clear the bar — a confident
  // identity placed into an uncertain node should not auto-attribute, and vice
  // versa. min() captures "both high".
  const confidence = Math.min(match.identityConfidence, match.taxonomyConfidence);
  if (confidence < threshold) {
    return null;
  }
  return {
    attributionStatus: "attributed",
    attributionMethod: "rule",
    confidence,
    // Foundational sub-portfolio nodes all live under the "foundational" portfolio.
    portfolioSlug: match.taxonomyNodeId.startsWith("foundational/") ? "foundational" : null,
    taxonomyNodeId: match.taxonomyNodeId,
    candidateTaxonomy: [],
    evidence: {
      source: "discovery-fingerprint",
      ruleKey: match.ruleKey,
      identityConfidence: match.identityConfidence,
      taxonomyConfidence: match.taxonomyConfidence,
      resolvedIdentity: match.resolvedIdentity,
      catalogIdentityId: match.catalogIdentityId,
    },
    catalogIdentityId: match.catalogIdentityId,
    identityStatus: match.catalogIdentityId ? "rule_resolved" : null,
    identityConfidence: match.identityConfidence,
  };
}

type DerivedAttribution = {
  attributionStatus: "attributed" | "needs_review";
  attributionMethod: "rule" | "heuristic";
  confidence: number;
  portfolioSlug: string | null;
  taxonomyNodeId: string | null;
  candidateTaxonomy: RankedTaxonomyCandidate[];
  evidence: Record<string, unknown>;
  // Enrichment linkage to the canonical identity spine (BI-27EE2AF7). Set only
  // on a deterministic fingerprint-rule match that resolves to a CatalogIdentity.
  catalogIdentityId?: string | null;
  identityStatus?: string | null;
  identityConfidence?: number | null;
};

function mapEntityType(itemType: string): string {
  if (itemType === "host") return "host";
  if (itemType.endsWith("_runtime")) return "runtime";
  if (itemType.includes("container")) return "container";
  // Network topology types — passthrough (already canonical)
  if (itemType === "network_interface" || itemType === "subnet" || itemType === "gateway" || itemType === "docker_host") return itemType;
  // UniFi network equipment types — passthrough
  if (itemType === "router" || itemType === "switch" || itemType === "access_point" || itemType === "vlan" || itemType === "network_client" || itemType === "network_device") return itemType;
  return itemType;
}

function isFoundationalInfrastructure(itemType: string): boolean {
  return itemType === "host"
    || itemType.endsWith("_runtime")
    || itemType.includes("database")
    || itemType.includes("network")
    || itemType.includes("storage")
    || itemType.includes("monitoring")
    || itemType === "subnet"
    || itemType === "gateway"
    || itemType === "docker_host"
    || itemType === "router"
    || itemType === "switch"
    || itemType === "access_point"
    || itemType === "vlan";
}

function buildFallbackAttribution(item: DiscoveredItemInput): DerivedAttribution {
  const foundational = isFoundationalInfrastructure(item.itemType);

  return {
    attributionStatus: foundational ? "attributed" : "needs_review",
    attributionMethod: foundational ? "rule" : "heuristic",
    confidence: foundational ? 0.9 : 0.25,
    portfolioSlug: foundational ? "foundational" : null,
    taxonomyNodeId: null,
    candidateTaxonomy: [],
    evidence: {
      descriptor: `${item.itemType} ${item.name}`,
      matchedSignals: foundational ? [item.itemType] : [],
    },
  };
}

function normalizeItem(
  item: DiscoveredItemInput,
  options: NormalizeDiscoveryOptions,
): {
  discoveredItem: NormalizedDiscoveredItem;
  inventoryEntity: NormalizedInventoryEntity;
} {
  const sourceKind = item.sourceKind ?? "dpf_bootstrap";
  const externalRef = item.externalRef ?? item.naturalKey ?? item.name;
  const discoveredKey = buildDiscoveredKey({
    sourceKind,
    itemType: item.itemType,
    externalRef,
  });
  const entityType = mapEntityType(item.itemType);
  const scopeFields = options.discoveryScope
    ? scopeFieldsFromContext(options.discoveryScope)
    : null;
  const entityKey = buildInventoryEntityKey({
    entityType,
    naturalKey: item.naturalKey ?? externalRef,
    scopeKey: scopeFields?.scopeKey,
  });
  const discoveredItem: NormalizedDiscoveredItem = {
    discoveredKey,
    sourceKind,
    itemType: item.itemType,
    name: item.name,
    externalRef,
    attributes: item.attributes ?? {},
  };

  if (item.sourcePath) {
    discoveredItem.sourcePath = item.sourcePath;
  }

  if (item.confidence != null) {
    discoveredItem.confidence = item.confidence;
  }

  // Layer 0 (spec §4): a confident fingerprint match identifies + places the
  // device deterministically and wins over the heuristic. Only when no rule
  // matches do we fall through to taxonomy scoring / the fallback.
  const attributed: DerivedAttribution =
    fingerprintAttribution(item, options)
    ?? (options.taxonomyNodes && options.taxonomyNodes.length > 0
      ? attributeInventoryEntity({
        entityKey,
        entityType,
        itemType: item.itemType,
        name: item.name,
        properties: item.attributes ?? {},
      }, options.taxonomyNodes)
      : buildFallbackAttribution(item));

  const inventoryEntity: NormalizedInventoryEntity = {
    entityKey,
    entityType,
    name: item.name,
    discoveredKey,
    portfolioSlug: attributed.portfolioSlug,
    taxonomyNodeId: attributed.taxonomyNodeId,
    attributionStatus: attributed.attributionStatus,
    attributionMethod: attributed.attributionMethod,
    attributionConfidence: attributed.confidence,
    attributionEvidence: attributed.evidence,
    candidateTaxonomy: attributed.candidateTaxonomy,
    catalogIdentityId: attributed.catalogIdentityId ?? null,
    identityStatus: attributed.identityStatus ?? null,
    identityConfidence: attributed.identityConfidence ?? null,
    providerView: attributed.portfolioSlug ?? "foundational",
    properties: {
      ...(item.attributes ?? {}),
      ...(scopeFields
        ? {
            scopeKey: scopeFields.scopeKey,
            customerAccountId: scopeFields.customerAccountId,
            customerSiteId: scopeFields.customerSiteId,
          }
        : {}),
    },
  };

  if (item.confidence != null) {
    inventoryEntity.confidence = item.confidence;
  }

  return {
    discoveredItem,
    inventoryEntity,
  };
}

function normalizeRelationship(
  relationship: DiscoveredRelationshipInput,
  discoveredKeyByExternalRef: Map<string, string>,
  options: NormalizeDiscoveryOptions,
): NormalizedInventoryRelationship {
  const scopeFields = options.discoveryScope
    ? scopeFieldsFromContext(options.discoveryScope)
    : null;
  const rawKey = buildDiscoveredKey({
    sourceKind: relationship.sourceKind ?? "dpf_bootstrap",
    itemType: relationship.relationshipType,
    externalRef: `${relationship.fromExternalRef ?? "unknown"}->${relationship.toExternalRef ?? "unknown"}`,
  });

  const normalizedRelationship: NormalizedInventoryRelationship = {
    relationshipKey: scopeFields ? `${scopeFields.scopeKey}:${rawKey}` : rawKey,
    relationshipType: relationship.relationshipType,
    properties: {
      ...(relationship.attributes ?? {}),
      ...(scopeFields
        ? {
            scopeKey: scopeFields.scopeKey,
            customerAccountId: scopeFields.customerAccountId,
            customerSiteId: scopeFields.customerSiteId,
          }
        : {}),
    },
  };

  if (relationship.fromExternalRef) {
    normalizedRelationship.fromDiscoveredKey =
      discoveredKeyByExternalRef.get(relationship.fromExternalRef)
      ?? relationship.fromExternalRef;
  }

  if (relationship.toExternalRef) {
    normalizedRelationship.toDiscoveredKey =
      discoveredKeyByExternalRef.get(relationship.toExternalRef)
      ?? relationship.toExternalRef;
  }

  if (relationship.confidence != null) {
    normalizedRelationship.confidence = relationship.confidence;
  }

  return normalizedRelationship;
}

function buildSoftwareEvidenceKey(
  inventoryEntityKey: string,
  software: DiscoveredSoftwareInput,
): string {
  const signature = software.rawPackageName
    ?? software.rawProductName
    ?? software.installLocation
    ?? software.evidenceSource;
  return `${inventoryEntityKey}:${software.evidenceSource}:${signature}`.toLowerCase();
}

function normalizeSoftware(
  software: DiscoveredSoftwareInput,
  inventoryEntityKeyByExternalRef: Map<string, string>,
  options: NormalizeDiscoveryOptions,
): NormalizedSoftwareEvidence | null {
  const externalRef = software.entityExternalRef ?? software.hostExternalRef ?? software.containerExternalRef;
  if (!externalRef) {
    return null;
  }

  const inventoryEntityKey = inventoryEntityKeyByExternalRef.get(externalRef);
  if (!inventoryEntityKey) {
    return null;
  }

  const normalized = normalizeSoftwareEvidence(
    {
      evidenceKey: buildSoftwareEvidenceKey(inventoryEntityKey, software),
      evidenceSource: software.evidenceSource,
      ...(software.rawVendor ? { rawVendor: software.rawVendor } : {}),
      ...(software.rawProductName ? { rawProductName: software.rawProductName } : {}),
      ...(software.rawPackageName ? { rawPackageName: software.rawPackageName } : {}),
      ...(software.rawVersion ? { rawVersion: software.rawVersion } : {}),
    },
    options.softwareIdentities ?? [],
    options.softwareRules ?? [],
  );

  return {
    evidenceKey: buildSoftwareEvidenceKey(inventoryEntityKey, software),
    inventoryEntityKey,
    evidenceSource: software.evidenceSource,
    ...(software.packageManager ? { packageManager: software.packageManager } : {}),
    ...(software.rawVendor ? { rawVendor: software.rawVendor } : {}),
    ...(software.rawProductName ? { rawProductName: software.rawProductName } : {}),
    ...(software.rawPackageName ? { rawPackageName: software.rawPackageName } : {}),
    ...(software.rawVersion ? { rawVersion: software.rawVersion } : {}),
    ...(software.installLocation ? { installLocation: software.installLocation } : {}),
    ...(software.metadata ? { rawMetadata: software.metadata } : {}),
    normalizationStatus: normalized.normalizationStatus,
    normalizationMethod: normalized.method,
    normalizationConfidence: normalized.confidence,
    ...(normalized.identity?.id ? { softwareIdentityId: normalized.identity.id } : {}),
    ...(normalized.identity?.normalizedVendor ? { normalizedVendor: normalized.identity.normalizedVendor } : {}),
    ...(normalized.identity?.normalizedProductName
      ? { normalizedProductName: normalized.identity.normalizedProductName }
      : {}),
    ...(normalized.identity?.normalizedEdition
      ? { normalizedEdition: normalized.identity.normalizedEdition }
      : {}),
    ...(normalized.identity?.canonicalVersion
      ? { canonicalVersion: normalized.identity.canonicalVersion }
      : {}),
    candidateIdentities: normalized.candidates.map((candidate) => ({
      id: candidate.id,
      score: candidate.score,
      normalizedProductName: candidate.normalizedProductName,
    })),
  };
}

export function normalizeDiscoveredFacts(
  output: CollectorOutput,
  options: NormalizeDiscoveryOptions = {},
): NormalizedDiscoveryOutput {
  const normalizedItems = output.items.map((item) => normalizeItem(item, options));
  const discoveredKeyByExternalRef = new Map<string, string>();
  const inventoryEntityKeyByExternalRef = new Map<string, string>();

  for (const entry of normalizedItems) {
    discoveredKeyByExternalRef.set(
      entry.discoveredItem.externalRef,
      entry.discoveredItem.discoveredKey,
    );
    inventoryEntityKeyByExternalRef.set(
      entry.discoveredItem.externalRef,
      entry.inventoryEntity.entityKey,
    );
  }

  return {
    discoveredItems: normalizedItems.map((entry) => entry.discoveredItem),
    inventoryEntities: normalizedItems.map((entry) => entry.inventoryEntity),
    inventoryRelationships: output.relationships.map((relationship) =>
      normalizeRelationship(relationship, discoveredKeyByExternalRef, options),
    ),
    softwareEvidence: (output.software ?? [])
      .map((software) => normalizeSoftware(software, inventoryEntityKeyByExternalRef, options))
      .filter((software): software is NormalizedSoftwareEvidence => software != null),
  };
}
