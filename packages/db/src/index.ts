// packages/db/src/index.ts
export { prisma } from "./client";
// Prisma is exported as both a value (for runtime helpers like Prisma.JsonNull,
// Prisma.DbNull) and a type (for input/output type aliases).
export { Prisma } from "../generated/client/client";
export type { PrismaClient } from "../generated/client/client";
export { WriteGateRequirement } from "../generated/client/client";

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

// EP-WIKI-001 Phase 1a: wiki kernel + per-org overlay store helpers
// Phase 2.1 adds the raw-source ingest helpers (upsertRawSource,
// recordIngestEvent, RAW_SOURCE_TYPES) consumed by the file-source
// orchestrator in apps/web/lib/wiki/ingest.ts.
export {
  upsertWikiPage,
  appendRevision,
  linkPages,
  attachSource,
  getWikiPage,
  listPrinciplesByTier,
  upsertRawSource,
  recordIngestEvent,
  RAW_SOURCE_TYPES,
  isRawSourceType,
  type WikiStoreClient,
  type WikiPageKind,
  type WikiPageStatus,
  type WikiRevisionChangeKind,
  type UpsertWikiPageInput,
  type AppendRevisionInput,
  type LinkPagesInput,
  type AttachSourceInput,
  type WikiPagePrincipleInput,
  type UpsertRawSourceInput,
  type RecordIngestEventInput,
  type RawSourceType,
} from "./wiki-store";

// EP-WIKI-001 Phase 2.1: re-export the shared frontmatter parser so the
// apps/web ingest orchestrator can reuse the same YAML subset that
// founder-kernel raw-source files are written against, without reaching
// into @dpf/db internals. Lives in `./wiki-frontmatter` rather than
// `./seed-wiki-kernel` because the seed module's `__dirname`-based
// KERNEL_DIR constant fails to evaluate under Vite's ESM/SSR loader.
export {
  parseFrontmatter as parseWikiFrontmatter,
  extractWikilinks,
  type RawSourceFrontmatter,
  type WikiPageFrontmatter,
} from "./wiki-frontmatter";

// Principles-as-wiki-kind Phase 0: taxonomy constants + predicates so
// retrieval, lint, MCP, and UI consumers in apps/web import them through
// the @dpf/db barrel.
export {
  WIKI_PAGE_KINDS,
  WIKI_PAGE_STATUSES,
  PRINCIPLE_TIERS,
  PRINCIPLE_APPLIES_TO,
  PRINCIPLE_DIMENSIONS,
  PRINCIPLE_TIER_DEFAULT_WEIGHT,
  PRINCIPLE_TIER_CAPS,
  PRINCIPLE_DECIDE_DEFAULTS,
  isWikiPageKind,
  isWikiPageStatus,
  isPrincipleTier,
  isPrincipleAppliesTo,
  isPrincipleDimension,
  type PrincipleTier,
  type PrincipleAppliesTo,
  type PrincipleDimension,
} from "./wiki-taxonomy";
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
  getNetworkTopologyAtLayerForScope,
  type Neo4jTopologyScope,
  pruneStaleInfraCIs,
  type GraphNode,
  type GraphEdge,
  type ImpactResult,
  type LayeredDependency,
  type PruneResult,
} from "./neo4j-graph";
export {
  buildDiscoveryScopeKey,
  buildScopedInventoryEntityKey,
  buildScopedRelationshipKey,
  resolveDiscoveryScopeFromIds,
  scopeFieldsFromContext,
  type DiscoveryScopeContext,
  type DiscoveryScopeFields,
} from "./discovery-scope";
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
  syncDocumentNode,
  syncDocumentReference,
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
  type DiscoveryProjectionOptions,
  type DiscoverySyncClient,
} from "./discovery-sync";
export {
  persistSubmittedDiscoveryRun,
  type SubmittedDiscoveryRunInput,
} from "./persist-submitted-discovery-run";
export {
  promoteInventoryEntities,
  generateProductId,
  AUTO_PROMOTE_THRESHOLD,
  PROMOTABLE_TYPES,
  type PromotionSummary,
} from "./discovery-promotion";
export {
  reconcilePromotedProducts,
  isInfrastructureProduct,
  type ReconcileSummary,
} from "./discovery-reconcile";
export {
  isNonProductEntityType,
  NON_PRODUCT_ENTITY_TYPES,
} from "./discovery-promotion-policy";
export {
  TRIAGE_ACTOR_TYPES,
  TRIAGE_OUTCOMES,
  TRIAGE_QUALITY_ISSUE_TYPES,
  type TriageActorType,
  type TriageOutcome,
  type TriageQualityIssueType,
} from "./discovery-triage-enums";
export {
  buildDiscoveryEvidencePacket,
  DEFAULT_DISCOVERY_TRIAGE_THRESHOLDS,
  recordDiscoveryTriageDecision,
  resolveDiscoveryTriageOutcome,
  scoreDiscoveryTriageCandidate,
  shouldAutoApplyTriageDecision,
  synthesizeDiscoveryFingerprintRule,
  type DiscoveryEvidencePacket,
  type DiscoveryEvidencePacketInput,
  type DiscoveryProtocolEvidence,
  type DiscoveryTriageClient,
  type DiscoveryTriageDecisionInput,
  type DiscoveryTriageIdentityCandidate,
  type DiscoveryTriageProposedRule,
  type DiscoveryTriageScore,
  type DiscoveryTriageTaxonomyCandidate,
  type DiscoveryTriageThresholds,
} from "./discovery-triage";
export * from "./discovery-triage-config";
export * from "./seed-discovery-triage";
export {
  inferCrossCollectorRelationships,
  inferProductDependencies,
  type InferenceSummary,
} from "./discovery-inference";
export * from "./discovery-fingerprint-types";
export * from "./discovery-fingerprint-redaction";
export * from "./discovery-fingerprint-policy";
export * from "./discovery-fingerprint-rules";
export * from "./discovery-mac-classification";
export * from "./device-placement";
// `./discovery-fingerprint-catalog` is intentionally NOT re-exported. Its
// `validateFingerprintCatalog` helper uses dynamic `path.resolve(process.cwd(), ...)`
// to locate catalog JSON at runtime, which Turbopack flags as an overly broad
// NFT pattern. The helper is test-only — import it directly from
// `./discovery-fingerprint-catalog` in tests, not via the barrel.
export * from "./discovery-fingerprint-store";

// Contributor-inventory-sync ScheduledJob constants — shared between the
// seed helper and the apps/web Inngest runner so the heartbeat row's name +
// schedule strings cannot drift between create (seed) and create-on-miss
// (runner upsert).
export {
  CONTRIBUTOR_INVENTORY_JOB_ID,
  CONTRIBUTOR_INVENTORY_JOB_NAME,
  CONTRIBUTOR_INVENTORY_SCHEDULE,
} from "./seed-contributor-inventory";
