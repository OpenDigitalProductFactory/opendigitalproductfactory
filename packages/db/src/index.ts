// packages/db/src/index.ts
export { prisma } from "./client";
export type { Prisma, PrismaClient } from "../generated/client/client";

export { neo4jSession, closeNeo4j, runCypher } from "./neo4j";

// Qdrant vector database
export {
  ensureCollections as ensureQdrantCollections,
  ensurePayloadIndexes,
  upsertVectors,
  searchSimilar,
  scrollPoints,
  deleteVectors,
  isQdrantHealthy,
  hashToNumber,
  QDRANT_COLLECTIONS,
} from "./qdrant";
export { initNeo4jSchema, backfillOsiLayers, NETWORK_RELATIONSHIP_TYPES } from "./neo4j-schema";
export {
  getDownstreamImpact,
  getUpstreamDependencies,
  getProductsByPortfolio,
  getProductsByTaxonomySubtree,
  shortestPath,
  getInfraCIs,
  getNeighbours,
  getLayeredDependencyStack,
  getNetworkTopologyAtLayer,
  pruneStaleInfraCIs,
  type GraphNode,
  type GraphEdge,
  type ImpactResult,
  type LayeredDependency,
  type PruneResult,
} from "./neo4j-graph";
export {
  syncDigitalProduct,
  syncTaxonomyNode,
  syncPortfolio,
  syncInfraCI,
  syncDependsOn,
  type InfraCIExtendedProps,
  syncInventoryEntityAsInfraCI,
  syncInventoryRelationship,
  syncIT4ITLabels,
} from "./neo4j-sync";
export {
  buildDiscoveredKey,
  buildInventoryEntityKey,
  type DiscoveredKeyInput,
  type InventoryEntityKeyInput,
} from "./discovery-identity";
export {
  normalizeDiscoveredFacts,
  type NormalizeDiscoveryOptions,
  type NormalizedDiscoveryOutput,
  type NormalizedInventoryEntity,
  type NormalizedInventoryRelationship,
  type NormalizedSoftwareEvidence,
} from "./discovery-normalize";
export {
  attributeInventoryEntity,
  buildDiscoveryDescriptor,
  evaluateInventoryQuality,
  flattenEnrichmentForScoring,
  scoreTaxonomyCandidates,
  type InventoryAttributionInput,
  type InventoryAttributionResult,
  type InventoryQualityEntityInput,
  type InventoryQualityEvaluation,
  type InventoryQualityIssue,
  type InventoryQualityRelationshipInput,
  type RankedTaxonomyCandidate,
  type TaxonomyNodeCandidate,
} from "./discovery-attribution";
export {
  buildNormalizationRuleCandidate,
  matchSoftwareIdentityByRule,
  normalizeSoftwareEvidence,
  scoreSoftwareIdentityCandidates,
  type RankedSoftwareIdentityCandidate,
  type RuleCandidateInput,
  type SoftwareEvidenceInput,
  type SoftwareIdentityCandidate,
  type SoftwareNormalizationResult,
  type SoftwareNormalizationRuleCandidate,
  type SoftwareNormalizationRuleInput,
} from "./software-normalization";
export {
  executeBootstrapDiscovery,
  runBootstrapCollectors,
} from "./discovery-runner";
export {
  runConnectionCollectors,
  type ConnectionLoaderDb,
  type DecryptFn,
} from "./discovery-runners/connection-collectors";
// UniFi collector uses 'undici' (Node-only) — do NOT export from barrel.
// Import dynamically in server actions: await import("@dpf/db/discovery-collectors-unifi")
export type { UnifiDeps } from "./discovery-collectors/unifi";
export {
  deriveNestedChevronSequenceWarnings,
  sortStructuredChildren,
  type StructuredChildRecord,
  type StructureConformanceWarning,
} from "./ea-structure";
export {
  persistBootstrapDiscoveryRun,
  summarizeDiscoveryPersistence,
  type DiscoveryPersistenceSummary,
} from "./discovery-sync";
export {
  promoteInventoryEntities,
  generateProductId,
  AUTO_PROMOTE_THRESHOLD,
  PROMOTABLE_TYPES,
  type PromotionSummary,
} from "./discovery-promotion";
export {
  inferCrossCollectorRelationships,
  inferProductDependencies,
  type InferenceSummary,
} from "./discovery-inference";
export * from "./discovery-fingerprint-types";
export * from "./discovery-fingerprint-redaction";
export * from "./discovery-fingerprint-policy";
export * from "./discovery-fingerprint-rules";
