// Data-governance registrations for the controlled-substance custody models
// (EP-CSC-CUSTODY, BI-3810ED3A). Every row is statutory evidence under 21 CFR
// 1304.04 / 1304.11 / 1301.76, held for at least the platform's seven-year
// regulated-record minimum and never purged on a timer.
import type { DataAssetDefinition } from "./asset-types";
import type { ClassificationProvenance } from "./taxonomy";

const PROVENANCE: ClassificationProvenance = {
  source: "manual",
  state: "confirmed",
  assertedBy: "data-steward",
  effectiveFrom: "2026-09-30",
};

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-09-30",
} as const;

function asset(input: {
  id: `data:${string}`;
  prismaModel: string;
  categories: DataAssetDefinition["categories"];
  fields?: DataAssetDefinition["fields"];
}): DataAssetDefinition {
  return {
    id: input.id,
    physical: { prismaModel: input.prismaModel },
    domain: "controlled-substances",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: input.categories,
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [{ role: "organization", fieldPath: "organization" }],
    lifecycleClass: "regulated-record",
    purposeCapabilities: ["service-delivery", "compliance-and-legal"],
    residencyClass: "local-only",
    projectionClass: "masked-content",
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

export const CONTROLLED_SUBSTANCE_ASSETS: readonly DataAssetDefinition[] = [
  asset({ id: "data:controlled-substance-product", prismaModel: "ControlledSubstanceProduct", categories: ["operational"] }),
  asset({ id: "data:controlled-substance-register", prismaModel: "ControlledSubstanceRegister", categories: ["operational"] }),
  asset({ id: "data:controlled-substance-handler-authorization", prismaModel: "ControlledSubstanceHandlerAuthorization", categories: ["operational", "security-audit"], fields: [governedText("data:controlled-substance-handler-authorization", "revocationReason", "Why a person lost access to a drug register may describe a personnel or diversion matter; shown only to the register's reconcilers.")] }),
  asset({ id: "data:controlled-substance-movement", prismaModel: "ControlledSubstanceMovement", categories: ["operational", "security-audit"], fields: [governedText("data:controlled-substance-movement", "reason", "Append-only movement rationale can describe a patient, a loss or a staff matter; minimized in list projections.")] }),
  asset({ id: "data:controlled-substance-count", prismaModel: "ControlledSubstanceCount", categories: ["operational", "security-audit"], fields: [governedText("data:controlled-substance-count", "notes", "Count notes can record observations about staff or missing stock; shown only to the register's counters and reconcilers.")] }),
  asset({ id: "data:controlled-substance-count-line", prismaModel: "ControlledSubstanceCountLine", categories: ["operational"] }),
  asset({ id: "data:controlled-substance-discrepancy", prismaModel: "ControlledSubstanceDiscrepancy", categories: ["operational", "security-audit"], fields: [governedText("data:controlled-substance-discrepancy", "classificationRationale", "Why a variance is classed as suspected theft or loss is investigation content."), governedText("data:controlled-substance-discrepancy", "resolution", "Case resolution can name people and findings; restricted to reconcilers.")] }),
];
