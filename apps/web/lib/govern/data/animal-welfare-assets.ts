import type { DataAssetDefinition } from "./assets";
import type { ClassificationProvenance } from "./taxonomy";

const PROVENANCE: ClassificationProvenance = {
  source: "manual",
  state: "confirmed",
  assertedBy: "data-steward",
  effectiveFrom: "2026-09-04",
};

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-09-04",
} as const;

function asset(input: {
  id: `data:${string}`;
  prismaModel: string;
  sensitivity: "internal" | "confidential";
  categories: DataAssetDefinition["categories"];
  lifecycleClass?: DataAssetDefinition["lifecycleClass"];
  fields?: DataAssetDefinition["fields"];
}): DataAssetDefinition {
  return {
    id: input.id,
    physical: { prismaModel: input.prismaModel },
    domain: "animal-welfare",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: input.categories,
    sensitivity: input.sensitivity,
    criticality: "high",
    subjectLocators: [{ role: "organization", fieldPath: "organization" }],
    lifecycleClass: input.lifecycleClass ?? "legal-evidence",
    purposeCapabilities: ["service-delivery", "compliance-and-legal"],
    residencyClass: "local-only",
    projectionClass: input.sensitivity === "confidential" ? "masked-content" : "structure",
    classification: CLASSIFICATION,
    fields: input.fields ?? [],
  };
}

const governedText = (assetId: string, physicalName: string, reason: string): DataAssetDefinition["fields"][number] => ({
  id: `${assetId}#${physicalName}` as `data:${string}#${string}`,
  physicalName,
  resolution: "governed",
  resolutionReason: reason,
  categories: ["content"],
  sensitivity: "confidential",
  collectionRule: "minimize",
  projectionOverride: "masked-content",
  provenance: PROVENANCE,
});

export const ANIMAL_WELFARE_ASSETS: readonly DataAssetDefinition[] = [
  asset({ id: "data:animal-profile", prismaModel: "AnimalProfile", sensitivity: "confidential", categories: ["identity", "operational"], lifecycleClass: "business-record", fields: [governedText("data:animal-profile", "name", "Animal-facing workspace identity; public projection is separately allowlisted."), governedText("data:animal-profile", "microchipNumber", "Persistent external animal identifier restricted to authorized welfare operations.")] }),
  asset({ id: "data:animal-custody-episode", prismaModel: "AnimalCustodyEpisode", sensitivity: "confidential", categories: ["operational", "content"], fields: [governedText("data:animal-custody-episode", "legalHoldReason", "Legal-hold rationale is disclosed only to authorized operators and is never public storefront copy.")] }),
  asset({ id: "data:animal-custody-event", prismaModel: "AnimalCustodyEvent", sensitivity: "confidential", categories: ["operational", "security-audit"], fields: [governedText("data:animal-custody-event", "reason", "Append-only custody rationale may carry investigation context and is minimized in list projections.")] }),
  asset({ id: "data:animal-adoption-application", prismaModel: "AnimalAdoptionApplication", sensitivity: "confidential", categories: ["contact", "operational"], fields: [governedText("data:animal-adoption-application", "applicantName", "Applicant identity is PII and is excluded from bounded queue projections unless detail access is authorized.")] }),
  asset({ id: "data:animal-placement", prismaModel: "AnimalPlacement", sensitivity: "confidential", categories: ["contact", "financial", "operational"], fields: [governedText("data:animal-placement", "returnReason", "Return rationale is sensitive case content and remains out of public adoption projections.")] }),
  asset({ id: "data:care-record", prismaModel: "CareRecord", sensitivity: "confidential", categories: ["operational", "content"], fields: [governedText("data:care-record", "detail", "Longitudinal animal health and welfare detail is restricted to the care context and correction history."), governedText("data:care-record", "value", "Care values are projected only for the named animal and authorized operator.")] }),
  asset({ id: "data:financial-fund", prismaModel: "FinancialFund", sensitivity: "internal", categories: ["financial", "configuration"], lifecycleClass: "regulated-record" }),
];
