import type { DataAssetDefinition } from "./assets";
import type {
  DataCategory,
  DataFieldId,
  DataSensitivity,
} from "./taxonomy";

// Finance — the stored copy of an invoice as the customer received it
// (BI-C86BD108, EP-778F1CED phase 3). Kept in its own module rather than inline
// in assets.ts, matching the per-domain asset files alongside it.

export const FINANCE_INVOICE_DOCUMENT_ASSETS: readonly DataAssetDefinition[] = [
  {
    // BI-C86BD108: the immutable copy of an invoice as the customer received it.
    // Not grandfathered — a new model must declare its governance. The row itself
    // is metadata about a financial document; the only personal datum is the
    // recipient address the invoice was emailed to, which is governed.
    id: "data:invoice-document",
    physical: { prismaModel: "InvoiceDocument" },
    domain: "finance",
    ownerRole: "business-operator",
    stewardRole: "data-steward",
    categories: ["operational", "financial"],
    sensitivity: "confidential",
    criticality: "high",
    subjectLocators: [],
    lifecycleClass: "regulated-record",
    purposeCapabilities: ["service-delivery", "platform-operations"],
    residencyClass: "local-only",
    projectionClass: "metadata",
    classification: { state: "confirmed", source: "manual", effectiveFrom: "2026-08-01" },
    fields: [
      {
        id: "data:invoice-document#sentToEmail",
        physicalName: "sentToEmail",
        resolution: "governed",
        resolutionReason:
          "The customer contact address this invoice copy was emailed to. Personal data, captured at send time because the contact can change later; it must not leave the install in an unapproved projection.",
        categories: ["contact"],
        sensitivity: "confidential",
        collectionRule: "minimize",
        protection: "mask-on-read",
        projectionOverride: "metadata",
        provenance: {
          source: "manual",
          state: "confirmed",
          assertedBy: "data-steward",
          effectiveFrom: "2026-08-01",
        },
      },
      ...["id", "invoiceId", "documentVersionId", "createdById"].map((physicalName) => ({
        id: `data:invoice-document#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "not-applicable" as const,
        resolutionReason:
          "Opaque internal identifier or foreign key; carries no data about a subject on its own.",
        categories: ["system-internal"] as DataCategory[],
        sensitivity: "internal" as DataSensitivity,
        provenance: {
          source: "manual" as const,
          state: "confirmed" as const,
          assertedBy: "data-steward",
          effectiveFrom: "2026-08-01",
        },
      })),
      ...["role", "revision", "createdAt", "invoice", "documentVersion", "createdBy"].map((physicalName) => ({
        id: `data:invoice-document#${physicalName}` as DataFieldId,
        physicalName,
        resolution: "not-applicable" as const,
        resolutionReason:
          "Structural metadata about the stored copy (what it is, which revision, when, and its relations) — no personal or financial content.",
        categories: ["system-internal"] as DataCategory[],
        sensitivity: "internal" as DataSensitivity,
        provenance: {
          source: "manual" as const,
          state: "confirmed" as const,
          assertedBy: "data-steward",
          effectiveFrom: "2026-08-01",
        },
      })),
    ],
  },
];
