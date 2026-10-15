// apps/web/lib/govern/data/asset-types.ts
// BI-DG-002 (spec §6.1): the data asset definition contract. Types only: the
// per-domain *-assets.ts seed modules and coverage name these shapes without
// importing assets.ts, which imports every seed module to build the registry
// (dependency-diet plan M11 step 2 needs apps/web's all-imports graph acyclic).
// assets.ts owns the registry machinery over these shapes.

import type {
  ClassificationProvenance,
  DataAssetId,
  DataCategory,
  DataCriticality,
  DataFieldId,
  DataSensitivity,
  LifecycleClassKey,
  MasterDataDomainKey,
  ProcessingPurposeKey,
  ProjectionClass,
  ProtectionProfileKey,
  ResidencyClassKey,
  SubjectLocator,
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

export type DataAssetRegistry = {
  readonly byId: ReadonlyMap<DataAssetId, DataAssetDefinition>;
  readonly byPrismaModel: ReadonlyMap<string, DataAssetDefinition>;
  readonly assets: readonly DataAssetDefinition[];
};
