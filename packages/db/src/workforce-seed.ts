import type { PrismaClient } from "../generated/client/client";

export type CoworkerAgentSeed = {
  agentId: string;
  slugId: string;
  name: string;
  tier: number;
  type: "coworker";
  description: string;
  valueStream: string;
  sensitivity: "internal" | "confidential" | "restricted";
};

export const COWORKER_AGENT_SEEDS: readonly CoworkerAgentSeed[] = [
  {
    agentId: "portfolio-advisor",
    slugId: "portfolio-advisor",
    name: "Portfolio Analyst",
    tier: 1,
    type: "coworker",
    description: "Investment, risk, and portfolio health analysis",
    valueStream: "evaluate",
    sensitivity: "internal",
  },
  {
    agentId: "external-catalog-scout",
    slugId: "external-catalog-scout",
    name: "External Catalog Scout",
    tier: 2,
    type: "coworker",
    description:
      "External coworker archetype reconnaissance and governed backlog suggestion generation from approved outside catalogs",
    valueStream: "explore",
    sensitivity: "internal",
  },
  {
    agentId: "inventory-specialist",
    slugId: "inventory-specialist",
    name: "Digital Product Estate Specialist",
    tier: 2,
    type: "coworker",
    description:
      "Lifecycle, maturity, and attribution analysis across the discovered digital product estate",
    valueStream: "explore",
    sensitivity: "internal",
  },
  {
    agentId: "ea-architect",
    slugId: "ea-architect",
    name: "Enterprise Architect",
    tier: 2,
    type: "coworker",
    description: "Structural analysis, dependency tracing, and architecture governance",
    valueStream: "cross-cutting",
    sensitivity: "internal",
  },
  {
    agentId: "hr-specialist",
    slugId: "hr-specialist",
    name: "HR Director",
    tier: 2,
    type: "coworker",
    description: "People, roles, accountability chains, and governance compliance",
    valueStream: "cross-cutting",
    sensitivity: "confidential",
  },
  {
    agentId: "customer-advisor",
    slugId: "customer-advisor",
    name: "Customer Success Manager",
    tier: 2,
    type: "coworker",
    description: "Customer journey, service adoption, and satisfaction analysis",
    valueStream: "consume",
    sensitivity: "confidential",
  },
  {
    agentId: "marketing-specialist",
    slugId: "marketing-specialist",
    name: "Marketing Strategist",
    tier: 2,
    type: "coworker",
    description:
      "Acquisition strategy, campaign planning, funnel analysis, and marketing automation readiness",
    valueStream: "consume",
    sensitivity: "confidential",
  },
  {
    agentId: "storefront-advisor",
    slugId: "storefront-advisor",
    name: "Storefront Operations Manager",
    tier: 2,
    type: "coworker",
    description:
      "Portal operations, offer presentation, inbox review, and storefront administration",
    valueStream: "consume",
    sensitivity: "confidential",
  },
  {
    agentId: "ops-coordinator",
    slugId: "ops-coordinator",
    name: "Scrum Master",
    tier: 2,
    type: "coworker",
    description: "Delivery flow, backlog prioritization, and blocker removal",
    valueStream: "integrate",
    sensitivity: "internal",
  },
  {
    agentId: "platform-engineer",
    slugId: "platform-engineer",
    name: "AI Ops Engineer",
    tier: 2,
    type: "coworker",
    description: "AI infrastructure, provider management, and cost optimization",
    valueStream: "operate",
    sensitivity: "confidential",
  },
  {
    agentId: "build-specialist",
    slugId: "build-specialist",
    name: "Software Engineer",
    tier: 2,
    type: "coworker",
    description: "Feature development, code generation, and implementation",
    valueStream: "integrate",
    sensitivity: "internal",
  },
  {
    agentId: "data-architect",
    slugId: "data-architect",
    name: "Data Architect",
    tier: 2,
    type: "coworker",
    description:
      "Schema design, data modeling (3NF/DAMA-DMBOK), migration validation, inverse relation checks, and index optimization. Validates all Prisma schema changes before migration.",
    valueStream: "integrate",
    sensitivity: "internal",
  },
  // System Admin operations usually cover RBAC review, provider config, backup
  // status, and audit trail review, so confidential keeps first-run cloud
  // provider setups usable. Operators can elevate deployments that process
  // restricted data after the relevant provider terms are in place.
  {
    agentId: "admin-assistant",
    slugId: "admin-assistant",
    name: "System Admin",
    tier: 2,
    type: "coworker",
    description: "Access control, security posture, and platform configuration",
    valueStream: "operate",
    sensitivity: "confidential",
  },
  {
    agentId: "coo",
    slugId: "coo",
    name: "COO",
    tier: 1,
    type: "coworker",
    description: "Cross-cutting oversight, workforce orchestration, and strategic priorities",
    valueStream: "cross-cutting",
    sensitivity: "confidential",
  },
  {
    agentId: "doc-specialist",
    slugId: "doc-specialist",
    name: "Documentation Specialist",
    tier: 2,
    type: "coworker",
    description:
      "Mermaid diagram creation/regeneration, documentation structure/consistency, spec and architecture document quality, renderer compatibility awareness",
    valueStream: "cross-cutting",
    sensitivity: "internal",
  },
  // Compliance and finance default to confidential to avoid forcing a local-only
  // LLM for ordinary policy and budget work. Deployments handling regulated
  // data can raise these workers to restricted through provider configuration.
  {
    agentId: "compliance-officer",
    slugId: "compliance-officer",
    name: "Compliance Officer",
    tier: 2,
    type: "coworker",
    description: "Regulatory compliance, policy governance, audit readiness, and risk management",
    valueStream: "cross-cutting",
    sensitivity: "confidential",
  },
  {
    agentId: "legal-operations-counsel",
    slugId: "legal-operations-counsel",
    name: "Legal Operations Counsel",
    tier: 2,
    type: "coworker",
    description: "Legal review packet preparation, contract issue spotting, and counsel handoff coordination",
    valueStream: "cross-cutting",
    sensitivity: "confidential",
  },
  {
    agentId: "finance-controller",
    slugId: "finance-controller",
    name: "Finance Controller",
    tier: 2,
    type: "coworker",
    description: "Financial controls, budget governance, cost management, and financial reporting",
    valueStream: "cross-cutting",
    sensitivity: "confidential",
  },
  // Field-dispatch coordinator for field-service archetypes. It coordinates the
  // field-service job lifecycle: scheduling, crew assignment, and customer
  // notification proposals.
  {
    agentId: "dispatcher",
    slugId: "dispatcher",
    name: "Dispatcher",
    tier: 2,
    type: "coworker",
    description:
      "Field-service dispatch: job scheduling, technician/crew assignment, customer ETA notifications (confirm / on-my-way / running-late), and running-late coordination",
    valueStream: "operate",
    sensitivity: "confidential",
  },
];

export const HARDCODED_COWORKER_GRANTS: Record<string, readonly string[]> = {
  "portfolio-advisor": ["portfolio_read", "registry_read", "backlog_read"],
  "external-catalog-scout": ["backlog_read", "backlog_write", "registry_read"],
  "inventory-specialist": [
    "portfolio_read",
    "registry_read",
    "registry_write",
    "backlog_read",
    "backlog_write",
    "agent_control_read",
  ],
  "ea-architect": ["ea_graph_read", "ea_graph_write", "architecture_read", "file_read", "registry_read"],
  "hr-specialist": ["registry_read", "consumer_read", "consumer_write"],
  "customer-advisor": ["consumer_read", "registry_read", "backlog_read", "backlog_write", "marketing_read"],
  "marketing-specialist": ["marketing_read", "marketing_write", "consumer_read", "registry_read"],
  "storefront-advisor": [
    "consumer_read",
    "registry_read",
    "backlog_read",
    "backlog_write",
    "marketing_read",
    "marketing_write",
    "web_search",
  ],
  "ops-coordinator": ["backlog_read", "backlog_write", "backlog_triage", "registry_read", "portfolio_read"],
  "platform-engineer": ["agent_control_read", "admin_read", "admin_write", "registry_read", "telemetry_read"],
  "build-specialist": [
    "file_read",
    "code_graph_read",
    "backlog_read",
    "backlog_write",
    "architecture_read",
    "build_plan_write",
    "registry_read",
    "sandbox_execute",
    "deployment_plan_create",
    "iac_execute",
    "release_gate_create",
    "release_plan_create",
    "release_plan_read",
    "coworker_screen_read",
    "coworker_screen_drive",
  ],
  "data-architect": ["file_read", "sandbox_execute", "architecture_read", "registry_read"],
  "admin-assistant": ["admin_read", "admin_write", "agent_control_read", "registry_read", "web_search", "file_read"],
  coo: ["portfolio_read", "registry_read", "backlog_read", "backlog_write", "agent_control_read", "email_config"],
  "doc-specialist": ["file_read", "registry_read", "portfolio_read", "document_read", "document_write", "document_publish"],
  "compliance-officer": [
    "policy_write",
    "data_governance_validate",
    "file_read",
    "backlog_read",
    "backlog_write",
    "tool_evaluation_create",
  ],
  "legal-operations-counsel": ["file_read", "document_read", "document_write", "registry_read"],
  "finance-controller": ["registry_read", "backlog_read", "portfolio_read"],
  // Reads field-service jobs and customer contact data, updates job status, and
  // proposes customer notifications for approval.
  dispatcher: ["backlog_read", "backlog_write", "consumer_read", "consumer_write", "registry_read"],
};

// onboarding-coo is created by bootstrap-first-run.ts during portal startup.
// Keep its grants here too so reseeding an initialized install stays consistent.
export const ONBOARDING_AGENT_GRANTS: Record<string, readonly string[]> = {
  "onboarding-coo": [
    "file_read",
    "web_search",
    "data_governance_validate",
    "registry_read",
    "backlog_read",
    "portfolio_read",
    "admin_write",
  ],
};

export function getDefaultEmploymentTypes() {
  return [
    { employmentTypeId: "emp-full-time", name: "Full-time" },
    { employmentTypeId: "emp-part-time", name: "Part-time" },
    { employmentTypeId: "emp-contractor", name: "Contractor" },
    { employmentTypeId: "emp-intern", name: "Intern" },
    { employmentTypeId: "emp-advisor", name: "Advisor" },
  ] as const;
}

export function getDefaultWorkLocations() {
  return [
    {
      locationId: "loc-hq",
      name: "Headquarters",
      locationType: "office",
      timezone: "America/Chicago",
    },
    {
      locationId: "loc-remote",
      name: "Remote",
      locationType: "remote",
      timezone: null,
    },
    {
      locationId: "loc-hybrid",
      name: "Hybrid",
      locationType: "hybrid",
      timezone: null,
    },
  ] as const;
}

export async function seedWorkforceReferenceData(prisma: PrismaClient): Promise<void> {
  for (const employmentType of getDefaultEmploymentTypes()) {
    await prisma.employmentType.upsert({
      where: { employmentTypeId: employmentType.employmentTypeId },
      update: {
        name: employmentType.name,
        status: "active",
      },
      create: {
        ...employmentType,
        status: "active",
      },
    });
  }

  for (const workLocation of getDefaultWorkLocations()) {
    await prisma.workLocation.upsert({
      where: { locationId: workLocation.locationId },
      update: {
        name: workLocation.name,
        locationType: workLocation.locationType,
        timezone: workLocation.timezone,
        status: "active",
      },
      create: {
        ...workLocation,
        status: "active",
      },
    });
  }
}
