// The governed-execution context the agentic loop gives every tool call it
// runs (lib/tak/agentic-loop.ts). Extracted so the loop's own call and the
// propose-boundary call (propose-interception.ts) build it in one place, and so
// the 2,600-line loop does not grow (module-size ratchet).
//
// BI-7BCC87BB (approval convergence PR-B): `extra` carries the server-set
// approval-convergence fields — `proposeBoundary`, `approvalCompletion` and
// `chatMessageId` — which only the platform's own callers set (AC-TRANSPORT).

import { createAuthorizedSurfaceTurnGovernance } from "@/lib/coworker/authorized-surface-execution-context";
import type { GovernedExecuteContext } from "@/lib/mcp-governed-execute-types";

export type LoopToolContextInput = {
  routeContext: string;
  agentId: string;
  threadId: string;
  taskRunId?: string | null;
  apiTokenId?: string | null;
  tokenScope?: GovernedExecuteContext["tokenScope"];
  tokenGrantScopes?: GovernedExecuteContext["tokenGrantScopes"];
  skillId?: string | null;
  interactionMode: "chat" | "autonomous";
  workroomId?: string | null;
  chatHistory: Array<{ role: string; content?: unknown }>;
  /** The caller's server-resolved external permission, when it supplied one. */
  externalAccessEnabled?: boolean;
  requiresExternalAccess?: boolean;
  roomAuthority?: GovernedExecuteContext["roomAuthority"] | null;
  featureBuildId?: string | null;
  delegationChainId?: string | null;
};

export function loopToolContext(
  input: LoopToolContextInput,
  extra: Pick<GovernedExecuteContext, "proposeBoundary" | "approvalCompletion" | "chatMessageId"> = {},
): GovernedExecuteContext {
  return {
    routeContext: input.routeContext,
    agentId: input.agentId,
    threadId: input.threadId,
    taskRunId: input.taskRunId ?? undefined,
    apiTokenId: input.apiTokenId ?? undefined,
    tokenScope: input.tokenScope,
    tokenGrantScopes: input.tokenGrantScopes,
    skillId: input.skillId ?? undefined,
    // In-portal coworker chat turns attach COWORKER_READ_BASELINE_GRANTS
    // to the tool surface (actions/agent-coworker.ts). Flag the turn so
    // the governed grant check honours the same baseline at execution
    // time (BI-FD7E4D72) — otherwise a coworker whose own grants lack a
    // baseline read grant gets the tool attached but rejected on call.
    // Autonomous turns leave this false, so their authority is unchanged.
    coworkerReadBaseline: input.interactionMode === "chat",
    ...createAuthorizedSurfaceTurnGovernance({
      interactionMode: input.interactionMode,
      apiTokenId: input.apiTokenId,
      route: input.routeContext,
      workroomId: input.workroomId ?? null,
      chatHistory: input.chatHistory,
    }),
    // The turn's SERVER-resolved external permission when the caller
    // supplied one (chat turns: room + standing grant). Callers that
    // predate the resolver keep the prior admission-by-attachment
    // behaviour so autonomous runs are unchanged.
    externalAccessEnabled: input.externalAccessEnabled !== undefined
      ? (input.requiresExternalAccess ? input.externalAccessEnabled : undefined)
      : (input.requiresExternalAccess || undefined),
    ...(input.roomAuthority ? { roomAuthority: input.roomAuthority } : {}),
    // BI-F4A30FCB (Dale dogfood 2026-05-24): plumb the build the
    // user is messaging from into tool context so phase-scoped
    // tools (start_ideate_research, start_scout_research) can
    // target the correct build instead of "latest in phase".
    featureBuildId: input.featureBuildId ?? undefined,
    // EP-31815F97 S2 (BI-F82F4E04): when this loop runs a delegated
    // coworker, carry the active DelegationChain grouping id so each
    // ToolExecution joins its chain-of-custody back to the human origin.
    delegationChainId: input.delegationChainId ?? undefined,
    ...extra,
  };
}

/** The envelope id a governed result names when the call is waiting on a person. */
export function pendingApprovalEnvelopeId(result: { success: boolean; error?: string; data?: unknown }): string | null {
  if (result.success || result.error !== "approval_required") return null;
  const data = result.data as Record<string, unknown> | undefined;
  return typeof data?.["envelopeId"] === "string" ? data["envelopeId"] : null;
}
