import type { BuildPhaseTag, ToolDefinition } from "@/lib/mcp-tools";

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
 * Build-phase filtering only applies inside an active build: when
 * `activeBuildPhase` is set, only tools whose `buildPhases` includes that
 * phase are kept.
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
      if (!tool.buildPhases) return false;
      return tool.buildPhases.includes(input.activeBuildPhase as BuildPhaseTag);
    }
    return true;
  });
}
