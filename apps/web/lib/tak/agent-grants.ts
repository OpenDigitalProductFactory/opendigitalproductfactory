// Direct JSON import — bundler resolves this at build time, works in both dev and Docker standalone
import agentRegistryData from "../../../../packages/db/data/agent_registry.json";

const agentRegistry = agentRegistryData as { agents: Array<Record<string, unknown>> };

/**
 * Maps platform tool names to agent grant categories.
 * A tool is allowed if the agent has ANY of the grants it maps to.
 * Tools not in this map are DENIED by default — every tool must have an entry.
 */
const TOOL_TO_GRANTS: Record<string, string[]> = {
  // Backlog
  create_backlog_item: ["backlog_write"],
  update_backlog_item: ["backlog_write"],
  query_backlog: ["backlog_read"],
  report_quality_issue: ["backlog_write"],

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
  search_integrations: ["external_registry_search", "registry_read"],
  search_knowledge: ["registry_read"],
  search_knowledge_base: ["registry_read"],
  create_knowledge_article: ["registry_write"],
  flag_stale_knowledge: ["registry_read"],

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
  register_tech_debt: ["backlog_write"],
  save_build_notes: ["backlog_write"],
  saveBuildEvidence: ["backlog_write"],
  reviewDesignDoc: ["architecture_read"],
  reviewBuildPlan: ["build_plan_write"],

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

  // Marketing / Storefront
  get_marketing_summary:        ["marketing_read"],
  suggest_campaign_ideas:       ["marketing_read"],
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
  create_portal_pr:           ["sandbox_execute"],
  suggest_taxonomy_placement: ["registry_read"],
  confirm_taxonomy_placement: ["backlog_write"],
  analyze_reusability:        ["backlog_read"],
  save_phase_handoff:         ["backlog_write"],

  // Hive Mind / Platform updates
  assess_contribution:    ["backlog_read"],
  contribute_to_hive:     ["backlog_write"],
  apply_platform_update:  ["admin_write"],

  // Design intelligence (read-only references)
  search_design_intelligence: ["file_read"],
  generate_design_system:     ["file_read"],

  // HR — query
  query_employees: ["consumer_read", "registry_read"],
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
    (a) => a.agent_id === agentId,
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

/** Check if a specific tool is allowed by an agent's grants. */
export function isToolAllowedByGrants(
  toolName: string,
  agentGrants: string[],
): boolean {
  const requiredGrants = TOOL_TO_GRANTS[toolName];
  // Tools not in the mapping are DENIED — every tool must have a grant entry.
  // This prevents silent permission escalation when new tools are added without
  // a corresponding grant mapping.
  if (!requiredGrants) {
    console.warn(`[agent-grants] Tool "${toolName}" has no TOOL_TO_GRANTS entry — denied by default`);
    return false;
  }
  // Agent must have at least ONE of the required grants
  return requiredGrants.some((g) => agentGrants.includes(g));
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
