// packages/db/src/index.ts
export { prisma } from "./client";
export type { Prisma, PrismaClient } from "../generated/client";

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
export { initNeo4jSchema } from "./neo4j-schema";
export {
  getDownstreamImpact,
  getUpstreamDependencies,
  getProductsByPortfolio,
  getProductsByTaxonomySubtree,
  shortestPath,
  getInfraCIs,
  getNeighbours,
  type GraphNode,
  type GraphEdge,
  type ImpactResult,
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
