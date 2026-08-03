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
 * spec Phase 2) is purely additive on top of it.
 *
 * Server-authoritative default (BI-88681BE0): when a caller passes no explicit
 * `?tier=`, the default now depends on the client (defaultTierForClient) —
 * Claude Code keeps "full" (it defers client-side), every other/unknown client
 * defaults to the lean "core" surface so it stops paying the full catalog. Any
 * caller opts back in with `?tier=full`.
 *
 * Core is not "backlog-only": peer CLIs (Grok, Codex) have no ToolSearch, so
 * WWMD tools that AGENTS.md requires (`principle_decide`, `wiki_query`) must
 * be discoverable on the lean list — otherwise agents cannot consult the
 * kernel even when the token grants them. That is discovery only; execution
 * already allowed by-name before this expansion.
 */

export type McpToolTier = "core" | "full";

/** Parse an EXPLICIT tier hint (`?tier=core` / `?tier=full`), or null when absent. */
export function parseExplicitTier(raw: string | null | undefined): McpToolTier | null {
  if (typeof raw !== "string") return null;
  const v = raw.toLowerCase();
  return v === "core" || v === "full" ? (v as McpToolTier) : null;
}

/** Parse a tier hint (e.g. the `?tier=` query param). Defaults to "full". */
export function resolveMcpToolTier(raw: string | null | undefined): McpToolTier {
  return typeof raw === "string" && raw.toLowerCase() === "core" ? "core" : "full";
}

/**
 * The default tier for a caller when it did NOT pass an explicit `?tier=`
 * (BI-88681BE0 / BI-71310615 §5a — server-authoritative default-minimal
 * disclosure). Claude Code defers the catalog client-side (ToolSearch), so it
 * keeps the `full` surface with no behaviour change; every OTHER client (Codex,
 * Grok, a customer's own agent, or an unidentified caller) has no client-side
 * deferral and otherwise pays the whole ~26k-token catalog up front, so it
 * defaults to the lean `core` surface. This is discovery-only — `tools/call`
 * still executes any granted tool by name and `search_tool_marketplace` (in
 * core) surfaces the rest — so no capability is lost, and any caller can opt
 * back into the full surface with `?tier=full`.
 */
export function defaultTierForClient(callerClient: string | null | undefined): McpToolTier {
  return typeof callerClient === "string" && /^claude-code(\/|$)/i.test(callerClient)
    ? "full"
    : "core";
}

/**
 * The effective tier for a `tools/list` request: an explicit `?tier=` wins;
 * otherwise fall back to the client-aware default (above).
 */
export function resolveEffectiveTier(
  rawTierParam: string | null | undefined,
  callerClient: string | null | undefined,
): McpToolTier {
  return parseExplicitTier(rawTierParam) ?? defaultTierForClient(callerClient);
}

/**
 * The curated lean surface for token-constrained MCP sessions: broadly-useful
 * discovery / read / backlog-lifecycle / work-visibility tools. A drift guard
 * (tool-tier.test.ts) asserts every name here exists in PLATFORM_TOOLS, so a
 * tool rename can't silently leave a dangling core entry. `search_tool_marketplace`
 * is included so a model in core tier can still discover the rest.
 *
 * WWMD / kernel tools (`principle_decide`, `wiki_query`) are core for peer
 * external agents (Grok, Codex, …) that cannot ToolSearch the full catalog —
 * AGENTS.md requires principle_decide before multi-option platform menus.
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
  // WWMD — founder-kernel decide + doctrine lookup (peer CLI discovery parity)
  "principle_decide",
  "wiki_query",
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
  // live delivery / verification
  "get_quiescence_status",
  "get_self_upgrade_queue_status",
  "request_self_upgrade",
  "repair_promoter_image",
  "record_runtime_verification",
]);

/**
 * Narrow an already-grant-filtered tool list to the requested tier. Pure.
 * `full` is identity; `core` keeps only `CORE_MCP_TOOL_NAMES`.
 */
export function selectToolsByTier<T extends { name: string }>(tools: T[], tier: McpToolTier): T[] {
  if (tier === "full") return tools;
  return tools.filter((t) => CORE_MCP_TOOL_NAMES.has(t.name));
}
