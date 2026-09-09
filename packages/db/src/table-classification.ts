// packages/db/src/table-classification.ts
// Sensitivity for Prisma models that do NOT yet carry a `/// @dpf sensitivity=` tag
// (EP-A33A5C61 slice 4d-ii). The schema tag is the declaration; this registry is
// the shrink-only remainder and drives sanitized-clone obfuscation / export
// filtering only for untagged models.

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { parseModelMetadataSources } from "./model-metadata";
import { listCanonicalPrismaSchemaFiles } from "./schema-source";

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
  // Mailroom (design 2026-09-09 §4.3): a declared mailbox row carries the
  // encrypted IMAP password or Graph client secret in secretsEnc — never copy.
  MailboxAccount: "restricted",
  // -- public --
  // Published IEEE registry of manufacturer MAC prefixes (BI-9632B15B). Contains no
  // customer, estate or personal data — an OUI identifies a manufacturer, never a
  // device owner. Same class as the other shipped lookup tables above.
  // Authored vendor-ecosystem absorption doctrine — public vendor/product names,
  // integration categories, verdicts. Reference data, no PII (BI-ECO-001).

  // -- internal --
  // Per-token deferred-tool-loading discovery state: tool names + token id, no
  // PII. Short-TTL, swept by its own expiry (see stewardship-exemptions.txt).
  // Candidate company/device coordinates learned from trusted introducers are
  // operator-only until independent SAS pairing establishes a relationship.
  Portfolio: "internal",
  DigitalProduct: "internal",
  // Outcome narratives/provenance and linked demand evidence can carry
  // customer-derived context even though their owning product records do not.
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
  // BI-662254C6: work-coordination edges between rooms. Operational structure,
  // not a second identity or portfolio-dependency store.
  Epic: "internal",
  EpicPortfolio: "internal",
  ImprovementProposal: "internal",
  BrandingConfig: "internal",
  EaReferenceModel: "internal",
  EaReferenceModelElement: "internal",
  EaReferenceModelArtifact: "internal",
  EaAssessmentScope: "internal",
  EaReferenceAssessment: "internal",
  EaReferenceProposal: "internal",
  EaElement: "internal",
  EaRelationship: "internal",
  EaView: "internal",
  EaViewElement: "internal",
  EaConformanceIssue: "internal",
  EaSnapshot: "internal",
  FeatureBuild: "internal",
  PromotionBackup: "internal",
  FeaturePack: "internal",
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
  PolicyObligationLink: "internal",
  TrainingRequirement: "internal",
  PolicyRule: "internal",
  ComplianceSnapshot: "internal",
  RegulatoryMonitorScan: "internal",
  RegulatoryAlert: "internal",
  DynamicForm: "internal",
  DynamicView: "internal",
  PlatformIssueReport: "internal",
  RuntimeAdvisory: "internal",
  PlatformSetupProgress: "internal",
  PlatformConfig: "internal",
  ScheduledJob: "internal",
  // EP-A33A5C61 slice 5: per-table byte/row samples, no row content. The schema
  // tag carries the same class; this entry leaves with slice 4d-ii.
  TableGrowthSample: "internal",
  McpServer: "internal",
  McpServerTool: "internal",
  McpIntegration: "internal",
  McpCatalogSync: "internal",
  // Per-customer incumbent coverage verdicts — operational, no PII (BI-548060D5).
  // Compact source/remote identity, fingerprints, timestamps, and lifecycle
  // only; the service rejects secrets and full content payloads (BI-93507D83).
  StorefrontConfig: "internal",
  StorefrontSection: "internal",
  StorefrontItem: "internal",
  // Stock coverage starter (BI-SPEND-003 slice). Supply names, counting units,
  // and quantities carry no PII — the customer-identifying data stays in the
  // order/booking tables, and the supplier's own contact/bank detail stays in
  // the confidential Supplier row this only points at by id.
  // W19 (BI-99C76A90): unified resource-scheduling family — same class as the
  // vertical clones it will absorb.
  // Tenant-scoped aggregate values and model-level lineage only; the
  // projection contract forbids customer, workforce, and financial records.
  ProviderService: "internal",
  ProviderAvailability: "internal",
  OnboardingChecklist: "internal",
  OnboardingTask: "internal",
  OnboardingDraft: "internal",
  ReviewCycle: "internal",
  LeavePolicy: "internal",
  CalendarSync: "internal",
  ExecutionRecipe: "internal",
  RecurringSchedule: "internal",
  RecurringLineItem: "internal",
  DunningSequence: "internal",
  DunningStep: "internal",
  OrgSettings: "internal",
  ApprovalRule: "internal",
  BusinessProfile: "internal",

  // Trust-envelope jurisdiction criteria packs — operator-authored config
  // (required/forbidden/monitoring-only axes + weight overlay per regime). No PII.

  // -- confidential --
  // Trust-envelope evidence re-verification (BI-70FF9114): holds recorded/live
  // excerpts of cited evidence, which may quote decision or candidate source text.
  // Trust-envelope MONITORING-ONLY demographic rail (BI-A59CB2EA): protected-class
  // observations for LL144/four-fifths bias audit. PII — obfuscate before any copy.
  User: "confidential",
  CustomerContact: "confidential",
  SocialIdentity: "confidential",
  AccountInvite: "confidential",
  EmployeeProfile: "confidential",
  Department: "confidential",
  Position: "confidential",
  Address: "confidential",
  EmployeeAddress: "confidential",
  // Employment-law judgements about a named worker (BI-C61CEEA9). A
  // classification decides whether the organisation may direct them and
  // whether they accrue entitlements; the evidence and rationale behind it
  // are free-shaped and can hold personal data.
  Team: "confidential",
  TeamMembership: "confidential",
  Agent: "confidential",
  AgentOwnership: "confidential",
  AgentCapabilityClass: "confidential",
  DirectivePolicyClass: "confidential",
  AgentGovernanceProfile: "confidential",
  DelegationGrant: "confidential",
  AgentMessage: "confidential",
  AgentActionProposal: "confidential",
  AgentAttachment: "confidential",
  CustomerAccount: "confidential",
  ContactAccountRole: "confidential",
  Organization: "confidential",
  // Operator-authored floor plans can expose internal room, table, equipment,
  // and site geometry plus references to live operational entities.
  Engagement: "confidential",
  Opportunity: "confidential",
  Quote: "confidential",
  QuoteLineItem: "confidential",
  SalesOrder: "confidential",
  StorefrontBooking: "confidential",
  ServiceProvider: "confidential",
  BookingHold: "confidential",
  StorefrontInquiry: "confidential",
  Supplier: "confidential",
  BankAccount: "confidential",
  BankTransaction: "confidential",
  BankRule: "confidential",
  ReviewInstance: "confidential",
  ReviewGoal: "confidential",
  FeedbackNote: "confidential",
  LeaveBalance: "confidential",
  LeaveRequest: "confidential",
  TimesheetPeriod: "confidential",
  TimesheetEntry: "confidential",
  RiskAssessment: "confidential",
  RiskControl: "confidential",
  ComplianceIncident: "confidential",
  CorrectiveAction: "confidential",
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
  // Embeddings are derived from source content and may retain semantic detail
  // even when the source text is otherwise obfuscated.
  VectorEmbedding: "restricted",
  TaskRun: "confidential",
  TaskNode: "confidential",
  TaskNodeEdge: "confidential",
  UserSkill: "confidential",
  TaskRequirement: "confidential",
  CustomEvalDimension: "confidential",

  // -- restricted (16) --
  PasswordResetToken: "restricted",
  PlatformRole: "restricted",
  // Memberships require PlatformRole, so retaining them while roles are
  // omitted creates authorization references that can never be resolved.
  UserGroup: "restricted",
  CredentialEntry: "restricted",
  OAuthPendingFlow: "restricted",
  ModelProvider: "restricted",
  DiscoveredModel: "restricted",
  ModelProfile: "restricted",
  EndpointTaskPerformance: "restricted",
  // Machine certificate binding and lifecycle metadata is authorization
  // material. The private key remains on the Edge Node and is never stored.
  PatientProfile: "restricted",
  PatientAuthority: "restricted",
  PatientConsentDirective: "restricted",
  CareAppointment: "restricted",
  CareAppointmentParticipant: "restricted",
  CareAppointmentResource: "restricted",
  CareIntakePacket: "restricted",
  CareIntakeResponse: "restricted",
  CareIntakeAccessGrant: "restricted",
  CareConsentAttestation: "restricted",
  CareCoverageEvidence: "restricted",
  CareIntakeException: "restricted",
  RouteOutcome: "restricted",
  RecipePerformance: "restricted",
  ApiToken: "restricted",
  // -- recruiting / ATS (BI-F3AEBF68) --
  // Payroll pay records (recruiting→hiring→paying seam) — pay amounts + PII.
  // -- payroll component lines (BI-EAC670F1) --
  // Both carry regulated employee financial detail: individual pay components
  // and standing deduction instructions (including garnishments).
  // -- mileage absorption (EP-MILEAGE-ABSORB) --
  // Trip carries precise personal location for an identified employee — the most
  // sensitive data this substrate holds. Vehicle and the consent record bind to a
  // named driver; a commute-exclusion rule's predicate can embed a home radius,
  // so the rule table is PII-bearing too and is classified with the rest.
  // Rate tables are org configuration, not personal data.

  // Published statutory figures with their citations — the authority's own
  // public tables. Nothing here is customer or employee data; the only
  // person-identifying field is the internal id of whoever ratified.
  // Period component totals are aggregate business figures for one filing
  // period — no employee is identifiable from a withheld total, which is the
  // sum across the whole payroll. The per-person detail lives on Payslip.
  // A deposit cadence determination is org tax configuration: a cadence, the
  // threshold it was judged against, and the citation for that threshold.
};

/** Fallback for tables not yet classified — defaults to confidential (obfuscate). */
export const DEFAULT_SENSITIVITY: TableSensitivity = "confidential";

// The clone enumerates physical PostgreSQL names, while this registry is keyed
// by canonical Prisma model names. Keep explicit aliases for mapped models whose
// classification differs from the confidential fallback.
const PHYSICAL_TABLE_MODEL_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  vector_embedding: "VectorEmbedding",
});

// EP-A33A5C61 slice 4d-ii: the schema tag is the declaration. A model whose
// `/// @dpf` line carries `sensitivity=` is answered from the schema; this file
// keeps ONLY the models that are not yet tagged (shrink-only — an entry is
// deleted the moment its model gains a tag; table-classification.test.ts fails
// on overlap so the two can never disagree).
let taggedSensitivity: Map<string, TableSensitivity> | null = null;
function tagSensitivityIndex(): Map<string, TableSensitivity> {
  if (taggedSensitivity) return taggedSensitivity;
  const index = new Map<string, TableSensitivity>();
  try {
    const parsed = parseModelMetadataSources(
      listCanonicalPrismaSchemaFiles().map((file) => ({ file: basename(file), source: readFileSync(file, "utf8") })),
    );
    for (const e of parsed.entries) {
      if (!e.metadata.sensitivity) continue;
      index.set(e.model, e.metadata.sensitivity);
      index.set(e.table, e.metadata.sensitivity);
    }
  } catch {
    // No schema on disk (a trimmed runtime image): the registry below answers.
  }
  taggedSensitivity = index;
  return index;
}

/** Test seam: forget the parsed tags so a test can inject a different schema state. */
export function resetTagSensitivityIndexForTests(): void {
  taggedSensitivity = null;
}

/** Sensitivity for a table: schema tag first, then the shrink-only registry, then DEFAULT_SENSITIVITY. */
export function getTableSensitivity(tableName: string): TableSensitivity {
  const canonicalName = PHYSICAL_TABLE_MODEL_ALIASES[tableName] ?? tableName;
  const declared = tagSensitivityIndex().get(canonicalName) ?? tagSensitivityIndex().get(tableName);
  if (declared) return declared;
  return TABLE_CLASSIFICATION[canonicalName] ?? DEFAULT_SENSITIVITY;
}
