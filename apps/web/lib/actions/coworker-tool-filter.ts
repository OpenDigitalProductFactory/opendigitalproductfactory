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
 * "act" intent. Two classes of side-effect tool are exempt because they are
 * not actions ON the outside world:
 *   - `coworkerArtifact` persists the coworker's own recommendation as an
 *     internal artifact (e.g. `save_marketing_review`) — saving the advice the
 *     user explicitly asked for is part of the advisory workflow.
 *   - `adviseCoordination` hands a scoped sub-task to a NAMED peer coworker
 *     (`request_coworker` / `summon_coworker`) — routing work to the right
 *     teammate is coordination, not an external action, and is exactly how an
 *     advisor gets the user a better answer. Without this exemption an
 *     advise-mode coworker can name the right peer but the delegation is
 *     muzzled, dead-ending the sub-task back to the human (BI-7EB4AE2C).
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
  input: {
    coworkerMode?: "advise" | "act";
    activeBuildPhase: string | null;
    /**
     * BI-867263F4: when true, advise mode KEEPS its side-effecting tools instead
     * of stripping them — the agentic loop captures each call as an
     * AgentActionProposal (propose-interception) so the coworker's recommended
     * actions render as selectable Approve/Reject cards rather than prose. The
     * default (false) preserves the original strip-in-advise behavior for every
     * other caller.
     */
    surfaceAsProposals?: boolean;
  },
): ToolDefinition[] {
  return tools.filter((tool) => {
    if (
      input.coworkerMode === "advise" &&
      !input.surfaceAsProposals &&
      tool.sideEffect &&
      !tool.coworkerArtifact &&
      !tool.adviseCoordination
    )
      return false;
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
 * removes for its `coworkerMode === "advise"` rule (side-effecting, non-artifact,
 * non-coordination). The coworker HOLDS authority for these (they passed grant +
 * capability gating to reach the merged set); advise mode is disabling them, not a
 * missing permission. Must mirror the filter's exemptions exactly — otherwise the
 * prompt would tell the user "switch to Act mode and I can delegate" when delegation
 * (`adviseCoordination`) already works in advise mode.
 *
 * Surfaced into the coworker's prompt so it can name the specific enabler ("switch
 * me to Act mode and I can …") per the limitation-response contract, instead of
 * misdiagnosing a mode muzzle as a missing permission or deflecting to an admin.
 *
 * Pass the FULL merged (authorized) tool set — not the already-filtered set.
 */
export function adviseHeldBackTools(mergedTools: ToolDefinition[]): ToolDefinition[] {
  return mergedTools.filter(
    (tool) => tool.sideEffect && !tool.coworkerArtifact && !tool.adviseCoordination,
  );
}

/**
 * The advise-mode prompt suffix appended to a coworker's system prompt.
 *
 * BI-867263F4: when `surfaceAsProposals` is on, Advise mode PROPOSES — it tells
 * the coworker to call the relevant tools (each is captured as an approval card)
 * rather than describe them in prose or ask to switch to Act mode. When it is
 * off (e.g. an advise turn inside a build phase), the legacy held-back note
 * fires: name the exact authority being muzzled so the coworker asks to switch
 * to Act mode instead of misdiagnosing a mode muzzle as a missing permission.
 * Returns "" when nothing applies. Pass the FULL merged (authorized) tool set.
 */
export function buildAdvisePromptSuffix(input: {
  coworkerMode?: "advise" | "act";
  surfaceAsProposals?: boolean;
  mergedTools: ToolDefinition[];
}): string {
  if (input.coworkerMode !== "advise") return "";
  if (input.surfaceAsProposals) {
    return [
      "",
      "",
      "ADVISE MODE — YOUR RECOMMENDATIONS BECOME APPROVAL CARDS.",
      "When the request calls for a side-effecting action, DO call the relevant tool. In Advise mode the platform does not execute it — it captures the call as a proposal card the employee can approve with one click. So surface your recommended actions by calling the tools (each becomes a card); do NOT just describe them in prose, and do NOT ask the employee to switch to Act mode. Read-only tools run normally.",
    ].join("\n");
  }
  const heldBack = adviseHeldBackTools(input.mergedTools);
  if (heldBack.length === 0) return "";
  const ADVISE_HELD_BACK_CAP = 10;
  const shown = heldBack.slice(0, ADVISE_HELD_BACK_CAP);
  const toolList = shown.map((t) => `- ${t.name}: ${t.description}`).join("\n");
  const moreLine = heldBack.length > shown.length ? `- (+${heldBack.length - shown.length} more)` : "";
  return [
    "",
    "",
    "ADVISE MODE — AUTHORITY HELD BACK (NOT A MISSING PERMISSION).",
    "You already hold permission for the actions below; they are disabled ONLY because you are in Advise mode. Do not tell the employee you lack access to these, and do not send them to an administrator. When the request needs one, follow the limitation-response contract: say you can do it and ask to switch to Act mode.",
    toolList,
    moreLine,
  ].filter(Boolean).join("\n");
}
