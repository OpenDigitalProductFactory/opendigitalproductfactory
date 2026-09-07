// Hardcoded coworker tool grants (LIFE-001).
//
// Split out of workforce-seed.ts, which crossed the 800-LOC module ceiling when
// the value-stream orchestrators were seeded. That file owns WHO the coworkers
// are; this one owns what each may call. They were one module only by history.
//
// This map is the DURABLE grant source: grants written to the database are
// re-seeded from here on every boot, so an entry removed here is a grant
// revoked, not merely a row edited.
//
// Grant counts are deliberately small. `specialization-over-generalization`
// (core kernel) caps a coworker at 10 tools relevant to its current task and
// records that selection accuracy degrades past 15 "regardless of model
// capability" — so a long list here is a defect even when every entry is
// individually defensible.

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
  // pipeline (no crm_write). The role is read-and-propose: it returns the cited
  // brief in conversation and may file a governed CRM enrichment proposal, but
  // holds neither document_write nor registry_write. Those broad grants would
  // also unlock unrelated knowledge, wiki, discovery, and document mutations.
  // registry_read/document_read/code_graph_read arrive via the explicit grant
  // below and COWORKER_READ_BASELINE_GRANTS. No
  // sandbox_execute: the Build-Studio scout/ideate research launchers are
  // feature-scoped, not owner-facing market research.
  // registry_read is explicit rather than implied by registry_write: the
  // implication would be a platform-wide change to the authority model, and
  // wiki-overlay-pack.test.ts pins registry_write as NOT conferring read on the
  // overlay list tool. Fix the coworker, not the semantics (BI-728FD7F2); the
  // implication question is filed separately.
  "market-research-analyst": ["web_search", "crm_read", "registry_read"],
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
    // BI-8E1FD1BD: this coworker could already research a statutory figure with
    // web_search and had nowhere to put it — its entire write surface was
    // policy_write (one tool) plus backlog. statutory_reference_propose gives the
    // research a governed destination. It proposes only; ratification is refused
    // to every agent unconditionally and has no tool at all.
    "statutory_reference_propose",
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
  // BI-8E1FD1BD: statutory_reference_propose. This is the agent behind the
  // LicenseRequirementReference corpus — the platform's existing precedent for an
  // acquired external corpus carrying citations — so the same hand that maintains
  // licence references maintains statutory rate references.
  "licensing-specialist": ["registry_read", "backlog_read", "backlog_write", "consumer_read", "policy_write", "policy_read", "initiative_compliance_review", "spec_plan_read", "web_search", "statutory_reference_propose"],
  "ux-accessibility-agent": ["file_read", "sandbox_execute", "work_capsule_read", "work_capsule_write", "work_capsule_adopt", "registry_read", "backlog_write", "decision_record_create", "initiative_ux_review", "web_search"],
  "soc-triage-analyst": ["siem_read", "siem_investigate", "registry_read"],
  "soc-investigator": ["siem_read", "siem_investigate", "siem_tune", "registry_read"],
  "soc-threat-hunter": ["siem_read", "siem_tune", "registry_read"],
  "soc-incident-commander": ["siem_read", "siem_investigate", "incident_respond", "registry_read"],
  "external-claude-code": ["work_room_read", "work_room_write", "registry_read"],
  "external-codex": ["work_room_read", "work_room_write", "registry_read"],
  "external-grok": ["work_room_read", "work_room_write", "registry_read"],
  // Value-stream orchestrators (LIFE-001). Coordination is READ plus ROUTE:
  // they survey a stream and hand work to a specialist, so they need to see
  // backlog and registry state and nothing that executes. The stream's
  // direction is a governed decision taken by its human owner.
  "evaluate-orchestrator": ["backlog_read", "registry_read", "backlog_write"],
  "explore-orchestrator": ["backlog_read", "registry_read", "backlog_write"],
  "integrate-orchestrator": ["backlog_read", "registry_read", "backlog_write"],
  "deploy-orchestrator": ["backlog_read", "registry_read", "backlog_write"],
  "release-orchestrator": ["backlog_read", "registry_read", "backlog_write"],
  "consume-orchestrator": ["backlog_read", "registry_read", "backlog_write"],
  "operate-orchestrator": ["backlog_read", "registry_read", "backlog_write"],
  "governance-orchestrator": ["backlog_read", "registry_read", "backlog_write"],
  "finance-agent": ["registry_read", "portfolio_read"],
};
