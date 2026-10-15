// Record an `unmediated` permit verdict for an O/A/I tool reached by a direct
// in-process call that never passed the reference monitor.
//
// GPP Phase 2, PR-C (docs/superpowers/plans/2026-10-01-gpp-phase-2-permits-and-enforcement.md).
// Scope baseline: OBJ-CRITICAL, OBJ-VISIBLE; acceptance AC-SHADOW-PERMIT for the
// Phase 1 direct sites (lib/gpp/unmediated-execute-sites.ts), without touching
// any Build Studio file.
//
// The tool runner in lib/mcp-tools.ts calls this fire-and-forget when its
// context carries no `governedSource` (the monitor always sets one). It never
// throws, never awaits on the caller's path, and never changes the call.

import type { ToolDefinition, ToolExecutionContext } from "@/lib/mcp-tool-types";
import { classifyConsequentialTool } from "@/lib/tak/consequential-tool-policy";

import { recordPermitObservation } from "./permit-verdict";

/** Route, agent or task hint for the direct caller. Never parameters. */
export function directCallerSite(context?: ToolExecutionContext): string | null {
  if (!context) return null;
  const parts = [
    context.routeContext ? `route:${context.routeContext}` : null,
    context.agentId ? `agent:${context.agentId}` : null,
    context.taskRunId ? `task:${context.taskRunId}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" ").slice(0, 256) : null;
}

/** Records one `unmediated` observation when the call is O/A/I and unmediated. */
export async function observeUnmediatedToolCall(input: {
  toolName: string;
  tool: Pick<ToolDefinition, "sideEffect" | "consequence" | "consequenceScope"> | undefined;
  context?: ToolExecutionContext;
}): Promise<void> {
  try {
    if (!input.tool || input.context?.governedSource) return;
    const classification = classifyConsequentialTool({ toolName: input.toolName, tool: input.tool });
    if (!classification.consequential) return;
    await recordPermitObservation({
      permitRowId: null,
      bindingId: null,
      toolName: input.toolName,
      verdict: "unmediated",
      path: "direct",
      toolExecutionId: null,
      callerSite: directCallerSite(input.context),
      detail: { consequence: input.tool.consequence ?? null, reason: classification.reason },
    });
  } catch (err) {
    console.error(
      "[gpp-permit] unmediated observation failed tool=%s: %s",
      JSON.stringify(input.toolName),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)),
    );
  }
}
