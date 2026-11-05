// The forced final step of a run that owes one governed writer (BI-A8679D84).
//
// The Harness² finding, measured in-platform: a run handed its required writer
// describes the call instead of making it. DEV 2026-10-07→10-28, 545 scheduled
// runs failed "required governed tool … executed zero times", many of them
// "attached to the run and not called". Asking again in prose (BI-62DB6C03's
// correction turn) leaves the choice with the model. The provider can take it
// away: tool_choice "required" over a surface holding only the writer
// (Anthropic `any`, OpenAI `required`, Gemini `ANY`) — the contract the
// governed reviewer's writer-only phase already dispatches
// (terminal-tool-policy.ts), including the dispatch guard for adapters that
// cannot enforce it (terminal-writer-dispatch-guard.ts).
//
// Once the writer has been attempted the step is done: the run's own surface
// comes back with the choice released, so the model can end its turn instead of
// being made to call the writer again. The surface is restored, not emptied:
// a provider such as Anthropic refuses a request whose history carries tool
// calls but which defines no tools.

export type ForcedToolRoute = {
  tools: Array<Record<string, unknown>>;
  toolChoice: "required" | undefined;
  terminalWriterToolName: string | undefined;
};

function providerToolName(tool: Record<string, unknown>): string | null {
  const fn = tool["function"];
  if (fn && typeof fn === "object" && !Array.isArray(fn)) {
    const name = (fn as Record<string, unknown>)["name"];
    return typeof name === "string" ? name : null;
  }
  return typeof tool["name"] === "string" ? tool["name"] : null;
}

/**
 * The route options for this iteration of a forced-writer loop, or null when
 * the writer is not among the provider tools (nothing to force; the loop keeps
 * its own surface).
 */
export function forcedToolRoute(
  toolName: string,
  executedTools: ReadonlyArray<{ name: string }>,
  providerTools: ReadonlyArray<Record<string, unknown>>,
): ForcedToolRoute | null {
  const writer = providerTools.find((tool) => providerToolName(tool) === toolName);
  if (!writer) return null;
  if (executedTools.some((tool) => tool.name === toolName)) {
    return { tools: [...providerTools], toolChoice: undefined, terminalWriterToolName: undefined };
  }
  return { tools: [writer], toolChoice: "required", terminalWriterToolName: toolName };
}
