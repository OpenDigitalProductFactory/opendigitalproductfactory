export {
  getDefaultEmploymentTypes,
  getDefaultWorkLocations,
  seedWorkforceReferenceData,
} from "./workforce-reference-seed";

export type CoworkerAgentSeed = {
  agentId: string;
  slugId: string;
  name: string;
  tier: number;
  type: "coworker";
  description: string;
  valueStream: string;
  sensitivity: "internal" | "confidential" | "restricted";
  /** Initial stage for a newly seeded row. Reseeding never changes a live stage. */
  initialLifecycleStage?: "draft" | "production";
  delegatesTo?: readonly string[];
};

export const COWORKER_AGENT_SEEDS: readonly CoworkerAgentSeed[] = [
  // Value-stream orchestrators and the cross-cutting finance specialist.
  // Seeded because each carries an authored persona in prompts/route-persona —
  // evidence that the role was specified to run, not merely enumerated in the
  // IT4IT lattice. The 39 declared identities WITHOUT a persona stay unseeded:
  // whether those roles are staffed, and by whom, is an operator decision.
  {
    agentId: "evaluate-orchestrator",
    slugId: "evaluate-orchestrator",
    name: "Evaluate Orchestrator",
    tier: 1,
    type: "coworker",
    description: "Coordinates evaluation-stream work: scoring, review, and what is worth doing next",
    valueStream: "evaluate",
    sensitivity: "internal",
  },
  {
    agentId: "explore-orchestrator",
    slugId: "explore-orchestrator",
    name: "Explore Orchestrator",
    tier: 1,
    type: "coworker",
    description: "Coordinates exploration-stream work: discovery, research, and option shaping",
    valueStream: "explore",
    sensitivity: "internal",
  },
  {
    agentId: "integrate-orchestrator",
    slugId: "integrate-orchestrator",
    name: "Integrate Orchestrator",
    tier: 1,
    type: "coworker",
    description: "Coordinates integration-stream work: build, review, and delivery handoff",
    valueStream: "integrate",
    sensitivity: "internal",
  },
  {
    agentId: "deploy-orchestrator",
    slugId: "deploy-orchestrator",
    name: "Deploy Orchestrator",
    tier: 1,
    type: "coworker",
    description: "Coordinates deployment-stream work: promotion readiness and release windows",
    valueStream: "deploy",
    sensitivity: "internal",
  },
  {
    agentId: "release-orchestrator",
    slugId: "release-orchestrator",
    name: "Release Orchestrator",
    tier: 1,
    type: "coworker",
    description: "Coordinates release-stream work: bundles, validation, and rollout",
    valueStream: "release",
    sensitivity: "internal",
  },
  {
    agentId: "consume-orchestrator",
    slugId: "consume-orchestrator",
    name: "Consume Orchestrator",
    tier: 1,
    type: "coworker",
    description: "Coordinates consumption-stream work: customer-facing delivery and demand",
    valueStream: "consume",
    sensitivity: "internal",
  },
  {
    agentId: "operate-orchestrator",
    slugId: "operate-orchestrator",
    name: "Operate Orchestrator",
    tier: 1,
    type: "coworker",
    description: "Coordinates operations-stream work: run-state, incidents, and service health",
    valueStream: "operate",
    sensitivity: "internal",
  },
  {
    agentId: "governance-orchestrator",
    slugId: "governance-orchestrator",
    name: "Governance Orchestrator",
    tier: 1,
    type: "coworker",
    description: "Coordinates governance-stream work: policy, compliance posture, and decision review",
    valueStream: "governance",
    sensitivity: "internal",
  },
  {
    agentId: "finance-agent",
    slugId: "finance-agent",
    name: "Finance Specialist",
    tier: 1,
    type: "coworker",
    description: "Cross-cutting money work: recording, reconciliation, and financial position",
    valueStream: "cross-cutting",
    sensitivity: "internal",
  },
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
    agentId: "time-off-advisor",
    slugId: "time-off-advisor",
    name: "Time-off Advisor",
    tier: 2,
    type: "coworker",
    description:
      "Propose-only time-off recommendations grounded in leave facts, staffing coverage, and the organization's recorded stance",
    valueStream: "operate",
    sensitivity: "confidential",
    initialLifecycleStage: "draft",
  },
  {
    // BI-6D10EB1F: owner-facing competitive intelligence / market research.
    // Researches a prospect or segment's tool stack + spend on the public web
    // and synthesizes it against the internal CRM into a grounded, cited brief.
    // Seeded as a draft; promoted after the nightly golden-journey certification.
    agentId: "market-research-analyst",
    slugId: "market-research-analyst",
    name: "Market Research Analyst",
    tier: 2,
    type: "coworker",
    description:
      "Competitive intelligence and market research on request — public-web reconnaissance of a prospect or segment's tool stack and spend, synthesized against internal CRM into a grounded, cited brief tied to an opportunity",
    valueStream: "explore",
    sensitivity: "confidential",
    initialLifecycleStage: "draft",
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
    // BI-DED7D653: independent semantic reviewer for committed changes. This
    // coworker is deliberately separate from build-specialist so the author
    // cannot provide its own independent review receipt.
    agentId: "change-reviewer",
    slugId: "change-reviewer",
    name: "Change Reviewer",
    tier: 2,
    type: "coworker",
    description:
      "Independent semantic review of committed software changes for correctness, security, maintainability, architecture fit, test adequacy, accessibility routing, and evidence quality",
    valueStream: "evaluate",
    sensitivity: "confidential",
    initialLifecycleStage: "draft",
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
  // Bookkeeper (BI-7D50DC56, slice S-BK of the Bookkeeping Work Room). Distinct
  // from the Finance Controller's oversight role: the bookkeeper does the
  // day-to-day transaction-level work — set up bank/card accounts, import
  // statements, categorize via bank rules, and reconcile against payments,
  // through the governed banking tools (BI-DE27D34E, S-FIN). Money-of-record
  // writes (account setup, statement import) route the governance gate.
  {
    agentId: "bookkeeper",
    slugId: "bookkeeper",
    name: "Bookkeeper",
    tier: 2,
    type: "coworker",
    description: "Keeps the books current from bank/card statements: account setup, statement import, bank-rule categorization, and reconciliation, with owner approval for money-of-record writes",
    valueStream: "operate",
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
  {
    agentId: "farm-ranch-steward",
    slugId: "farm-ranch-steward",
    name: "Farm & Ranch Steward",
    tier: 2,
    type: "coworker",
    description:
      "Seasonal land, forage, livestock, working-animal, equipment, vendor, weather, market, and regulatory operating coordination",
    valueStream: "operate",
    sensitivity: "confidential",
    initialLifecycleStage: "draft",
  },
  // AGT-906 revived through the enforced lifecycle (EP-UX-SYSTEM L6, BI-42892849
  // / BI-3880DA1D). Deliberately established in its CURATION stage: it owns the
  // founder-authored UX critique corpus and holds NO gating authority. Its
  // grants are read-and-draft only — no backlog_write, no build_phase_advance,
  // no release_gate_create — because an ungrounded design critic is the
  // zero-shot judge UICrit measured at 13.1% comment validity, and a critic that
  // can block on invalid findings teaches the org to ignore the UX signal.
  // Critic authority is a later staged grant, gated on measured agreement
  // against a held-out corpus slice (see the WSID decision-gate page).
  {
    agentId: "ux-design-critic",
    slugId: "ux-design-critic",
    name: "UX Design Critic",
    tier: 2,
    type: "coworker",
    description:
      "Curates the founder-authored UX critique corpus and, once calibrated against it, critiques owner-facing surfaces for information hierarchy, content density, and cognitive load",
    valueStream: "evaluate",
    sensitivity: "internal",
  },
  // Internal developer security acumen (BI-CC44E74F, EP-413F2602), established
  // via the establish_coworker factory door; stays draft pending certification.
  {
    agentId: "security-engineer",
    slugId: "security-engineer",
    name: "Security Engineer",
    tier: 2,
    type: "coworker",
    description:
      "Exposure classification at birth, vulnerability and supply-chain triage, access-control review of platform surfaces (endpoints, MCP/A2A planes), and security findings stewardship",
    valueStream: "evaluate",
    sensitivity: "confidential",
    initialLifecycleStage: "draft",
  },
  // Internal developer mcp-integration acumen (BI-CC44E74F, EP-413F2602),
  // established via the establish_coworker factory door; stays draft pending
  // certification.
  {
    agentId: "integration-engineer",
    slugId: "integration-engineer",
    name: "MCP & Integration Engineer",
    tier: 2,
    type: "coworker",
    description:
      "Coordination-plane stewardship: MCP protocol version window (N/N-1), frozen tool-name contract with grant-mapped aliases, context economy of the tool surface, and integration/connector review",
    valueStream: "integrate",
    sensitivity: "internal",
    initialLifecycleStage: "draft",
  },
  // EP-32B0E693 identity reconciliation. Each entry below already exists as an
  // ACTIVE canonical registry identity. Seeding its slug projects that existing
  // staffing state onto the workforce roster; it does not activate any of the
  // declared-only IT4IT lattice or change the identity's authority.
  {
    agentId: "licensing-specialist",
    slugId: "licensing-specialist",
    name: "Licensing & Permit Specialist",
    tier: 2,
    type: "coworker",
    description: "Archetype-aware licensing, permit, legality, display-obligation, and staff-credential readiness investigation",
    valueStream: "cross-cutting",
    sensitivity: "confidential",
  },
  {
    agentId: "ux-accessibility-agent",
    slugId: "ux-accessibility-agent",
    name: "UX Accessibility Reviewer",
    tier: 2,
    type: "coworker",
    description: "WCAG 2.2 AA, keyboard, semantic HTML, contrast, and DPF design-system conformance review",
    valueStream: "evaluate",
    sensitivity: "internal",
  },
  {
    agentId: "soc-triage-analyst",
    slugId: "soc-triage-analyst",
    name: "SOC Triage Analyst",
    tier: 2,
    type: "coworker",
    description: "Tier-1 security detection triage, enrichment, severity assessment, and case stewardship",
    valueStream: "operate",
    sensitivity: "restricted",
  },
  {
    agentId: "soc-investigator",
    slugId: "soc-investigator",
    name: "SOC Investigator",
    tier: 2,
    type: "coworker",
    description: "Deep security-case investigation, timeline construction, blast-radius analysis, and response proposals",
    valueStream: "operate",
    sensitivity: "restricted",
  },
  {
    agentId: "soc-threat-hunter",
    slugId: "soc-threat-hunter",
    name: "SOC Threat Hunter",
    tier: 2,
    type: "coworker",
    description: "Hypothesis-driven threat hunting and proposal-only detection-content improvement",
    valueStream: "operate",
    sensitivity: "restricted",
  },
  {
    agentId: "soc-incident-commander",
    slugId: "soc-incident-commander",
    name: "SOC Incident Commander",
    tier: 2,
    type: "coworker",
    description: "Security incident coordination, remediation proposals, case ownership, and customer communications",
    valueStream: "operate",
    sensitivity: "restricted",
  },
  {
    agentId: "external-claude-code",
    slugId: "external-claude-code",
    name: "Claude Code (external CLI)",
    tier: 2,
    type: "coworker",
    description: "External Claude Code CLI session acting as a governed Workroom participant",
    valueStream: "integrate",
    sensitivity: "internal",
  },
  {
    agentId: "external-codex",
    slugId: "external-codex",
    name: "Codex (external CLI)",
    tier: 2,
    type: "coworker",
    description: "External Codex CLI session acting as a governed Workroom participant",
    valueStream: "integrate",
    sensitivity: "internal",
  },
  {
    agentId: "external-grok",
    slugId: "external-grok",
    name: "Grok (external CLI)",
    tier: 2,
    type: "coworker",
    description: "External Grok CLI session acting as a governed Workroom participant",
    valueStream: "integrate",
    sensitivity: "internal",
  },
];

// HARDCODED_COWORKER_GRANTS moved to ./coworker-grants when this module crossed
// the 800-LOC ceiling. Re-exported so every existing import keeps working —
// the split is a file boundary, not a contract change.
export { HARDCODED_COWORKER_GRANTS } from "./coworker-grants";


/**
 * Seed-time lifecycle policy. Creation may start a newly defined coworker in
 * draft; updates deliberately carry no lifecycle field so certification and
 * explicit promotion remain authoritative.
 */
export function resolveCoworkerLifecycleSeedPolicy(seed: CoworkerAgentSeed): {
  create: { lifecycleStage: "draft" | "production" };
  update: Record<string, never>;
} {
  return {
    create: { lifecycleStage: seed.initialLifecycleStage ?? "production" },
    update: {},
  };
}

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
