// Direct JSON import — bundler resolves this at build time, works in both dev and Docker standalone
import agentRegistryData from "../../../../packages/db/data/agent_registry.json";

const agentRegistry = agentRegistryData as { agents: Array<Record<string, unknown>> };

/**
 * Implications between agent grant categories. A grant on the left of the
 * mapping implicitly satisfies every grant on the right. Used to refactor
 * coarse grants (e.g. `backlog_write`) into finer ones (e.g. `build_evidence`)
 * without breaking existing roles that hold the coarse grant.
 *
 * Pseudo-User Contract (spec §6.3): the finer grants let coworker tokens be
 * scoped tightly (e.g. a coworker that should record build evidence but not
 * mutate the broader backlog) while existing roles with the coarse grants
 * continue to satisfy the refactored tool requirements unchanged.
 *
 * Implications are ONE-WAY. Holding `backlog_write` implies `build_evidence`;
 * holding `build_evidence` does NOT imply `backlog_write`. That's the whole
 * point — narrowing is a real scope reduction.
 *
 * BI-B2F7ABF5 / EP-COWORKER-INTERACTIVITY.
 */
export const GRANT_IMPLICATIONS: Readonly<Record<string, readonly string[]>> = {
  // `backlog_write` is the legacy broad grant for any backlog mutation.
  // The Pseudo-User Contract introduces build-scoped finer grants; anyone
  // who currently has backlog_write retains access to those tools.
  backlog_write: ["build_evidence", "build_phase_advance"],
  // `build_promote` was the legacy promotion grant; `build_lifecycle` is the
  // broader Pseudo-User Contract grant covering reopen + cancel + promote.
  build_promote: ["build_lifecycle"],
};

/** Expand a list of held grants by applying GRANT_IMPLICATIONS one-way.
 *  Returns a new array; does not mutate the input. Idempotent: applying twice
 *  yields the same set as applying once (implications are not transitive in
 *  the current taxonomy; if a new implication chain is added the implementation
 *  should switch to fixed-point expansion). */
export function expandGrants(grants: readonly string[]): string[] {
  const expanded = new Set<string>(grants);
  for (const g of grants) {
    const implied = GRANT_IMPLICATIONS[g];
    if (implied) {
      for (const i of implied) expanded.add(i);
    }
  }
  return Array.from(expanded);
}

/**
 * Maps platform tool names to agent grant categories.
 * A tool is allowed if the agent has ANY of the grants it maps to —
 * directly OR via GRANT_IMPLICATIONS expansion (see expandGrants).
 * Tools not in this map are DENIED by default — every tool must have an entry.
 */
const TOOL_TO_GRANTS: Record<string, string[]> = {
  // Backlog
  create_backlog_item: ["backlog_write"],
  update_backlog_item: ["backlog_write"],
  query_backlog: ["backlog_read"],
  report_quality_issue: ["backlog_write"],

  // Governed MCP backlog surface (spec 2026-04-25)
  create_epic: ["backlog_write"],
  update_epic: ["backlog_write"],
  list_epics: ["backlog_read"],
  list_backlog_items: ["backlog_read"],
  get_backlog_item: ["backlog_read"],
  update_backlog_item_status: ["backlog_write"],
  retire_backlog_item: ["backlog_write"],
  link_backlog_item_to_epic: ["backlog_write"],
  search_specs_and_plans: ["spec_plan_read", "backlog_read"],
  // Build-scoped evidence recording — refactored to the finer `build_evidence`
  // grant (BI-B2F7ABF5). Backwards-compat preserved by GRANT_IMPLICATIONS
  // (backlog_write → build_evidence).
  record_execution_evidence: ["build_evidence"],
  // Non-build-scoped evidence remains on the broad backlog_write grant —
  // these tools coordinate across the whole backlog surface, not just build.
  record_external_development_evidence: ["backlog_write"],
  record_local_integration_result: ["backlog_write"],
  record_functional_failure_evidence: ["backlog_write"],
  get_next_recommended_work: ["backlog_read"],

  // Work Capsule control harness (spec 2026-05-14)
  list_work_capsules: ["work_capsule_read"],
  get_work_capsule: ["work_capsule_read"],
  create_work_capsule: ["work_capsule_write"],
  plan_capsule_worktree: ["work_capsule_write"],
  adopt_worktree: ["work_capsule_adopt"],
  claim_capsule_scope: ["work_capsule_write"],
  record_capsule_evidence: ["work_capsule_write"],
  heartbeat_capsule: ["work_capsule_write"],
  update_work_capsule_status: ["work_capsule_write"],
  release_capsule_scope: ["work_capsule_write"],
  get_runtime_coordination_map: ["work_capsule_read"],
  register_runtime_target: ["work_capsule_write"],
  heartbeat_runtime_target: ["work_capsule_write"],
  release_runtime_target: ["work_capsule_write"],
  record_runtime_verification: ["work_capsule_write"],
  list_nonprod_environment_leases: ["work_capsule_read"],
  claim_nonprod_environment_lease: ["work_capsule_write"],
  release_nonprod_environment_lease: ["work_capsule_write"],

  // Backlog triage and Build Studio promotion (spec 2026-04-21)
  // These were defined in PLATFORM_TOOLS but missing here, so every call was
  // denied by the default-deny rule below. That broke the entire backlog →
  // Build Studio handoff path through any coworker chat.
  triage_backlog_item:              ["backlog_triage"],
  size_backlog_item:                ["backlog_triage"],
  // Build lifecycle ops — refactored to the finer `build_lifecycle` grant
  // (BI-B2F7ABF5). Backwards-compat preserved by GRANT_IMPLICATIONS
  // (build_promote → build_lifecycle).
  promote_to_build_studio:          ["build_lifecycle"],
  process_backlog_for_build_studio: ["build_lifecycle"],

  // Deliberation (multi-branch peer review / debate)
  start_deliberation:        ["deliberation_create"],
  get_deliberation_status:   ["deliberation_read"],
  get_deliberation_outcome:  ["deliberation_read"],
  deliberate_on:             ["deliberation_create"],

  // Specialist subtask thread spawning
  spawn_work_thread:         ["thread_write"],
  cancel_thread:             ["thread_write"],
  get_thread_result:         ["thread_read"],
  get_child_threads:         ["thread_read"],

  // Registry / Products
  create_digital_product: ["registry_read", "backlog_write"],
  update_lifecycle: ["backlog_write"],
  search_portfolio_context: ["portfolio_read", "registry_read"],
  register_digital_product_from_build: ["registry_read", "backlog_write"],
  create_build_epic: ["backlog_write"],

  // Web / External
  search_public_web: ["web_search"],
  fetch_public_website: ["web_search"],
  analyze_public_website_branding: ["web_search"],
  extract_brand_design_system: ["web_search", "file_read", "admin_write"],
  search_integrations: ["external_registry_search", "registry_read"],
  search_tool_marketplace: ["registry_read"],
  get_my_coworker_profile: ["registry_read"],
  assess_my_capabilities: ["registry_read"],
  submit_coworker_capability_need: ["registry_read"],
  list_my_capability_needs: ["registry_read"],
  // BI-F9E7B780: governance-surface variant — same grant tier (registry_read)
  // because both surfaces are read-only over the same CoworkerCapabilityNeed
  // model; the scope difference is "your needs" vs "everyone's needs", not
  // a privilege difference.
  list_all_capability_needs: ["registry_read"],
  search_knowledge: ["registry_read"],
  search_knowledge_base: ["registry_read"],
  create_knowledge_article: ["registry_write"],
  flag_stale_knowledge: ["registry_read"],
  doc_save: ["document_write", "registry_write"],
  doc_load: ["document_read", "registry_read"],
  doc_search: ["document_read", "registry_read"],
  doc_link: ["document_write", "registry_write"],
  doc_version_list: ["document_read", "registry_read"],
  doc_state_change: ["document_publish", "registry_write"],
  doc_list_references: ["document_read", "registry_read"],

  // EP-WIKI-001 Phase 3b2: Founder kernel + per-org overlay wiki
  wiki_query: ["registry_read"],
  // EP-WIKI-001 Phase 4b2b: on-demand wiki lint trigger
  wiki_lint: ["registry_read"],
  // EP-WIKI-001 Phase 2.3b: end-to-end ingest pipeline (file → RawSource →
  // LLM proposal → draft overlay pages). Requires `registry_write` because
  // commit-mode writes WikiPage / WikiPageRevision / WikiPageSource rows
  // under the org's overlay. Kernel pages remain PR-only at the engine
  // layer per spec §4.
  wiki_ingest: ["registry_write"],
  // EP-WIKI-001 coworker-UX: list pending overlay drafts so the coworker
  // can walk the user through them in chat. Read-only; same scope guard
  // as wiki_query.
  list_wiki_overlay_drafts: ["registry_read"],
  // EP-WIKI-001 coworker-UX: batch-publish overlay drafts after review.
  // Writes WikiPage.status + appends a manual revision row per page.
  publish_wiki_overlay_pages: ["registry_write"],
  // Principles-as-wiki-kind Phase 2 Task 2.7: advisory decision support
  // over governance principles. Read-only — returns scored options with a
  // contribution ledger; never executes the recommended option itself.
  principle_decide: ["registry_read"],

  // Build / Sandbox
  launch_sandbox: ["sandbox_execute"],
  generate_code: ["sandbox_execute"],
  iterate_sandbox: ["sandbox_execute"],
  run_sandbox_tests: ["sandbox_execute"],
  read_sandbox_file: ["sandbox_execute"],
  edit_sandbox_file: ["sandbox_execute"],
  write_sandbox_file: ["sandbox_execute"],
  validate_schema: ["sandbox_execute"],
  describe_model: ["sandbox_execute"],
  search_sandbox: ["sandbox_execute"],
  list_sandbox_files: ["sandbox_execute"],
  run_sandbox_command: ["sandbox_execute"],
  update_feature_brief: ["backlog_write"],
  assess_complexity: ["backlog_read"],
  propose_decomposition: ["backlog_write"],
  // Design-time decomposition Phase 4a/4b (BI-2E6CC391). These three tools
  // are downstream of Ideate (operating on a passed FeatureBuild design),
  // distinct from the upstream `propose_decomposition` brainstorming tool
  // above. Refactored to the finer `build_phase_advance` grant (BI-B2F7ABF5);
  // backwards-compat preserved by GRANT_IMPLICATIONS (backlog_write →
  // build_phase_advance).
  propose_build_decomposition: ["build_phase_advance"],
  approve_decomposition: ["build_phase_advance"],
  record_decomposition_override: ["build_phase_advance"],
  register_tech_debt: ["backlog_write"],
  // Build-evidence persistence — refactored to the finer `build_evidence`
  // grant (BI-B2F7ABF5). Backwards-compat preserved by GRANT_IMPLICATIONS.
  save_build_notes: ["build_evidence"],
  saveBuildEvidence: ["build_evidence"],
  reviewDesignDoc: ["architecture_read"],
  reviewBuildPlan: ["build_plan_write"],
  diagnose_sandbox: ["sandbox_execute", "work_capsule_read"],
  recover_sandbox: ["sandbox_execute"],
  // Build-progress observation tools are read-only work capsule inspection.
  get_build_progress_visibility: ["work_capsule_read"],
  get_build_sandbox_state: ["work_capsule_read"],
  get_build_dispatch_history: ["work_capsule_read"],
  get_build_scoped_verification: ["work_capsule_read"],
  list_build_activity_since: ["work_capsule_read"],

  // Deploy / Release
  deploy_feature: ["iac_execute"],
  execute_promotion: ["iac_execute"],
  check_deployment_windows: ["deployment_plan_create"],
  schedule_promotion: ["deployment_plan_create"],
  create_release_bundle: ["release_gate_create"],
  run_release_gate: ["release_gate_create"],
  schedule_release_bundle: ["release_plan_create"],
  get_release_status: ["release_plan_read"],

  // Discovery / Monitoring
  summarize_estate_posture: ["registry_read"],
  review_estate_identity: ["registry_read"],
  validate_version_confidence: ["registry_read"],
  explain_blast_radius: ["registry_read"],
  discovery_sweep: ["telemetry_read"],
  run_discovery_triage: ["registry_write"],
  run_hive_scout_ingest: ["backlog_write"],
  attribute_entity_to_product: ["registry_write"],
  dismiss_entity: ["registry_write"],
  resolve_portfolio_quality_issue: ["registry_write"],
  configure_gateway_scan: ["agent_control_read"],

  // UX / Page evaluation
  evaluate_page: ["file_read"],
  run_ux_test: ["file_read"],

  // Codebase access
  list_project_directory: ["file_read"],
  read_project_file: ["file_read"],
  search_project_files: ["file_read"],
  query_version_history: ["file_read"],
  generate_codebase_manifest: ["file_read"],
  read_codebase_manifest: ["file_read"],
  read_source_at_version: ["file_read"],
  search_source_at_version: ["file_read"],
  list_source_directory: ["file_read"],
  compare_versions: ["file_read"],
  propose_file_change: ["file_read"],
  propose_improvement: ["decision_record_create"],
  propose_skill_improvement: ["decision_record_create"],

  // Code graph (file-level coverage today; symbol-level deferred)
  get_code_graph_freshness: ["code_graph_read"],
  inspect_build_code_impact: ["code_graph_read"],
  search_code_graph: ["code_graph_read"],
  trace_code_surface: ["code_graph_read"],
  find_related_tests: ["code_graph_read"],

  // Provider management
  add_provider: ["agent_control_read"],
  update_provider_category: ["agent_control_read"],
  run_endpoint_tests: ["agent_control_read"],

  // Employee / HR
  list_departments: ["registry_read"],
  list_positions: ["registry_read"],
  create_employee: ["consumer_write"],
  transition_employee_status: ["consumer_write"],
  propose_leave_policy: ["policy_write"],

  // Feedback
  submit_feedback: ["backlog_write"],

  // Brand
  analyze_brand_document: ["file_read"],

  // Compliance
  prefill_onboarding_wizard: ["data_governance_validate"],
  save_licensing_investigation: ["policy_write"],
  create_licensing_readiness_issue: ["policy_write"],

  // Tool evaluation (EP-GOVERN-002)
  evaluate_tool: ["tool_evaluation_create"],

  // EA / Ontology Graph
  create_ea_element:      ["ea_graph_write"],
  create_ea_relationship: ["ea_graph_write"],
  classify_ea_element:    ["ea_graph_write"],
  import_archimate:       ["ea_graph_write"],
  query_ontology_graph:   ["ea_graph_read"],
  run_traversal_pattern:  ["ea_graph_read"],
  export_archimate:       ["ea_graph_read"],

  // Finance
  get_finance_period_summary:   ["financial_report_create"],

  // Marketing / Storefront
  get_marketing_summary:        ["marketing_read"],
  suggest_campaign_ideas:       ["marketing_read"],
  save_marketing_review:        ["marketing_write"],
  create_marketing_campaign_brief: ["marketing_write"],
  create_marketing_asset_task:   ["marketing_write"],
  record_marketing_kpi_checkpoint: ["marketing_write"],
  create_marketing_automation_candidate: ["marketing_write"],
  draft_marketing_asset:         ["marketing_write"],
  publish_to_linkedin:           ["marketing_write"],
  send_marketing_email:          ["marketing_write"],
  place_linkedin_ad:             ["marketing_write"],
  refresh_channel_kpis:          ["marketing_write"],
  tick_marketing_scheduler:      ["marketing_write"],
  plan_upcoming_marketing_drafts: ["marketing_write"],
  // Tool checks `requiredCapability: "manage_provider_connections"` at the
  // user-capability layer (operator-only). The agent-grant layer just gates
  // whether the agent may attempt the tool; marketing-specialist needs
  // marketing_write here for the prompt to even surface the tool name. The
  // OPERATOR's capability gate is the real "operator-only" enforcement;
  // marketing-specialist's prompt is also explicit that it must not call
  // this tool itself.
  set_marketing_autopilot_policy: ["marketing_write"],
  analyze_seo_opportunity:      ["marketing_read"],
  generate_custom_archetype:    ["marketing_write"],
  assess_archetype_refinement:  ["marketing_read"],

  // Admin
  admin_view_logs:        ["admin_read"],
  admin_query_db:         ["admin_read"],
  admin_read_file:        ["admin_read"],
  admin_restart_service:  ["admin_write"],
  admin_run_migration:    ["admin_write"],
  admin_run_seed:         ["admin_write"],
  admin_run_command:       ["admin_write"],

  // Build lifecycle (sandbox-adjacent)
  check_sandbox:              ["sandbox_execute"],
  start_sandbox:              ["sandbox_execute"],
  start_build:                ["sandbox_execute"],
  start_ideate_research:      ["sandbox_execute", "file_read"],
  start_scout_research:       ["sandbox_execute", "file_read", "web_search"],
  create_portal_pr:           ["sandbox_execute"],
  suggest_taxonomy_placement: ["registry_read"],
  confirm_taxonomy_placement: ["backlog_write"],
  analyze_reusability:        ["backlog_read"],
  save_phase_handoff:         ["backlog_write"],

  // Hive Mind / Platform updates
  assess_contribution:    ["backlog_read"],
  contribute_to_hive:     ["backlog_write"],
  apply_platform_update:  ["admin_write"],
  // BI-C26F7EE1: read-only operator preview of the upstream change set —
  // paired with apply_platform_update's admin_write as the read tier.
  summarize_upgrade_impact: ["admin_read"],

  // Contributor inventory sync — admin-scope on-demand trigger so agents
  // that just pushed a branch / opened a PR can force the cron to run
  // out-of-band rather than waiting up to 10 minutes (BI-063BDF1B Phase 5).
  trigger_contributor_inventory_sync: ["admin_write"],

  // Design intelligence (read-only references)
  search_design_intelligence: ["file_read"],
  generate_design_system:     ["file_read"],

  // HR — query
  query_employees: ["consumer_read", "registry_read"],

  // ─── Pseudo-User Contract: screen_* view-command family (BI-DF6079E9) ─────
  // Three finer grants (coworker_screen_read / drive / fill) carry the view-
  // command surface. screen_scroll_to is read-class per the chief-architect
  // review (PR #1361). screen_dispatch_action gates on coworker_screen_drive
  // at the entry; the underlying tool resolved from the envelope's
  // manifestActionId carries its own grant check (BI-0F9C291C will wire
  // the second-key resolution).
  screen_describe:         ["coworker_screen_read"],
  screen_get_state:        ["coworker_screen_read"],
  screen_scroll_to:        ["coworker_screen_read"],
  screen_select_entity:    ["coworker_screen_drive"],
  screen_navigate:         ["coworker_screen_drive"],
  screen_open_panel:       ["coworker_screen_drive"],
  screen_close_panel:      ["coworker_screen_drive"],
  screen_focus_field:      ["coworker_screen_drive"],
  screen_propose_action:   ["coworker_screen_drive"],
  screen_dispatch_action:  ["coworker_screen_drive"],
  screen_set_input:        ["coworker_screen_fill"],
};

const grantCache = new Map<string, string[]>();

type AgentEntry = {
  agent_id: string;
  agent_name: string;
  tier: string;
  value_stream: string;
  human_supervisor_id: string;
  hitl_tier_default: number;
  escalates_to: string;
  delegates_to: string[];
  config_profile: { tool_grants: string[] };
};

/**
 * Load tool_grants for an agent (cached).
 * EP-AI-WORKFORCE-001: First tries DB (AgentToolGrant table), falls back to
 * agent_registry.json for agents not yet migrated.
 */
export function getAgentToolGrants(agentId: string): string[] | null {
  if (grantCache.has(agentId)) return grantCache.get(agentId)!;
  // Fallback: JSON registry lookup (synchronous, always available)
  const agent = (agentRegistry.agents as AgentEntry[]).find(
    (a) => a.agent_id === agentId || a.agent_name === agentId,
  );
  if (!agent) return null;
  const grants = agent.config_profile.tool_grants;
  grantCache.set(agentId, grants);
  return grants;
}

/**
 * EP-AI-WORKFORCE-001: Async DB-backed grant resolution.
 * Resolves grants from AgentToolGrant table, falling back to JSON registry.
 * Use this in async contexts (API routes, server actions).
 */
export async function getAgentToolGrantsAsync(agentId: string): Promise<string[]> {
  if (grantCache.has(agentId)) return grantCache.get(agentId)!;

  try {
    const { prisma } = await import("@dpf/db");
    const agent = await prisma.agent.findFirst({
      where: { OR: [{ agentId }, { slugId: agentId }] },
      include: { toolGrants: true },
    });
    if (agent && agent.toolGrants.length > 0) {
      const grants = agent.toolGrants.map((g) => g.grantKey);
      grantCache.set(agentId, grants);
      return grants;
    }
  } catch {
    // DB unavailable — fall through to JSON
  }

  // Fallback to JSON registry
  return getAgentToolGrants(agentId) ?? [];
}

/** Check if a specific tool is allowed by an agent's grants. The agent's
 *  held grants are expanded through GRANT_IMPLICATIONS before the check, so
 *  a coarse legacy grant (e.g. `backlog_write`) still satisfies a tool that
 *  has been refactored to require a finer grant (e.g. `build_evidence`). */
export function isToolAllowedByGrants(
  toolName: string,
  agentGrants: string[],
): boolean {
  const requiredGrants = TOOL_TO_GRANTS[toolName];
  // Tools not in the mapping are DENIED — every tool must have a grant entry.
  // This prevents silent permission escalation when new tools are added without
  // a corresponding grant mapping.
  if (!requiredGrants) {
    console.warn(`[agent-grants] Tool ${JSON.stringify(toolName)} has no TOOL_TO_GRANTS entry — denied by default`);
    return false;
  }
  // Expand the agent's grants through GRANT_IMPLICATIONS, then check that the
  // expanded set includes at least one of the required grants.
  const expanded = expandGrants(agentGrants);
  return requiredGrants.some((g) => expanded.includes(g));
}

export type EffectivePermission = {
  toolName: string;
  toolDescription: string;
  userAllowed: boolean;
  agentAllowed: boolean;
  effective: boolean;
  executionMode: string;
  grantReason: string | null;
};

/** Get the tool-to-grant mapping (for UI display). */
export function getToolGrantMapping(): Record<string, string[]> {
  return { ...TOOL_TO_GRANTS };
}

/**
 * EP-AI-WORKFORCE-001: Get agent grant summaries from DB (unified model).
 * Falls back to JSON registry if DB query fails.
 */
export async function getAgentGrantSummaries(): Promise<Array<{
  agentId: string;
  agentName: string;
  tier: string;
  valueStream: string;
  grantCount: number;
  grants: string[];
  supervisorId: string;
  hitlTier: number;
  escalatesTo: string;
  delegatesTo: string[];
}>> {
  const TIER_LABELS: Record<number, string> = { 1: "orchestrator", 2: "specialist", 3: "cross-cutting" };
  try {
    const { prisma } = await import("@dpf/db");
    const agents = await prisma.agent.findMany({
      where: { archived: false },
      orderBy: [{ tier: "asc" }, { name: "asc" }],
      include: { toolGrants: true },
    });
    return agents.map((a) => ({
      agentId: a.agentId,
      agentName: a.name,
      tier: TIER_LABELS[a.tier] ?? "specialist",
      valueStream: a.valueStream ?? "cross-cutting",
      grantCount: a.toolGrants.length,
      grants: a.toolGrants.map((g) => g.grantKey),
      supervisorId: a.humanSupervisorId ?? "",
      hitlTier: a.hitlTierDefault,
      escalatesTo: a.escalatesTo ?? "",
      delegatesTo: a.delegatesTo,
    }));
  } catch {
    // Fallback to JSON registry
    return (agentRegistry.agents as AgentEntry[]).map(
      (a) => ({
        agentId: a.agent_id,
        agentName: a.agent_name,
        tier: a.tier,
        valueStream: a.value_stream,
        grantCount: a.config_profile.tool_grants.length,
        grants: a.config_profile.tool_grants as string[],
        supervisorId: a.human_supervisor_id,
        hitlTier: a.hitl_tier_default,
        escalatesTo: a.escalates_to,
        delegatesTo: a.delegates_to,
      }),
    );
  }
}
