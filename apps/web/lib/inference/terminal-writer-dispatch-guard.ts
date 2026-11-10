// apps/web/lib/inference/terminal-writer-dispatch-guard.ts
//
// What happens when a plan demands `toolChoice: "required"` on an execution
// adapter that cannot force a tool call (claude-code-cli, codex-cli).
//
// Two cases, deliberately different:
//
//   plain required     No post-dispatch verification exists, so the only safe
//                      answer is to refuse before inference. Unchanged.
//
//   bound terminal     The writer is the sole tool AND the plan names it as the
//   writer             terminal writer. The executor verifies the governed
//                      receipt after the turn (mcp-task-execution:
//                      terminalWriterSucceeded = persistedOutcome !== null), a
//                      missing receipt parks the same TaskRun as a resumable,
//                      rotated, bounded failure — never a pass. That check IS the
//                      server-verifiable mechanism, so the turn is dispatched
//                      with best-effort tool choice under the receipt-verified
//                      contract (BI-C35576A9, kernel DI-48BC3C1F11A8).
//
//                      Only with a governed MCP session, though: the writer is an
//                      MCP tool the CLI reaches THROUGH that session. Without it
//                      no receipt could ever exist and dispatch would only burn a
//                      turn, so it still refuses — and says why.
//
// Before this, the bound-writer case refused outright. On an install whose cloud
// providers are all CLI subscriptions that left exactly one eligible endpoint
// for every governance write — the local model — and the reviewer chain could
// not complete (276 such exclusions in one day on one install).

import type { RoutedExecutionPlan } from "@/lib/routing/recipe-types";
import {
  requiredToolChoiceExclusionReason,
  type ExecutionAdapterSelector,
} from "@/lib/routing/execution-adapter-types";

/**
 * The decision, not the throw: ai-inference.ts owns InferenceError, and this
 * module must not import it back (that would be an import cycle).
 */
export type RequiredToolChoiceGuardOutcome =
  | { kind: "dispatch"; plan: RoutedExecutionPlan }
  | { kind: "refuse"; message: string; code: "required_terminal_writer_not_enforceable" | "provider_error" };

export function applyRequiredToolChoiceGuard(input: {
  plan: RoutedExecutionPlan;
  selector: ExecutionAdapterSelector | null;
  tools: Array<Record<string, unknown>> | undefined;
  providerId: string;
  hasGovernedMcpSession: boolean;
}): RequiredToolChoiceGuardOutcome {
  const { plan, selector, tools, providerId, hasGovernedMcpSession } = input;
  const exclusion = requiredToolChoiceExclusionReason(selector);
  if (plan.toolPolicy.toolChoice !== "required" || !exclusion) return { kind: "dispatch", plan };

  const soleToolFunction = tools?.length === 1 ? tools[0]?.["function"] : undefined;
  const soleToolName = soleToolFunction && typeof soleToolFunction === "object" && !Array.isArray(soleToolFunction)
    ? (soleToolFunction as Record<string, unknown>)["name"]
    : undefined;
  const boundTerminalWriter = typeof soleToolName === "string"
    && plan.responsePolicy.terminalWriterToolName === soleToolName;

  if (boundTerminalWriter && hasGovernedMcpSession) {
    console.info(
      `[callProvider] ${providerId}: ${exclusion} Dispatching the sole governed writer under the receipt-verified contract.`,
    );
    return { kind: "dispatch", plan: { ...plan, toolPolicy: { ...plan.toolPolicy, toolChoice: "auto" } } };
  }

  return {
    kind: "refuse",
    message: boundTerminalWriter
      ? `required-terminal-writer-not-enforceable: ${exclusion} No governed MCP session was supplied, so the sole writer cannot be reached and no receipt could be verified.`
      : exclusion,
    code: boundTerminalWriter ? "required_terminal_writer_not_enforceable" : "provider_error",
  };
}
