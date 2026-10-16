import type { InitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import { projectRecordedTaskState } from "@/lib/tak/task-states";
import type { loadSemanticReviewRoomProjection } from "@/lib/work-management/semantic-review-room-projection";

type WorkroomIdentity = {
  capsuleId?: string;
  repositoryFullName: string | null;
  headBranch: string | null;
  worktreePath: string | null;
  baseSha: string | null;
  headSha: string | null;
};

type ReviewProjection = Pick<Awaited<ReturnType<typeof loadSemanticReviewRoomProjection>>, "runs" | "partial" | "attentionReason">;

type WorkroomReadback = { capsule: Record<string, unknown>; log?: { afterSequence: number; activity: unknown[]; hasMore: boolean } };

/** Preserve actionable facts instead of letting the route replace the whole room with a text preview. */
export function boundWorkroomRecoveryReadback(data: WorkroomReadback, fits: (value: unknown) => boolean) {
  if (fits(data)) return data;
  const retainedKeys = ["id", "capsuleId", "status", "backlogItemId", "repositoryFullName", "baseBranch", "baseSha",
    "headBranch", "headSha", "worktreePath", "executorKind", "executorRef", "leaseHolderPrincipalId", "leaseExpiresAt",
    "updatedAt", "createdByPrincipalId", "requestedByPrincipalId", "activitySequence", "taskRunId", "featureBuildId",
    "pullRequestUrl", "pullRequestNumber", "recovery"];
  const capsule = Object.fromEntries(retainedKeys.filter(key => key in data.capsule).map(key => [key, data.capsule[key]]));
  const omittedFields = Object.keys(data.capsule).filter(key => !retainedKeys.includes(key)).map(key => `capsule.${key}`);
  const compact = { ...data, capsule, omittedFields,
    activityRead: { toolName: "get_workroom", args: { capsuleId: data.capsule.capsuleId, afterSequence: 0 } } };
  if (fits(compact)) return compact;
  // Never consume a log cursor for rows the caller did not receive. Large raw
  // activity detail remains a separate bounded-detail repair (BI-3CE72645).
  const bounded = { ...compact, ...(data.log ? { log: { afterSequence: data.log.afterSequence, activity: [],
    hasMore: data.log.hasMore || data.log.activity.length > 0, incomplete: true,
    reason: "activity-page-budget-exceeded", nextAction: "Do not advance this cursor; bounded activity-detail recovery is required (BI-3CE72645)." } } : {}),
    omittedFields: [...omittedFields, ...(data.log ? ["log.activity"] : [])] };
  return fits(bounded) ? bounded : null;
}

/** Observations are readback, never completion evidence or retry authorization. */
function projectSemanticRecovery(room: WorkroomIdentity, view: ReviewProjection) {
  const runs = view.runs.filter(run => run.capsuleId === room.capsuleId);
  const current = runs.filter(run => run.identityScope === "current" && room.headSha && run.sourceHeadSha
    && run.sourceHeadSha.toLowerCase() === room.headSha.toLowerCase());
  if (!view.partial && runs.length === 0) return null;
  const run = current.length === 1 ? current[0] : null;
  const recorded = run ? projectRecordedTaskState(run.status) : "unknown";
  // Retry retains prior receipts. They are historical while a new generation
  // executes, and must not replace that generation's working/queued state.
  const receipt = run?.status === "completed" || (run?.status === "input-required" && run.receipt?.decision === "inconclusive")
    ? run.receipt : null;
  const resultAction = run?.requesterId ? { method: "tasks/result" as const, params: { taskId: run.taskRunId }, requiredUserId: run.requesterId } : null;
  const accountableOwner = run ? { agentId: run.requesterAgentId ?? null,
    userId: run.requesterId, displayName: run.requesterName ?? null } : null;
  const reason = view.partial ? "review-observation-incomplete"
    : current.length > 1 ? "review-identity-conflict"
      : !run ? "current-review-unavailable"
        : receipt?.decision === "fail" ? "review-failed"
          : receipt?.decision === "inconclusive" ? run.reason ?? "review-inconclusive"
            : recorded === "terminal" && !receipt ? "review-receipt-unavailable"
              : recorded === "waiting" || recorded === "unknown" ? run.reason ?? `review-${recorded}` : null;
  const state = view.partial || current.length !== 1 || reason === "review-receipt-unavailable" ? "unknown" as const
    : receipt?.decision === "fail" ? "blocked" as const
      : receipt?.decision === "inconclusive" ? "waiting" as const : recorded;
  const needsRoomRead = view.partial || current.length !== 1;
  const roomAction = room.capsuleId ? { toolName: "get_workroom" as const, args: { capsuleId: room.capsuleId } } : null;
  const nextAction = needsRoomRead
    ? "Read get_workroom for this room's bounded review history; the current review observation is incomplete or conflicting."
    : run?.nextAction ?? view.attentionReason ?? "Read this Workroom again to resolve the current review identity and evidence.";
  return {
    state,
    reviewerExecution: run ? {
      taskRunId: run.taskRunId, status: run.status,
      pending: recorded === "unknown" ? null : recorded !== "terminal",
      accountableOwner, reason: run.reason, nextAction, resultAction,
      heartbeat: run.heartbeat, lastHeartbeatAt: run.lastHeartbeatAt, readAt: run.readAt,
      budget: run.budget, receipt: receipt ?? null,
    } : null,
    blocker: reason ? { reason, accountableOwner, nextAction,
      action: needsRoomRead ? roomAction : resultAction } : null,
  };
}

type LinkedTaskRun = { taskRunId: string; status: string } | null;
type WorkroomReviewerExecution = NonNullable<LinkedTaskRun> & { pending: boolean | null }
  & Partial<NonNullable<NonNullable<ReturnType<typeof projectSemanticRecovery>>["reviewerExecution"]>>;

/** Room fields adopt_worktree requires besides the identity itself. */
type WorkroomRepairContext = {
  title?: string | null;
  objective?: string | null;
  backlogItemId?: string | null;
  baseBranch?: string | null;
};

/**
 * adopt_worktree refuses a call without title and objective, so a repair packet
 * that leaves them out cannot be replayed as given (observed 2026-09-23). Carry
 * every field the room already knows.
 */
function repairContextFields(room: WorkroomRepairContext): Record<string, unknown> {
  return {
    ...(room.title ? { title: room.title } : {}),
    ...(room.objective ? { objective: room.objective } : {}),
    ...(room.backlogItemId ? { backlogItemId: room.backlogItemId } : {}),
    ...(room.baseBranch ? { baseBranch: room.baseBranch } : {}),
  };
}

export function projectWorkroomIdentityRepair(
  room: WorkroomIdentity,
  packetFields: Record<string, unknown> = {},
): NonNullable<InitiativeReviewerRecovery["identityRepair"]> | null {
  const missingFields = [
    ...(!room.baseSha ? ["baseSha" as const] : []),
    ...(!room.headSha ? ["headSha" as const] : []),
  ];
  if (missingFields.length === 0) return null;
  const retainedFields = {
    repositoryFullName: room.repositoryFullName ?? "",
    headBranch: room.headBranch ?? "",
    worktreePath: room.worktreePath ?? "",
    ...(room.baseSha ? { baseSha: room.baseSha } : {}),
    ...(room.headSha ? { headSha: room.headSha } : {}),
  };
  return {
    toolName: "adopt_worktree",
    missingFields,
    retainedFields,
    packet: {
      ...packetFields,
      repositoryFullName: retainedFields.repositoryFullName,
      headBranch: retainedFields.headBranch,
      worktreePath: retainedFields.worktreePath,
      ...(room.baseSha ? { baseSha: room.baseSha } : {}),
      ...(room.headSha ? { headSha: room.headSha } : {}),
    },
  };
}

export function projectWorkroomRecovery(
  room: WorkroomIdentity & WorkroomRepairContext & { taskRun?: LinkedTaskRun },
  review?: ReviewProjection,
) {
  const identityRepair = projectWorkroomIdentityRepair(room, repairContextFields(room));
  // These are recorded states, not proof of a current heartbeat. In particular,
  // waiting for input or recovery must never look like queued execution.
  const executionState = room.taskRun ? projectRecordedTaskState(room.taskRun.status) : null;
  const reviewerExecution = room.taskRun
    ? {
      taskRunId: room.taskRun.taskRunId,
      status: room.taskRun.status,
      pending: executionState === "unknown" ? null : executionState !== "terminal",
    }
    : null;
  const semantic = review ? projectSemanticRecovery(room, review) : null;
  const recoveryExecution: WorkroomReviewerExecution | null = semantic ? semantic.reviewerExecution : reviewerExecution;
  const prerequisite = identityRepair
    ? {
      accountableRole: "artifact-resolver" as const,
      missingFields: identityRepair.missingFields,
      retainedFields: identityRepair.retainedFields,
      nextAction:
        `Call adopt_worktree with this packet, adding the full 40-character commit SHA for ${identityRepair.missingFields.join(" and ")}. `
        + "Without them no reviewer can be routed to this room's source.",
      repair: { toolName: identityRepair.toolName, packet: identityRepair.packet },
    }
    : null;
  return {
    state: identityRepair
      ? "blocked" as const
      : semantic?.state ?? executionState ?? "actionable" as const,
    prerequisite,
    reviewerExecution: recoveryExecution,
    blocker: prerequisite ? { reason: "source-identity-missing", accountableRole: prerequisite.accountableRole,
      nextAction: prerequisite.nextAction, action: prerequisite.repair } : semantic?.blocker ?? null,
  };
}
