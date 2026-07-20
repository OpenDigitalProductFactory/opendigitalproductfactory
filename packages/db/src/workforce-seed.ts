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
  delegatesTo?: readonly string[];
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
    // EP-4A12A7CB slice 4: owns master-data quality — dedup review, merge,
    // staleness, enrichment. Runs autonomously on a daily schedule and works
    // the steward queue down; escalates the ambiguous cases to a human.
    agentId: "data-steward",
    slugId: "data-steward",
    name: "Data Steward",
    tier: 2,
    type: "coworker",
    description: "Master-data quality: duplicate resolution, record refresh, and merge governance",
    valueStream: "cross-cutting",
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
    delegatesTo: ["AGT-902"],
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
  // The Digital Product Estate Specialist stewards the product estate (discovery
  // triage, portfolio quality) via registry_read/registry_write + backlog. It does
  // NOT do AI-ops: agent_control_read (add_provider, configure_gateway_scan,
  // manage_coworker_tool_grant, grok_signin, …) was out-of-role and only inflated
  // its tool surface (BI-CAP-C2565D94). portfolio_read added no reachable tool that
  // registry_read didn't already cover. Both removed for least-privilege.
  "inventory-specialist": [
    "registry_read",
    "registry_write",
    "backlog_read",
    "backlog_write",
  ],
  // tool_script_exec (EP-27FD96BC BI-9893614D): the EA architect traverses large
  // graph/architecture reads — a prime case for programmatic filtering in the
  // sandbox (the script's JWT is read-only-scoped regardless of these grants).
  "ea-architect": ["ea_graph_read", "ea_graph_write", "architecture_read", "file_read", "registry_read", "tool_script_exec"],
  "hr-specialist": ["registry_read", "consumer_read", "consumer_write"],
  // The Customer Success Manager operates the CRM (accounts, pipeline, quotes),
  // so it needs crm_read/crm_write — NOT backlog_write (which let it retire live
  // backlog items while flailing) or marketing_read (wrong domain). Its runtime
  // grants resolve from THIS map (the slug agent row the coworker queries by
  // agentId "customer-advisor"), not from agent_registry.json — so the CRM
  // grants must live here to actually reach the coworker's tool surface.
  "customer-advisor": ["crm_read", "crm_write", "consumer_read", "registry_read", "backlog_read", "web_search"],
  // The Data Steward owns master-data quality: it runs the dedup/staleness
  // sweep, merges duplicates, and proposes enrichment. crm_write reaches the
  // mdm-stewardship pack tools (run_mdm_steward_sweep, merge_customer_*,
  // list_mdm_steward_tasks); web_search gates the enrich_customer_account door.
  "data-steward": ["crm_read", "crm_write", "consumer_read", "registry_read", "backlog_read", "web_search", "tool_script_exec"],
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
  // The AI Ops Engineer runs the /platform/ai/readiness surface: it observes
  // coworker capability needs and must be able to file/track backlog items for the
  // issues it detects. Its runtime grants resolve from THIS map (not
  // agent_registry.json, which already intends backlog access), so backlog_read/
  // backlog_write must live here to reach its tool surface (BI-CAP-CBC41758).
  "platform-engineer": ["agent_control_read", "admin_read", "admin_write", "registry_read", "telemetry_read", "backlog_read", "backlog_write", "tool_script_exec"],
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
    // Already sandbox-native (sandbox_execute); code_graph/file reads are the
    // canonical read-heavy filtering case (EP-27FD96BC BI-9893614D).
    "tool_script_exec",
  ],
  "data-architect": ["file_read", "sandbox_execute", "architecture_read", "registry_read", "tool_script_exec"],
  "admin-assistant": ["admin_read", "admin_write", "agent_control_read", "registry_read", "web_search", "file_read"],
  coo: ["portfolio_read", "registry_read", "backlog_read", "backlog_write", "agent_control_read", "email_config", "thread_write"],
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
    // WWWD elicitation (BI-44526F3E Phase C): the onboarding COO interviews the
    // operator about how the business runs and captures confirmed answers into
    // the org corpus (record_org_business_answer → draft pages for review).
    "registry_write",
    "backlog_read",
    "portfolio_read",
    "admin_write",
    "thread_write",
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
