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
 * capability, and shipped model-driven deferral (load_tools + list_changed,
 * spec Phase 2) is purely additive on top of it.
 *
 * Server-authoritative default (BI-88681BE0): an explicit `?tier=` wins. Known
 * lazy-host bootstrap/config URLs use `?tier=full`, because current Codex HTTP
 * requests carry no User-Agent and do not refresh the top-level registry after
 * `list_changed`. User-Agent recognition remains a compatibility fallback for
 * clients that identify themselves. Other/unknown clients default to `core`.
 *
 * Core is not "backlog-only": peer clients without host-side ToolSearch, such
 * as Grok and generic MCP clients, still need the WWMD tools that AGENTS.md
 * requires (`principle_decide`, `wiki_query`) on the lean list.
 * That is discovery only; execution already allowed by-name before this
 * expansion.
 */

import {
  selectLoadableTools,
} from "@/lib/tak/tool-intent";
export { LOAD_TOOLS_TOOL_NAME } from "@/lib/tak/tool-intent";

export type McpToolTier = "core" | "full";

const CLIENT_SIDE_LAZY_TOOL_CATALOG = /^(?:claude-code|codex(?:-cli|-desktop)?)(?:\/|$)/i;

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
 * Compatibility fallback for a request without `?tier=`. Bootstrap does not
 * rely on this signal: current Codex Streamable HTTP requests omit User-Agent,
 * so known lazy-host configs request `tier=full` explicitly. Recognized Claude
 * Code/Codex identifiers still receive `full`; Grok, generic MCP clients, and
 * unidentified callers default to `core`. Explicit `?tier=` always wins.
 */
export function defaultTierForClient(callerClient: string | null | undefined): McpToolTier {
  return typeof callerClient === "string" && CLIENT_SIDE_LAZY_TOOL_CATALOG.test(callerClient)
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

/** Where a resolved MCP credential came from. `oauth` joins the original two
 *  as the default external door; `pat` is on a deprecation horizon. */
export type McpAuthSource = "pat" | "session-jwt" | "oauth";

/**
 * Auth-source-aware tier resolution (W12, BI-EE64547B). Internal AI-coworker
 * calls (`source: "session-jwt"`, the `x-mcp-session` seam) are per-call
 * stateless: no server-side deferred-loading session may influence what they
 * see, so their default tier is `full` — the session JWT's narrow scopes
 * already bound the surface, and every call independently lists everything it
 * is authorized for. External clients keep the client-aware default (and the
 * per-token deferred-loading session store). An explicit `?tier=` always wins
 * for both.
 */
export function resolveEffectiveTierForAuthSource(
  rawTierParam: string | null | undefined,
  callerClient: string | null | undefined,
  authSource: McpAuthSource,
): McpToolTier {
  if (authSource === "session-jwt") return parseExplicitTier(rawTierParam) ?? "full";
  // An OAuth-authorized client is an EXTERNAL client that happens to have a
  // better credential; its host-side registry behaviour is unchanged, so it
  // keeps the client-aware default rather than inheriting the internal seam's
  // "full". Auth strength and catalog width are unrelated axes.
  return resolveEffectiveTier(rawTierParam, callerClient);
}

/**
 * The curated lean surface for token-constrained MCP sessions: broadly-useful
 * discovery / read / backlog-lifecycle / work-visibility tools. A drift guard
 * (tool-tier.test.ts) asserts every name here exists in PLATFORM_TOOLS, so a
 * tool rename can't silently leave a dangling core entry. `search_tool_marketplace`
 * is included so a model in core tier can still discover the rest.
 *
 * WWMD / kernel tools (`principle_decide`, `wiki_query`) are core for peer
 * external agents that cannot ToolSearch the full catalog — AGENTS.md requires
 * principle_decide before multi-option platform menus.
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
  "find_coworker",
  "get_next_recommended_work",
  "list_workrooms",
  "get_workroom",
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

// ─── Phase 2: model-driven deferral (load_tools + list_changed) ──────────────
// Spec: docs/superpowers/specs/2026-06-20-mcp-tool-tier-deferred-loading-design.md §4.
// This is PURELY ADDITIVE on top of the Phase-1 tier: `tools/list` returns the
// tier surface (the floor) UNION any tools a model has pulled in via load_tools,
// plus the load_tools meta-tool itself. Append-not-swap: the lean core stays
// present for clients that don't honor list_changed, and the cached prompt
// prefix survives because tools are appended, never removed/reordered.

/**
 * The append-not-swap listing set: the tier floor (core|full) UNION any
 * session-loaded tools not already in the floor. Preserves floor order, then
 * appends newly-loaded tools in their original grant order. Pure. The caller
 * appends the `load_tools` meta-tool separately (it is not a granted domain
 * tool). `loadedNames` is the set of tool names this token has loaded.
 */
export function selectToolsForListing<T extends { name: string }>(
  granted: T[],
  tier: McpToolTier,
  loadedNames: ReadonlySet<string>,
): T[] {
  const floor = selectToolsByTier(granted, tier);
  if (loadedNames.size === 0) return floor;
  const floorNames = new Set(floor.map((t) => t.name));
  const appended = granted.filter((t) => loadedNames.has(t.name) && !floorNames.has(t.name));
  return [...floor, ...appended];
}

/**
 * Resolve which already-grant-filtered tools a `load_tools({query?,names?})`
 * call selects. Exact `names` take precedence; natural-language `query` intent
 * is ranked by token overlap over name and description and capped at 16.
 * Pure — the caller persists the resulting names to the session store.
 */
export function resolveLoadToolsSelection<T extends { name: string; description?: string }>(
  granted: T[],
  args: { names?: unknown; query?: unknown },
): T[] {
  return selectLoadableTools(granted, args);
}

// ─── Session-store pure helpers (DB wrapper lives in tool-session-store.ts) ──

/** Merge newly-loaded names into an existing set, de-duplicated and sorted. */
export function mergeLoadedToolNames(
  existing: readonly string[],
  incoming: readonly string[],
): string[] {
  return [...new Set([...existing, ...incoming])].sort();
}

/** True when a session's expiry has passed — expired sessions read as empty. */
export function isToolSessionExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}
