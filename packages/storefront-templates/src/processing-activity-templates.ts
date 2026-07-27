import type { ArchetypeCategory } from "./types";

export type ProcessingActivityTemplate = {
  templateId: string;
  archetypeCategory: ArchetypeCategory;
  name: string;
  purposeKey: string;
  proposedDataCategories: readonly string[];
  authorityRefs: readonly string[];
  provenance: { source: "archetype-template"; version: 1 };
  initialStatus: "review";
};

const CATEGORY_PURPOSE: Partial<
  Record<ArchetypeCategory, { purposeKey: string; dataCategories: readonly string[] }>
> = {
  "banking-financial-services": {
    purposeKey: "billing-and-payments",
    dataCategories: ["financial", "identity", "contact"],
  },
  "healthcare-wellness": {
    purposeKey: "service-delivery",
    dataCategories: ["health", "identity", "contact"],
  },
  "public-sector": {
    purposeKey: "compliance-and-legal",
    dataCategories: ["operational", "identity", "security-audit"],
  },
  "software-platform": {
    purposeKey: "platform-operations",
    dataCategories: ["telemetry", "configuration", "system-internal"],
  },
};

export function processingActivityTemplatesForArchetype(
  archetypeCategory: ArchetypeCategory,
): readonly ProcessingActivityTemplate[] {
  const templates: ProcessingActivityTemplate[] = [
    {
      templateId: `dpa-template.${archetypeCategory}.service-delivery.v1`,
      archetypeCategory,
      name: "Deliver the requested service",
      purposeKey: "service-delivery",
      proposedDataCategories: ["identity", "contact", "operational"],
      authorityRefs: [],
      provenance: { source: "archetype-template", version: 1 },
      initialStatus: "review",
    },
    {
      templateId: `dpa-template.${archetypeCategory}.security.v1`,
      archetypeCategory,
      name: "Protect accounts and investigate abuse",
      purposeKey: "security-and-fraud",
      proposedDataCategories: ["security-audit", "authorization", "identity"],
      authorityRefs: [],
      provenance: { source: "archetype-template", version: 1 },
      initialStatus: "review",
    },
  ];
  const categoryPurpose = CATEGORY_PURPOSE[archetypeCategory];
  if (categoryPurpose && categoryPurpose.purposeKey !== "service-delivery") {
    templates.push({
      templateId: `dpa-template.${archetypeCategory}.${categoryPurpose.purposeKey}.v1`,
      archetypeCategory,
      name: "Review the archetype-specific processing purpose",
      purposeKey: categoryPurpose.purposeKey,
      proposedDataCategories: categoryPurpose.dataCategories,
      authorityRefs: [],
      provenance: { source: "archetype-template", version: 1 },
      initialStatus: "review",
    });
  }
  return templates;
}
