import type { BuildPhaseTag, ToolDefinition } from "@/lib/mcp-tools";

const ACTIVE_BUILD_PHASES = new Set<string>(["ideate", "plan", "build", "review", "ship"]);
const TERMINAL_BUILD_PHASES = new Set<string>(["complete", "failed", "abandoned"]);
const TERMINAL_BUILD_TOOLS = new Set<string>([
  "get_build_progress_visibility",
  "get_build_sandbox_state",
  "get_build_dispatch_history",
  "get_build_scoped_verification",
  "list_build_activity_since",
  "screen_describe",
  "screen_get_state",
  "screen_scroll_to",
  "screen_select_entity",
  "screen_navigate",
  "screen_open_panel",
  "screen_close_panel",
]);

/**
 * Filter the merged tool set (platform tools + page actions) down to what
 * the in-portal coworker is allowed to use right now.
 *
 * Advise mode is the default for non-/build routes. It strips side-effect
 * tools so the coworker cannot act on the outside world without explicit
 * "act" intent. Tools flagged as `coworkerArtifact` persist the coworker's
 * own recommendation as an internal artifact (e.g. `save_marketing_review`)
 * and stay available — saving the advice the user explicitly asked for is
 * part of the advisory workflow, not an external action.
 *
 * Build-phase filtering only applies inside an active build. Terminal builds
 * keep only navigation/inspection tools so the coworker can help the operator
 * switch or diagnose without mutating stale build evidence.
 *
 * Extracted to its own module so the filter is unit-testable without
 * dragging in next-auth and the rest of the agent-coworker action surface.
 */
export function filterToolsForCoworkerRuntime(
  tools: ToolDefinition[],
  input: { coworkerMode?: "advise" | "act"; activeBuildPhase: string | null },
): ToolDefinition[] {
  return tools.filter((tool) => {
    if (input.coworkerMode === "advise" && tool.sideEffect && !tool.coworkerArtifact) return false;
    if (input.activeBuildPhase) {
      if (TERMINAL_BUILD_PHASES.has(input.activeBuildPhase)) {
        return TERMINAL_BUILD_TOOLS.has(tool.name);
      }
      if (!ACTIVE_BUILD_PHASES.has(input.activeBuildPhase)) return false;
      if (!tool.buildPhases) return false;
      return tool.buildPhases.includes(input.activeBuildPhase as BuildPhaseTag);
    }
    return true;
  });
}

/**
 * The tools that Advise mode holds back — the exact set `filterToolsForCoworkerRuntime`
 * removes for its `coworkerMode === "advise"` rule (side-effecting, non-artifact).
 * The coworker HOLDS authority for these (they passed grant + capability gating to
 * reach the merged set); advise mode is disabling them, not a missing permission.
 *
 * Surfaced into the coworker's prompt so it can name the specific enabler ("switch
 * me to Act mode and I can …") per the limitation-response contract, instead of
 * misdiagnosing a mode muzzle as a missing permission or deflecting to an admin.
 *
 * Pass the FULL merged (authorized) tool set — not the already-filtered set.
 */
export function adviseHeldBackTools(mergedTools: ToolDefinition[]): ToolDefinition[] {
  return mergedTools.filter((tool) => tool.sideEffect && !tool.coworkerArtifact);
}
