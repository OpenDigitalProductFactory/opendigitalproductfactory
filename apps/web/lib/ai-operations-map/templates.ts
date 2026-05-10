import type { OperationsMapTemplate } from "./types";

export const SOFTWARE_PLATFORM_MAP_TEMPLATE: OperationsMapTemplate = {
  id: "software-platform",
  label: "Software Platform Operations",
  archetypeCategoryIds: ["software-platform"],
  stations: [
    {
      id: "discover",
      label: "Discover",
      shortLabel: "Discover",
      description: "Research signals, customer needs, technical opportunities, and operating risks.",
    },
    {
      id: "backlog",
      label: "Backlog",
      shortLabel: "Backlog",
      description: "Convert signals into governed epics, items, priorities, and execution evidence.",
    },
    {
      id: "design",
      label: "Design",
      shortLabel: "Design",
      description: "Shape architecture, UX, policies, specifications, and implementation plans.",
    },
    {
      id: "build",
      label: "Build",
      shortLabel: "Build",
      description: "Implement scoped product and platform changes through the build runtime.",
    },
    {
      id: "verify",
      label: "Verify",
      shortLabel: "Verify",
      description: "Run tests, builds, QA, review, and acceptance checks before release.",
    },
    {
      id: "release",
      label: "Release",
      shortLabel: "Release",
      description: "Prepare, review, promote, and publish approved changes.",
    },
    {
      id: "support",
      label: "Support",
      shortLabel: "Support",
      description: "Handle operational issues, customer support, diagnostics, and recovery.",
    },
    {
      id: "improve",
      label: "Improve",
      shortLabel: "Improve",
      description: "Feed outcomes, incidents, and evidence back into better platform behavior.",
    },
  ],
  lines: [
    {
      id: "product-flow",
      label: "Product flow",
      stationIds: ["discover", "backlog", "design", "build", "verify", "release", "support", "improve"],
    },
  ],
};

export const GENERIC_VALUE_CHAIN_TEMPLATE: OperationsMapTemplate = {
  id: "generic-value-chain",
  label: "Generic Value Chain",
  archetypeCategoryIds: [],
  stations: [
    {
      id: "demand",
      label: "Demand",
      shortLabel: "Demand",
      description: "Market, customer, and operational demand entering the business.",
    },
    {
      id: "intake",
      label: "Intake",
      shortLabel: "Intake",
      description: "Qualification, triage, and routing into a business flow.",
    },
    {
      id: "delivery",
      label: "Delivery",
      shortLabel: "Delivery",
      description: "Primary work that creates value for customers or operators.",
    },
    {
      id: "experience",
      label: "Customer Experience",
      shortLabel: "Experience",
      description: "Customer-facing communication, support, and trust work.",
    },
    {
      id: "improve",
      label: "Improve",
      shortLabel: "Improve",
      description: "Evidence and feedback loops that improve future work.",
    },
  ],
  lines: [
    {
      id: "value-flow",
      label: "Value flow",
      stationIds: ["demand", "intake", "delivery", "experience", "improve"],
    },
  ],
};

export const OPERATIONS_MAP_TEMPLATES = [
  SOFTWARE_PLATFORM_MAP_TEMPLATE,
  GENERIC_VALUE_CHAIN_TEMPLATE,
] as const;

export function getMapTemplate(archetypeCategoryId: string | null | undefined): OperationsMapTemplate {
  return (
    OPERATIONS_MAP_TEMPLATES.find((template) =>
      archetypeCategoryId ? template.archetypeCategoryIds.includes(archetypeCategoryId) : false,
    ) ?? GENERIC_VALUE_CHAIN_TEMPLATE
  );
}

export function validateMapTemplate(template: OperationsMapTemplate): string[] {
  const stationIds = new Set(template.stations.map((station) => station.id));
  const errors: string[] = [];

  for (const line of template.lines) {
    for (const stationId of line.stationIds) {
      if (!stationIds.has(stationId)) {
        errors.push(`Line ${line.id} references missing station ${stationId}`);
      }
    }
  }

  return errors;
}
