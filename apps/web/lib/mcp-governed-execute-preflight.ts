import type { ToolLifecycleEvent } from "./mcp-governed-execute-types";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "./mcp-tool-types";

export const APPROVAL_COMPLETION = "approval-completion";

export async function checkRecoveredReviewAuthority(userId: string, context?: ToolExecutionContext,
  phase?: "working" | "approval-resume"): Promise<ToolResult | null> {
  if (!context?.taskRunId) return null;
  const { reviewRecoveryToolRefusal } = await import("./mcp-task-review-recovery");
  return reviewRecoveryToolRefusal({ taskRunId: context.taskRunId, apiTokenId: context.apiTokenId, userId,
    actingAgentId: context.agentId, executionFence: context.taskExecutionFence, ...(phase ? { phase } : {}) });
}

/** Approved calls are checked at execution so a refusal closes their approval as failed. */
export async function defaultGovernedToolPreflight(event: ToolLifecycleEvent,
  roomRefusal: (toolName: string, params: Record<string, unknown>, userId: string, context?: ToolExecutionContext) => Promise<ToolResult | null>,
  definition?: ToolDefinition,
): Promise<ToolResult | null> {
  if (event.context?.callerClient !== APPROVAL_COMPLETION) {
    const recoveryRefusal = await checkRecoveredReviewAuthority(event.userId, event.context);
    if (recoveryRefusal) return recoveryRefusal;
  const { scheduledReportingToolRefusal } = await import("./operate/scheduled-jobs/scheduled-reporting-authority");
  const reportingRefusal = await scheduledReportingToolRefusal(event.toolName, event.userId, event.context, definition);
  if (reportingRefusal) return reportingRefusal;
  if (event.toolName === "configure_scheduled_agent_task_reporting") {
    const { preflightConfigureScheduledReporting } = await import("./operate/scheduled-jobs/scheduled-reporting-config");
    const refusal = await preflightConfigureScheduledReporting(event.rawParams, event.userId);
    if (refusal) return refusal;
  }
  }
  if (event.context?.callerClient !== APPROVAL_COMPLETION) {
    const refusal = await roomRefusal(event.toolName, event.rawParams, event.userId, event.context);
    if (refusal) return refusal;
    if (event.toolName === "record_initiative_evidence") {
      const { preflightInitiativeEvidence } = await import("./mcp/packs/initiative-readiness-pack");
      const evidenceRefusal = await preflightInitiativeEvidence(event.rawParams, event.userId, event.context);
      if (evidenceRefusal) return evidenceRefusal;
    }
    if (event.toolName === "record_semantic_review_exemption") {
      const { preflightSemanticReviewExemption } = await import("./change-review/semantic-review-policy-exemption");
      return preflightSemanticReviewExemption(event.rawParams, event.userId, { ...event.context, userContext: event.userContext });
    }
  }
  if (event.toolName === "invite_room_participant") {
    const { preflightRoomParticipantInvitation } = await import("./work-management/room-participant-invitation-preflight.server");
    const outcome = await preflightRoomParticipantInvitation({ params: event.rawParams,
      userId: event.userId, agentId: event.context?.agentId });
    return outcome.verdict === "allow" ? null : outcome.result;
  }
  return null;
}
