import type { OperationsMapTemplate, OperationsMapTemplateSelector } from "./types";

export const SOFTWARE_PLATFORM_MAP_TEMPLATE: OperationsMapTemplate = {
  id: "software-platform",
  label: "Software Platform Operations",
  archetypeCategoryIds: ["software-platform"],
  stations: [
    {
      id: "cross-cutting",
      label: "Cross-Cutting",
      shortLabel: "Cross",
      description: "Orchestrators and operators that coordinate across multiple value streams.",
    },
    {
      id: "explore",
      label: "Discover",
      shortLabel: "Discover",
      description: "Research signals, customer needs, technical opportunities, and operating risks.",
    },
    {
      id: "evaluate",
      label: "Backlog and Evaluation",
      shortLabel: "Evaluate",
      description: "Convert signals into governed epics, items, priorities, and execution evidence.",
    },
    {
      id: "integrate",
      label: "Design and Integrate",
      shortLabel: "Integrate",
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
      id: "deploy",
      label: "Deploy",
      shortLabel: "Deploy",
      description: "Prepare runtime, deployment, and environment changes.",
    },
    {
      id: "release",
      label: "Release",
      shortLabel: "Release",
      description: "Review, promote, and publish approved changes.",
    },
    {
      id: "consume",
      label: "Customer Experience",
      shortLabel: "Consume",
      description: "Support customer-facing adoption, service experience, and trust work.",
    },
    {
      id: "operate",
      label: "Operate and Improve",
      shortLabel: "Operate",
      description: "Handle operational issues, diagnostics, recovery, and improvement loops.",
    },
    {
      id: "governance",
      label: "Governance",
      shortLabel: "Govern",
      description: "Policy, evidence, compliance, and constitutional governance for AI coworker actions.",
    },
    {
      id: "unplaced",
      label: "Unplaced",
      shortLabel: "Unplaced",
      description: "Coworkers or activity whose registry value stream does not yet map to a station.",
    },
  ],
  lines: [
    {
      id: "cross-cutting-band",
      label: "Cross-cutting band",
      stationIds: ["cross-cutting"],
    },
    {
      id: "product-flow",
      label: "Product flow",
      stationIds: ["explore", "evaluate", "integrate", "build", "verify", "deploy", "release", "consume", "operate"],
    },
    {
      id: "governance-band",
      label: "Governance band",
      stationIds: ["governance", "unplaced"],
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

export const MANAGED_SERVICE_PROVIDER_MAP_TEMPLATE: OperationsMapTemplate = {
  id: "managed-service-provider",
  label: "Managed Service Provider Operations",
  archetypeCategoryIds: ["it-managed-services"],
  activationProfileTypes: ["managed-service-provider"],
  stations: [
    {
      id: "customer-intake",
      label: "Customer Intake",
      shortLabel: "Intake",
      description: "New customer requests, qualification, onboarding signals, and context capture.",
    },
    {
      id: "triage",
      label: "Triage",
      shortLabel: "Triage",
      description: "Classify service demand, urgency, ownership, and response path.",
    },
    {
      id: "agreements",
      label: "Agreement and SLA",
      shortLabel: "SLA",
      description: "Connect work to service agreements, entitlements, approval gates, and SLA posture.",
    },
    {
      id: "service-operations",
      label: "Service Operations",
      shortLabel: "Ops",
      description: "Resolve incidents, fulfill service requests, coordinate projects, and operate support workflows.",
    },
    {
      id: "customer-estate",
      label: "Customer Estate",
      shortLabel: "Estate",
      description: "Inspect customers, sites, configuration items, integrations, and estate separation signals.",
    },
    {
      id: "billing-readiness",
      label: "Billing Readiness",
      shortLabel: "Billing",
      description: "Prepare chargeable work, billing units, pass-through costs, and commercial readiness evidence.",
    },
    {
      id: "lifecycle-review",
      label: "Lifecycle Review",
      shortLabel: "Review",
      description: "Surface lifecycle signals, risk reviews, renewal prompts, and improvement opportunities.",
    },
    {
      id: "improvement",
      label: "Improvement",
      shortLabel: "Improve",
      description: "Feed service evidence, incidents, and lessons back into better customer operations.",
    },
  ],
  lines: [
    {
      id: "service-flow",
      label: "Service flow",
      stationIds: [
        "customer-intake",
        "triage",
        "agreements",
        "service-operations",
        "customer-estate",
        "billing-readiness",
        "lifecycle-review",
        "improvement",
      ],
    },
  ],
};

export const OPERATIONS_MAP_TEMPLATES = [
  SOFTWARE_PLATFORM_MAP_TEMPLATE,
  MANAGED_SERVICE_PROVIDER_MAP_TEMPLATE,
  GENERIC_VALUE_CHAIN_TEMPLATE,
] as const;

export function getMapTemplate(
  selector: string | OperationsMapTemplateSelector | null | undefined,
): OperationsMapTemplate {
  const normalized = normalizeTemplateSelector(selector);

  return (
    OPERATIONS_MAP_TEMPLATES.find((template) =>
      normalized.activationProfileType
        ? template.activationProfileTypes?.includes(normalized.activationProfileType)
        : false,
    ) ??
    OPERATIONS_MAP_TEMPLATES.find((template) =>
      normalized.archetypeId ? template.archetypeCategoryIds.includes(normalized.archetypeId) : false,
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

function normalizeTemplateSelector(
  selector: string | OperationsMapTemplateSelector | null | undefined,
): OperationsMapTemplateSelector {
  if (typeof selector === "string") return { archetypeId: selector };
  return selector ?? {};
}
