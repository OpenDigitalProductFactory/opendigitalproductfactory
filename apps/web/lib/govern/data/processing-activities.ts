// apps/web/lib/govern/data/processing-activities.ts
// BI-DG-002 (spec §6.1): platform-default processing-purpose CAPABILITY templates.
// PURE, declarative. These declare which purposes the platform can TECHNICALLY serve
// for which data categories — NOT legal applicability and NOT organization
// authorization. Active org-specific purposes come only from confirmed
// `DataProcessingActivity` records + executable policy at runtime (spec §6.1); this
// module never asserts that a purpose is lawful or authorized for a given org.

import type { DataCategory, ProcessingPurposeKey } from "./taxonomy";

/**
 * A platform capability template: "the implementation can serve <purpose> over data
 * in these categories." `mustMinimize` marks categories the platform treats as
 * minimize-by-default for the purpose even when technically capable.
 */
export type PurposeCapabilityTemplate = {
  purpose: ProcessingPurposeKey;
  description: string;
  appliesToCategories: readonly DataCategory[];
  mustMinimize?: readonly DataCategory[];
};

const TEMPLATES: readonly PurposeCapabilityTemplate[] = [
  {
    purpose: "service-delivery",
    description: "Operate the product features the user is actively using.",
    appliesToCategories: ["identity", "contact", "operational", "content", "configuration"],
  },
  {
    purpose: "security-and-fraud",
    description: "Detect abuse, intrusion, and fraud; maintain audit trails.",
    appliesToCategories: ["security-audit", "authorization", "telemetry", "identity"],
  },
  {
    purpose: "billing-and-payments",
    description: "Invoice, collect, and reconcile payments.",
    appliesToCategories: ["financial", "identity", "contact"],
  },
  {
    purpose: "customer-support",
    description: "Resolve customer issues and answer questions.",
    appliesToCategories: ["contact", "operational", "content", "identity"],
    mustMinimize: ["financial"],
  },
  {
    purpose: "product-analytics",
    description: "Understand aggregate product usage and performance.",
    appliesToCategories: ["telemetry", "derived-analytic"],
    mustMinimize: ["identity", "contact"],
  },
  {
    purpose: "personalization",
    description: "Tailor experience to a subject's context.",
    appliesToCategories: ["personal-attribute", "derived-analytic", "content"],
    mustMinimize: ["personal-attribute"],
  },
  {
    purpose: "compliance-and-legal",
    description: "Meet legal, regulatory, and contractual obligations.",
    appliesToCategories: ["financial", "security-audit", "operational", "identity"],
  },
  {
    purpose: "platform-operations",
    description: "Run, monitor, and maintain the platform itself.",
    appliesToCategories: ["telemetry", "system-internal", "configuration"],
  },
  {
    purpose: "coworker-assistance",
    description: "Let AI coworkers assist the operator over their own workspace data.",
    appliesToCategories: ["content", "operational", "derived-analytic"],
    mustMinimize: ["financial", "credential-secret"],
  },
];

const BY_PURPOSE: ReadonlyMap<ProcessingPurposeKey, PurposeCapabilityTemplate> = new Map(
  TEMPLATES.map((t) => [t.purpose, t]),
);

export const PURPOSE_CAPABILITY_TEMPLATES = TEMPLATES;

export function getPurposeCapability(
  purpose: ProcessingPurposeKey,
): PurposeCapabilityTemplate | undefined {
  return BY_PURPOSE.get(purpose);
}

/**
 * Whether the platform can technically serve `purpose` for data in `category`.
 * A CAPABILITY check only — callers still require a confirmed org processing activity
 * + executable policy before actually processing for that purpose.
 */
export function purposeCoversCategory(
  purpose: ProcessingPurposeKey,
  category: DataCategory,
): boolean {
  return getPurposeCapability(purpose)?.appliesToCategories.includes(category) ?? false;
}

/** Categories a purpose treats as minimize-by-default (subset of appliesToCategories). */
export function minimizedCategoriesFor(purpose: ProcessingPurposeKey): readonly DataCategory[] {
  return getPurposeCapability(purpose)?.mustMinimize ?? [];
}
