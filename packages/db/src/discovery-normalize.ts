import {
  attributeInventoryEntity,
  type RankedTaxonomyCandidate,
  type TaxonomyNodeCandidate,
} from "./discovery-attribution";
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

export type NormalizeDiscoveryOptions = {
  taxonomyNodes?: TaxonomyNodeCandidate[];
  softwareIdentities?: SoftwareIdentityCandidate[];
  softwareRules?: SoftwareNormalizationRuleInput[];
};

type DerivedAttribution = {
  attributionStatus: "attributed" | "needs_review";
  attributionMethod: "rule" | "heuristic";
  confidence: number;
  portfolioSlug: string | null;
  taxonomyNodeId: string | null;
  candidateTaxonomy: RankedTaxonomyCandidate[];
  evidence: Record<string, unknown>;
};

function mapEntityType(itemType: string): string {
  if (itemType === "host") return "host";
  if (itemType.endsWith("_runtime")) return "runtime";
  if (itemType.includes("container")) return "container";
  // Network topology types — passthrough (already canonical)
  if (itemType === "network_interface" || itemType === "subnet" || itemType === "gateway" || itemType === "docker_host") return itemType;
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
    || itemType === "docker_host";
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
  const entityKey = buildInventoryEntityKey({
    entityType,
    naturalKey: item.naturalKey ?? externalRef,
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

  const attributed: DerivedAttribution = options.taxonomyNodes && options.taxonomyNodes.length > 0
    ? attributeInventoryEntity({
      entityKey,
      entityType,
      itemType: item.itemType,
      name: item.name,
      properties: item.attributes ?? {},
    }, options.taxonomyNodes)
    : buildFallbackAttribution(item);

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
    providerView: attributed.portfolioSlug ?? "foundational",
    properties: item.attributes ?? {},
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
): NormalizedInventoryRelationship {
  const normalizedRelationship: NormalizedInventoryRelationship = {
    relationshipKey: buildDiscoveredKey({
      sourceKind: relationship.sourceKind ?? "dpf_bootstrap",
      itemType: relationship.relationshipType,
      externalRef: `${relationship.fromExternalRef ?? "unknown"}->${relationship.toExternalRef ?? "unknown"}`,
    }),
    relationshipType: relationship.relationshipType,
    properties: relationship.attributes ?? {},
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
      normalizeRelationship(relationship, discoveredKeyByExternalRef),
    ),
    softwareEvidence: (output.software ?? [])
      .map((software) => normalizeSoftware(software, inventoryEntityKeyByExternalRef, options))
      .filter((software): software is NormalizedSoftwareEvidence => software != null),
  };
}
