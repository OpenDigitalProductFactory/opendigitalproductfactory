// packages/db/src/index.ts
export { prisma } from "./client";
export { ensureDefaultProviderConnection, refreshDefaultProviderConnectionOwners } from "./provider-connection";
export {
  PROVIDER_COMPLIANCE_SOURCE_REGISTRY,
  validateProviderComplianceSourceRegistry,
  type ProviderComplianceClaimApplicability,
  type ProviderComplianceSourceAuthority,
  type ProviderComplianceSourceClaim,
  type ProviderComplianceSourceEntry,
} from "./provider-compliance-source-registry";
// Prisma is exported as both a value (for runtime helpers like Prisma.JsonNull,
// Prisma.DbNull) and a type (for input/output type aliases).
export { Prisma } from "../generated/client/client";
export type {
  PrismaClient,
  PayRunStatus,
  PayslipDisbursementStatus,
  // W19 unified resource-scheduling family (BI-99C76A90) + the W20 record
  // lifecycle convention enum (BI-C357FA5A).
  RecordLifecycle,
  ResourceDomain,
  AvailabilityWindowKind,
  CapacityAllocationState,
} from "../generated/client/client";
export { WriteGateRequirement } from "../generated/client/client";
// Worker classification: the legally-consequential axis, distinct from the
// organisation's EmploymentType label (BI-C61CEEA9). Exported as a value so the
// app composes from the generated enum instead of re-typing its members.
export { WorkerClassification } from "../generated/client/client";
// Decision-resolution proposal vocabulary (BI-3D0FB84B). Exported as values so
// the app composes from the generated enum instead of re-typing its members.
export {
  DecisionProposalAction,
  DecisionProposalScope,
  DecisionProposalStatus,
} from "../generated/client/client";
export {
  WorkroomParticipantRole,
  WorkroomParticipantAssignmentSource,
  WorkroomRelationKind,
} from "../generated/client/client";
export {
  PRINCIPAL_SENSITIVITIES,
  isPrincipalSensitivity,
  normalizePrincipalSensitivities,
  type PrincipalSensitivity,
} from "./principal-sensitivity";
export * from "./healthcare-patient-authority";
export * from "./healthcare-care-intake";
export * from "./subject-reference";
export * from "./agent-principal-convergence";

// Quality-issue lifecycle governance (BI-0B420A1D): the registry is the
// compile-time contract; the drift sweep is the runtime half.
export {
  QUALITY_ISSUE_REGISTRY,
  QUALITY_ISSUE_TYPES,
  isKnownQualityIssueType,
  qualityIssueContract,
  operatorActionableTypes,
  qualityIssueDrift,
  type QualityIssueType,
  type QualityIssueContract,
  type QualityIssueResolver,
} from "./quality-issue-registry";
export {
  runQualityIssueDriftSweep,
  type DriftSweepDb,
  type QualityIssueDriftReport,
} from "./quality-issue-drift-sweep";

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
  type MatchClause,
  type QdrantFilter,
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
  getInfraEdges,
  getEdgesAmong,
  deleteGraphNode,
  clearGraphByLabel,
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
  describeEstateScope,
  estateRoutingFields,
  estateScopeKey,
  isCustomerScoped,
  resolveEstateScope,
  type EstateRoutingFields,
  type EstateScopeContext,
  type EstateScopeInput,
  type EstateScopeMode,
} from "./estate-scope";
export {
  isValidTicketStatusTransition,
  priorityFromSeverity,
  serviceTicketDraftFromIncident,
  SERVICE_TICKET_KINDS,
  SERVICE_TICKET_PRIORITIES,
  SERVICE_TICKET_STATUSES,
  type IncidentLike,
  type ServiceTicketDraft,
  type ServiceTicketKind,
  type ServiceTicketPriority,
  type ServiceTicketScope,
  type ServiceTicketStatus,
} from "./service-ticket-types";
export {
  canAuthenticateUnderTrust,
  canSubmitUnderTrust,
  canTransitionTrust,
  hasTokenPrefix,
  isBootstrapConsumed,
  isBootstrapUsable,
  isDualApproved,
  resolveLinkTrust,
  tokenDisplayPrefix,
  TOKEN_PREFIXES,
  TRUST_STATES,
  type AuthGateState,
  type BootstrapTokenState,
  type LinkTrustInput,
  type TrustState,
} from "./trust-link-lifecycle";
export {
  canExchangeOverLink,
  FEDERATION_BOOTSTRAP_DEFAULT_TTL_MS,
  FEDERATION_BOOTSTRAP_MAX_TTL_MS,
  FEDERATION_BOOTSTRAP_TOKEN_PREFIX,
  FEDERATION_LINK_TOKEN_PREFIX,
  FEDERATION_LINK_TOKEN_TTL_MS,
  FEDERATION_OPERATOR_ALIAS_TYPE,
  FEDERATION_OPERATOR_PRINCIPAL_KIND,
  FEDERATION_PEER_ALIAS_TYPE,
  FEDERATION_PEER_PRINCIPAL_KIND,
  FEDERATION_RELATIONSHIP_PRESETS,
  FEDERATION_RELATIONSHIP_ROLE_PAIRS,
  FEDERATION_ROLES,
  inverseRole,
  isFederationRelationshipPreset,
  isRoleAllowedForRelationship,
  isFederationRole,
  linkStateFromRow,
  type FederationLinkTrustRow,
  type FederationRelationshipPreset,
  type FederationRole,
} from "./federation-link-types";
export {
  FEDERATION_PAIRING_DIRECTIONS,
  FEDERATION_PAIRING_STATUSES,
  canTransitionFederationPairing,
  isFederationPairingDirection,
  isFederationPairingStatus,
  resolveFederationPairingStatus,
  type FederationPairingDirection,
  type FederationPairingStatus,
} from "./federation-pairing-types";
export {
  DEMAND_ACTIVITIES,
  DEMAND_ATTRIBUTIONS,
  DEMAND_AUDIENCES,
  DEMAND_PROJECTION_TEMPLATES,
  DEMAND_SCHEMA_VERSIONS,
  validateDemandEnvelopeV1,
  type DemandActivity,
  type DemandAttribution,
  type DemandAudience,
  type DemandEnvelopeV1,
  type DemandEnvelopeValidationContext,
  type DemandRouteHopV1,
  type DemandSchemaVersion,
} from "./federated-demand-contract";
export {
  assertNoExcludedEgress,
  isForbiddenField,
  projectEstatePayload,
  toCloudEvent,
  type CloudEventEnvelope,
  type ProjectionContractSpec,
  type ProjectionResult,
  type RetentionClass,
} from "./projection-serialization";
export {
  DEFAULT_INCIDENT_PROJECTION,
  INCIDENT_SLICE,
  projectIncidentForEgress,
  resolveIncidentProjectionSpec,
  type IncidentEgressResult,
} from "./projection-egress";
export {
  canTransitionDispatch,
  claimableActionsForNode,
  isClaimableByNode,
  isDispatchActionType,
  isPrivilegedDispatchActionType,
  isReadonlyDispatchActionType,
  nodeScopeMatchesAction,
  DEFAULT_CLAIM_TIMEOUT_MS,
  READONLY_DISPATCH_ACTION_TYPES,
  PRIVILEGED_DISPATCH_ACTION_TYPES,
  REMOTE_ACTION_DISPATCH_STATES,
  type ClaimDecision,
  type ClaimingNodeView,
  type DispatchableActionView,
  type ReadonlyDispatchActionType,
  type RemoteActionDispatchState,
} from "./remote-action-dispatch";
export {
  canonicalizeEdgeActionEnvelope,
  EDGE_ACTION_ENVELOPE_VERSION,
  MAX_EDGE_ACTION_ENVELOPE_LIFETIME_MS,
  signEdgeActionEnvelope,
  verifyEdgeActionEnvelope,
  type EdgeActionEnvelope,
  type EdgeActionEnvelopeVerification,
  type SignedEdgeActionEnvelope,
} from "./edge-action-envelope";
export {
  isOrganizationJoinActionType,
  ORGANIZATION_JOIN_ACTION_TYPES,
  parseOrganizationJoinDispatchParameters,
  parseOrganizationJoinPackage,
  parseOrganizationJoinRequest,
  requiredOrganizationTrustRole,
  type OrganizationJoinActionType,
  type OrganizationJoinImportParameters,
  type OrganizationJoinIssueParameters,
  type OrganizationJoinPackagePreview,
  type OrganizationJoinRequestParameters,
  type OrganizationTrustRole,
} from "./organization-join-action";
export {
  buildOrganizationCrosswalk,
  FEDERATED_RECORD_TYPES,
  reconcileMirror,
  type CanonicalSide,
  type FederatedRecordType,
  type IncomingMirrorUpdate,
  type MirrorDecision,
  type MirrorState,
  type MirrorSyncStatus,
  type OrganizationCrosswalk,
} from "./federated-record-sync";
export {
  ENROLLMENT_DECISIONS,
  MANUAL_APPROVAL_REASONS,
  evaluateOrganizationEnrollment,
  type EnrollmentDecision,
  type EnrollmentEvaluation,
  type EnrollmentProposal,
  type ManualApprovalReason,
  type OrganizationTrustAnchor,
  type PeerEnrollmentEvidence,
} from "./organization-federation-enrollment";
export {
  PAIRING_MODES,
  PAIRING_BLOCK_REASONS,
  decideAutomaticPairing,
  mayPairWithoutOperator,
  type AutomaticPairingDecision,
  type CandidateTransport,
  type PairingBlockReason,
  type PairingDecisionReason,
  type PairingMode,
} from "./automatic-pairing-decision";
export {
  PEER_VERIFICATION_FAILURES,
  normalizeFingerprint,
  verifyPeerChainAgainstRoot,
  type ObservedCertificate,
  type PeerVerification,
  type PeerVerificationFailure,
} from "./peer-certificate-verification";
export {
  PAIRING_SOURCES,
  pairingSupportsWorkSync,
  resolveInstallationPairing,
  type PairingLink,
  type PairingSource,
  type ResolvedPairing,
} from "./installation-peer-pairing";
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
  syncEaElement,
  syncEaRelationship,
} from "./graph-sync";
export {
  CODE_GRAPH_KEY,
  DOC_GRAPH_KEY,
  DOC_IMPACT_REL,
  DOC_IMPACT_SOURCE_LABEL,
  DOC_PAGE_LABEL,
  docPageKey,
  countDocPagesInManifest,
  planDocImpactProjection,
  routeKey,
  sourceFileKey,
  type DocImpactManifest,
  type DocImpactPlan,
} from "./doc-impact-graph";
export { projectDocImpactManifest } from "./doc-impact-graph-sync";
export { rebuildKnowledgeAndPortfolioGraph } from "./knowledge-portfolio-graph-sync";
// Import-safe by construction (no dotenv, no CLI specifiers) — the same split that
// keeps a runner out of the Next bundle applies here (BI-FEDFABF6).
export {
  classifyProjection,
  hasProjectionFault,
  PORTFOLIO_LABELS,
  reconcileGraphProjections,
  WIKI_LABEL_PREFIX,
  type ProjectionReconciliation,
  type ProjectionStatus,
} from "./graph-projection-reconcile";
export {
  readCanonicalPrismaSchema,
  listCanonicalPrismaSchemaFiles,
  CANONICAL_PRISMA_SCHEMA_DIR,
  CANONICAL_PRISMA_SCHEMA_PATH,
} from "./schema-source";
export { DATA_MODEL_MIRROR_TASK_ID } from "./data-model-mirror-config";
export { SYSML_PROJECTION_TASK_ID } from "./sysml-projection-config";
export { SELF_OPTIMIZATION_SWEEP_TASK_ID } from "./self-optimization-sweep-config";
// Canonical SysML projection applier — shared by seed-time views (packages/db
// seed-ea-sysml-*.ts) and runtime extractors (apps/web/lib/ea, via this barrel).
export {
  applySysmlModel,
  type SysmlDesiredElement,
  type SysmlDesiredRel,
  type SysmlDesiredConformanceIssue,
  type SysmlDesiredModel,
  type SysmlSeedResult,
} from "./sysml-model-seed";
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
  loadDiscoveryAttributionInputs,
  type DiscoveryAttributionInputs,
} from "./discovery-attribution-inputs";
export {
  backfillDiscoveryAttribution,
  type AttributionBackfillReport,
} from "./discovery-attribution-backfill";
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
export * from "./discovery-fingerprint-observation";
// Asset-intelligence on-demand product enrichment (EP-ASSET-INTELLIGENCE, spec §4.2/§4.6)
// — the enrich_digital_product / request_re_enrichment MCP tools' backing logic.
export * from "./enrich-digital-product";
// Asset-intelligence catalog enrichment sweep (EP-ASSET-INTELLIGENCE, spec §4.2/§4.4)
// — the governed loop that runs the endoflife.date / CPE / SBOM feeds over the
// CatalogIdentity spine. The per-feed modules stay internal; the sweep is the surface.
export * from "./catalog-enrichment-sweep";
// Asset-intelligence AI identity-resolution fallback (EP-ASSET-INTELLIGENCE, spec §4.2/§8)
// — the cheap-model fallback for the ambiguous tail deterministic rules don't resolve,
// under a batching + per-run inference budget cost guardrail. Pure engine; the governed
// apps/web runner wires the real prisma + a minimize_cost inference fn.
export * from "./catalog-identity-inference";
export {
  buildCommonsFingerprint,
  isContributableFingerprint,
  looksLikeIdentifier,
  assertNoIdentifiers,
  type CommonsFingerprint,
  type FingerprintContributionCandidate,
} from "./fingerprint-commons-contribution";
// HAM Phase D2 (BI-828998DC, spec §7): read-model correlation of discovered InventoryEntity
// to managed CustomerConfigurationItem — no authority move, no persistence.
export * from "./inventory-cci-bridge";
// HAM Phase D2 (BI-1093AF1C, spec §7): read-model reconciliation of discovered InventoryEntity
// against the FixedAsset register (serial-only) — no authority move, no persistence.
export * from "./inventory-asset-bridge";
export * from "./inventory-entity-lifecycle";
export * from "./inventory-entity-heap-integrity";
export * from "./inventory-entity-merge-references";
export * from "./docker-origin";
export * from "./device-placement";
export * from "./portfolio-sources";
export * from "./backlog-portfolio";
export * from "./workforce-portfolio";
export * from "./device-investigation";
export * from "./device-fingerprint-contribution";
export * from "./hive-contribution-settings";
export * from "./device-catalog";
// `./discovery-fingerprint-catalog` is intentionally NOT re-exported. Its
// `validateFingerprintCatalog` helper uses dynamic `path.resolve(process.cwd(), ...)`
// to locate catalog JSON at runtime, which Turbopack flags as an overly broad
// NFT pattern. The helper is test-only — import it directly from
// `./discovery-fingerprint-catalog` in tests, not via the barrel.
export * from "./discovery-fingerprint-store";
export * from "./installation-operating-intent";
export * from "./installation-instance-stance";
export * from "./reference-freshness";

// Contributor-inventory-sync ScheduledJob constants — shared between the
// seed helper and the apps/web Inngest runner so the heartbeat row's name +
// schedule strings cannot drift between create (seed) and create-on-miss
// (runner upsert).
export {
  CONTRIBUTOR_INVENTORY_JOB_ID,
  CONTRIBUTOR_INVENTORY_JOB_NAME,
  CONTRIBUTOR_INVENTORY_SCHEDULE,
} from "./seed-contributor-inventory";
