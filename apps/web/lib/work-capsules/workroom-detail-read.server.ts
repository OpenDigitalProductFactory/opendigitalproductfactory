import { prisma } from "@dpf/db";
import { projectDeliveryAgreement } from "@/lib/work-management/delivery-agreement";
import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import { clampToolResultForModel, MCP_ROUTE_TOOL_RESULT_CHAR_CAP } from "@/lib/tak/tool-result-budget";

export async function readWorkroomDetail(params: Record<string, unknown>, userId?: string, context?: ToolExecutionContext): Promise<ToolResult> {
  const capsuleId = typeof params.capsuleId === "string" ? params.capsuleId.trim() : null;
  if (!capsuleId) {
    return { success: false, error: "missing_capsuleId", message: "capsuleId is required." };
  }
  if (params.activityMode === "bounded") {
    const { getBoundedWorkroomActivity } = await import("./bounded-activity-read.server");
    return getBoundedWorkroomActivity({ ...params, capsuleId }, userId, context?.agentId);
  }
  if (["activityMode", "activityId", "activityField", "payloadPath", "activityLimit", "throughSequence"].some(key => params[key] !== undefined)) {
    return { success: false, error: "invalid_activity_read", message: "Use activityMode: bounded for bounded activity metadata or selected-value reads." };
  }
  const { parseAfterSequence, readActivityAfter } = await import("./activity-log-read");
  const afterSequence = parseAfterSequence(params["afterSequence"]);
  if (afterSequence === null) {
    return { success: false, error: "invalid_input", message: "afterSequence must be a non-negative integer." };
  }
  const capsule = await prisma.workroom.findUnique({
    where: { capsuleId },
    include: {
      activities: {
        orderBy: { recordedAt: "desc" },
        take: 25,
      },
      taskRun: { select: { taskRunId: true, status: true } },
    },
  });

  if (!capsule) {
    return {
      success: false,
      error: "not_found",
      message: `Work Capsule ${capsuleId} not found.`,
    };
  }
  const { loadWorkroomRecoveryItems, projectWorkroomRecovery, boundWorkroomRecoveryReadback } = await import("./workroom-recovery-projection");
  const { loadSemanticReviewRoomProjection } = await import("@/lib/work-management/semantic-review-room-projection");
  const reviews = await loadSemanticReviewRoomProjection(prisma as never, [capsule.capsuleId], new Date());
  const failedHandoffRecovery = userId ? await (await import("./workroom-failed-handoff-recovery.server"))
    .loadWorkroomFailedHandoffRecovery({ workroomRowId: capsule.id, userId, context }, prisma) : null;
  const recoveryItems = await loadWorkroomRecoveryItems(prisma, [capsule]);
  const investment = capsule.backlogItemId
    ? await (await import("../portfolio/investment-balance-server")).projectItemInvestment(prisma, { itemId: capsule.backlogItemId, roomId: capsule.id })
    : null;
  const nestedCoordination = userId && context?.agentId
    ? await (await import("@/lib/work-management/nested-room-coordination.server")).loadNestedRoomCoordination(prisma as never, {
      roomId: capsule.id,
      canReadRoom: async workroomId => (await (await import("@/lib/work-management/workroom-agent-access.server"))
        .resolveAgentWorkroomAccess({ userId, agentId: context.agentId!, workroomId, requested: "content" })).decision.level === "content",
    }).catch(() => ({ delegations: [], escalation: {
      state: "setup-required" as const, reason: "coordination-read-unavailable", steps: [],
    } })) : null;
  // BI-62514632: the room's log from a position the caller already holds.
  const log = afterSequence === undefined ? null
    : { afterSequence, ...(await readActivityAfter(prisma as never, { workCapsuleId: capsule.id, afterSequence })) };
  const message = `Loaded ${capsule.capsuleId}.`;
  const data = boundWorkroomRecoveryReadback({ capsule: { ...capsule, delivery: projectDeliveryAgreement({ workspaceState: capsule.workspaceState, currentObjective: capsule.objective, terminal: ["complete", "archived", "abandoned"].includes(capsule.status) }), recovery: projectWorkroomRecovery(capsule, reviews,
    recoveryItems.get(capsule.backlogItemId ?? "") ?? null, new Date(), failedHandoffRecovery), nestedCoordination, investment },
    ...(log ? { log } : {}) }, value => !clampToolResultForModel({ success: true, message, data: value },
      { maxChars: MCP_ROUTE_TOOL_RESULT_CHAR_CAP, toolName: "get_workroom" }).truncated);
  if (!data) return { success: false, error: "workroom_recovery_budget_exceeded",
    message: "Exact Workroom identity and recovery exceed the response budget. No partial identity or passing readiness is reported; bounded-detail repair is required." };
  return {
    success: true,
    entityId: capsule.capsuleId,
    message,
    data,
  };
}
