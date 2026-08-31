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
  /** Initial stage for a newly seeded row. Reseeding never changes a live stage. */
  initialLifecycleStage?: "draft" | "production";
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
  // BI-3CDEC5F0: policy_read/write so HR can draft company policies into Policy
  // (not chat-only). Publish remains human HITL on /compliance/policies.
  "hr-specialist": [
    "registry_read",
    "consumer_read",
    "consumer_write",
    "policy_read",
    "policy_write",
    "backlog_read",
    "backlog_write",
    "web_search",
  ],
  "time-off-advisor": ["consumer_read", "registry_read"],
  // BI-6D10EB1F: web_search gates the public-web research doors
  // (search_public_web, fetch_public_website, analyze_public_website_branding);
  // crm_read lets it target and cite an opportunity/account WITHOUT mutating the
  // pipeline (no crm_write); document_write + registry_write reach doc_save/
  // doc_link so it can author and attach a cited brief. registry_read/
  // document_read/code_graph_read arrive via COWORKER_READ_BASELINE_GRANTS. No
  // sandbox_execute: the Build-Studio scout/ideate research launchers are
  // feature-scoped, not owner-facing market research.
  // registry_read is explicit rather than implied by registry_write: the
  // implication would be a platform-wide change to the authority model, and
  // wiki-overlay-pack.test.ts pins registry_write as NOT conferring read on the
  // overlay list tool. Fix the coworker, not the semantics (BI-728FD7F2); the
  // implication question is filed separately.
  "market-research-analyst": ["web_search", "crm_read", "document_write", "registry_write", "registry_read"],
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
    "storefront_read",
    "stock_read",
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
  // Read-only by construction. The reviewer may inspect the change and its
  // governed context, but cannot edit code, advance a build, waive findings,
  // or publish a release.
  "change-reviewer": [
    "file_read",
    "code_graph_read",
    "architecture_read",
    "spec_plan_read",
    "backlog_read",
    "registry_read",
    // Mirrors AGT-WS-REVIEW in agent_registry.json. The seed is authoritative at
    // boot, so both sources must carry these or the grants revert on restart.
    "initiative_design_review",
    "initiative_domain_review",
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
    // onboard-regulation declares search_public_web, which TOOL_TO_GRANTS keys on
    // web_search. Without it the skill was denied on every call — a broken skill
    // that looked assigned. Surfaced by the tool-grant audit once the coworker
    // gained a canonical registry record.
    "web_search",
    // registry_read reaches evaluate_profession_decision (WSID) and
    // principle_decide (WWMD). Without it the coworker whose entire job is
    // governance was the one coworker locked out of the governance kernel, and
    // its own 11-page legal-compliance corpus was unreachable by the coworker it
    // was written for. Both tools are read-only advisory doors: this widens
    // judgement, not authority (BI-728FD7F2).
    "registry_read",
  ],
  "legal-operations-counsel": ["file_read", "document_read", "document_write", "registry_read"],
  "finance-controller": ["registry_read", "backlog_read", "portfolio_read"],
  // Bookkeeper (S-BK): the day-to-day books loop. banking_read/banking_write drive
  // the governed banking tools (S-FIN); enrichment_write resolves vendor→supplier
  // (BI-B2497DFB); crm_read/write for counterparties; document_read for
  // receipts/statements; work_room_read/write to participate in the Bookkeeping
  // Work Room. These MATCH the agent_registry.json config_profile.tool_grants for
  // bookkeeper, so there is no seed↔registry divergence to sanction.
  bookkeeper: [
    "banking_read",
    "banking_write",
    "enrichment_write",
    "crm_read",
    "crm_write",
    "document_read",
    "work_room_read",
    "work_room_write",
    "registry_read",
    "backlog_read",
  ],
  // Reads field-service jobs and customer contact data, updates job status, and
  // proposes customer notifications for approval.
  dispatcher: ["backlog_read", "backlog_write", "consumer_read", "consumer_write", "registry_read"],
  "farm-ranch-steward": [
    "registry_read",
    "backlog_read",
    "backlog_write",
    "consumer_read",
    "web_search",
    "file_read",
  ],
  // UX Design Critic (AGT-906) — READ-AND-DRAFT ONLY, deliberately.
  //
  // Absent by design: backlog_write / backlog_triage (cannot file its own
  // work), build_phase_advance / build_promote / release_gate_create (cannot
  // block or advance a build). The curation stage carries NO gating authority
  // because an ungrounded design critic is the zero-shot judge UICrit measured
  // at 13.1% comment validity — a critic that can block on invalid findings
  // trains the org to ignore the UX signal, which is how the checkers in the
  // EP-UX-SYSTEM spec §2 died. Critic authority is a later staged grant, gated
  // on measured agreement against a held-out founder-corpus slice.
  //
  // NOT the HX UX Analyst (EP-HX-LOOP BI-4A1B34E1): that coworker reasons over
  // UxAnalysisRun briefs — real user telemetry, post-usage — and emits
  // ImprovementSignal rows. This one reasons over rendered screenshots and the
  // founder critique corpus, pre-merge. Posterior vs prior; different inputs,
  // different clocks. The HX spec anticipates both (it tells its analyst to
  // reference AGT-906 output where scope overlaps).
  "ux-design-critic": [
    "browser_read",
    "coworker_screen_read",
    "document_read",
    "document_write",
    "spec_plan_read",
    "backlog_read",
    "portfolio_read",
    "code_graph_read",
    "deliberation_create",
    "deliberation_read",
    "decision_record_create",
    // registry_read is what makes evaluate_profession_decision reachable — the
    // WSID craft-decision path. Without it this coworker could read its own
    // profession corpus but never weigh a craft call THROUGH it, which is the
    // whole point of grounding design critique in WSID rather than in taste.
    // Load-bearing once WSID decisions carry dimension vectors: that scored
    // path runs through this tool.
    "registry_read",
  ],
  // Security Engineer — must match the establish_coworker factory-door grants
  // exactly (BI-CC44E74F). Files findings as backlog items (backlog_write);
  // holds no merge-blocking or release-gate authority by design.
  "security-engineer": [
    "file_read",
    "architecture_read",
    "backlog_read",
    "backlog_write",
    "telemetry_read",
    "web_search",
    // Same reason as compliance-officer: reaches the WSID craft-decision path
    // and principle_decide. Its `security` profession family carries 8 corpus
    // pages that were unreachable without it (BI-728FD7F2).
    "registry_read",
  ],
  // MCP & Integration Engineer — must match the establish_coworker factory-door
  // grants exactly (BI-CC44E74F). registry_read reaches the WSID craft-decision
  // path; tool_script_exec supports programmatic review of the tool surface.
  "integration-engineer": [
    "file_read",
    "architecture_read",
    "backlog_read",
    "backlog_write",
    "registry_read",
    "tool_script_exec",
    "web_search",
  ],
  "licensing-specialist": ["registry_read", "backlog_read", "backlog_write", "consumer_read", "policy_write", "policy_read", "initiative_compliance_review", "spec_plan_read", "web_search"],
  "ux-accessibility-agent": ["file_read", "sandbox_execute", "work_capsule_read", "work_capsule_write", "work_capsule_adopt", "registry_read", "backlog_write", "decision_record_create", "initiative_ux_review", "web_search"],
  "soc-triage-analyst": ["siem_read", "siem_investigate", "registry_read"],
  "soc-investigator": ["siem_read", "siem_investigate", "siem_tune", "registry_read"],
  "soc-threat-hunter": ["siem_read", "siem_tune", "registry_read"],
  "soc-incident-commander": ["siem_read", "siem_investigate", "incident_respond", "registry_read"],
  "external-claude-code": ["work_room_read", "work_room_write", "registry_read"],
  "external-codex": ["work_room_read", "work_room_write", "registry_read"],
  "external-grok": ["work_room_read", "work_room_write", "registry_read"],
};

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

/**
 * The worker classes every install starts with.
 *
 * `Volunteer` belongs here rather than in one archetype: `WorkerClassification`
 * already carries `volunteer` and names it "the majority classification for
 * nonprofit and community archetypes", and running a rescue found the platform
 * could not record one at all (BI-A30152B6). A class an archetype's day needs on
 * top of these is declared on the archetype and applied per organization — see
 * `workforceProfile` in @dpf/storefront-templates.
 *
 * `classification` is written on create only, never on update: it is a legal
 * determination, and the operator's answer outranks the seed's. The four
 * pre-existing rows that carry no classification are left alone for the same
 * reason.
 */
export function getDefaultEmploymentTypes() {
  return [
    { employmentTypeId: "emp-full-time", name: "Full-time" },
    { employmentTypeId: "emp-part-time", name: "Part-time" },
    { employmentTypeId: "emp-contractor", name: "Contractor" },
    { employmentTypeId: "emp-intern", name: "Intern" },
    { employmentTypeId: "emp-advisor", name: "Advisor" },
    { employmentTypeId: "emp-volunteer", name: "Volunteer", classification: "volunteer" },
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
