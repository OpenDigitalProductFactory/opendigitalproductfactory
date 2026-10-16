import type { ToolLifecycleEvent } from "./mcp-governed-execute-types";
import type { ToolExecutionContext, ToolResult } from "./mcp-tool-types";

export const APPROVAL_COMPLETION = "approval-completion";

export async function checkRecoveredReviewAuthority(userId: string, context?: ToolExecutionContext): Promise<ToolResult | null> {
  if (!context?.taskRunId) return null;
  const { reviewRecoveryToolRefusal } = await import("./mcp-task-review-recovery");
  return reviewRecoveryToolRefusal({ taskRunId: context.taskRunId, apiTokenId: context.apiTokenId, userId });
}

/** Approved calls are checked at execution so a refusal closes their approval as failed. */
export async function defaultGovernedToolPreflight(event: ToolLifecycleEvent,
  roomRefusal: (toolName: string, params: Record<string, unknown>, userId: string, context?: ToolExecutionContext) => Promise<ToolResult | null>,
): Promise<ToolResult | null> {
  if (event.context?.callerClient !== APPROVAL_COMPLETION) {
    const recoveryRefusal = await checkRecoveredReviewAuthority(event.userId, event.context);
    if (recoveryRefusal) return recoveryRefusal;
    const refusal = await roomRefusal(event.toolName, event.rawParams, event.userId, event.context);
    if (refusal) return refusal;
  }
  if (event.toolName === "invite_room_participant") {
    const { preflightRoomParticipantInvitation } = await import("./work-management/room-participant-invitation-preflight.server");
    const outcome = await preflightRoomParticipantInvitation({ params: event.rawParams,
      userId: event.userId, agentId: event.context?.agentId });
    return outcome.verdict === "allow" ? null : outcome.result;
  }
  return null;
}
