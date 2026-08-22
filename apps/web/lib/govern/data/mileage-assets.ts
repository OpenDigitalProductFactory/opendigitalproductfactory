// Data-governance registration for the mileage absorption substrate
// (EP-MILEAGE-ABSORB: BI-6D98AD8A, BI-E17E0034).
//
// Trip is the most sensitive thing this substrate holds: precise personal
// location for an identified employee. It is registered as a regulated record
// with masked projection so geometry is never handed to a generic reader, and
// its collection rule is "minimize" — the coordinates exist to compute distance
// and to evaluate commute exclusion, and for nothing else.
//
// The rate tables are org configuration, not personal data, so they are
// registered at internal sensitivity with metadata projection.

import type { DataAssetDefinition } from "./assets";
import type { DataCategory, DataFieldId } from "./taxonomy";

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-08-22",
} as const;

const PROVENANCE = {
  source: "manual",
  state: "confirmed",
  assertedBy: "data-steward",
  effectiveFrom: "2026-08-22",
} as const;

type MileageAssetId =
  | "data:mileage-trip"
  | "data:mileage-vehicle"
  | "data:mileage-classification-rule"
  | "data:driver-location-consent";

/**
 * Precise-location and driver-identifying fields. These are masked on read:
 * a reimbursement reviewer needs the distance and the money, not the route.
 */
function locationSensitiveFields(assetId: MileageAssetId, physicalNames: readonly string[]) {
  return physicalNames.map((physicalName) => ({
    id: `${assetId}#${physicalName}` as DataFieldId,
    physicalName,
    resolution: "governed" as const,
    resolutionReason:
      "Precise personal location for an identified employee; collected only to compute distance and evaluate commute exclusion, and exposed only through an authorized mileage projection with masking applied.",
    categories: ["personal-attribute", "operational"] as DataCategory[],
    sensitivity: "confidential" as const,
    collectionRule: "minimize" as const,
    protection: "mask-on-read" as const,
    projectionOverride: "masked-content" as const,
    provenance: PROVENANCE,
  }));
}

export const MILEAGE_ASSETS: readonly DataAssetDefinition[] = [
  {
    id: "data:mileage-trip",
    physical: { prismaModel: "Trip" },
    domain: "people-hcm",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["personal-attribute", "financial", "operational"],
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [{ role: "employee", fieldPath: "employeeProfile" }],
    lifecycleClass: "regulated-record",
    purposeCapabilities: ["service-delivery", "billing-and-payments", "compliance-and-legal"],
    residencyClass: "local-only",
    projectionClass: "masked-content",
    classification: CLASSIFICATION,
    fields: locationSensitiveFields("data:mileage-trip", [
      "startLatitude",
      "startLongitude",
      "endLatitude",
      "endLongitude",
      "startPlaceLabel",
      "endPlaceLabel",
    ]),
  },
  {
    id: "data:mileage-vehicle",
    physical: { prismaModel: "Vehicle" },
    domain: "people-hcm",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["operational", "personal-attribute"],
    sensitivity: "confidential",
    criticality: "standard",
    subjectLocators: [{ role: "employee", fieldPath: "employeeProfile" }],
    lifecycleClass: "operational",
    purposeCapabilities: ["service-delivery", "compliance-and-legal"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: CLASSIFICATION,
    fields: [],
  },
  {
    id: "data:mileage-classification-rule",
    physical: { prismaModel: "TripClassificationRule" },
    domain: "people-hcm",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["personal-attribute", "operational"],
    sensitivity: "confidential",
    criticality: "standard",
    subjectLocators: [{ role: "employee", fieldPath: "employeeProfile" }],
    lifecycleClass: "operational",
    purposeCapabilities: ["service-delivery"],
    residencyClass: "local-only",
    projectionClass: "masked-content",
    classification: CLASSIFICATION,
    // A commute-exclusion predicate can embed a home location, so the rule body
    // is treated as location data rather than plain configuration.
    fields: locationSensitiveFields("data:mileage-classification-rule", ["predicate"]),
  },
  {
    id: "data:driver-location-consent",
    physical: { prismaModel: "DriverLocationConsent" },
    domain: "people-hcm",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["personal-attribute", "operational"],
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [{ role: "employee", fieldPath: "employeeProfile" }],
    // The consent history is the lawful-basis evidence for every captured trip,
    // so it is a regulated record and is never aged out.
    lifecycleClass: "regulated-record",
    purposeCapabilities: ["compliance-and-legal", "service-delivery"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: CLASSIFICATION,
    fields: [],
  },
  {
    id: "data:mileage-rate-plan",
    physical: { prismaModel: "MileageRatePlan" },
    domain: "finance",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["financial", "configuration"],
    sensitivity: "internal",
    criticality: "standard",
    subjectLocators: [],
    lifecycleClass: "business-record",
    purposeCapabilities: ["billing-and-payments", "compliance-and-legal"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: CLASSIFICATION,
    fields: [],
  },
  {
    id: "data:mileage-rate",
    physical: { prismaModel: "MileageRate" },
    domain: "finance",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["financial", "configuration"],
    sensitivity: "internal",
    criticality: "standard",
    subjectLocators: [],
    lifecycleClass: "business-record",
    purposeCapabilities: ["billing-and-payments", "compliance-and-legal"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: CLASSIFICATION,
    fields: [],
  },
];
