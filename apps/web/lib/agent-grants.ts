import * as fs from "fs";
import * as path from "path";

// Load agent registry at module init — file path resolves relative to packages/db
function loadAgentRegistry(): { agents: Array<Record<string, unknown>> } {
  try {
    const registryPath = path.join(process.cwd(), "node_modules", "@dpf", "db", "data", "agent_registry.json");
    const raw = fs.readFileSync(registryPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    // Fallback: try relative to monorepo root
    try {
      const fallbackPath = path.resolve(__dirname, "../../../packages/db/data/agent_registry.json");
      const raw = fs.readFileSync(fallbackPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      console.warn("[agent-grants] Could not load agent_registry.json — grant checks will use defaults");
      return { agents: [] };
    }
  }
}

const agentRegistry = loadAgentRegistry();

/**
 * Maps platform tool names to agent grant categories.
 * A tool is allowed if the agent has ANY of the grants it maps to.
 * Tools not in this map are allowed by default (backward-compatible).
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

  // Build / Sandbox
  launch_sandbox: ["sandbox_execute"],
  generate_code: ["sandbox_execute"],
  iterate_sandbox: ["sandbox_execute"],
  run_sandbox_tests: ["sandbox_execute"],
  read_sandbox_file: ["sandbox_execute"],
  edit_sandbox_file: ["sandbox_execute"],
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
  check_deployment_windows: ["deployment_plan_create"],
  schedule_promotion: ["deployment_plan_create"],
  create_release_bundle: ["release_gate_create"],
  run_release_gate: ["release_gate_create"],
  schedule_release_bundle: ["release_plan_create"],
  get_release_status: ["release_plan_read"],

  // UX / Page evaluation
  evaluate_page: ["file_read"],
  generate_ux_test: ["file_read"],
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

/** Load tool_grants for an agent from agent_registry.json (cached). */
export function getAgentToolGrants(agentId: string): string[] | null {
  if (grantCache.has(agentId)) return grantCache.get(agentId)!;
  const agent = (agentRegistry.agents as AgentEntry[]).find(
    (a) => a.agent_id === agentId,
  );
  if (!agent) return null;
  const grants = agent.config_profile.tool_grants;
  grantCache.set(agentId, grants);
  return grants;
}

/** Check if a specific tool is allowed by an agent's grants. */
export function isToolAllowedByGrants(
  toolName: string,
  agentGrants: string[],
): boolean {
  const requiredGrants = TOOL_TO_GRANTS[toolName];
  // Tools not in the mapping are allowed by default (backward-compatible)
  if (!requiredGrants) return true;
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

/** Get all agent IDs and their grant counts (for summary display). */
export function getAgentGrantSummaries(): Array<{
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
}> {
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
