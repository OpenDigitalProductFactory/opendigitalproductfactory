/**
 * MCP tool-tier selection (R3 / P4, context-engineering-standards.md).
 *
 * External coding agents (Claude Code, Codex, Grok) fetch the platform's whole
 * granted tool surface via `/api/mcp/v1` `tools/list` — up to ~50K tokens of
 * definitions before any work begins. This module lets a session opt into a
 * curated CORE surface (lean discovery) via `?tier=core`, cutting that tax for
 * token-constrained sessions.
 *
 * Important property: tiering affects ONLY discovery (`tools/list`), never
 * execution (`tools/call`). A granted tool can still be called by name even in
 * core tier — so this is a pure context-economy lever with no loss of
 * capability, and the staged model-driven deferral (load_tools + list_changed,
 * spec Phase 2) is purely additive on top of it. Default tier is "full", so
 * existing clients are unaffected.
 */

export type McpToolTier = "core" | "full";

/** Parse a tier hint (e.g. the `?tier=` query param). Defaults to "full". */
export function resolveMcpToolTier(raw: string | null | undefined): McpToolTier {
  return typeof raw === "string" && raw.toLowerCase() === "core" ? "core" : "full";
}

/**
 * The curated lean surface for token-constrained MCP sessions: broadly-useful
 * discovery / read / backlog-lifecycle / work-visibility tools. A drift guard
 * (tool-tier.test.ts) asserts every name here exists in PLATFORM_TOOLS, so a
 * tool rename can't silently leave a dangling core entry. `search_tool_marketplace`
 * is included so a model in core tier can still discover the rest.
 */
export const CORE_MCP_TOOL_NAMES: ReadonlySet<string> = new Set([
  // discovery / read
  "search_knowledge",
  "search_code_graph",
  "search_project_files",
  "search_specs_and_plans",
  "read_project_file",
  "list_project_directory",
  "read_codebase_manifest",
  "search_tool_marketplace",
  // backlog lifecycle
  "query_backlog",
  "get_backlog_item",
  "list_backlog_items",
  "create_backlog_item",
  "update_backlog_item",
  "triage_backlog_item",
  "size_backlog_item",
  "list_epics",
  "link_backlog_item_to_epic",
  // work / coworker / build visibility
  "get_my_coworker_profile",
  "get_next_recommended_work",
  "list_work_capsules",
  "get_work_capsule",
  "get_build_progress_visibility",
]);

/**
 * Narrow an already-grant-filtered tool list to the requested tier. Pure.
 * `full` is identity; `core` keeps only `CORE_MCP_TOOL_NAMES`.
 */
export function selectToolsByTier<T extends { name: string }>(tools: T[], tier: McpToolTier): T[] {
  if (tier === "full") return tools;
  return tools.filter((t) => CORE_MCP_TOOL_NAMES.has(t.name));
}
