// The platform tool names a model's narration may mention without calling them.
// One copy for every driver's tool-call trace (BI-A01B06F6 AC-3); the Claude and
// Codex routing adapters each used to keep their own.

export const TOOL_TRACE_KEYWORD_PATTERN = /\b(read_sandbox_file|write_sandbox_file|edit_sandbox_file|search_sandbox|list_sandbox_files|run_sandbox_command|check_sandbox|start_sandbox|saveBuildEvidence|save_build_notes|save_phase_handoff|reviewDesignDoc|reviewBuildPlan|search_project_files|read_project_file|list_project_directory|get_code_graph_freshness|inspect_build_code_impact|search_code_graph|trace_code_surface|find_related_tests|generate_design_system|search_design_intelligence|describe_model|deploy_feature|execute_promotion)\b/g;

export function extractMentionedPlatformToolNames(text: string): string[] {
  return Array.from(new Set(text.match(TOOL_TRACE_KEYWORD_PATTERN) ?? []));
}
