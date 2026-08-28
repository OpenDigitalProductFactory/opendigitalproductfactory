// Data-governance registration for durable payroll calculation records.
// PayRun and Payslip contain regulated employee financial data. Keep the model-level
// posture confidential and local, and explicitly mask amounts and component detail
// anywhere a field-level projection is requested.

import type { DataAssetDefinition } from "./assets";
import type { DataCategory, DataFieldId } from "./taxonomy";

const CLASSIFICATION = {
  state: "confirmed",
  source: "manual",
  effectiveFrom: "2026-08-12",
} as const;

const PROVENANCE = {
  source: "manual",
  state: "confirmed",
  assertedBy: "data-steward",
  effectiveFrom: "2026-08-12",
} as const;

function protectedPayrollFields(
  assetId: "data:pay-run" | "data:payslip",
  physicalNames: readonly string[],
) {
  return physicalNames.map((physicalName) => ({
    id: `${assetId}#${physicalName}` as DataFieldId,
    physicalName,
    resolution: "governed" as const,
    resolutionReason:
      "Regulated employee payroll detail; expose only through an authorized payroll projection with masking applied.",
    categories: ["financial", "personal-attribute"] as DataCategory[],
    sensitivity: "confidential" as const,
    collectionRule: "minimize" as const,
    protection: "mask-on-read" as const,
    projectionOverride: "masked-content" as const,
    provenance: PROVENANCE,
  }));
}

export const PAYROLL_ASSETS: readonly DataAssetDefinition[] = [
  {
    id: "data:pay-run",
    physical: { prismaModel: "PayRun" },
    domain: "people-hcm",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["financial", "operational"],
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [{ role: "employee", fieldPath: "payslips.employeeProfile" }],
    lifecycleClass: "regulated-record",
    purposeCapabilities: [
      "service-delivery",
      "billing-and-payments",
      "compliance-and-legal",
    ],
    residencyClass: "local-only",
    projectionClass: "masked-content",
    classification: CLASSIFICATION,
    fields: protectedPayrollFields("data:pay-run", ["payRunRef"]),
  },
  {
    id: "data:payslip",
    physical: { prismaModel: "Payslip" },
    domain: "people-hcm",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["financial", "personal-attribute", "operational"],
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [{ role: "employee", fieldPath: "employeeProfile" }],
    lifecycleClass: "regulated-record",
    purposeCapabilities: [
      "service-delivery",
      "billing-and-payments",
      "compliance-and-legal",
    ],
    residencyClass: "local-only",
    projectionClass: "masked-content",
    classification: CLASSIFICATION,
    fields: protectedPayrollFields("data:payslip", [
      "grossPay",
      "taxablePay",
      "netPay",
      "totalEmployerCost",
      "earnings",
      "employeeDeductions",
      "employerCosts",
    ]),
  },
  {
    id: "data:pay-component-line",
    physical: { prismaModel: "PayComponentLine" },
    domain: "people-hcm",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["financial", "personal-attribute", "operational"],
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [{ role: "employee", fieldPath: "payslip.employeeProfile" }],
    lifecycleClass: "regulated-record",
    purposeCapabilities: [
      "service-delivery",
      "billing-and-payments",
      "compliance-and-legal",
    ],
    residencyClass: "local-only",
    projectionClass: "masked-content",
    classification: CLASSIFICATION,
    fields: [],
  },
  {
    id: "data:employee-deduction-election",
    physical: { prismaModel: "EmployeeDeductionElection" },
    domain: "people-hcm",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["financial", "personal-attribute"],
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [{ role: "employee", fieldPath: "employeeProfile" }],
    // A garnishment discloses a legal judgement against the employee, so this
    // is regulated rather than ordinary operational configuration.
    lifecycleClass: "regulated-record",
    purposeCapabilities: ["billing-and-payments", "compliance-and-legal"],
    residencyClass: "local-only",
    projectionClass: "masked-content",
    classification: CLASSIFICATION,
    fields: [],
  },
  {
    // Aggregate figures for one filing period, not per-person detail: no
    // employee is identifiable from a withheld TOTAL summed across the whole
    // payroll. The per-person detail stays on Payslip and PayComponentLine,
    // which are masked. So this is operational finance, not regulated
    // employee data, and carries no subject locator.
    id: "data:tax-obligation-period-component",
    physical: { prismaModel: "TaxObligationPeriodComponent" },
    domain: "finance-accounting",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["financial", "operational"],
    sensitivity: "internal",
    criticality: "high",
    subjectLocators: [],
    // A component of a FILED return is accounting evidence and must survive as
    // a row; it is disposed with its parent period, never time-aged.
    lifecycleClass: "regulated-record",
    purposeCapabilities: ["compliance-and-legal", "billing-and-payments"],
    residencyClass: "local-only",
    projectionClass: "content",
    classification: CLASSIFICATION,
    fields: [],
  },
  {
    // A cadence determination is org tax configuration — a cadence, the
    // threshold it was judged against, and the citation for that threshold.
    // No personal data.
    id: "data:tax-deposit-schedule",
    physical: { prismaModel: "TaxDepositSchedule" },
    domain: "finance-accounting",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["financial", "operational"],
    sensitivity: "internal",
    criticality: "high",
    subjectLocators: [],
    // Retained as the evidence for why a past deposit was timed as it was,
    // which is what a late-deposit penalty dispute turns on.
    lifecycleClass: "regulated-record",
    purposeCapabilities: ["compliance-and-legal"],
    residencyClass: "local-only",
    projectionClass: "content",
    classification: CLASSIFICATION,
    fields: [],
  },
];
