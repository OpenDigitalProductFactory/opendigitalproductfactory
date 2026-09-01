// packages/db/src/table-classification.ts
// Manual mapping of every Prisma model to a data-sensitivity level.
// Drives sanitized-clone obfuscation and export filtering.

export type TableSensitivity = "public" | "internal" | "confidential" | "restricted";

/**
 * Classification of every Prisma model by data sensitivity.
 *
 * - public:       Reference / lookup data safe for any environment.
 * - internal:     Operational data with no PII — copy as-is to dev.
 * - confidential: Contains PII or customer data — obfuscate before copy.
 * - restricted:   Secrets, credentials, auth tokens — never copy.
 */
export const TABLE_CLASSIFICATION: Record<string, TableSensitivity> = {
  // -- public --
  TaxonomyNode: "public",
  // Published IEEE registry of manufacturer MAC prefixes (BI-9632B15B). Contains no
  // customer, estate or personal data — an OUI identifies a manufacturer, never a
  // device owner. Same class as the other shipped lookup tables above.
  MacVendorOui: "public",
  EaElementType: "public",
  EaRelationshipType: "public",
  EaRelationshipRule: "public",
  EaDqRule: "public",
  EaNotation: "public",
  EaStructureRule: "public",
  ViewpointDefinition: "public",
  StorefrontArchetype: "public",
  PlatformCapability: "public",
  Country: "public",
  Region: "public",
  City: "public",
  EmploymentType: "public",
  WorkLocation: "public",
  // Authored vendor-ecosystem absorption doctrine — public vendor/product names,
  // integration categories, verdicts. Reference data, no PII (BI-ECO-001).
  AbsorptionPosture: "public",

  // -- internal --
  // Per-token deferred-tool-loading discovery state: tool names + token id, no
  // PII. Short-TTL, swept by its own expiry (see stewardship-exemptions.txt).
  McpToolSession: "internal",
  // Candidate company/device coordinates learned from trusted introducers are
  // operator-only until independent SAS pairing establishes a relationship.
  FederationIntroductionCandidate: "confidential",
  Portfolio: "internal",
  DigitalProduct: "internal",
  ProductLine: "internal",
  Product: "internal",
  ProductObjective: "internal",
  ProductObjectiveWork: "internal",
  // Outcome narratives/provenance and linked demand evidence can carry
  // customer-derived context even though their owning product records do not.
  ProductOutcomeObservation: "confidential",
  DemandEvidenceLink: "confidential",
  ProductOffering: "internal",
  CatalogItem: "internal",
  ProductConfiguration: "internal",
  CatalogSku: "internal",
  CatalogBundleComponent: "internal",
  CatalogPriceList: "internal",
  CatalogPriceListEntry: "internal",
  CatalogPromotion: "internal",
  CatalogPromotionItem: "internal",
  CatalogChannelEligibility: "internal",
  ProductSold: "internal",
  ProductSoldComponentAllocation: "internal",
  ProductVersion: "internal",
  ChangePromotion: "internal",
  ChangeRequest: "internal",
  ChangeItem: "internal",
  DeploymentWindow: "internal",
  BlackoutPeriod: "internal",
  StandardChangeCatalog: "internal",
  CodebaseManifest: "internal",
  ServiceOffering: "internal",
  BacklogItem: "internal",
  // BI-4CB2EF76: room roster is operational membership (principal FK + roles).
  // Display names stay on Principal; this table is not a second identity store.
  WorkroomParticipant: "internal",
  // BI-662254C6: work-coordination edges between rooms. Operational structure,
  // not a second identity or portfolio-dependency store.
  WorkroomRelation: "internal",
  InitiativeArtifactRetentionPin: "confidential",
  Epic: "internal",
  EpicPortfolio: "internal",
  ImprovementProposal: "internal",
  DecisionResolutionProposal: "internal",
  WeightAdjustmentProposal: "internal",
  BrandingConfig: "internal",
  EaReferenceModel: "internal",
  EaReferenceModelElement: "internal",
  EaReferenceModelArtifact: "internal",
  EaAssessmentScope: "internal",
  EaReferenceAssessment: "internal",
  EaReferenceProposal: "internal",
  EaElement: "internal",
  LifecycleEvent: "confidential",
  PlateauMembership: "internal",
  LifecycleGap: "internal",
  EaRelationship: "internal",
  EaView: "internal",
  EaViewElement: "internal",
  EaConformanceIssue: "internal",
  EaSnapshot: "internal",
  FeatureBuild: "internal",
  BuildActivity: "internal",
  PromotionBackup: "internal",
  FeaturePack: "internal",
  DiscoveryRun: "internal",
  DiscoveredItem: "internal",
  DiscoveredRelationship: "internal",
  InventoryEntity: "internal",
  InventoryRelationship: "internal",
  PortfolioQualityIssue: "internal",
  Regulation: "internal",
  Obligation: "internal",
  Control: "internal",
  ControlObligationLink: "internal",
  Policy: "internal",
  PolicyRequirement: "internal",
  DataProcessingActivity: "confidential",
  DataControlOperation: "restricted",
  DataControlOperationStep: "restricted",
  PolicyObligationLink: "internal",
  TrainingRequirement: "internal",
  PolicyRule: "internal",
  ComplianceSnapshot: "internal",
  RegulatoryMonitorScan: "internal",
  RegulatoryAlert: "internal",
  Notification: "internal",
  DynamicForm: "internal",
  DynamicView: "internal",
  PlatformIssueReport: "internal",
  RuntimeAdvisory: "internal",
  PlatformSetupProgress: "internal",
  PlatformConfig: "internal",
  SelfUpgradeRun: "internal",
  ScheduledJob: "internal",
  McpServer: "internal",
  McpServerTool: "internal",
  McpIntegration: "internal",
  McpCatalogSync: "internal",
  // Per-customer incumbent coverage verdicts — operational, no PII (BI-548060D5).
  IncumbentCoverageAssessment: "internal",
  // Compact source/remote identity, fingerprints, timestamps, and lifecycle
  // only; the service rejects secrets and full content payloads (BI-93507D83).
  ExternalChannelProjection: "internal",
  StorefrontConfig: "internal",
  StorefrontSection: "internal",
  StorefrontItem: "internal",
  // Stock coverage starter (BI-SPEND-003 slice). Supply names, counting units,
  // and quantities carry no PII — the customer-identifying data stays in the
  // order/booking tables, and the supplier's own contact/bank detail stays in
  // the confidential Supplier row this only points at by id.
  StockItem: "internal",
  StorefrontItemComponent: "internal",
  HospitalityResource: "internal",
  HospitalityCapacityPool: "internal",
  HospitalityResourceAvailability: "internal",
  // W19 (BI-99C76A90): unified resource-scheduling family — same class as the
  // vertical clones it will absorb.
  Resource: "internal",
  ResourceAvailability: "internal",
  ResourceCapacityPool: "internal",
  ResourceCapacityAllocation: "internal",
  BeautyResource: "internal",
  BeautyResourceService: "internal",
  BeautyResourceAvailability: "internal",
  // Tenant-scoped aggregate values and model-level lineage only; the
  // projection contract forbids customer, workforce, and financial records.
  BusinessMetricRollup: "internal",
  ProviderService: "internal",
  ProviderAvailability: "internal",
  OnboardingChecklist: "internal",
  OnboardingTask: "internal",
  OnboardingDraft: "internal",
  ReviewCycle: "internal",
  LeavePolicy: "internal",
  CalendarEvent: "internal",
  CalendarSync: "internal",
  ExecutionRecipe: "internal",
  RecurringSchedule: "internal",
  RecurringLineItem: "internal",
  DunningSequence: "internal",
  DunningStep: "internal",
  ExchangeRate: "internal",
  OrgSettings: "internal",
  ApprovalRule: "internal",
  BusinessProfile: "internal",

  // Trust-envelope jurisdiction criteria packs — operator-authored config
  // (required/forbidden/monitoring-only axes + weight overlay per regime). No PII.
  JurisdictionCriteriaProfile: "internal",

  // -- confidential --
  // Trust-envelope evidence re-verification (BI-70FF9114): holds recorded/live
  // excerpts of cited evidence, which may quote decision or candidate source text.
  EvidenceReVerification: "confidential",
  // Trust-envelope MONITORING-ONLY demographic rail (BI-A59CB2EA): protected-class
  // observations for LL144/four-fifths bias audit. PII — obfuscate before any copy.
  ProtectedMonitoringObservation: "confidential",
  User: "confidential",
  CustomerContact: "confidential",
  SocialIdentity: "confidential",
  AccountInvite: "confidential",
  EmployeeProfile: "confidential",
  Department: "confidential",
  Position: "confidential",
  Address: "confidential",
  EmployeeAddress: "confidential",
  EmploymentEvent: "confidential",
  TerminationRecord: "confidential",
  // Employment-law judgements about a named worker (BI-C61CEEA9). A
  // classification decides whether the organisation may direct them and
  // whether they accrue entitlements; the evidence and rationale behind it
  // are free-shaped and can hold personal data.
  WorkerClassificationDetermination: "confidential",
  WorkerEngagementTerm: "confidential",
  Team: "confidential",
  TeamMembership: "confidential",
  Agent: "confidential",
  AgentOwnership: "confidential",
  AgentCapabilityClass: "confidential",
  DirectivePolicyClass: "confidential",
  AgentGovernanceProfile: "confidential",
  DelegationGrant: "confidential",
  AgentThread: "confidential",
  AgentMessage: "confidential",
  AgentActionProposal: "confidential",
  AgentAttachment: "confidential",
  CustomerAccount: "confidential",
  ContactAccountRole: "confidential",
  Organization: "confidential",
  // Operator-authored floor plans can expose internal room, table, equipment,
  // and site geometry plus references to live operational entities.
  OperationalSceneLayout: "confidential",
  Engagement: "confidential",
  Opportunity: "confidential",
  Quote: "confidential",
  QuoteLineItem: "confidential",
  SalesOrder: "confidential",
  Activity: "confidential",
  StorefrontBooking: "confidential",
  HospitalityCapacityAllocation: "confidential",
  BeautyCapacityAllocation: "confidential",
  HospitalityServiceTurn: "confidential",
  HospitalityServiceTurnEvent: "confidential",
  ServiceProvider: "confidential",
  BookingHold: "confidential",
  StorefrontOrder: "confidential",
  StorefrontOrderLineItem: "confidential",
  ProductSoldEvidence: "confidential",
  ProductSoldParty: "confidential",
  ProductSoldEntitlement: "confidential",
  ProductFulfillmentInstance: "confidential",
  StorefrontInquiry: "confidential",
  StorefrontDonation: "confidential",
  Invoice: "confidential",
  InvoiceDocument: "confidential",
  InvoiceLineItem: "confidential",
  Payment: "confidential",
  PaymentAllocation: "confidential",
  Supplier: "confidential",
  Bill: "confidential",
  BillLineItem: "confidential",
  BillApproval: "confidential",
  PurchaseOrder: "confidential",
  PurchaseOrderLineItem: "confidential",
  BankAccount: "confidential",
  BankTransaction: "confidential",
  BankRule: "confidential",
  DunningLog: "confidential",
  ExpenseClaim: "confidential",
  ExpenseItem: "confidential",
  FixedAsset: "confidential",
  ReviewInstance: "confidential",
  ReviewGoal: "confidential",
  FeedbackNote: "confidential",
  LeaveBalance: "confidential",
  LeaveRequest: "confidential",
  TimesheetPeriod: "confidential",
  TimesheetEntry: "confidential",
  RequirementCompletion: "confidential",
  PolicyAcknowledgment: "confidential",
  ComplianceEvidence: "confidential",
  RiskAssessment: "confidential",
  RiskControl: "confidential",
  ComplianceIncident: "confidential",
  CorrectiveAction: "confidential",
  ComplianceAudit: "confidential",
  AuditFinding: "confidential",
  RegulatorySubmission: "confidential",
  PushDeviceRegistration: "confidential",
  ExternalEvidenceRecord: "confidential",
  AsyncInferenceOp: "confidential",
  // Connection posture can reference the restricted ModelProvider catalog and
  // credential/contract records. Copying it without those parents creates an
  // invalid preview and exposes organization-specific provider governance.
  AiProviderConnection: "restricted",
  // MCP OAuth authorization server (BI-E4DFDCB0). All three hold or gate
  // credentials: OAuthClient carries a hashed AND an encrypted client secret,
  // and the code/refresh tables hold hashes that are directly exchangeable for
  // an access token. "restricted" means never copied to a dev environment,
  // which is the only correct answer for an auth-token table.
  OAuthClient: "restricted",
  OAuthAuthorizationCode: "restricted",
  OAuthRefreshToken: "restricted",
  // Embeddings are derived from source content and may retain semantic detail
  // even when the source text is otherwise obfuscated.
  VectorEmbedding: "restricted",
  TaskRun: "confidential",
  TaskNode: "confidential",
  TaskNodeEdge: "confidential",
  UserSkill: "confidential",
  TaskRequirement: "confidential",
  RouteDecisionLog: "confidential",
  CustomEvalDimension: "confidential",

  // -- restricted (16) --
  PasswordResetToken: "restricted",
  PlatformRole: "restricted",
  // Memberships require PlatformRole, so retaining them while roles are
  // omitted creates authorization references that can never be resolved.
  UserGroup: "restricted",
  CredentialEntry: "restricted",
  DataPolicyException: "restricted",
  OAuthPendingFlow: "restricted",
  ModelProvider: "restricted",
  DiscoveredModel: "restricted",
  ModelProfile: "restricted",
  TokenUsage: "restricted",
  EndpointTaskPerformance: "restricted",
  TaskEvaluation: "restricted",
  EndpointTestRun: "restricted",
  AuthorizationDecisionLog: "restricted",
  // Machine certificate binding and lifecycle metadata is authorization
  // material. The private key remains on the Edge Node and is never stored.
  EdgeNodeCertificate: "restricted",
  PatientProfile: "restricted",
  PatientAuthority: "restricted",
  PatientConsentDirective: "restricted",
  CareAppointment: "restricted",
  CareAppointmentParticipant: "restricted",
  CareAppointmentResource: "restricted",
  CareAppointmentStatusEvent: "restricted",
  AppointmentSyncEvent: "restricted",
  CareIntakePacket: "restricted",
  CareIntakeResponse: "restricted",
  CareIntakeAccessGrant: "restricted",
  CareConsentAttestation: "restricted",
  CareCoverageEvidence: "restricted",
  CareIntakeException: "restricted",
  CareIntakeStatusEvent: "restricted",
  ComplianceAuditLog: "restricted",
  RouteOutcome: "restricted",
  RecipePerformance: "restricted",
  ApiToken: "restricted",
  // -- recruiting / ATS (BI-F3AEBF68) --
  JobRequisition: "internal",
  RequisitionOpening: "internal",
  JobPosting: "internal",
  RecruitingSource: "internal",
  PipelineStage: "internal",
  DispositionReason: "internal",
  Candidate: "confidential",
  Application: "confidential",
  ScheduledInterview: "confidential",
  Scorecard: "confidential",
  Offer: "confidential",
  DemographicResponse: "restricted",
  // Payroll pay records (recruiting→hiring→paying seam) — pay amounts + PII.
  PayRun: "confidential",
  Payslip: "confidential",
  // -- payroll component lines (BI-EAC670F1) --
  // Both carry regulated employee financial detail: individual pay components
  // and standing deduction instructions (including garnishments).
  PayComponentLine: "confidential",
  EmployeeDeductionElection: "confidential",
  // -- mileage absorption (EP-MILEAGE-ABSORB) --
  // Trip carries precise personal location for an identified employee — the most
  // sensitive data this substrate holds. Vehicle and the consent record bind to a
  // named driver; a commute-exclusion rule's predicate can embed a home radius,
  // so the rule table is PII-bearing too and is classified with the rest.
  Vehicle: "confidential",
  Trip: "confidential",
  TripClassificationRule: "confidential",
  DriverLocationConsent: "confidential",
  // Rate tables are org configuration, not personal data.
  MileageRatePlan: "internal",
  MileageRate: "internal",

  // Period component totals are aggregate business figures for one filing
  // period — no employee is identifiable from a withheld total, which is the
  // sum across the whole payroll. The per-person detail lives on Payslip.
  TaxObligationPeriodComponent: "internal",
  // A deposit cadence determination is org tax configuration: a cadence, the
  // threshold it was judged against, and the citation for that threshold.
  TaxDepositSchedule: "internal",
};

/** Fallback for tables not yet classified — defaults to confidential (obfuscate). */
export const DEFAULT_SENSITIVITY: TableSensitivity = "confidential";

// The clone enumerates physical PostgreSQL names, while this registry is keyed
// by canonical Prisma model names. Keep explicit aliases for mapped models whose
// classification differs from the confidential fallback.
const PHYSICAL_TABLE_MODEL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  vector_embedding: "VectorEmbedding",
});

/** Look up the sensitivity level for a table, falling back to DEFAULT_SENSITIVITY. */
export function getTableSensitivity(tableName: string): TableSensitivity {
  const canonicalName = PHYSICAL_TABLE_MODEL_ALIASES[tableName] ?? tableName;
  return TABLE_CLASSIFICATION[canonicalName] ?? DEFAULT_SENSITIVITY;
}
