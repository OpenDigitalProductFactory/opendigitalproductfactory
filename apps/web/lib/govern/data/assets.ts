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
    id: "data:ai-provider-connection",
    physical: { prismaModel: "AiProviderConnection" },
    domain: "ai-provider-governance",
    ownerRole: "platform-owner",
    stewardRole: "data-steward",
    categories: ["configuration", "authorization", "security-audit"],
    sensitivity: "confidential",
    criticality: "mission-critical",
    subjectLocators: [
      { role: "organization", fieldPath: "organization" },
    ],
    lifecycleClass: "legal-evidence",
    purposeCapabilities: ["platform-operations", "compliance-and-legal", "coworker-assistance"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-07-19" },
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
