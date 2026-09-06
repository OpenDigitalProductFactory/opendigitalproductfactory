// apps/web/lib/govern/data/assets.ts
// BI-DG-002 (spec §6.1): the logical asset registry and pure lookup/resolution over
// it. An asset is a stable logical identity for a physical Prisma model; its fields
// each resolve to inherited | governed | not-applicable with a reason and provenance.
// PURE module — no DB calls. Registry content is seeded here and grown by the
// per-domain coverage waves (BI-DG-015+); this file owns the SHAPE + machinery, and
// coverage.ts checks completeness against the live Prisma facts.

import {
  isDataAssetId,
  isDataFieldId,
  parseDataFieldId,
  type ClassificationProvenance,
  type DataAssetId,
  type DataCategory,
  type DataCriticality,
  type DataFieldId,
  type DataSensitivity,
  type LifecycleClassKey,
  type MasterDataDomainKey,
  type ProcessingPurposeKey,
  type ProjectionClass,
  type ProtectionProfileKey,
  type ResidencyClassKey,
  type SubjectLocator,
} from "./taxonomy";
import { AI_PROVIDER_GOVERNANCE_ASSETS } from "./ai-provider-governance-assets";
import { PROCESSING_GOVERNANCE_ASSETS } from "./processing-governance-assets";
import { BUSINESS_PRODUCT_PORTFOLIO_ASSETS } from "./business-product-portfolio-assets";
import { HOSPITALITY_CAPACITY_ASSETS } from "./hospitality-capacity-assets";
import { BEAUTY_CAPACITY_ASSETS } from "./beauty-capacity-assets";
import { RESOURCE_SCHEDULING_ASSETS } from "./resource-scheduling-assets";
import { LIFECYCLE_GOVERNANCE_ASSETS } from "./lifecycle-governance-assets";
import { STOCK_COVERAGE_ASSETS } from "./stock-coverage-assets";
import { FINANCE_INVOICE_DOCUMENT_ASSETS } from "./finance-invoice-document-assets";
import { RECRUITING_ASSETS } from "./recruiting-assets";
import { WORKER_CLASSIFICATION_ASSETS } from "./worker-classification-assets";
import { DECISION_TRUST_ENVELOPE_ASSETS } from "./decision-trust-envelope-assets";
import { MCP_OAUTH_ASSETS } from "./mcp-oauth-assets";
import { MCP_ASSETS } from "./mcp-assets";
import { WORKROOM_PARTICIPANT_ASSETS } from "./workroom-participant-assets";
import { WORKROOM_RELATION_ASSETS } from "./workroom-relation-assets";
import { INITIATIVE_GOVERNANCE_ASSETS } from "./initiative-governance-assets";
import { FEDERATION_INTRODUCTION_ASSETS } from "./federation-introduction-assets";
import { BUSINESS_PERFORMANCE_ASSETS } from "./business-performance-assets";
import { EXTERNAL_CHANNEL_ASSETS } from "./external-channel-assets";
import { ANIMAL_WELFARE_ASSETS } from "./animal-welfare-assets";

// ─── Definitions (spec §6.1) ─────────────────────────────────────────────────
export type FieldResolution = "inherited" | "governed" | "not-applicable";

export type DataFieldDefinition = {
  id: DataFieldId;
  physicalName: string;
  resolution: FieldResolution;
  resolutionReason: string;
  categories?: DataCategory[];
  sensitivity?: DataSensitivity;
  subjectRoles?: SubjectLocator[];
  collectionRule?: "allowed" | "minimize" | "prohibited";
  protection?: ProtectionProfileKey;
  purposeCapabilities?: ProcessingPurposeKey[];
  lifecycleOverride?: LifecycleClassKey;
  projectionOverride?: ProjectionClass;
  provenance: ClassificationProvenance;
};

export type DataAssetDefinition = {
  id: DataAssetId;
  physical: { prismaModel: string };
  fields: DataFieldDefinition[];
  domain: string;
  ownerRole: string;
  stewardRole: string;
  categories: DataCategory[];
  sensitivity: DataSensitivity;
  criticality: DataCriticality;
  subjectLocators: SubjectLocator[];
  masterDataDomain?: MasterDataDomainKey;
  lifecycleClass: LifecycleClassKey;
  purposeCapabilities: ProcessingPurposeKey[];
  residencyClass: ResidencyClassKey;
  projectionClass: ProjectionClass;
  classification: {
    state: "suggested" | "confirmed";
    source: "manual" | "inferred" | "propagated";
    effectiveFrom: string;
  };
};

// ─── Registry (indexed, validated) ───────────────────────────────────────────

export type DataAssetRegistry = {
  readonly byId: ReadonlyMap<DataAssetId, DataAssetDefinition>;
  readonly byPrismaModel: ReadonlyMap<string, DataAssetDefinition>;
  readonly assets: readonly DataAssetDefinition[];
};

/** Thrown when a registry definition violates a structural invariant. */
export class DataAssetRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataAssetRegistryError";
  }
}

/**
 * Validate + index a set of asset definitions into a registry. Structural invariants
 * (spec §6.1): unique asset ids, unique physical models, well-formed field ids that
 * belong to their asset, field-id local names matching a physical field, and required
 * provenance. Duplicate/foreign ids throw — a registry must be internally consistent
 * before any coverage or policy layer trusts it.
 */
export function buildAssetRegistry(
  definitions: readonly DataAssetDefinition[],
): DataAssetRegistry {
  const byId = new Map<DataAssetId, DataAssetDefinition>();
  const byPrismaModel = new Map<string, DataAssetDefinition>();

  for (const asset of definitions) {
    if (!isDataAssetId(asset.id)) {
      throw new DataAssetRegistryError(`malformed asset id: ${JSON.stringify(asset.id)}`);
    }
    if (byId.has(asset.id)) {
      throw new DataAssetRegistryError(`duplicate asset id: ${asset.id}`);
    }
    if (byPrismaModel.has(asset.physical.prismaModel)) {
      throw new DataAssetRegistryError(
        `two assets map to prisma model ${asset.physical.prismaModel}`,
      );
    }

    const seenFieldIds = new Set<string>();
    for (const field of asset.fields) {
      if (!isDataFieldId(field.id)) {
        throw new DataAssetRegistryError(`malformed field id: ${JSON.stringify(field.id)}`);
      }
      const { assetId } = parseDataFieldId(field.id);
      if (assetId !== asset.id) {
        throw new DataAssetRegistryError(
          `field ${field.id} does not belong to asset ${asset.id}`,
        );
      }
      if (seenFieldIds.has(field.id)) {
        throw new DataAssetRegistryError(`duplicate field id in ${asset.id}: ${field.id}`);
      }
      seenFieldIds.add(field.id);
      if (!field.provenance) {
        throw new DataAssetRegistryError(`field ${field.id} is missing provenance`);
      }
    }

    byId.set(asset.id, asset);
    byPrismaModel.set(asset.physical.prismaModel, asset);
  }

  return { byId, byPrismaModel, assets: [...definitions] };
}

export function lookupAsset(
  registry: DataAssetRegistry,
  id: DataAssetId,
): DataAssetDefinition | undefined {
  return registry.byId.get(id);
}

export function lookupAssetByPrismaModel(
  registry: DataAssetRegistry,
  prismaModel: string,
): DataAssetDefinition | undefined {
  return registry.byPrismaModel.get(prismaModel);
}

/** Resolve a field id to its definition, or undefined if the asset/field is unknown. */
export function resolveField(
  registry: DataAssetRegistry,
  fieldId: DataFieldId,
): DataFieldDefinition | undefined {
  const { assetId } = parseDataFieldId(fieldId);
  const asset = registry.byId.get(assetId);
  return asset?.fields.find((f) => f.id === fieldId);
}

// ─── Seed registry ───────────────────────────────────────────────────────────
// The seed grows one bounded domain per coverage wave (BI-DG-015+). It starts with
// the derived-data asset that BI-DG-001 governs so the spine has a real, worked entry
// its own tests can exercise. Everything not yet seeded lives in the immutable legacy
// baseline (legacy-coverage-baseline.ts), never as a blanket "internal" default.

const SEED_ASSETS: readonly DataAssetDefinition[] = [
  {
    // BI-CD99DC3F: operator-authored physical geometry is durable business
    // configuration. It can expose room, equipment, table, or site structure and
    // typed pointers to operational entities, so it stays confidential and local.
    // Published IEEE OUI registry: MAC prefix -> manufacturer (BI-9632B15B).
    // Reference data, not tenant data. An OUI identifies a HARDWARE MAKER, never a
    // device owner or a person, so there is no subject to locate and nothing to
    // mask — it is the same class of shipped lookup as the taxonomy tables.
    id: "data:mac-vendor-oui",
    physical: { prismaModel: "MacVendorOui" },
    domain: "platform-operations",
    ownerRole: "platform-operator",
    stewardRole: "data-steward",
    categories: ["configuration"],
    sensitivity: "public",
    criticality: "low",
    subjectLocators: [],
    lifecycleClass: "ephemeral",
    purposeCapabilities: ["platform-operations"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-08-06" },
    // Identical governance on both columns, so one definition. An OUI identifies a
    // MANUFACTURER, never an owner: no subject to locate, nothing to mask.
    fields: (["oui", "vendor"] as const).map((physicalName) => ({
      id: `data:mac-vendor-oui#${physicalName}` as DataFieldId,
      physicalName,
      resolution: "governed" as const,
      resolutionReason:
        "Published IEEE registry data: a manufacturer prefix and its name. No tenant scope, no subject.",
      categories: ["configuration"] as DataCategory[],
      sensitivity: "public" as DataSensitivity,
      collectionRule: "allowed" as const,
      protection: "none" as ProtectionProfileKey,
      provenance: {
        source: "manual" as const,
        state: "confirmed" as const,
        assertedBy: "data-steward",
        effectiveFrom: "2026-08-06",
      },
    })),
  },
  {
    // BI-8E1FD1BD. Statutory payroll tax figures with their citation and a
    // proposed -> ratified lifecycle. The FIGURES are published by tax
    // authorities and are public facts; the RECORD is not, because it also says
    // which coworker proposed a reading and which human in this organization
    // ratified it. That attribution is the audit trail behind a filing, so the
    // asset is classified on the record rather than on the figure.
    id: "data:payroll-tax-rule",
    physical: { prismaModel: "PayrollTaxRule" },
    domain: "business-operations",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["financial", "configuration", "authorization"],
    sensitivity: "internal",
    // A wrong figure here produces a wrong filing to a tax authority. There is
    // no higher-consequence reference data in the platform.
    criticality: "high",
    subjectLocators: [],
    // Tax records: deletion maxima are constrained by statute, not by us.
    lifecycleClass: "regulated-record",
    purposeCapabilities: ["compliance-and-legal", "billing-and-payments", "platform-operations"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-09-06" },
    fields: [
      // The statutory figure and the jurisdiction/period that scope it. Public
      // facts an authority publishes; nothing here points at a person.
      ...([
        "id", "payrollTaxRuleId", "jurisdictionRefId", "taxType", "ruleKind",
        "side", "taxYear", "value", "currency", "qualifiers",
        "effectiveFrom", "effectiveTo", "status",
      ] as const).map((physicalName) => ({
        id: `data:payroll-tax-rule#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "governed" as const,
        resolutionReason:
          "Published statutory reference data: a figure an authority publishes, and the jurisdiction, period and lifecycle state that scope it. No subject.",
        categories: ["financial", "configuration"] as DataCategory[],
        sensitivity: "public" as DataSensitivity,
        collectionRule: "allowed" as const,
        protection: "none" as ProtectionProfileKey,
        provenance: {
          source: "manual" as const,
          state: "confirmed" as const,
          assertedBy: "data-steward",
          effectiveFrom: "2026-09-06",
        },
      })),
      // The citation. Kept public deliberately: a figure that cannot be shown to
      // come from the authority's own publication must not be usable, so the
      // evidence has to travel with the figure rather than be masked away from it.
      ...(["sourceUrl", "sourceExcerpt", "retrievedAt"] as const).map((physicalName) => ({
        id: `data:payroll-tax-rule#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "governed" as const,
        resolutionReason:
          "The authority's own publication and the quoted passage a ratifier checked. Public by design: an uncitable figure must never price money.",
        categories: ["financial", "configuration"] as DataCategory[],
        sensitivity: "public" as DataSensitivity,
        collectionRule: "allowed" as const,
        protection: "none" as ProtectionProfileKey,
        provenance: {
          source: "manual" as const,
          state: "confirmed" as const,
          assertedBy: "data-steward",
          effectiveFrom: "2026-09-06",
        },
      })),
      // Attribution. This is the part that makes the record internal: who
      // proposed a reading, and which human accepted it. Identity, not finance.
      ...([
        "proposedByAgentId", "proposedAt", "ratifiedByUserId", "ratifiedAt",
        "rejectedReason", "notes",
      ] as const).map((physicalName) => ({
        id: `data:payroll-tax-rule#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "governed" as const,
        resolutionReason:
          "Ratification trail: which coworker proposed the figure and which human accepted it. The audit answer to who stands behind a filing.",
        categories: ["identity", "authorization"] as DataCategory[],
        sensitivity: "internal" as DataSensitivity,
        collectionRule: "allowed" as const,
        protection: "none" as ProtectionProfileKey,
        provenance: {
          source: "manual" as const,
          state: "confirmed" as const,
          assertedBy: "data-steward",
          effectiveFrom: "2026-09-06",
        },
      })),
      // Row bookkeeping, no subject meaning.
      ...(["lifecycle", "lifecycleAt", "lifecycleReason", "createdAt", "updatedAt"] as const).map((physicalName) => ({
        id: `data:payroll-tax-rule#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "governed" as const,
        resolutionReason: "Record lifecycle and timestamps. Framework bookkeeping with no subject meaning.",
        categories: ["system-internal"] as DataCategory[],
        sensitivity: "internal" as DataSensitivity,
        collectionRule: "allowed" as const,
        protection: "none" as ProtectionProfileKey,
        provenance: {
          source: "manual" as const,
          state: "confirmed" as const,
          assertedBy: "data-steward",
          effectiveFrom: "2026-09-06",
        },
      })),
    ],
  },
  {
    id: "data:operational-scene-layout",
    physical: { prismaModel: "OperationalSceneLayout" },
    domain: "business-operations",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["configuration", "operational", "content"],
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [],
    lifecycleClass: "operational",
    purposeCapabilities: ["service-delivery", "platform-operations"],
    residencyClass: "local-only",
    projectionClass: "structure",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-07-29" },
    fields: [
      ...["layoutState", "underlayRef"].map((physicalName) => ({
        id: `data:operational-scene-layout#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "governed" as const,
        resolutionReason:
          "Physical-space geometry and its floor-plan reference can reveal the operator's internal layout and links to live operational entities; retain locally and omit from unapproved projections.",
        categories: ["configuration", "operational"] as DataCategory[],
        sensitivity: "confidential" as DataSensitivity,
        collectionRule: "minimize" as const,
        protection: "mask-on-read" as ProtectionProfileKey,
        projectionOverride: "structure" as ProjectionClass,
        provenance: {
          source: "manual" as const,
          state: "confirmed" as const,
          assertedBy: "data-steward",
          effectiveFrom: "2026-07-29",
        },
      })),
      {
        id: "data:operational-scene-layout#label",
        physicalName: "label",
        resolution: "governed",
        resolutionReason:
          "Operator-authored room or area name is bounded business content and inherits the layout's confidential tenant scope.",
        categories: ["content", "configuration"],
        sensitivity: "confidential",
        collectionRule: "minimize",
        protection: "mask-on-read",
        projectionOverride: "structure",
        provenance: {
          source: "manual",
          state: "confirmed",
          assertedBy: "data-steward",
          effectiveFrom: "2026-07-29",
        },
      },
      ...[
        "id",
        "orgId",
        "twinTemplate",
        "spaceKind",
        "locationId",
        "version",
        "updatedAt",
        "createdAt",
        "organization",
      ].map((physicalName) => ({
        id: `data:operational-scene-layout#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "inherited" as const,
        resolutionReason:
          "Tenant binding, scene classification, optional location pointer, versioning, persistence metadata, or relation governed by the confidential operational-scene asset.",
        provenance: {
          source: "manual" as const,
          state: "confirmed" as const,
          assertedBy: "data-steward",
          effectiveFrom: "2026-07-29",
        },
      })),
    ],
  },
  {
    // BI-F12A8D0D: machine-bound X.509 lifecycle metadata for an Edge Node.
    // The device private key and CA private key never enter this asset.
    id: "data:edge-node-certificate",
    physical: { prismaModel: "EdgeNodeCertificate" },
    domain: "edge-fleet",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["authorization", "configuration", "security-audit"],
    sensitivity: "restricted",
    criticality: "high",
    subjectLocators: [],
    lifecycleClass: "security-audit",
    purposeCapabilities: ["service-delivery", "security-and-fraud", "platform-operations"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-07-24" },
    fields: [
      ...[
        "certificateId",
        "fingerprintSha256",
        "serialNumber",
        "subject",
        "issuer",
        "provisioner",
      ].map((physicalName) => ({
        id: `data:edge-node-certificate#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "governed" as const,
        resolutionReason:
          "Machine-certificate identity metadata used to authenticate an Edge Node. It is not secret key material, but disclosure increases reconnaissance and correlation risk.",
        categories: ["authorization", "security-audit"] as DataCategory[],
        sensitivity: "restricted" as DataSensitivity,
        collectionRule: "minimize" as const,
        protection: "mask-on-read" as ProtectionProfileKey,
        projectionOverride: "structure" as ProjectionClass,
        provenance: {
          source: "manual" as const,
          state: "confirmed" as const,
          assertedBy: "data-steward",
          effectiveFrom: "2026-07-24",
        },
      })),
      ...[
        "edgeNodeId",
        "status",
        "validFrom",
        "validUntil",
        "registeredAt",
        "lastSeenAt",
        "revokedAt",
        "revocationReason",
      ].map((physicalName) => ({
        id: `data:edge-node-certificate#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "governed" as const,
        resolutionReason:
          "Certificate binding and lifecycle evidence retained for authorization, rotation, revocation, and security audit.",
        categories: ["authorization", "security-audit"] as DataCategory[],
        sensitivity: "restricted" as DataSensitivity,
        collectionRule: "minimize" as const,
        projectionOverride: "metadata" as ProjectionClass,
        provenance: {
          source: "manual" as const,
          state: "confirmed" as const,
          assertedBy: "data-steward",
          effectiveFrom: "2026-07-24",
        },
      })),
      ...["id", "createdAt", "updatedAt", "edgeNode"].map((physicalName) => ({
        id: `data:edge-node-certificate#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "inherited" as const,
        resolutionReason:
          "Internal persistence identity, audit timestamp, or relation governed by the restricted certificate asset.",
        provenance: {
          source: "manual" as const,
          state: "confirmed" as const,
          assertedBy: "data-steward",
          effectiveFrom: "2026-07-24",
        },
      })),
    ],
  },
  {
    // BI-DE47EC0B: partner-program commercial terms for an account that resells
    // / delivers DPF (the local-MSP channel). No data subject — this describes a
    // BUSINESS relationship, not a person; the partner's people are contacts on
    // the account and are governed there. Margin and tier are confidential
    // commercial terms: disclosure across partners damages the relationship.
    id: "data:partner-program-enrollment",
    physical: { prismaModel: "PartnerProgramEnrollment" },
    domain: "partner-channel",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["operational", "financial", "configuration"],
    sensitivity: "confidential",
    criticality: "standard",
    subjectLocators: [],
    lifecycleClass: "business-record",
    purposeCapabilities: ["service-delivery", "billing-and-payments", "platform-operations"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-07-23" },
    fields: [
      {
        id: "data:partner-program-enrollment#marginPercent",
        physicalName: "marginPercent",
        resolution: "governed",
        resolutionReason:
          "Confidential partner margin from the signed agreement. Never rendered on partner-visible or customer-visible surfaces without an explicit disclosure decision.",
        categories: ["financial"],
        sensitivity: "confidential",
        collectionRule: "minimize",
        protection: "mask-on-read",
        projectionOverride: "structure",
        provenance: {
          source: "manual",
          state: "confirmed",
          assertedBy: "data-steward",
          effectiveFrom: "2026-07-23",
        },
      },
      ...["tier", "agreementRef"].map((physicalName) => ({
        id: `data:partner-program-enrollment#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "governed" as const,
        resolutionReason:
          "Commercial standing of a business partner — organization-scoped terms visible to the operator and the partner they describe, never to other partners or customer-facing surfaces.",
        categories: ["operational"] as DataCategory[],
        sensitivity: "confidential" as DataSensitivity,
        collectionRule: "minimize" as const,
        protection: "mask-on-read" as ProtectionProfileKey,
        projectionOverride: "metadata" as ProjectionClass,
        provenance: {
          source: "manual" as const,
          state: "confirmed" as const,
          assertedBy: "data-steward",
          effectiveFrom: "2026-07-23",
        },
      })),
      ...["status", "territory", "dealRegistrationEnabled", "enrolledAt", "endedAt"].map(
        (physicalName) => ({
          id: `data:partner-program-enrollment#${physicalName}` as DataFieldId,
          physicalName,
          resolution: "inherited" as const,
          resolutionReason:
            "Enrolment lifecycle and channel-configuration facts with the same scope and lifecycle as the enrolment itself; no personal data, and territory is a soft designation rather than an exclusivity grant.",
          provenance: {
            source: "manual" as const,
            state: "confirmed" as const,
            assertedBy: "data-steward",
            effectiveFrom: "2026-07-23",
          },
        }),
      ),
      {
        id: "data:partner-program-enrollment#notes",
        physicalName: "notes",
        resolution: "governed",
        resolutionReason:
          "Free-text operator notes on the partner relationship — unbounded content that must stay operator-scoped and out of any partner- or customer-visible projection.",
        categories: ["content"],
        sensitivity: "confidential",
        collectionRule: "minimize",
        protection: "mask-on-read",
        projectionOverride: "structure",
        provenance: {
          source: "manual",
          state: "confirmed",
          assertedBy: "data-steward",
          effectiveFrom: "2026-07-23",
        },
      },
    ],
  },
  {
    id: "data:federation-pairing-session",
    physical: { prismaModel: "FederationPairingSession" },
    domain: "federated-demand",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["credential-secret", "authorization", "configuration", "security-audit"],
    sensitivity: "restricted",
    criticality: "high",
    subjectLocators: [],
    lifecycleClass: "security-audit",
    purposeCapabilities: ["service-delivery", "security-and-fraud", "platform-operations"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-07-20" },
    fields: [
      {
        id: "data:federation-pairing-session#pairingSecretHash",
        physicalName: "pairingSecretHash",
        resolution: "governed",
        resolutionReason:
          "One-time incoming poll authenticator retained only as a hash and never disclosed after creation.",
        categories: ["credential-secret", "authorization"],
        sensitivity: "restricted",
        collectionRule: "minimize",
        protection: "mask-on-read",
        projectionOverride: "structure",
        provenance: {
          source: "manual",
          state: "confirmed",
          assertedBy: "data-steward",
          effectiveFrom: "2026-07-20",
        },
      },
      ...["pairingSecretEnc", "bootstrapTokenEnc"].map((physicalName) => ({
        id: `data:federation-pairing-session#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "governed" as const,
        resolutionReason:
          "Short-lived federation bearer material encrypted through the credential-crypto boundary and cleared at terminal disposition.",
        categories: ["credential-secret", "authorization"] as DataCategory[],
        sensitivity: "restricted" as DataSensitivity,
        collectionRule: "minimize" as const,
        protection: "encrypt-and-mask" as ProtectionProfileKey,
        projectionOverride: "structure" as ProjectionClass,
        provenance: {
          source: "manual" as const,
          state: "confirmed" as const,
          assertedBy: "data-steward",
          effectiveFrom: "2026-07-20",
        },
      })),
    ],
  },
  {
    // BI-D6DFC0E7: operational readiness telemetry per build surface. No subject
    // or business data — which build tool on which machine is wired to durable
    // memory. telemetry-bounded lifecycle; safe to prune.
    id: "data:agent-surface-readiness",
    physical: { prismaModel: "AgentSurfaceReadiness" },
    domain: "agent-toolchain",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["telemetry", "configuration", "system-internal"],
    sensitivity: "internal",
    criticality: "low",
    subjectLocators: [],
    lifecycleClass: "telemetry-bounded",
    purposeCapabilities: ["platform-operations"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-07-21" },
    fields: [
      {
        id: "data:agent-surface-readiness#surfaceKey",
        physicalName: "surfaceKey",
        resolution: "not-applicable",
        resolutionReason:
          "Opaque build-surface + machine identifier (e.g. claude-code@<machineId>) — an operational tool key, not a data subject.",
        categories: ["system-internal"],
        sensitivity: "internal",
        provenance: { source: "manual", state: "confirmed", assertedBy: "data-steward", effectiveFrom: "2026-07-21" },
      },
      {
        id: "data:agent-surface-readiness#readinessState",
        physicalName: "readinessState",
        resolution: "not-applicable",
        resolutionReason:
          "Computed toolchain readiness state — operational telemetry with no subject or business meaning.",
        categories: ["telemetry"],
        sensitivity: "internal",
        provenance: { source: "manual", state: "confirmed", assertedBy: "data-steward", effectiveFrom: "2026-07-21" },
      },
      {
        id: "data:agent-surface-readiness#detail",
        physicalName: "detail",
        resolution: "not-applicable",
        resolutionReason:
          "Optional operational detail blob for a heartbeat; carries no subject or business-record data by contract.",
        categories: ["telemetry"],
        sensitivity: "internal",
        provenance: { source: "manual", state: "confirmed", assertedBy: "data-steward", effectiveFrom: "2026-07-21" },
      },
    ],
  },
  ...[
    ["data:founder-demand-cluster", "FounderDemandCluster"],
    ["data:founder-demand-cluster-member", "FounderDemandClusterMember"],
  ].map(([id, prismaModel]) => ({
    id: id as DataAssetId,
    physical: { prismaModel },
    domain: "federated-demand",
    ownerRole: "founder-business-owner",
    stewardRole: "data-steward",
    categories: ["operational", "content", "security-audit"] as DataCategory[],
    sensitivity: "confidential" as DataSensitivity,
    criticality: "high" as DataCriticality,
    subjectLocators: [
      { role: "organization" as const, fieldPath: prismaModel === "FounderDemandCluster" ? "organization" : "cluster.organization" },
    ],
    lifecycleClass: "business-record" as LifecycleClassKey,
    purposeCapabilities: ["service-delivery", "platform-operations", "product-analytics"] as ProcessingPurposeKey[],
    residencyClass: "local-only" as ResidencyClassKey,
    projectionClass: "masked-content" as ProjectionClass,
    classification: { state: "confirmed" as const, source: "manual" as const, effectiveFrom: "2026-07-20" },
    fields: [],
  })),
  ...[
    ["data:partner-account", "PartnerAccount"],
    ["data:partner-agreement", "PartnerAgreement"],
    ["data:partner-entitlement", "PartnerEntitlement"],
    ["data:partner-support-route", "PartnerSupportRoute"],
    ["data:partner-contribution-recognition", "PartnerContributionRecognition"],
  ].map(([id, prismaModel]) => ({
    id: id as DataAssetId,
    physical: { prismaModel },
    domain: "partner-channel",
    ownerRole: "founder-business-owner",
    stewardRole: "data-steward",
    categories: ["configuration"] as DataCategory[],
    sensitivity: "confidential" as DataSensitivity,
    criticality: "standard" as DataCriticality,
    subjectLocators: [],
    lifecycleClass: "operational" as LifecycleClassKey,
    purposeCapabilities: ["service-delivery", "platform-operations"] as ProcessingPurposeKey[],
    residencyClass: "local-only" as ResidencyClassKey,
    projectionClass: "metadata" as ProjectionClass,
    classification: { state: "confirmed" as const, source: "manual" as const, effectiveFrom: "2026-07-20" },
    fields: [],
  })),
  {
    // Authored vendor-ecosystem absorption matrix (BI-ECO-001). Reference/config
    // doctrine — public vendor/product names + integration categories + verdicts;
    // no data subject. Retention is exemption-governed (reference-data), never aged.
    id: "data:absorption-posture",
    physical: { prismaModel: "AbsorptionPosture" },
    domain: "ecosystem-absorption",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["configuration"],
    sensitivity: "internal",
    criticality: "standard",
    subjectLocators: [],
    lifecycleClass: "operational",
    purposeCapabilities: ["platform-operations"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-07-24" },
    fields: [],
  },
  ...AI_PROVIDER_GOVERNANCE_ASSETS,
  {
    // Per-customer incumbent coverage verdict (BI-548060D5). Operational — the
    // instantiated verdict for a customer's incumbent app, defaulted from the
    // authored posture matrix; no data subject. Domain-lifecycle-managed
    // (re-assessment supersedes).
    id: "data:incumbent-coverage-assessment",
    physical: { prismaModel: "IncumbentCoverageAssessment" },
    domain: "asset-intelligence",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["operational", "configuration"],
    sensitivity: "internal",
    criticality: "standard",
    subjectLocators: [],
    lifecycleClass: "operational",
    purposeCapabilities: ["platform-operations", "service-delivery"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-08-01" },
    fields: [],
  },
  {
    id: "data:runtime-capability-transition-event",
    physical: { prismaModel: "RuntimeCapabilityTransitionEvent" },
    domain: "platform-runtime",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["security-audit"],
    sensitivity: "internal",
    criticality: "mission-critical",
    subjectLocators: [],
    lifecycleClass: "security-audit",
    purposeCapabilities: ["platform-operations", "security-and-fraud"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-07-18" },
    fields: [],
  },
  {
    id: "data:runtime-capability-transition",
    physical: { prismaModel: "RuntimeCapabilityTransition" },
    domain: "platform-runtime",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["security-audit", "configuration"],
    sensitivity: "internal",
    criticality: "mission-critical",
    subjectLocators: [],
    lifecycleClass: "security-audit",
    purposeCapabilities: ["platform-operations", "security-and-fraud"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-07-17" },
    fields: [],
  },
  ...BUSINESS_PRODUCT_PORTFOLIO_ASSETS,
  ...HOSPITALITY_CAPACITY_ASSETS,
  ...BEAUTY_CAPACITY_ASSETS,
  ...RESOURCE_SCHEDULING_ASSETS,
  ...LIFECYCLE_GOVERNANCE_ASSETS,
  ...STOCK_COVERAGE_ASSETS,
  ...FINANCE_INVOICE_DOCUMENT_ASSETS, ...BUSINESS_PERFORMANCE_ASSETS,
  ...PROCESSING_GOVERNANCE_ASSETS,
  ...RECRUITING_ASSETS,
  ...WORKER_CLASSIFICATION_ASSETS,
  ...DECISION_TRUST_ENVELOPE_ASSETS,
  ...MCP_OAUTH_ASSETS,
  ...MCP_ASSETS,
  ...WORKROOM_PARTICIPANT_ASSETS,
  ...WORKROOM_RELATION_ASSETS,
  ...INITIATIVE_GOVERNANCE_ASSETS,
  ...FEDERATION_INTRODUCTION_ASSETS,
  ...EXTERNAL_CHANNEL_ASSETS,
  ...ANIMAL_WELFARE_ASSETS,
   {
    id: "data:agent-conversation",
    physical: { prismaModel: "AgentMessage" },
    domain: "coworker",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["content"],
    sensitivity: "confidential",
    criticality: "standard",
    subjectLocators: [
      { role: "user", fieldPath: "thread.user" },
      { role: "organization", fieldPath: "thread.organization" },
    ],
    lifecycleClass: "operational",
    purposeCapabilities: ["service-delivery", "coworker-assistance"],
    residencyClass: "local-only",
    projectionClass: "content",
    classification: {
      state: "confirmed",
      source: "manual",
      effectiveFrom: "2026-07-17",
    },
    fields: [
      {
        id: "data:agent-conversation#content",
        physicalName: "content",
        resolution: "governed",
        resolutionReason:
          "User/agent authored free text; masked before derived projection (BI-DG-001).",
        categories: ["content"],
        sensitivity: "confidential",
        collectionRule: "allowed",
        projectionOverride: "masked-content",
        provenance: {
          source: "manual",
          state: "confirmed",
          assertedBy: "data-steward",
          effectiveFrom: "2026-07-17",
        },
      },
    ],
  },
];

/** The platform's seeded logical asset registry. */
export const DATA_ASSET_REGISTRY: DataAssetRegistry = buildAssetRegistry(SEED_ASSETS);
