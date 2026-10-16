import type { InitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import { projectRecordedTaskState } from "@/lib/tak/task-states";
import type { loadSemanticReviewRoomProjection } from "@/lib/work-management/semantic-review-room-projection";
import { isFullSourceCommitSha } from "./work-capsule-branch-identity";

type WorkroomIdentity = {
  capsuleId?: string;
  repositoryFullName: string | null;
  headBranch: string | null;
  worktreePath: string | null;
  baseSha: string | null;
  headSha: string | null;
  backlogItemId?: string | null;
  leaseHolderPrincipalId?: string | null;
};

type ReviewProjection = Pick<Awaited<ReturnType<typeof loadSemanticReviewRoomProjection>>, "runs" | "partial" | "attentionReason">;

type WorkroomReadback = { capsule: Record<string, unknown>; log?: { afterSequence: number; activity: unknown[]; hasMore: boolean } };

/** Preserve actionable facts instead of letting the route replace the whole room with a text preview. */
export function boundWorkroomRecoveryReadback(data: WorkroomReadback, fits: (value: unknown) => boolean) {
  if (fits(data)) return data;
  const retainedKeys = ["id", "capsuleId", "status", "backlogItemId", "repositoryFullName", "baseBranch", "baseSha",
    "headBranch", "headSha", "worktreePath", "executorKind", "executorRef", "leaseHolderPrincipalId", "leaseExpiresAt",
    "updatedAt", "createdByPrincipalId", "requestedByPrincipalId", "activitySequence", "taskRunId", "featureBuildId",
    "pullRequestUrl", "pullRequestNumber", "recovery", "investment"];
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

/** One observed execution shape for current and explicitly historical facts. */
function projectReviewExecution(run: ReviewProjection["runs"][number], nextAction = run.nextAction) {
  const recorded = projectRecordedTaskState(run.status);
  const receipt = run.status === "completed" || (run.status === "input-required" && run.receipt?.decision === "inconclusive")
    ? run.receipt : null;
  return {
    taskRunId: run.taskRunId, status: run.status, identityScope: run.identityScope,
    sourceHeadSha: run.sourceHeadSha ?? null,
    pending: recorded === "unknown" ? null : recorded !== "terminal",
    accountableOwner: { agentId: run.requesterAgentId ?? null, userId: run.requesterId, displayName: run.requesterName ?? null },
    reason: run.reason, nextAction,
    resultAction: run.requesterId ? { method: "tasks/result" as const, params: { taskId: run.taskRunId }, requiredUserId: run.requesterId } : null,
    heartbeat: run.heartbeat, lastHeartbeatAt: run.lastHeartbeatAt, readAt: run.readAt,
    budget: run.budget, receipt: receipt ?? null,
  };
}

/** Observations are readback, never completion evidence or retry authorization. */
function projectSemanticRecovery(room: WorkroomIdentity, view: ReviewProjection) {
  const runs = view.runs.filter(run => run.capsuleId === room.capsuleId);
  const current = runs.filter(run => run.identityScope === "current" && room.headSha && run.sourceHeadSha
    && run.sourceHeadSha.toLowerCase() === room.headSha.toLowerCase());
  if (!view.partial && runs.length === 0) return null;
  const run = current.length === 1 ? current[0] : null;
  const historical = runs.filter(run => run.identityScope === "historical");
  const recorded = run ? projectRecordedTaskState(run.status) : "unknown";
  // Retry retains prior receipts. They are historical while a new generation
  // executes, and must not replace that generation's working/queued state.
  const execution = run ? projectReviewExecution(run) : null;
  const receipt = execution?.receipt;
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
  const needsIssuer = view.partial || current.length !== 1;
  // The issuer owns recovery and exact packet selection. A repeat of this same
  // bounded observation cannot repair source absence, truncation or conflict.
  const issuerAction = room.backlogItemId ? { toolName: "get_backlog_item" as const,
    args: { itemId: room.backlogItemId, recoveryGate: "post-implementation-review" as const } } : null;
  const nextAction = needsIssuer
    ? issuerAction
      ? "The delivery coordinator must read get_backlog_item with post-implementation-review recovery for the current source. Historical reviews do not authorize a retry or publication."
      : "Link this Workroom to its governing backlog item through the existing delivery coordinator, then read that item's post-implementation-review recovery. Do not retry historical work."
    : run?.nextAction ?? view.attentionReason ?? "Read this Workroom again to resolve the current review identity and evidence.";
  return {
    state,
    reviewerExecution: execution ? { ...execution, nextAction } : null,
    historicalReviewerExecutions: historical.slice(0, 5).map(run => projectReviewExecution(run,
      "Historical source only. Inspect the recorded result with its requester identity; use the current item's recovery for further action.")),
    historicalReviewHistoryTruncated: historical.length > 5 || view.partial,
    blocker: reason ? { reason,
      accountableOwner: needsIssuer ? { principalId: room.leaseHolderPrincipalId ?? null, role: "delivery-coordinator" as const } : execution?.accountableOwner ?? null,
      nextAction, action: needsIssuer ? issuerAction : execution?.resultAction ?? null } : null,
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
    ...(!isFullSourceCommitSha(room.baseSha) ? ["baseSha" as const] : []),
    ...(!isFullSourceCommitSha(room.headSha) ? ["headSha" as const] : []),
  ];
  if (missingFields.length === 0) return null;
  const retainedFields = {
    repositoryFullName: room.repositoryFullName ?? "",
    headBranch: room.headBranch ?? "",
    worktreePath: room.worktreePath ?? "",
    ...(isFullSourceCommitSha(room.baseSha) ? { baseSha: room.baseSha } : {}),
    ...(isFullSourceCommitSha(room.headSha) ? { headSha: room.headSha } : {}),
  };
  // A caller's context cannot smuggle an unusable source value back into repair.
  const { baseSha: _base, headSha: _head, ...context } = packetFields;
  return {
    toolName: "adopt_worktree",
    missingFields,
    retainedFields,
    packet: {
      ...context,
      ...retainedFields,
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
    historicalReviewerExecutions: semantic?.historicalReviewerExecutions ?? [],
    historicalReviewHistoryTruncated: semantic?.historicalReviewHistoryTruncated ?? false,
    blocker: prerequisite ? { reason: "source-identity-missing", accountableRole: prerequisite.accountableRole,
      nextAction: prerequisite.nextAction, action: prerequisite.repair } : semantic?.blocker ?? null,
  };
}
